const crypto = require('crypto');

const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 128;

const validateNewPassword = (password) => {
  const value = String(password || '');
  if (value.length < PASSWORD_MIN_LENGTH || value.length > PASSWORD_MAX_LENGTH) {
    return `Password must be ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters`;
  }
  return '';
};

const isValidEmail = (email) => {
  const value = String(email || '').trim();
  if (!value) return true;
  if (value.length > 254 || /\s/.test(value)) return false;
  return /^[^@]+@[^@]+\.[^@]+$/.test(value);
};

function registerProfileRoutes({
  app,
  authenticateJwt,
  requireAdmin,
  authStore,
  mfaService,
  verifyPassword,
  hashPassword,
  issueSession
}) {
  const publicMfa = (config) => ({
    enabled: Boolean(config),
    provider: config?.provider || '',
    enabledAt: config?.enabledAt || '',
    recoveryCodesRemaining: Number(config?.recoveryCodesRemaining || 0),
    lockedUntil: config?.lockedUntil || ''
  });

  const verifyMfaFactor = async (username, { code, mode = 'totp' } = {}) => {
    const config = await authStore.getMfaConfig(username);
    if (!config) return { ok: false, status: 400, error: 'Authenticator is not enabled' };
    if (config.lockedUntil && Date.parse(config.lockedUntil) > Date.now()) {
      return { ok: false, status: 429, error: 'Authenticator verification is temporarily locked. Try again later.' };
    }
    if (config.lockedUntil && Date.parse(config.lockedUntil) <= Date.now()) {
      await authStore.resetMfaFailures(username);
    }

    let ok = false;
    let recoveryCodesRemaining = config.recoveryCodesRemaining;
    if (mode === 'recovery') {
      const normalized = mfaService.normalizeRecoveryCode(code);
      if (normalized.length === 15) {
        const remaining = await authStore.consumeRecoveryCode(username, mfaService.recoveryCodeHash(normalized));
        if (remaining !== null) {
          ok = true;
          recoveryCodesRemaining = remaining;
        }
      }
    } else {
      try {
        const secret = mfaService.decryptSecret(config);
        const counter = mfaService.validateTotp({ secret, token: code });
        if (counter !== null) ok = await authStore.markTotpUsed(username, counter);
      } catch {
        ok = false;
      }
    }

    if (!ok) {
      const failure = await authStore.recordMfaFailure(username);
      const locked = failure?.lockedUntil && Date.parse(failure.lockedUntil) > Date.now();
      return {
        ok: false,
        status: locked ? 429 : 400,
        error: locked
          ? 'Authenticator verification is temporarily locked. Try again later.'
          : 'The verification code is invalid or has already been used'
      };
    }

    await authStore.resetMfaFailures(username);
    return { ok: true, recoveryCodesRemaining };
  };

  app.post('/api/login/mfa', async (req, res) => {
    const challengeToken = String(req.body?.challengeToken || '');
    const tokenHash = mfaService.tokenHash(challengeToken);
    const challenge = await authStore.getMfaChallenge(tokenHash, 'login');
    if (!challenge || challenge.attemptCount >= 5) {
      return res.status(400).json({ error: 'Verification challenge expired. Sign in again.', restartRequired: true });
    }

    try {
      const result = await verifyMfaFactor(challenge.username, req.body || {});
      if (!result.ok) {
        const failure = await authStore.recordMfaChallengeFailure(tokenHash);
        if (failure?.consumed) {
          return res.status(400).json({ error: 'Too many incorrect codes. Sign in again.', restartRequired: true });
        }
        return res.status(result.status).json({ error: result.error });
      }
      if (!await authStore.consumeMfaChallenge(tokenHash)) {
        return res.status(400).json({ error: 'Verification challenge expired. Sign in again.', restartRequired: true });
      }
      const user = await authStore.getUserByUsername(challenge.username);
      if (!user || user.status === 'suspended') {
        return res.status(401).json({ error: 'Unable to complete sign in' });
      }
      const session = await issueSession(user, req);
      res.set('Cache-Control', 'no-store');
      return res.json({ ...session, recoveryCodesRemaining: result.recoveryCodesRemaining });
    } catch (err) {
      console.error('MFA login error:', err.message);
      return res.status(500).json({ error: 'Unable to complete sign in' });
    }
  });

  app.get('/api/profile', authenticateJwt, async (req, res) => {
    try {
      const user = await authStore.getUserByUsername(req.user.username);
      const mfa = await authStore.getMfaConfig(req.user.username);
      res.set('Cache-Control', 'no-store');
      res.json({ user: authStore.buildPublicUser(user), mfa: publicMfa(mfa) });
    } catch (err) {
      console.error('Profile load error:', err.message);
      res.status(500).json({ error: 'Unable to load profile' });
    }
  });

  app.patch('/api/profile', authenticateJwt, async (req, res) => {
    const email = String(req.body?.email || '').trim();
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Enter a valid email address' });
    try {
      const user = await authStore.updateEmail(req.user.username, email);
      await authStore.saveAuditEvent({
        actorUsername: req.user.username,
        targetUsername: req.user.username,
        action: 'profile.email_updated'
      });
      res.json({ message: 'Email updated', user: authStore.buildPublicUser(user) });
    } catch (err) {
      console.error('Profile update error:', err.message);
      res.status(500).json({ error: 'Unable to update profile' });
    }
  });

  app.patch('/api/profile/password', authenticateJwt, async (req, res) => {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    const passwordError = validateNewPassword(newPassword);
    if (passwordError) return res.status(400).json({ error: passwordError });
    try {
      const user = await authStore.getUserByUsername(req.user.username);
      if (!user || !verifyPassword(currentPassword, user)) {
        return res.status(400).json({ error: 'Current password is incorrect' });
      }
      if (verifyPassword(newPassword, user)) {
        return res.status(400).json({ error: 'New password must be different from the current password' });
      }
      const mfa = await authStore.getMfaConfig(req.user.username);
      if (mfa) {
        const factor = await verifyMfaFactor(req.user.username, req.body || {});
        if (!factor.ok) return res.status(factor.status).json({ error: factor.error });
      }
      const next = hashPassword(newPassword);
      await authStore.updatePassword(req.user.username, {
        salt: next.salt,
        hash: next.hash,
        passwordAlgorithm: next.algorithm
      });
      await authStore.saveAuditEvent({
        actorUsername: req.user.username,
        targetUsername: req.user.username,
        action: 'profile.password_changed'
      });
      await authStore.revokeUserSessions(req.user.username);
      res.json({ message: 'Password changed. Sign in again.' });
    } catch (err) {
      console.error('Password update error:', err.message);
      res.status(500).json({ error: 'Unable to change password' });
    }
  });

  app.post('/api/profile/mfa/setup', authenticateJwt, async (req, res) => {
    const provider = mfaService.normalizeProvider(req.body?.provider);
    try {
      const user = await authStore.getUserByUsername(req.user.username);
      if (!user || !verifyPassword(String(req.body?.currentPassword || ''), user)) {
        return res.status(400).json({ error: 'Current password is incorrect' });
      }
      const existing = await authStore.getMfaConfig(req.user.username);
      if (existing) {
        const factor = await verifyMfaFactor(req.user.username, req.body || {});
        if (!factor.ok) return res.status(factor.status).json({ error: factor.error });
      }

      const enrollment = mfaService.generateEnrollment({ username: user.username, provider });
      const encrypted = mfaService.encryptSecret(enrollment.secret);
      const setupToken = mfaService.createOpaqueToken();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      await authStore.createMfaChallenge({
        id: crypto.randomUUID(),
        username: user.username,
        purpose: 'setup',
        tokenHash: mfaService.tokenHash(setupToken),
        payload: { provider, replacing: Boolean(existing), ...encrypted },
        expiresAt
      });
      res.set('Cache-Control', 'no-store');
      res.json({
        setupToken,
        provider,
        otpauthUri: enrollment.otpauthUri,
        manualKey: enrollment.manualKey,
        expiresAt
      });
    } catch (err) {
      console.error('MFA setup error:', err.message);
      res.status(500).json({ error: 'Unable to start authenticator setup' });
    }
  });

  app.post('/api/profile/mfa/confirm', authenticateJwt, async (req, res) => {
    const setupToken = String(req.body?.setupToken || '');
    const tokenHash = mfaService.tokenHash(setupToken);
    try {
      const challenge = await authStore.getMfaChallenge(tokenHash, 'setup');
      if (!challenge || challenge.username !== req.user.username || challenge.attemptCount >= 5) {
        return res.status(400).json({ error: 'Setup expired. Start again.' });
      }
      const secret = mfaService.decryptSecret(challenge.payload);
      const counter = mfaService.validateTotp({ secret, token: req.body?.code });
      if (counter === null) {
        await authStore.recordMfaChallengeFailure(tokenHash);
        return res.status(400).json({ error: 'Enter the current six-digit code from your authenticator' });
      }
      if (!await authStore.consumeMfaChallenge(tokenHash)) {
        return res.status(400).json({ error: 'Setup expired. Start again.' });
      }
      const recoveryCodes = mfaService.generateRecoveryCodes();
      const recoveryHashes = recoveryCodes.map(mfaService.recoveryCodeHash);
      const enabledAt = new Date().toISOString();
      await authStore.saveMfaConfig(req.user.username, {
        provider: challenge.payload.provider,
        secretCiphertext: challenge.payload.secretCiphertext,
        secretIv: challenge.payload.secretIv,
        secretTag: challenge.payload.secretTag,
        enabledAt,
        lastUsedCounter: counter
      }, recoveryHashes);
      if (challenge.payload.replacing) {
        await authStore.revokeUserSessions(req.user.username, { exceptSid: req.user.sid });
      }
      await authStore.saveAuditEvent({
        actorUsername: req.user.username,
        targetUsername: req.user.username,
        action: challenge.payload.replacing ? 'mfa.replaced' : 'mfa.enabled',
        metadata: { provider: challenge.payload.provider }
      });
      res.set('Cache-Control', 'no-store');
      res.json({
        message: 'Authenticator enabled',
        recoveryCodes,
        mfa: publicMfa(await authStore.getMfaConfig(req.user.username))
      });
    } catch (err) {
      console.error('MFA confirmation error:', err.message);
      res.status(500).json({ error: 'Unable to complete authenticator setup' });
    }
  });

  app.post('/api/profile/mfa/recovery-codes/regenerate', authenticateJwt, async (req, res) => {
    try {
      const user = await authStore.getUserByUsername(req.user.username);
      if (!user || !verifyPassword(String(req.body?.currentPassword || ''), user)) {
        return res.status(400).json({ error: 'Current password is incorrect' });
      }
      const factor = await verifyMfaFactor(req.user.username, req.body || {});
      if (!factor.ok) return res.status(factor.status).json({ error: factor.error });
      const config = await authStore.getMfaConfig(req.user.username);
      const recoveryCodes = mfaService.generateRecoveryCodes();
      await authStore.saveMfaConfig(req.user.username, config, recoveryCodes.map(mfaService.recoveryCodeHash));
      await authStore.saveAuditEvent({
        actorUsername: req.user.username,
        targetUsername: req.user.username,
        action: 'mfa.recovery_codes_regenerated'
      });
      res.set('Cache-Control', 'no-store');
      res.json({ message: 'Recovery codes regenerated', recoveryCodes, mfa: publicMfa(await authStore.getMfaConfig(req.user.username)) });
    } catch (err) {
      console.error('Recovery-code regeneration error:', err.message);
      res.status(500).json({ error: 'Unable to regenerate recovery codes' });
    }
  });

  app.post('/api/profile/mfa/disable', authenticateJwt, async (req, res) => {
    try {
      const user = await authStore.getUserByUsername(req.user.username);
      if (!user || !verifyPassword(String(req.body?.currentPassword || ''), user)) {
        return res.status(400).json({ error: 'Current password is incorrect' });
      }
      const factor = await verifyMfaFactor(req.user.username, req.body || {});
      if (!factor.ok) return res.status(factor.status).json({ error: factor.error });
      await authStore.clearMfa(req.user.username);
      await authStore.saveAuditEvent({
        actorUsername: req.user.username,
        targetUsername: req.user.username,
        action: 'mfa.disabled'
      });
      await authStore.revokeUserSessions(req.user.username);
      res.json({ message: 'Authenticator disabled. Sign in again.' });
    } catch (err) {
      console.error('MFA disable error:', err.message);
      res.status(500).json({ error: 'Unable to disable authenticator' });
    }
  });

  app.post('/api/users/:username/mfa/reset', authenticateJwt, requireAdmin, async (req, res) => {
    const username = String(req.params.username || '').trim();
    const reason = String(req.body?.reason || '').trim();
    const confirmation = String(req.body?.confirmation || '').trim();
    if (username === req.user.username) {
      return res.status(400).json({ error: 'Use your Profile page to manage your own authenticator' });
    }
    if (confirmation !== username) return res.status(400).json({ error: 'Type the username to confirm the reset' });
    if (reason.length < 3 || reason.length > 500) return res.status(400).json({ error: 'Enter a reason between 3 and 500 characters' });
    try {
      const admin = await authStore.getUserByUsername(req.user.username);
      if (!admin || !verifyPassword(String(req.body?.adminPassword || ''), admin)) {
        return res.status(400).json({ error: 'Administrator password is incorrect' });
      }
      const target = await authStore.getUserByUsername(username);
      if (!target) return res.status(404).json({ error: 'User not found' });
      const config = await authStore.getMfaConfig(username);
      if (!config) return res.status(400).json({ error: 'Authenticator is not enabled for this user' });
      await authStore.clearMfa(username);
      await authStore.revokeUserSessions(username);
      await authStore.saveAuditEvent({
        actorUsername: req.user.username,
        targetUsername: username,
        action: 'mfa.admin_reset',
        metadata: { reason }
      });
      res.json({ message: `Authenticator reset for ${username}` });
    } catch (err) {
      console.error('Administrator MFA reset error:', err.message);
      res.status(500).json({ error: 'Unable to reset authenticator' });
    }
  });
}

module.exports = {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  isValidEmail,
  registerProfileRoutes,
  validateNewPassword
};
