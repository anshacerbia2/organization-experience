-- The Tenant a sign-in asks for, which the callback holds the ID token's tenant_id to, and the Tenant
-- the session then holds (ADR-IAM-008, TDD-identity-experience-001 §Context Switch). NULL is the
-- provider-scope form, which carries none; every sign-in in flight and every session from before
-- this migration is that form.
ALTER TABLE login_states ADD COLUMN tenant_id text
    CHECK (tenant_id IS NULL OR tenant_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
ALTER TABLE sessions ADD COLUMN tenant_id text;
