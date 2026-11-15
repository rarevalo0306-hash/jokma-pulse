alter table private.integration_credentials enable row level security;

create index integration_credentials_company_account_idx
  on private.integration_credentials (company_id, channel_account_id);

drop index if exists public.contact_identities_company_idx;

create index contact_identities_company_contact_idx
  on public.contact_identities (company_id, contact_id);

create index contact_identities_company_account_idx
  on public.contact_identities (company_id, channel_account_id);

create index messages_approved_by_idx
  on public.messages (approved_by)
  where approved_by is not null;

create index messages_company_account_idx
  on public.messages (company_id, channel_account_id);

create index messages_company_conversation_idx
  on public.messages (company_id, conversation_id);
