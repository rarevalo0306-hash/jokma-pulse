create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null check (char_length(trim(email)) between 3 and 254),
  role text not null default 'agent' check (role in ('admin', 'agent')),
  token_hash text not null check (token_hash ~ '^[a-f0-9]{64}$'),
  invited_by uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint organization_invitations_expiry_after_creation check (expires_at > created_at),
  constraint organization_invitations_single_terminal_state check (accepted_at is null or revoked_at is null)
);

create unique index organization_invitations_token_hash_key
  on public.organization_invitations (token_hash);

create unique index organization_invitations_pending_email_key
  on public.organization_invitations (organization_id, lower(email))
  where accepted_at is null and revoked_at is null;

create index organization_invitations_organization_created_idx
  on public.organization_invitations (organization_id, created_at desc);

create table public.organization_invitation_companies (
  invitation_id uuid not null references public.organization_invitations (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  primary key (invitation_id, company_id)
);

create index organization_invitation_companies_company_idx
  on public.organization_invitation_companies (company_id, invitation_id);

alter table public.organization_invitations enable row level security;
alter table public.organization_invitation_companies enable row level security;

revoke all on table public.organization_invitations, public.organization_invitation_companies from anon, authenticated;
grant all on table public.organization_invitations, public.organization_invitation_companies to service_role;
