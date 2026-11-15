import { createHash, randomBytes } from "node:crypto";
import postgres from "postgres";

const MANAGER_ROLES = new Set(["owner", "admin"]);
const INVITABLE_ROLES = new Set(["admin", "agent"]);

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

function clean(value, max = 400) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function emailAddress(value) {
  const email = clean(value, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail(400, "Escribe un correo válido.");
  return email;
}

export function invitationTokenHash(token) {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

export function validateInvitedRegistration(input = {}) {
  const firstName = clean(input.nombre, 60);
  const lastName = clean(input.apellido, 60);
  const displayName = clean(`${firstName} ${lastName}`, 120);
  const username = clean(input.usuario, 40).toLowerCase();
  const email = emailAddress(input.correo);
  const password = String(input.clave ?? "");
  if (!firstName) throw fail(400, "Escribe tu nombre.");
  if (!lastName) throw fail(400, "Escribe tu apellido.");
  if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username)) {
    throw fail(400, "El usuario necesita de 3 a 40 caracteres: letras, números, punto, guion o guion bajo.");
  }
  if (password.length < 6) throw fail(400, "La clave necesita al menos 6 caracteres.");
  if (password.length > 128) throw fail(400, "La clave no puede superar 128 caracteres.");
  if (!/[a-z]/i.test(password) || !/\d/.test(password)) throw fail(400, "La clave debe incluir letras y números.");
  return { firstName, lastName, displayName, username, email, password };
}

export function createTeamPersistence(databaseUrl = process.env.SUPABASE_DATABASE_URL) {
  if (!String(databaseUrl || "").trim()) throw new Error("SUPABASE_DATABASE_URL es obligatorio para administrar equipos.");
  const sql = postgres(databaseUrl, { max: 4, prepare: false });

  async function manager(transaction, organizationId, actorId, { ownerOnly = false } = {}) {
    const [membership] = await transaction`
      select role
      from public.organization_memberships
      where organization_id = ${organizationId} and user_id = ${actorId} and active
      for update
    `;
    if (!membership || !MANAGER_ROLES.has(membership.role) || (ownerOnly && membership.role !== "owner")) {
      throw fail(403, ownerOnly ? "Solo el propietario puede transferir la organización." : "No tienes permiso para administrar este equipo.");
    }
    return membership.role;
  }

  async function organizationCompanies(transaction, organizationId) {
    return transaction`
      select id, name
      from public.companies
      where organization_id = ${organizationId}
      order by created_at, name
    `;
  }

  function allowedCompanies(companies, requested, role) {
    const known = new Set(companies.map((company) => company.id));
    const selected = [...new Set((requested || []).map(String))];
    if (selected.some((id) => !known.has(id))) throw fail(400, "Una de las empresas no pertenece a esta organización.");
    const result = role === "admin" ? companies.map((company) => company.id) : selected;
    if (!result.length) throw fail(400, "Elige al menos una empresa para el miembro.");
    return result;
  }

  async function acceptInside(transaction, { tokenHash, userId, email }) {
    const [invitation] = await transaction`
      select id, organization_id, role
      from public.organization_invitations
      where token_hash = ${tokenHash}
        and lower(email) = ${email}
        and accepted_at is null
        and revoked_at is null
        and expires_at > now()
      for update
    `;
    if (!invitation) throw fail(410, "Esta invitación no es válida, venció o ya fue usada.");
    const companies = await transaction`
      select company_id
      from public.organization_invitation_companies
      where invitation_id = ${invitation.id}
      order by company_id
    `;
    if (!companies.length) throw fail(409, "La invitación no tiene empresas asignadas.");
    await transaction`
      insert into public.organization_memberships (organization_id, user_id, role, active)
      values (${invitation.organization_id}, ${userId}, ${invitation.role}, true)
      on conflict (organization_id, user_id) do update set role = excluded.role, active = true
    `;
    await transaction`
      update public.company_memberships membership
      set active = false
      from public.companies company
      where membership.company_id = company.id
        and company.organization_id = ${invitation.organization_id}
        and membership.user_id = ${userId}
    `;
    for (const company of companies) {
      await transaction`
        insert into public.company_memberships (company_id, user_id, role, active)
        values (${company.company_id}, ${userId}, ${invitation.role}, true)
        on conflict (company_id, user_id) do update set role = excluded.role, active = true
      `;
    }
    await transaction`
      update public.profiles
      set default_company_id = ${companies[0].company_id}
      where id = ${userId}
        and not exists (
          select 1 from public.company_memberships current_membership
          where current_membership.user_id = ${userId}
            and current_membership.company_id = profiles.default_company_id
            and current_membership.active
        )
    `;
    await transaction`
      update public.organization_invitations
      set accepted_at = now(), accepted_by = ${userId}
      where id = ${invitation.id}
    `;
    return { organizationId: invitation.organization_id, companyId: companies[0].company_id };
  }

  return {
    async list(organizationId, actorId) {
      return sql.begin(async (transaction) => {
        const actorRole = await manager(transaction, organizationId, actorId);
        const [companies, memberRows, companyRows, invitationRows, invitationCompanyRows] = await Promise.all([
          organizationCompanies(transaction, organizationId),
          transaction`
            select membership.user_id, membership.role, membership.active, membership.created_at,
                   profile.display_name, profile.username, auth_user.email
            from public.organization_memberships membership
            join public.profiles profile on profile.id = membership.user_id
            join auth.users auth_user on auth_user.id = membership.user_id
            where membership.organization_id = ${organizationId}
            order by membership.active desc, membership.created_at, profile.display_name
          `,
          transaction`
            select membership.user_id, membership.company_id, membership.active
            from public.company_memberships membership
            join public.companies company on company.id = membership.company_id
            where company.organization_id = ${organizationId}
          `,
          transaction`
            select id, email, role, expires_at, created_at
            from public.organization_invitations
            where organization_id = ${organizationId}
              and accepted_at is null and revoked_at is null and expires_at > now()
            order by created_at desc
          `,
          transaction`
            select link.invitation_id, link.company_id
            from public.organization_invitation_companies link
            join public.organization_invitations invitation on invitation.id = link.invitation_id
            where invitation.organization_id = ${organizationId}
              and invitation.accepted_at is null and invitation.revoked_at is null and invitation.expires_at > now()
          `,
        ]);
        const membershipsByUser = new Map();
        for (const row of companyRows) {
          if (!row.active) continue;
          const ids = membershipsByUser.get(row.user_id) || [];
          ids.push(row.company_id);
          membershipsByUser.set(row.user_id, ids);
        }
        const companiesByInvitation = new Map();
        for (const row of invitationCompanyRows) {
          const ids = companiesByInvitation.get(row.invitation_id) || [];
          ids.push(row.company_id);
          companiesByInvitation.set(row.invitation_id, ids);
        }
        return {
          actorRole,
          companies: companies.map((company) => ({ id: company.id, nombre: company.name })),
          members: memberRows.map((row) => ({
            id: row.user_id,
            nombre: row.display_name,
            usuario: row.username,
            correo: row.email,
            rol: row.role,
            activo: row.active,
            empresaIds: membershipsByUser.get(row.user_id) || [],
          })),
          invitations: invitationRows.map((row) => ({
            id: row.id,
            correo: row.email,
            rol: row.role,
            venceEn: row.expires_at,
            creadaEn: row.created_at,
            empresaIds: companiesByInvitation.get(row.id) || [],
          })),
        };
      });
    },

    async createInvitation(record) {
      return sql.begin(async (transaction) => {
        const actorRole = await manager(transaction, record.organizationId, record.actorId);
        if (actorRole === "admin" && record.role !== "agent") throw fail(403, "Un administrador solo puede invitar agentes.");
        const companies = await organizationCompanies(transaction, record.organizationId);
        const companyIds = allowedCompanies(companies, record.companyIds, record.role);
        await transaction`
          update public.organization_invitations
          set revoked_at = now()
          where organization_id = ${record.organizationId}
            and lower(email) = ${record.email}
            and accepted_at is null and revoked_at is null
        `;
        const [invitation] = await transaction`
          insert into public.organization_invitations
            (organization_id, email, role, token_hash, invited_by, expires_at)
          values
            (${record.organizationId}, ${record.email}, ${record.role}, ${record.tokenHash}, ${record.actorId}, now() + interval '7 days')
          returning id, expires_at
        `;
        for (const companyId of companyIds) {
          await transaction`
            insert into public.organization_invitation_companies (invitation_id, company_id)
            values (${invitation.id}, ${companyId})
          `;
        }
        return { id: invitation.id, venceEn: invitation.expires_at, companyIds };
      });
    },

    async preview(tokenHash) {
      const [invitation] = await sql`
        select invitation.id, invitation.email, invitation.role, invitation.expires_at,
               organization.id as organization_id, organization.name as organization_name
        from public.organization_invitations invitation
        join public.organizations organization on organization.id = invitation.organization_id
        where invitation.token_hash = ${tokenHash}
          and invitation.accepted_at is null and invitation.revoked_at is null and invitation.expires_at > now()
      `;
      if (!invitation) throw fail(410, "Esta invitación no es válida, venció o ya fue usada.");
      const companies = await sql`
        select company.id, company.name
        from public.organization_invitation_companies link
        join public.companies company on company.id = link.company_id
        where link.invitation_id = ${invitation.id}
        order by company.name
      `;
      return { ...invitation, companies };
    },

    async accept(record) {
      return sql.begin((transaction) => acceptInside(transaction, record));
    },

    async registerInvited(record) {
      return sql.begin(async (transaction) => {
        await transaction`
          insert into public.profiles (id, username, display_name, first_name, last_name)
          values (${record.userId}, ${record.username}, ${record.displayName}, ${record.firstName}, ${record.lastName})
        `;
        return acceptInside(transaction, record);
      });
    },

    async updateMember(record) {
      return sql.begin(async (transaction) => {
        const actorRole = await manager(transaction, record.organizationId, record.actorId);
        const [target] = await transaction`
          select role, active
          from public.organization_memberships
          where organization_id = ${record.organizationId} and user_id = ${record.userId}
          for update
        `;
        if (!target) throw fail(404, "No encontramos ese miembro.");
        if (record.userId === record.actorId && !record.active) throw fail(409, "No puedes suspender tu propio acceso.");
        if (target.role === "owner") throw fail(409, "Transfiere la propiedad antes de modificar al propietario.");
        if (actorRole === "admin" && (target.role !== "agent" || record.role !== "agent")) {
          throw fail(403, "Un administrador solo puede gestionar agentes.");
        }
        const companies = await organizationCompanies(transaction, record.organizationId);
        const companyIds = record.active ? allowedCompanies(companies, record.companyIds, record.role) : [];
        await transaction`
          update public.organization_memberships
          set role = ${record.role}, active = ${record.active}
          where organization_id = ${record.organizationId} and user_id = ${record.userId}
        `;
        await transaction`
          update public.company_memberships membership
          set active = false
          from public.companies company
          where membership.company_id = company.id
            and company.organization_id = ${record.organizationId}
            and membership.user_id = ${record.userId}
        `;
        for (const companyId of companyIds) {
          await transaction`
            insert into public.company_memberships (company_id, user_id, role, active)
            values (${companyId}, ${record.userId}, ${record.role}, true)
            on conflict (company_id, user_id) do update set role = excluded.role, active = true
          `;
        }
        const [fallback] = await transaction`
          select membership.company_id
          from public.company_memberships membership
          where membership.user_id = ${record.userId} and membership.active
          order by membership.created_at
          limit 1
        `;
        await transaction`
          update public.profiles
          set default_company_id = ${fallback?.company_id || null}
          where id = ${record.userId}
            and not exists (
              select 1 from public.company_memberships current_membership
              where current_membership.user_id = ${record.userId}
                and current_membership.company_id = profiles.default_company_id
                and current_membership.active
            )
        `;
        return { ok: true };
      });
    },

    async transfer(record) {
      return sql.begin(async (transaction) => {
        await manager(transaction, record.organizationId, record.actorId, { ownerOnly: true });
        if (record.userId === record.actorId) throw fail(400, "Elige otro miembro para transferir la propiedad.");
        const [target] = await transaction`
          select role from public.organization_memberships
          where organization_id = ${record.organizationId} and user_id = ${record.userId} and active
          for update
        `;
        if (!target) throw fail(404, "El nuevo propietario debe ser un miembro activo.");
        const companies = await organizationCompanies(transaction, record.organizationId);
        await transaction`
          update public.organization_memberships
          set role = case when user_id = ${record.userId} then 'owner' else 'admin' end
          where organization_id = ${record.organizationId} and role = 'owner'
        `;
        await transaction`
          update public.organization_memberships set role = 'owner', active = true
          where organization_id = ${record.organizationId} and user_id = ${record.userId}
        `;
        await transaction`
          update public.company_memberships company_membership
          set role = 'admin'
          from public.companies company, public.organization_memberships organization_membership
          where company_membership.company_id = company.id
            and company.organization_id = ${record.organizationId}
            and organization_membership.organization_id = ${record.organizationId}
            and organization_membership.user_id = company_membership.user_id
            and organization_membership.role = 'admin'
            and company_membership.role = 'owner'
        `;
        for (const company of companies) {
          await transaction`
            insert into public.company_memberships (company_id, user_id, role, active)
            values (${company.id}, ${record.userId}, 'owner', true)
            on conflict (company_id, user_id) do update set role = 'owner', active = true
          `;
          await transaction`
            update public.company_memberships set role = 'admin', active = true
            where company_id = ${company.id} and user_id = ${record.actorId}
          `;
        }
        return { ok: true };
      });
    },

    async revokeInvitation(organizationId, invitationId, actorId) {
      return sql.begin(async (transaction) => {
        await manager(transaction, organizationId, actorId);
        const result = await transaction`
          update public.organization_invitations
          set revoked_at = now()
          where id = ${invitationId} and organization_id = ${organizationId}
            and accepted_at is null and revoked_at is null
          returning id
        `;
        if (!result.length) throw fail(404, "No encontramos esa invitación pendiente.");
        return { ok: true };
      });
    },

    close() {
      return sql.end({ timeout: 2 });
    },
  };
}

function maskedEmail(email) {
  const [local, domain] = String(email).split("@");
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}${"•".repeat(Math.max(2, local.length - visible.length))}@${domain}`;
}

export function createTeamService({ admin, persistence = createTeamPersistence(), tokenFactory = () => randomBytes(32).toString("base64url") } = {}) {
  if (!admin?.auth?.admin) throw new Error("La administración de equipos necesita Supabase Auth.");

  async function preview(token) {
    const raw = clean(token, 200);
    if (raw.length < 32) throw fail(410, "Esta invitación no es válida, venció o ya fue usada.");
    const invitation = await persistence.preview(invitationTokenHash(raw));
    return {
      organizacion: { id: invitation.organization_id, nombre: invitation.organization_name },
      correo: maskedEmail(invitation.email),
      rol: invitation.role,
      venceEn: invitation.expires_at,
      empresas: invitation.companies.map((company) => ({ id: company.id, nombre: company.name })),
    };
  }

  return {
    list: (organizationId, actorId) => persistence.list(clean(organizationId, 80), actorId),

    async createInvitation(organizationId, actorId, input = {}) {
      const role = clean(input.rol, 20);
      if (!INVITABLE_ROLES.has(role)) throw fail(400, "El rol debe ser administrador o agente.");
      const token = tokenFactory();
      const created = await persistence.createInvitation({
        organizationId: clean(organizationId, 80),
        actorId,
        email: emailAddress(input.correo),
        role,
        companyIds: Array.isArray(input.empresaIds) ? input.empresaIds : [],
        tokenHash: invitationTokenHash(token),
      });
      return { ...created, token };
    },

    preview,

    async accept(userId, token) {
      const user = await admin.auth.admin.getUserById(userId);
      const email = user.data?.user?.email?.toLowerCase();
      if (user.error || !email) throw fail(401, "No pudimos verificar el correo de tu cuenta.");
      const result = await persistence.accept({ tokenHash: invitationTokenHash(token), userId, email });
      return result;
    },

    async registerInvited(input = {}) {
      const token = clean(input.invitacion, 200);
      const invitation = await persistence.preview(invitationTokenHash(token));
      const values = validateInvitedRegistration(input);
      if (values.email !== String(invitation.email).toLowerCase()) throw fail(403, "Usa el mismo correo al que se envió la invitación.");
      const created = await admin.auth.admin.createUser({
        email: values.email,
        password: values.password,
        email_confirm: true,
        app_metadata: { pulse_local_signup: true },
      });
      const authUser = created.data?.user;
      if (created.error || !authUser) throw fail(409, "Ese usuario o correo ya está en uso. Entra con tu cuenta y acepta la invitación.");
      try {
        const accepted = await persistence.registerInvited({
          tokenHash: invitationTokenHash(token),
          userId: authUser.id,
          email: values.email,
          ...values,
        });
        return {
          user: { id: authUser.id, nombre: values.displayName, usuario: values.username },
          company: { id: accepted.companyId },
          organization: { id: accepted.organizationId, nombre: invitation.organization_name },
        };
      } catch (error) {
        await admin.auth.admin.deleteUser(authUser.id).catch(() => {});
        if (String(error?.code || "") === "23505") throw fail(409, "Ese usuario o correo ya está en uso.");
        throw error;
      }
    },

    async updateMember(organizationId, actorId, userId, input = {}) {
      const role = clean(input.rol, 20);
      if (!INVITABLE_ROLES.has(role)) throw fail(400, "El rol debe ser administrador o agente.");
      return persistence.updateMember({
        organizationId: clean(organizationId, 80),
        actorId,
        userId: clean(userId, 80),
        role,
        active: input.activo !== false,
        companyIds: Array.isArray(input.empresaIds) ? input.empresaIds : [],
      });
    },

    transfer: (organizationId, actorId, userId) => persistence.transfer({
      organizationId: clean(organizationId, 80), actorId, userId: clean(userId, 80),
    }),

    revokeInvitation: (organizationId, invitationId, actorId) => persistence.revokeInvitation(
      clean(organizationId, 80), clean(invitationId, 80), actorId,
    ),

    close: () => persistence.close?.(),
  };
}
