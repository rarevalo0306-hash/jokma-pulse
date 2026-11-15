alter table public.profiles
  add column first_name text not null default '',
  add column last_name text not null default '';

update public.profiles
set
  first_name = split_part(trim(display_name), ' ', 1),
  last_name = trim(substr(trim(display_name), length(split_part(trim(display_name), ' ', 1)) + 1));

alter table public.profiles
  add constraint profiles_first_name_length
    check (char_length(trim(first_name)) between 1 and 80),
  add constraint profiles_last_name_length
    check (char_length(trim(last_name)) between 0 and 80);
