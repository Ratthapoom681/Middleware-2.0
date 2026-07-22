-- Email-only authenticator enrollment invitations. This migration intentionally
-- invalidates the earlier authenticated setup flow while preserving confirmed
-- authenticator configurations.

ALTER TABLE auth_mfa_policy
    ADD COLUMN IF NOT EXISTS enrollment_generation text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS auth_mfa_enrollment_invitations (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    token_hash text UNIQUE NOT NULL CHECK (length(token_hash) = 64),
    provider text NOT NULL CHECK (provider IN ('google', 'microsoft', 'other')),
    generation text NOT NULL CHECK (length(generation) > 0),
    secret_ciphertext text NOT NULL,
    secret_iv text NOT NULL,
    secret_tag text NOT NULL,
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    cancelled_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_mfa_enrollment_invitations_user_idx
    ON auth_mfa_enrollment_invitations (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS auth_mfa_enrollment_invitations_active_idx
    ON auth_mfa_enrollment_invitations (user_id, expires_at)
    WHERE consumed_at IS NULL AND cancelled_at IS NULL;

-- Setup challenges and queued setup messages created by the legacy in-app flow
-- cannot be upgraded safely because they do not carry an email invitation.
DELETE FROM auth_mfa_challenges WHERE purpose = 'setup';

UPDATE auth_email_outbox
SET status = 'cancelled',
    secret_ciphertext = '',
    secret_iv = '',
    secret_tag = '',
    lease_expires_at = NULL,
    updated_at = now()
WHERE type = 'mfa_setup'
  AND status IN ('queued', 'sending');

-- An authenticator policy without a confirmed config is pending. Force a
-- deliberate Resend so the administrator issues a new single-use invitation.
UPDATE auth_mfa_policy policy
SET enrollment_generation = '',
    notification_status = 'failed',
    notification_attempted_at = now(),
    notification_sent_at = NULL,
    notification_error = 'Authenticator setup email must be resent',
    updated_at = now()
WHERE policy.mode = 'authenticator'
  AND NOT EXISTS (
      SELECT 1 FROM auth_mfa_config config WHERE config.user_id = policy.user_id
  );

-- Confirmed enrollments remain enabled and keep their encrypted secret,
-- provider, replay counter, failure count, and lock state unchanged.
UPDATE auth_mfa_policy policy
SET enrollment_generation = ''
WHERE EXISTS (
    SELECT 1 FROM auth_mfa_config config WHERE config.user_id = policy.user_id
);
