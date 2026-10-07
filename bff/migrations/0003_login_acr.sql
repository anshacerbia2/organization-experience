-- The level a sign-in asked for (ADR-IAM-004), which the callback holds the ID token's acr to
-- (TDD-identity-experience-001 §Step-Up). NULL for a sign-in that asked for none.
ALTER TABLE login_states ADD COLUMN acr_values text CHECK (acr_values IS NULL OR acr_values IN ('aal1', 'aal2'));
