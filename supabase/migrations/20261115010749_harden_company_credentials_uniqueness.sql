create unique index integration_credentials_company_provider_key
  on private.integration_credentials (company_id, provider)
  where channel_account_id is null;
