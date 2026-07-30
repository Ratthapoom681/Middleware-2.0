CREATE TABLE IF NOT EXISTS auth_roles (
    id text PRIMARY KEY,
    name text NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 80),
    description text NOT NULL DEFAULT '',
    is_system boolean NOT NULL DEFAULT false,
    created_by text NOT NULL DEFAULT '',
    updated_by text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS auth_roles_name_lower_unique
    ON auth_roles (lower(trim(name)));

CREATE TABLE IF NOT EXISTS auth_role_permissions (
    role_id text NOT NULL REFERENCES auth_roles(id) ON DELETE CASCADE,
    permission_key text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE IF NOT EXISTS auth_user_role_assignments (
    user_id text PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,
    role_id text NOT NULL REFERENCES auth_roles(id) ON DELETE RESTRICT,
    assigned_by text NOT NULL DEFAULT '',
    assigned_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE auth_app_memberships
    ADD COLUMN IF NOT EXISTS product_scope_mode text NOT NULL DEFAULT 'none';

UPDATE auth_app_memberships
SET product_scope_mode = CASE
    WHEN role = 'admin' THEN 'all'
    WHEN jsonb_array_length(products) > 0 THEN 'selected'
    ELSE 'none'
END
WHERE product_scope_mode NOT IN ('all', 'selected')
   OR role = 'admin'
   OR jsonb_array_length(products) > 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'auth_app_memberships_product_scope_mode_check'
    ) THEN
        ALTER TABLE auth_app_memberships
            ADD CONSTRAINT auth_app_memberships_product_scope_mode_check
            CHECK (product_scope_mode IN ('all', 'selected', 'none'));
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS auth_user_role_assignments_role_idx
    ON auth_user_role_assignments (role_id);

CREATE INDEX IF NOT EXISTS auth_audit_events_created_at_idx
    ON auth_audit_events (created_at DESC);
