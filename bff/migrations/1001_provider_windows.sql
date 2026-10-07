-- Provider mode (TDD-organization-experience-001 1.2.0 §Provider Mode Entry). This application's own
-- table, numbered apart from the identity-experience pattern's migrations so the two never collide.
--
-- A window is what a provider session opened provider mode with: the reason, the duration and the
-- Tenants the operator stated before it opened, and the activation the Organization Control API
-- recorded for it. It belongs to the session and goes with it.
--
-- An eligible grant's window has an activation, and ends_at is the API's, recorded once the
-- activation is approved. An emergency grant is standing authority and has no activation to ask
-- for (ADR-ORG-002 §5.2), so its window ends at the duration the operator stated, counted from
-- opening, which only this application enforces.
CREATE TABLE provider_windows (
    session_hash      bytea       PRIMARY KEY REFERENCES sessions (id_hash) ON DELETE CASCADE,
    grant_kind        text        NOT NULL CHECK (grant_kind IN ('eligible', 'emergency')),
    activation_id     uuid,
    reason            text        NOT NULL CHECK (btrim(reason) <> ''),
    correlation_id    uuid        NOT NULL,
    -- NULL is every Tenant; otherwise the Tenants named, at least one.
    tenants           text[]      CHECK (tenants IS NULL OR cardinality(tenants) > 0),
    duration_seconds  integer     NOT NULL CHECK (duration_seconds > 0),
    requested_at      timestamptz NOT NULL,
    ends_at           timestamptz,
    CHECK ((grant_kind = 'eligible') = (activation_id IS NOT NULL)),
    CHECK (grant_kind = 'eligible' OR ends_at IS NOT NULL)
);
