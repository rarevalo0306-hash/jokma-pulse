alter table public.profiles
  add column username text not null,
  add column default_company_id uuid references public.companies (id) on delete set null;

alter table public.profiles
  add constraint profiles_username_format
  check (username ~ '^[a-z0-9][a-z0-9._-]{2,39}$');

create unique index profiles_username_lower_key
  on public.profiles (lower(username));

create index profiles_default_company_idx
  on public.profiles (default_company_id)
  where default_company_id is not null;
