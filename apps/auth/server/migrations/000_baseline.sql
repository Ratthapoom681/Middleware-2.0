CREATE TABLE IF NOT EXISTS auth_users (
    id text PRIMARY KEY,
    username text UNIQUE NOT NULL CHECK (length(trim(username)) > 0),
    email text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'active',
    last_login_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_credentials (
    user_id text PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,
    salt text NOT NULL,
    password_hash text NOT NULL,
    password_algorithm text NOT NULL DEFAULT 'pbkdf2-sha512:310000',
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_app_memberships (
    user_id text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    app_key text NOT NULL,
    role text NOT NULL DEFAULT 'viewer',
    products jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, app_key)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    issued_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    user_agent text NOT NULL DEFAULT '',
    ip_address text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS auth_audit_events (
    id bigserial PRIMARY KEY,
    actor_username text NOT NULL DEFAULT '',
    target_username text NOT NULL DEFAULT '',
    action text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
