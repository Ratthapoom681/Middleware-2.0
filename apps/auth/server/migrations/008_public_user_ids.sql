CREATE SEQUENCE IF NOT EXISTS auth_user_public_id_seq AS bigint START WITH 1;

CREATE OR REPLACE FUNCTION format_auth_user_public_id(numeric_id bigint)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
    SELECT lpad(numeric_id::text, GREATEST(6, length(numeric_id::text)), '0');
$$;

ALTER TABLE auth_users
    ADD COLUMN IF NOT EXISTS public_id text;

WITH ranked AS (
    SELECT
        id,
        public_id,
        row_number() OVER (PARTITION BY public_id ORDER BY created_at, username, id) AS duplicate_rank
    FROM auth_users
), invalid AS (
    SELECT id
    FROM ranked
    WHERE public_id IS NULL
       OR public_id !~ '^[0-9]{6,}$'
       OR duplicate_rank > 1
)
UPDATE auth_users AS users
SET public_id = NULL
FROM invalid
WHERE users.id = invalid.id;

WITH current_max AS (
    SELECT COALESCE(MAX(public_id::bigint), 0) AS value
    FROM auth_users
    WHERE public_id ~ '^[0-9]{6,}$'
), missing AS (
    SELECT
        id,
        row_number() OVER (ORDER BY created_at, username, id) AS offset
    FROM auth_users
    WHERE public_id IS NULL
)
UPDATE auth_users AS users
SET public_id = format_auth_user_public_id(current_max.value + missing.offset)
FROM current_max, missing
WHERE users.id = missing.id;

SELECT setval(
    'auth_user_public_id_seq',
    GREATEST(COALESCE((SELECT MAX(public_id::bigint) FROM auth_users), 0) + 1, 1),
    false
);

ALTER TABLE auth_users
    ALTER COLUMN public_id SET DEFAULT format_auth_user_public_id(nextval('auth_user_public_id_seq')),
    ALTER COLUMN public_id SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'auth_users_public_id_format'
    ) THEN
        ALTER TABLE auth_users
            ADD CONSTRAINT auth_users_public_id_format CHECK (public_id ~ '^[0-9]{6,}$');
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'auth_users_public_id_unique'
    ) THEN
        ALTER TABLE auth_users
            ADD CONSTRAINT auth_users_public_id_unique UNIQUE (public_id);
    END IF;
END $$;

CREATE OR REPLACE FUNCTION prevent_auth_user_public_id_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.public_id IS DISTINCT FROM OLD.public_id THEN
        RAISE EXCEPTION 'auth_users.public_id is immutable';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auth_users_public_id_immutable ON auth_users;
CREATE TRIGGER auth_users_public_id_immutable
BEFORE UPDATE OF public_id ON auth_users
FOR EACH ROW
EXECUTE FUNCTION prevent_auth_user_public_id_change();
