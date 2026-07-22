DELETE FROM auth_email_outbox
WHERE type = 'test';

DO $$
DECLARE constraint_name text;
BEGIN
    FOR constraint_name IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'auth_email_outbox'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%type%'
    LOOP
        EXECUTE format('ALTER TABLE auth_email_outbox DROP CONSTRAINT %I', constraint_name);
    END LOOP;
END $$;

ALTER TABLE auth_email_outbox
    ADD CONSTRAINT auth_email_outbox_type_check
    CHECK (type IN ('mfa_setup', 'temporary_password'));
