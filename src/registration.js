import { randomUUID } from "node:crypto";
import postgres from "postgres";

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

function clean(value, max) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function slug(value) {
  return String(value || "empresa")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "empresa";
}

export function registrationEnabled(env = process.env) {
  const development = !env.VERCEL && String(env.NODE_ENV || "development").toLowerCase() !== "production";
  return development && String(env.PULSE_STORE || "").toLowerCase() === "supabase"
    && String(env.PULSE_ALLOW_SIGNUP || "").toLowerCase() === "true";
}

export function validateRegistration(input = {}) {
  const firstName = clean(input.nombre, 60);
  const lastName = clean(input.apellido, 60);
  const displayName = clean(`${firstName} ${lastName}`, 120);
  const organizationName = clean(input.organizacion, 160);
  const companyName = clean(input.empresa, 160);
  const industry = clean(input.industria, 240);
  const username = clean(input.usuario, 40).toLowerCase();
  const email = clean(input.correo, 254).toLowerCase();
  const password = String(input.clave ?? "");

  if (!firstName) throw fail(400, "Escribe tu nombre.");
  if (!lastName) throw fail(400, "Escribe tu apellido.");
  if (!organizationName) throw fail(400, "Escribe el nombre de tu organización.");
  if (!companyName) throw fail(400, "Escribe el nombre de tu primera empresa.");
  if (!industry) throw fail(400, "Escribe la industria o actividad de tu empresa.");
  if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username)) {
    throw fail(400, "El usuario necesita de 3 a 40 caracteres: letras, números, punto, guion o guion bajo.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw fail(400, "Escribe un correo válido.");
  }
  if (password.length < 6) throw fail(400, "La clave necesita al menos 6 caracteres.");
  if (password.length > 128) throw fail(400, "La clave no puede superar 128 caracteres.");
  if (!/[a-z]/i.test(password) || !/\d/.test(password)) {
    throw fail(400, "La clave debe incluir letras y números.");
  }

  return { firstName, lastName, displayName, organizationName, companyName, industry, username, email, password };
}

export function createRegistrationPersistence(databaseUrl = process.env.SUPABASE_DATABASE_URL) {
  if (!String(databaseUrl || "").trim()) throw new Error("SUPABASE_DATABASE_URL es obligatorio para el registro local.");
  const sql = postgres(databaseUrl, { max: 2, prepare: false });

  return {
    async save(record) {
      await sql.begin(async (transaction) => {
        await transaction`
          insert into public.organizations (id, slug, name, created_by)
          values (${record.organizationId}, ${record.organizationSlug}, ${record.organizationName}, ${record.userId})
        `;
        await transaction`
          insert into public.companies (id, organization_id, slug, name, industry, settings)
          values (${record.companyId}, ${record.organizationId}, ${record.companySlug}, ${record.companyName}, ${record.industry}, ${{}})
        `;
        await transaction`
          insert into public.profiles (id, username, display_name, first_name, last_name, default_company_id)
          values (${record.userId}, ${record.username}, ${record.displayName}, ${record.firstName}, ${record.lastName}, ${record.companyId})
        `;
        await transaction`
          insert into public.organization_memberships (organization_id, user_id, role, active)
          values (${record.organizationId}, ${record.userId}, 'owner', true)
        `;
        await transaction`
          insert into public.company_memberships (company_id, user_id, role, active)
          values (${record.companyId}, ${record.userId}, 'owner', true)
        `;
      });
    },
    async close() {
      await sql.end({ timeout: 2 });
    },
  };
}

export function createRegistrationService({
  admin,
  persistence = createRegistrationPersistence(),
  idFactory = randomUUID,
} = {}) {
  if (!admin?.auth?.admin) throw new Error("El registro local necesita un cliente administrador de Supabase.");

  async function register(input) {
    const values = validateRegistration(input);
    const organizationId = idFactory();
    const companyId = idFactory();
    const organizationSlug = `${slug(values.organizationName)}-${organizationId.slice(0, 8)}`;
    const companySlug = `${slug(values.companyName)}-${companyId.slice(0, 8)}`;
    const created = await admin.auth.admin.createUser({
      email: values.email,
      password: values.password,
      email_confirm: true,
      app_metadata: { pulse_local_signup: true },
    });
    const authUser = created.data?.user;
    if (created.error || !authUser) {
      throw fail(409, "Ese usuario o correo ya está en uso.");
    }

    try {
      await persistence.save({
        userId: authUser.id,
        organizationId,
        companyId,
        organizationSlug,
        companySlug,
        ...values,
      });
    } catch (error) {
      await admin.auth.admin.deleteUser(authUser.id).catch(() => {});
      if (String(error?.code || "") === "23505") {
        throw fail(409, "Ese usuario o correo ya está en uso.");
      }
      throw error;
    }

    return {
      user: { id: authUser.id, nombre: values.displayName, usuario: values.username },
      organization: { id: organizationId, nombre: values.organizationName },
      company: { id: companyId, nombre: values.companyName, industria: values.industry },
    };
  }

  return { register, close: () => persistence.close?.() };
}
