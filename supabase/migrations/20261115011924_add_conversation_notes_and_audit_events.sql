create table public.conversation_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  conversation_id uuid not null,
  author_user_id uuid not null references auth.users (id) on delete restrict,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  foreign key (company_id, conversation_id) references public.conversations (company_id, id) on delete cascade
);

create index conversation_notes_timeline_idx
  on public.conversation_notes (conversation_id, created_at, id);
create index conversation_notes_author_idx
  on public.conversation_notes (author_user_id);

create table public.audit_events (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  action text not null check (char_length(action) between 1 and 120),
  entity_type text not null check (entity_type in ('conversation', 'message', 'connection')),
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index audit_events_company_timeline_idx
  on public.audit_events (company_id, created_at desc, id desc);
create index audit_events_actor_idx
  on public.audit_events (actor_user_id)
  where actor_user_id is not null;

alter table public.conversation_notes enable row level security;
alter table public.audit_events enable row level security;

grant select, insert, update, delete on public.conversation_notes to authenticated;
grant select on public.audit_events to authenticated;
grant select, insert, update, delete on public.conversation_notes to service_role;
grant select, insert, update, delete on public.audit_events to service_role;
grant usage, select on sequence public.audit_events_id_seq to service_role;

create policy conversation_notes_members on public.conversation_notes
  for all to authenticated
  using (exists (
    select 1 from public.company_memberships membership
    where membership.company_id = conversation_notes.company_id
      and membership.user_id = (select auth.uid())
      and membership.active
  ))
  with check (
    author_user_id = (select auth.uid())
    and exists (
      select 1 from public.company_memberships membership
      where membership.company_id = conversation_notes.company_id
        and membership.user_id = (select auth.uid())
        and membership.active
    )
  );

create policy audit_events_select_members on public.audit_events
  for select to authenticated
  using (exists (
    select 1 from public.company_memberships membership
    where membership.company_id = audit_events.company_id
      and membership.user_id = (select auth.uid())
      and membership.active
  ));
