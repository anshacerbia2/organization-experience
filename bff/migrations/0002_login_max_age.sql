-- A step-up sign-in carries the max_age the Identity Control API asked for, and the callback refuses
-- an ID token whose auth_time is older (TDD-identity-experience-001 §Step-Up). NULL for a plain
-- sign-in, so a sign-in in flight across the deploy is unaffected.
ALTER TABLE login_states ADD COLUMN max_age integer CHECK (max_age IS NULL OR max_age BETWEEN 0 AND 86400);
