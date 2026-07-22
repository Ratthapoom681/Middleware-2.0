ALTER TABLE auth_mfa_policy
    ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT '';

UPDATE auth_mfa_policy policy
SET mode = 'authenticator', provider = config.provider
FROM auth_mfa_config config
WHERE config.user_id = policy.user_id
  AND config.provider IN ('google', 'microsoft', 'other');

UPDATE auth_mfa_policy
SET provider = 'other'
WHERE mode = 'authenticator'
  AND provider NOT IN ('google', 'microsoft', 'other');

UPDATE auth_mfa_policy
SET provider = ''
WHERE mode = 'disabled';

DO $$
DECLARE constraint_name text;
BEGIN
    FOR constraint_name IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'auth_mfa_policy'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%provider%'
    LOOP
        EXECUTE format('ALTER TABLE auth_mfa_policy DROP CONSTRAINT %I', constraint_name);
    END LOOP;
END $$;

ALTER TABLE auth_mfa_policy
    ADD CONSTRAINT auth_mfa_policy_provider_check
    CHECK (
        (mode = 'disabled' AND provider = '')
        OR
        (mode = 'authenticator' AND provider IN ('google', 'microsoft', 'other'))
    );
