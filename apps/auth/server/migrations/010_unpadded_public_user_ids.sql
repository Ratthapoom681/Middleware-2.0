DROP TRIGGER IF EXISTS auth_users_public_id_immutable ON auth_users;

ALTER TABLE auth_users
    ALTER COLUMN public_id DROP DEFAULT,
    DROP CONSTRAINT IF EXISTS auth_users_public_id_format,
    DROP CONSTRAINT IF EXISTS auth_users_public_id_unique;

CREATE TEMP TABLE auth_user_public_id_rewrite AS
WITH parsed AS (
    SELECT
        id,
        username,
        created_at,
        CASE
            WHEN public_id ~ '^[0-9]+$'
             AND public_id::numeric BETWEEN 1 AND 9223372036854775807
                THEN public_id::numeric::bigint
            ELSE NULL
        END AS numeric_id
    FROM auth_users
), ranked AS (
    SELECT
        *,
        row_number() OVER (
            PARTITION BY numeric_id
            ORDER BY created_at, username, id
        ) AS numeric_rank
    FROM parsed
), current_max AS (
    SELECT COALESCE(MAX(numeric_id), 0) AS value
    FROM ranked
), repaired AS (
    SELECT
        id,
        current_max.value + row_number() OVER (ORDER BY created_at, username, id) AS numeric_id
    FROM ranked
    CROSS JOIN current_max
    WHERE ranked.numeric_id IS NULL OR ranked.numeric_rank > 1
), canonical AS (
    SELECT id, numeric_id
    FROM ranked
    WHERE numeric_id IS NOT NULL AND numeric_rank = 1
    UNION ALL
    SELECT id, numeric_id
    FROM repaired
)
SELECT id, numeric_id::text AS public_id
FROM canonical;

UPDATE auth_users AS users
SET public_id = rewrite.public_id
FROM auth_user_public_id_rewrite AS rewrite
WHERE users.id = rewrite.id;

DROP TABLE auth_user_public_id_rewrite;

CREATE OR REPLACE FUNCTION format_auth_user_public_id(numeric_id bigint)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
    SELECT numeric_id::text;
$$;

SELECT setval(
    'auth_user_public_id_seq',
    GREATEST(COALESCE((SELECT MAX(public_id::bigint) FROM auth_users), 0) + 1, 1),
    false
);

ALTER TABLE auth_users
    ALTER COLUMN public_id SET DEFAULT format_auth_user_public_id(nextval('auth_user_public_id_seq')),
    ALTER COLUMN public_id SET NOT NULL,
    ADD CONSTRAINT auth_users_public_id_format CHECK (public_id ~ '^[1-9][0-9]*$'),
    ADD CONSTRAINT auth_users_public_id_unique UNIQUE (public_id);

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

CREATE TRIGGER auth_users_public_id_immutable
BEFORE UPDATE OF public_id ON auth_users
FOR EACH ROW
EXECUTE FUNCTION prevent_auth_user_public_id_change();
