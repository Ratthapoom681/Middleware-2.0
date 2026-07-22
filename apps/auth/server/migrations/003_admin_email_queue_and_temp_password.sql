-- Reconcile prerequisites because some deployed databases already recorded 002.
ALTER TABLE auth_users
    ADD COLUMN IF NOT EXISTS full_name text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS company text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS department text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS auth_mfa_policy (
    user_id text PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,
    mode text NOT NULL DEFAULT 'disabled',
    requested_at timestamptz,
    requested_by text NOT NULL DEFAULT '',
    notification_status text NOT NULL DEFAULT 'none',
    notification_attempted_at timestamptz,
    notification_sent_at timestamptz,
    notification_error text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auth_users_full_name_length') THEN
        ALTER TABLE auth_users ADD CONSTRAINT auth_users_full_name_length CHECK (length(full_name) <= 120);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auth_users_company_length') THEN
        ALTER TABLE auth_users ADD CONSTRAINT auth_users_company_length CHECK (length(company) <= 120);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auth_users_department_length') THEN
        ALTER TABLE auth_users ADD CONSTRAINT auth_users_department_length CHECK (length(department) <= 120);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auth_mfa_policy_mode_check') THEN
        ALTER TABLE auth_mfa_policy ADD CONSTRAINT auth_mfa_policy_mode_check CHECK (mode IN ('disabled', 'authenticator'));
    END IF;
END $$;

INSERT INTO auth_mfa_policy (user_id, mode, requested_at)
SELECT u.id, CASE WHEN mf.user_id IS NULL THEN 'disabled' ELSE 'authenticator' END, mf.enabled_at
FROM auth_users u
LEFT JOIN auth_mfa_config mf ON mf.user_id = u.id
ON CONFLICT (user_id) DO NOTHING;

DO $$
DECLARE constraint_name text;
BEGIN
    FOR constraint_name IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'auth_mfa_policy'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%notification_status%'
    LOOP
        EXECUTE format('ALTER TABLE auth_mfa_policy DROP CONSTRAINT %I', constraint_name);
    END LOOP;
END $$;

ALTER TABLE auth_mfa_policy
    ADD COLUMN IF NOT EXISTS notification_status text NOT NULL DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS notification_attempted_at timestamptz,
    ADD COLUMN IF NOT EXISTS notification_sent_at timestamptz,
    ADD COLUMN IF NOT EXISTS notification_error text NOT NULL DEFAULT '';

ALTER TABLE auth_mfa_policy
    ADD CONSTRAINT auth_mfa_policy_notification_status_check
    CHECK (notification_status IN ('none', 'queued', 'sending', 'sent', 'failed'));

CREATE TABLE IF NOT EXISTS auth_temporary_credentials (
    user_id text PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS auth_email_settings (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    host text NOT NULL DEFAULT '',
    port integer NOT NULL DEFAULT 25 CHECK (port > 0 AND port <= 65535),
    security text NOT NULL DEFAULT 'plain' CHECK (security IN ('plain', 'starttls', 'tls')),
    username text NOT NULL DEFAULT '',
    password_ciphertext text NOT NULL DEFAULT '',
    password_iv text NOT NULL DEFAULT '',
    password_tag text NOT NULL DEFAULT '',
    from_address text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by text NOT NULL DEFAULT ''
);

INSERT INTO auth_email_settings (singleton) VALUES (true) ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS auth_email_outbox (
    id text PRIMARY KEY,
    type text NOT NULL CHECK (type IN ('mfa_setup', 'temporary_password', 'test')),
    target_username text NOT NULL DEFAULT '',
    recipient text NOT NULL,
    subject text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    secret_ciphertext text NOT NULL DEFAULT '',
    secret_iv text NOT NULL DEFAULT '',
    secret_tag text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'cancelled')),
    attempt_count integer NOT NULL DEFAULT 0,
    available_at timestamptz NOT NULL DEFAULT now(),
    lease_expires_at timestamptz,
    last_error text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS auth_email_outbox_claim_idx
    ON auth_email_outbox (status, available_at, created_at);
CREATE INDEX IF NOT EXISTS auth_email_outbox_target_idx
    ON auth_email_outbox (target_username, type, status);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auth_mfa_challenges_purpose_check') THEN
        ALTER TABLE auth_mfa_challenges DROP CONSTRAINT auth_mfa_challenges_purpose_check;
    END IF;
END $$;
ALTER TABLE auth_mfa_challenges
    ADD CONSTRAINT auth_mfa_challenges_purpose_check CHECK (purpose IN ('login', 'setup', 'password_change'));

DELETE FROM auth_mfa_recovery_codes;
