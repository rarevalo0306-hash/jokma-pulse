create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  name text not null check (char_length(trim(name)) between 1 and 160),
  industry text not null default '',
  services text not null default '',
  business_hours text not null default '',
  phone text not null default '',
  official_email text not null default '',
  website text not null default '',
  support_contact text not null default '',
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint companies_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create unique index companies_slug_lower_key on public.companies (lower(slug));

create table public.company_memberships (
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'agent' check (role in ('owner', 'admin', 'agent')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

create index company_memberships_user_company_idx
  on public.company_memberships (user_id, company_id)
  where active;

create table public.channel_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  channel text not null check (channel in (
    'google_reviews', 'instagram_dm', 'instagram_comment',
    'facebook_messenger', 'facebook_comment', 'x_post', 'x_dm', 'email'
  )),
  external_account_id text not null,
  label text not null,
  agent_name text not null,
  tone text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, channel, external_account_id),
  unique (company_id, id)
);

create index channel_accounts_company_idx on public.channel_accounts (company_id, active);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 160),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id)
);

create index contacts_company_idx on public.contacts (company_id, updated_at desc);

create table public.contact_identities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  contact_id uuid not null,
  channel_account_id uuid not null,
  external_user_id text not null,
  created_at timestamptz not null default now(),
  unique (channel_account_id, external_user_id),
  foreign key (company_id, contact_id) references public.contacts (company_id, id) on delete cascade,
  foreign key (company_id, channel_account_id) references public.channel_accounts (company_id, id) on delete cascade
);

create index contact_identities_contact_idx on public.contact_identities (contact_id);
create index contact_identities_company_idx on public.contact_identities (company_id);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  contact_id uuid not null,
  status text not null default 'open' check (status in ('open', 'pending', 'closed')),
  assigned_user_id uuid references auth.users (id) on delete set null,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, contact_id),
  unique (company_id, id),
  foreign key (company_id, contact_id) references public.contacts (company_id, id) on delete cascade
);

create index conversations_company_queue_idx
  on public.conversations (company_id, status, last_message_at desc nulls last);
create index conversations_assigned_user_idx
  on public.conversations (assigned_user_id)
  where assigned_user_id is not null;

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  conversation_id uuid not null,
  channel_account_id uuid not null,
  external_message_id text,
  direction text not null default 'inbound' check (direction in ('inbound', 'outbound')),
  body text not null check (char_length(trim(body)) between 1 and 8000),
  rating smallint check (rating between 1 and 5),
  reply_draft text,
  delivery_state text not null default 'pending' check (delivery_state in (
    'pending', 'draft', 'approved', 'sending', 'sent', 'delivered', 'error'
  )),
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  error_code text,
  error_detail text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint messages_approval_consistency check (
    (delivery_state not in ('approved', 'sending', 'sent', 'delivered'))
    or (approved_at is not null and approved_by is not null)
  ),
  foreign key (company_id, conversation_id) references public.conversations (company_id, id) on delete cascade,
  foreign key (company_id, channel_account_id) references public.channel_accounts (company_id, id) on delete restrict
);

create unique index messages_external_id_key
  on public.messages (channel_account_id, external_message_id)
  where external_message_id is not null;
create index messages_conversation_timeline_idx
  on public.messages (conversation_id, created_at, id);
create index messages_company_state_idx
  on public.messages (company_id, delivery_state, created_at desc);

create table private.integration_credentials (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  channel_account_id uuid,
  provider text not null check (provider in ('meta', 'x', 'google', 'email')),
  ciphertext bytea not null,
  key_version integer not null default 1 check (key_version > 0),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, provider, channel_account_id),
  foreign key (company_id, channel_account_id) references public.channel_accounts (company_id, id) on delete cascade
);

revoke all on all tables in schema private from public, anon, authenticated;
grant select, insert, update, delete on all tables in schema private to service_role;

alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.company_memberships enable row level security;
alter table public.channel_accounts enable row level security;
alter table public.contacts enable row level security;
alter table public.contact_identities enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

grant select, insert, update on public.profiles to authenticated;
grant select, update on public.companies to authenticated;
grant select on public.company_memberships to authenticated;
grant select, insert, update, delete on public.channel_accounts to authenticated;
grant select, insert, update, delete on public.contacts to authenticated;
grant select, insert, update, delete on public.contact_identities to authenticated;
grant select, insert, update, delete on public.conversations to authenticated;
grant select, insert, update, delete on public.messages to authenticated;

create policy profiles_select_own on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check ((select auth.uid()) = id);

create policy profiles_update_own on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy memberships_select_own on public.company_memberships
  for select to authenticated
  using ((select auth.uid()) = user_id and active);

create policy companies_select_members on public.companies
  for select to authenticated
  using (exists (
    select 1 from public.company_memberships membership
    where membership.company_id = companies.id
      and membership.user_id = (select auth.uid())
      and membership.active
  ));

create policy companies_update_admins on public.companies
  for update to authenticated
  using (exists (
    select 1 from public.company_memberships membership
    where membership.company_id = companies.id
      and membership.user_id = (select auth.uid())
      and membership.role in ('owner', 'admin')
      and membership.active
  ))
  with check (exists (
    select 1 from public.company_memberships membership
    where membership.company_id = companies.id
      and membership.user_id = (select auth.uid())
      and membership.role in ('owner', 'admin')
      and membership.active
  ));

create policy channel_accounts_select_members on public.channel_accounts
  for select to authenticated
  using (exists (
    select 1 from public.company_memberships membership
    where membership.company_id = channel_accounts.company_id
      and membership.user_id = (select auth.uid())
      and membership.active
  ));

create policy channel_accounts_insert_admins on public.channel_accounts
  for insert to authenticated
  with check (exists (
    select 1 from public.company_memberships membership
    where membership.company_id = channel_accounts.company_id
      and membership.user_id = (select auth.uid())
      and membership.role in ('owner', 'admin')
      and membership.active
  ));

create policy channel_accounts_update_admins on public.channel_accounts
  for update to authenticated
  using (exists (
    select 1 from public.company_memberships membership
    where membership.company_id = channel_accounts.company_id
      and membership.user_id = (select auth.uid())
      and membership.role in ('owner', 'admin')
      and membership.active
  ))
  with check (exists (
    select 1 from public.company_memberships membership
    where membership.company_id = channel_accounts.company_id
      and membership.user_id = (select auth.uid())
      and membership.role in ('owner', 'admin')
      and membership.active
  ));

create policy channel_accounts_delete_admins on public.channel_accounts
  for delete to authenticated
  using (exists (
    select 1 from public.company_memberships membership
    where membership.company_id = channel_accounts.company_id
      and membership.user_id = (select auth.uid())
      and membership.role in ('owner', 'admin')
      and membership.active
  ));

create policy contacts_members on public.contacts
  for all to authenticated
  using (exists (
    select 1 from public.company_memberships membership
    where membership.company_id = contacts.company_id
      and membership.user_id = (select auth.uid())
      and membership.active
  ))
  with check (exists (
    select 1 from public.company_memberships membership
    where membership.company_id = contacts.company_id
      and membership.user_id = (select auth.uid())
      and membership.active
  ));

create policy contact_identities_members on public.contact_identities
  for all to authenticated
  using (exists (
    select 1 from public.company_memberships membership
    where membership.company_id = contact_identities.company_id
      and membership.user_id = (select auth.uid())
      and membership.active
  ))
  with check (exists (
    select 1 from public.company_memberships membership
    where membership.company_id = contact_identities.company_id
      and membership.user_id = (select auth.uid())
      and membership.active
  ));

create policy conversations_members on public.conversations
  for all to authenticated
  using (exists (
    select 1 from public.company_memberships membership
    where membership.company_id = conversations.company_id
      and membership.user_id = (select auth.uid())
      and membership.active
  ))
  with check (exists (
    select 1 from public.company_memberships membership
    where membership.company_id = conversations.company_id
      and membership.user_id = (select auth.uid())
      and membership.active
  ));

create policy messages_members on public.messages
  for all to authenticated
  using (exists (
    select 1 from public.company_memberships membership
    where membership.company_id = messages.company_id
      and membership.user_id = (select auth.uid())
      and membership.active
  ))
  with check (exists (
    select 1 from public.company_memberships membership
    where membership.company_id = messages.company_id
      and membership.user_id = (select auth.uid())
      and membership.active
  ));
