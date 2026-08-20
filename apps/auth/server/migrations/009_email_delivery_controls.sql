ALTER TABLE auth_email_settings
    ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS mfa_setup_enabled boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS temporary_password_enabled boolean NOT NULL DEFAULT false;
