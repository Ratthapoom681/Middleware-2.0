DO $$
BEGIN
    IF to_regclass('defectdojo_viewer_users') IS NOT NULL THEN
        ALTER TABLE defectdojo_viewer_users
            ADD COLUMN IF NOT EXISTS email text NOT NULL DEFAULT '',
            ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
            ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
    END IF;
END $$;
