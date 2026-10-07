-- The BFF's session store (TDD-identity-experience-001 §Server-Side Session).
--
-- Neither table holds a value the browser presents: rows are keyed by the SHA-256 of the cookie,
-- so a copy of the table cannot be replayed as a cookie. Tokens are sealed with AES-256-GCM under a
-- key the database never sees, bound to the row they belong to.

-- A sign-in in flight: from /auth/login to /auth/callback. Keyed by the digest of the login cookie,
-- which binds the callback to the browser that started it: a code and state captured from another
-- browser, delivered to this one, find no row.
CREATE TABLE login_states (
    binding_hash    bytea       PRIMARY KEY,
    state           text        NOT NULL,
    nonce           text        NOT NULL,
    code_verifier   bytea       NOT NULL,
    return_to       text        NOT NULL,
    expires_at      timestamptz NOT NULL
);

CREATE INDEX login_states_expires_at ON login_states (expires_at);

CREATE TABLE sessions (
    id_hash              bytea       PRIMARY KEY,
    subject              text        NOT NULL,
    principal_id         text,
    display_name         text,
    -- The Keycloak session (`sid`), which a back-channel logout names.
    keycloak_session_id  text,
    acr                  text,
    auth_time            timestamptz,
    -- The access and refresh tokens, sealed together. The ID token is validated at sign-in and
    -- not kept.
    tokens               bytea       NOT NULL,
    access_expires_at    timestamptz NOT NULL,
    csrf_token           text        NOT NULL,
    created_at           timestamptz NOT NULL,
    last_seen_at         timestamptz NOT NULL,
    idle_expires_at      timestamptz NOT NULL,
    absolute_expires_at  timestamptz NOT NULL
);

CREATE INDEX sessions_keycloak_session_id ON sessions (keycloak_session_id);
CREATE INDEX sessions_subject ON sessions (subject);
CREATE INDEX sessions_idle_expires_at ON sessions (idle_expires_at);
CREATE INDEX sessions_absolute_expires_at ON sessions (absolute_expires_at);
