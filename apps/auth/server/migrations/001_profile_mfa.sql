CREATE TABLE IF NOT EXISTS auth_mfa_config (
    user_id text PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,
    provider text NOT NULL CHECK (provider IN ('google', 'microsoft', 'other')),
    secret_ciphertext text NOT NULL,
    secret_iv text NOT NULL,
    secret_tag text NOT NULL,
    enabled_at timestamptz NOT NULL DEFAULT now(),
    last_used_counter bigint,
    failed_attempts integer NOT NULL DEFAULT 0,
    locked_until timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_mfa_recovery_codes (
    id bigserial PRIMARY KEY,
    user_id text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    code_hash text NOT NULL,
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, code_hash)
);

CREATE INDEX IF NOT EXISTS auth_mfa_recovery_codes_user_idx
    ON auth_mfa_recovery_codes (user_id, used_at);

CREATE TABLE IF NOT EXISTS auth_mfa_challenges (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    purpose text NOT NULL CHECK (purpose IN ('login', 'setup')),
    token_hash text UNIQUE NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    attempt_count integer NOT NULL DEFAULT 0,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_mfa_challenges_lookup_idx
    ON auth_mfa_challenges (token_hash, purpose, expires_at);
