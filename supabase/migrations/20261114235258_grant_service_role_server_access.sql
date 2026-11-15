grant select, insert, update, delete on table
  public.profiles,
  public.companies,
  public.company_memberships,
  public.channel_accounts,
  public.contacts,
  public.contact_identities,
  public.conversations,
  public.messages
to service_role;

alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to service_role;
