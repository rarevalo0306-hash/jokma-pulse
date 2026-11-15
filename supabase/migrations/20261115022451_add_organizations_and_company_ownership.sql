create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  name text not null check (char_length(trim(name)) between 1 and 160),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create unique index organizations_slug_lower_key on public.organizations (lower(slug));

create table public.organization_memberships (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'agent' check (role in ('owner', 'admin', 'agent')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index organization_memberships_user_organization_idx
  on public.organization_memberships (user_id, organization_id)
  where active;

alter table public.companies
  add column organization_id uuid references public.organizations (id) on delete cascade;

insert into public.organizations (id, slug, name, created_by, created_at, updated_at)
select
  company.id,
  company.slug,
  company.name,
  (
    select membership.user_id
    from public.company_memberships membership
    where membership.company_id = company.id and membership.active
    order by case membership.role when 'owner' then 1 when 'admin' then 2 else 3 end, membership.created_at
    limit 1
  ),
  company.created_at,
  company.updated_at
from public.companies company;

update public.companies
set organization_id = id
where organization_id is null;

alter table public.companies
  alter column organization_id set not null;

create index companies_organization_idx on public.companies (organization_id, created_at);

insert into public.organization_memberships (organization_id, user_id, role, active, created_at)
select company.organization_id, membership.user_id, membership.role, membership.active, membership.created_at
from public.company_memberships membership
join public.companies company on company.id = membership.company_id
on conflict (organization_id, user_id) do update
set
  active = excluded.active,
  role = case
    when organization_memberships.role = 'owner' or excluded.role = 'owner' then 'owner'
    when organization_memberships.role = 'admin' or excluded.role = 'admin' then 'admin'
    else 'agent'
  end;

alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;

revoke all on public.organizations, public.organization_memberships from anon, authenticated;
grant select on public.organizations, public.organization_memberships to authenticated;
grant all on public.organizations, public.organization_memberships to service_role;

create policy organizations_select_members on public.organizations
for select to authenticated
using (
  exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = organizations.id
      and membership.user_id = (select auth.uid())
      and membership.active
  )
);

create policy organization_memberships_select_own on public.organization_memberships
for select to authenticated
using (user_id = (select auth.uid()) and active);
