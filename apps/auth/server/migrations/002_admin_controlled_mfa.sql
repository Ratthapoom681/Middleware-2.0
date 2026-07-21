ALTER TABLE auth_users
    ADD COLUMN IF NOT EXISTS full_name text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS company text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS department text NOT NULL DEFAULT '';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'auth_users_full_name_length'
    ) THEN
        ALTER TABLE auth_users
            ADD CONSTRAINT auth_users_full_name_length CHECK (length(full_name) <= 120);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'auth_users_company_length'
    ) THEN
        ALTER TABLE auth_users
            ADD CONSTRAINT auth_users_company_length CHECK (length(company) <= 120);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'auth_users_department_length'
    ) THEN
        ALTER TABLE auth_users
            ADD CONSTRAINT auth_users_department_length CHECK (length(department) <= 120);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS auth_mfa_policy (
    user_id text PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,
    mode text NOT NULL DEFAULT 'disabled' CHECK (mode IN ('disabled', 'authenticator')),
    requested_at timestamptz,
    requested_by text NOT NULL DEFAULT '',
    request_reason text NOT NULL DEFAULT '',
    notification_status text NOT NULL DEFAULT 'none'
        CHECK (notification_status IN ('none', 'pending', 'sent', 'failed')),
    notification_attempted_at timestamptz,
    notification_sent_at timestamptz,
    notification_error text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO auth_mfa_policy (
    user_id,
    mode,
    requested_at,
    notification_status
)
SELECT
    u.id,
    CASE WHEN mf.user_id IS NULL THEN 'disabled' ELSE 'authenticator' END,
    mf.enabled_at,
    'none'
FROM auth_users u
LEFT JOIN auth_mfa_config mf ON mf.user_id = u.id
ON CONFLICT (user_id) DO NOTHING;

-- Recovery codes are no longer an accepted factor. Invalidate every previously
-- issued code during the additive migration while retaining the table so rolling
-- application deployments and old migration histories remain compatible.
DELETE FROM auth_mfa_recovery_codes;
