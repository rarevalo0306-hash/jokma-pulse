BEGIN;
SELECT plan(6);

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.organization_invitations'::regclass),
  'organization_invitations has RLS enabled'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.organization_invitation_companies'::regclass),
  'organization_invitation_companies has RLS enabled'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.organization_invitations', 'select')
  AND NOT has_table_privilege('anon', 'public.organization_invitation_companies', 'select'),
  'anon cannot read invitation records'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.organization_invitations', 'select')
  AND NOT has_table_privilege('authenticated', 'public.organization_invitation_companies', 'select'),
  'authenticated clients cannot read invitation records directly'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.organization_invitations', 'insert,update,delete')
  AND NOT has_table_privilege('authenticated', 'public.organization_invitation_companies', 'insert,update,delete'),
  'authenticated clients cannot mutate invitations directly'
);
SELECT ok(
  has_table_privilege('service_role', 'public.organization_invitations', 'select,insert,update,delete')
  AND has_table_privilege('service_role', 'public.organization_invitation_companies', 'select,insert,update,delete'),
  'service role can manage invitation records on the server'
);

SELECT * FROM finish();
ROLLBACK;
