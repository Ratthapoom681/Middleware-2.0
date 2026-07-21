const crypto = require('crypto');

const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 128;
const ADMIN_REASON_MIN_LENGTH = 3;
const ADMIN_REASON_MAX_LENGTH = 500;

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

const buildMfaSummary = (policy, config) => {
  const mode = policy?.mode === 'authenticator' || config ? 'authenticator' : 'disabled';
  const status = mode === 'disabled' ? 'disabled' : (config ? 'enabled' : 'pending');
  return {
    mode,
    status,
    enabled: status === 'enabled',
    requestedAt: policy?.requestedAt || '',
    enabledAt: config?.enabledAt || '',
    notificationStatus: policy?.notificationStatus || 'none',
    notificationAttemptedAt: policy?.notificationAttemptedAt || '',
    notificationSentAt: policy?.notificationSentAt || ''
  };
};

function registerProfileRoutes({
  app,
  authenticateJwt,
  requireAdmin,
  authStore,
  mfaService,
  verifyPassword,
  hashPassword,
  issueSession,
  sendMfaSetupNotification
}) {
  const loadMfaSummary = async (username) => {
    const [policy, config] = await Promise.all([
      authStore.getMfaPolicy(username),
      authStore.getMfaConfig(username)
    ]);
    return buildMfaSummary(policy, config);
  };

  const verifyTotpFactor = async (username, code) => {
    const config = await authStore.getMfaConfig(username);
    if (!config) return { ok: false, status: 400, error: 'Authenticator is not enabled' };
    if (config.lockedUntil && Date.parse(config.lockedUntil) > Date.now()) {
      return { ok: false, status: 429, error: 'Authenticator verification is temporarily locked. Try again later.' };
    }
    if (config.lockedUntil && Date.parse(config.lockedUntil) <= Date.now()) {
      await authStore.resetMfaFailures(username);
    }

    let accepted = false;
    try {
      const secret = mfaService.decryptSecret(config);
      const counter = mfaService.validateTotp({ secret, token: code });
      if (counter !== null) accepted = await authStore.markTotpUsed(username, counter);
    } catch {
      accepted = false;
    }

    if (!accepted) {
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
    return { ok: true };
  };

  const verifyAdminAction = async (req) => {
    const reason = String(req.body?.reason || '').trim();
    if (reason.length < ADMIN_REASON_MIN_LENGTH || reason.length > ADMIN_REASON_MAX_LENGTH) {
      return { ok: false, status: 400, error: 'Enter a reason between 3 and 500 characters' };
    }
    const admin = await authStore.getUserByUsername(req.user.username);
    if (!admin || !verifyPassword(String(req.body?.adminPassword || ''), admin)) {
      return { ok: false, status: 400, error: 'Administrator password is incorrect' };
    }
    return { ok: true, reason };
  };

  app.post('/api/login/mfa', async (req, res) => {
    if (req.body?.mode && String(req.body.mode).toLowerCase() !== 'totp') {
      return res.status(400).json({ error: 'Recovery codes are not supported. Contact an administrator.' });
    }
    const challengeToken = String(req.body?.challengeToken || '');
    const tokenHash = mfaService.tokenHash(challengeToken);
    const challenge = await authStore.getMfaChallenge(tokenHash, 'login');
    if (!challenge || challenge.attemptCount >= 5) {
      return res.status(400).json({ error: 'Verification challenge expired. Sign in again.', restartRequired: true });
    }

    try {
      const result = await verifyTotpFactor(challenge.username, req.body?.code);
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
      res.set('Cache-Control', 'no-store');
      return res.json(await issueSession(user, req));
    } catch (error) {
      console.error('MFA login error:', error.message);
      return res.status(500).json({ error: 'Unable to complete sign in' });
    }
  });

  app.get('/api/profile', authenticateJwt, async (req, res) => {
    try {
      const user = await authStore.getUserByUsername(req.user.username);
      const mfa = await loadMfaSummary(req.user.username);
      res.set('Cache-Control', 'no-store');
      res.json({ user: authStore.buildPublicUser(user), mfa });
    } catch (error) {
      console.error('Profile load error:', error.message);
      res.status(500).json({ error: 'Unable to load profile' });
    }
  });

  app.post('/api/profile/mfa/enrollment/start', authenticateJwt, async (req, res) => {
    try {
      const [user, policy, existing] = await Promise.all([
        authStore.getUserByUsername(req.user.username),
        authStore.getMfaPolicy(req.user.username),
        authStore.getMfaConfig(req.user.username)
      ]);
      if (policy?.mode !== 'authenticator' || existing) {
        return res.status(409).json({ error: existing ? 'Authenticator is already enabled' : 'An administrator must enable Authenticator MFA first' });
      }
      if (!user || !verifyPassword(String(req.body?.currentPassword || ''), user)) {
        return res.status(400).json({ error: 'Current password is incorrect' });
      }

      const enrollment = mfaService.generateEnrollment({ username: user.username, provider: 'other' });
      const encrypted = mfaService.encryptSecret(enrollment.secret);
      const setupToken = mfaService.createOpaqueToken();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      await authStore.createMfaChallenge({
        id: crypto.randomUUID(),
        username: user.username,
        purpose: 'setup',
        tokenHash: mfaService.tokenHash(setupToken),
        payload: { provider: 'other', ...encrypted },
        expiresAt
      });
      res.set('Cache-Control', 'no-store');
      res.json({ setupToken, otpauthUri: enrollment.otpauthUri, manualKey: enrollment.manualKey, expiresAt });
    } catch (error) {
      console.error('MFA enrollment start error:', error.message);
      res.status(500).json({ error: 'Unable to start authenticator setup' });
    }
  });

  app.post('/api/profile/mfa/enrollment/confirm', authenticateJwt, async (req, res) => {
    const tokenHash = mfaService.tokenHash(String(req.body?.setupToken || ''));
    try {
      const [challenge, policy, existing] = await Promise.all([
        authStore.getMfaChallenge(tokenHash, 'setup'),
        authStore.getMfaPolicy(req.user.username),
        authStore.getMfaConfig(req.user.username)
      ]);
      if (policy?.mode !== 'authenticator' || existing) {
        return res.status(409).json({ error: existing ? 'Authenticator is already enabled' : 'Authenticator enrollment is no longer pending' });
      }
      if (!challenge || challenge.username !== req.user.username || challenge.attemptCount >= 5) {
        return res.status(400).json({ error: 'Setup expired. Start again.' });
      }
      const secret = mfaService.decryptSecret(challenge.payload);
      const counter = mfaService.validateTotp({ secret, token: req.body?.code });
      if (counter === null) {
        const failure = await authStore.recordMfaChallengeFailure(tokenHash);
        return res.status(400).json({
          error: failure?.consumed ? 'Too many incorrect codes. Start setup again.' : 'Enter the current six-digit code from your authenticator'
        });
      }
      if (!await authStore.consumeMfaChallenge(tokenHash)) {
        return res.status(400).json({ error: 'Setup expired. Start again.' });
      }

      const enabledAt = new Date().toISOString();
      await authStore.saveMfaConfig(req.user.username, {
        provider: 'other',
        secretCiphertext: challenge.payload.secretCiphertext,
        secretIv: challenge.payload.secretIv,
        secretTag: challenge.payload.secretTag,
        enabledAt,
        lastUsedCounter: counter
      }, []);
      await authStore.setMfaPolicy(req.user.username, { mode: 'authenticator' });
      await authStore.revokeUserSessions(req.user.username, { exceptSid: req.user.sid });
      await authStore.saveAuditEvent({
        actorUsername: req.user.username,
        targetUsername: req.user.username,
        action: 'mfa.enrolled'
      });
      res.set('Cache-Control', 'no-store');
      res.json({ message: 'Authenticator MFA enabled', mfa: await loadMfaSummary(req.user.username) });
    } catch (error) {
      console.error('MFA enrollment confirmation error:', error.message);
      res.status(500).json({ error: 'Unable to complete authenticator setup' });
    }
  });

  const administratorControlled = (_req, res) => res.status(403).json({ error: 'Your administrator manages this security setting' });
  app.patch('/api/profile', authenticateJwt, administratorControlled);
  app.patch('/api/profile/password', authenticateJwt, administratorControlled);
  app.post('/api/profile/mfa/setup', authenticateJwt, administratorControlled);
  app.post('/api/profile/mfa/confirm', authenticateJwt, administratorControlled);
  app.post('/api/profile/mfa/recovery-codes/regenerate', authenticateJwt, administratorControlled);
  app.post('/api/profile/mfa/disable', authenticateJwt, administratorControlled);

  app.patch('/api/users/:username/password', authenticateJwt, requireAdmin, async (req, res) => {
    const username = String(req.params.username || '').trim();
    const newPassword = String(req.body?.newPassword || '');
    const passwordError = validateNewPassword(newPassword);
    if (passwordError) return res.status(400).json({ error: passwordError });
    try {
      const proof = await verifyAdminAction(req);
      if (!proof.ok) return res.status(proof.status).json({ error: proof.error });
      const target = await authStore.getUserByUsername(username);
      if (!target) return res.status(404).json({ error: 'User not found' });
      if (verifyPassword(newPassword, target)) {
        return res.status(400).json({ error: 'New password must be different from the current password' });
      }
      const next = hashPassword(newPassword);
      await authStore.updatePassword(username, {
        salt: next.salt,
        hash: next.hash,
        passwordAlgorithm: next.algorithm
      });
      await authStore.revokeUserSessions(username);
      await authStore.saveAuditEvent({
        actorUsername: req.user.username,
        targetUsername: username,
        action: 'user.password_reset',
        metadata: { reason: proof.reason }
      });
      res.json({ message: `Password reset for ${username}`, sessionEnded: username === req.user.username });
    } catch (error) {
      console.error('Administrator password reset error:', error.message);
      res.status(500).json({ error: 'Unable to reset password' });
    }
  });

  app.patch('/api/users/:username/mfa', authenticateJwt, requireAdmin, async (req, res) => {
    const username = String(req.params.username || '').trim();
    const mode = String(req.body?.mode || '').trim().toLowerCase();
    if (!['disabled', 'authenticator'].includes(mode)) {
      return res.status(400).json({ error: 'MFA mode must be disabled or authenticator' });
    }
    try {
      const proof = await verifyAdminAction(req);
      if (!proof.ok) return res.status(proof.status).json({ error: proof.error });
      const [target, config, policy] = await Promise.all([
        authStore.getUserByUsername(username),
        authStore.getMfaConfig(username),
        authStore.getMfaPolicy(username)
      ]);
      if (!target) return res.status(404).json({ error: 'User not found' });

      let notification = null;
      let sessionEnded = false;
      if (mode === 'authenticator') {
        if (!target.email || !isValidEmail(target.email)) {
          return res.status(400).json({ error: 'A valid email address is required for Authenticator MFA' });
        }
        if (config) return res.status(409).json({ error: 'Authenticator MFA is already enabled' });
        if (policy?.mode === 'authenticator') {
          return res.status(409).json({ error: 'Authenticator enrollment is already pending. Use Resend email.' });
        }
        await authStore.setMfaPolicy(username, {
          mode: 'authenticator',
          requestedAt: new Date().toISOString(),
          requestedBy: req.user.username,
          requestReason: proof.reason,
          notificationStatus: 'pending',
          notificationError: ''
        });
        notification = await sendMfaSetupNotification({ user: target, requestedBy: req.user.username, request: req });
      } else {
        await authStore.clearMfa(username);
        await authStore.setMfaPolicy(username, {
          mode: 'disabled',
          requestedAt: '',
          requestedBy: '',
          requestReason: '',
          notificationStatus: 'none',
          notificationAttemptedAt: '',
          notificationSentAt: '',
          notificationError: ''
        });
        if (config) {
          await authStore.revokeUserSessions(username);
          sessionEnded = username === req.user.username;
        }
      }
      await authStore.saveAuditEvent({
        actorUsername: req.user.username,
        targetUsername: username,
        action: mode === 'authenticator' ? 'mfa.admin_enabled' : 'mfa.admin_disabled',
        metadata: { reason: proof.reason }
      });
      const refreshed = await authStore.getUserByUsername(username);
      res.json({
        message: mode === 'authenticator' ? 'Authenticator enrollment requested' : 'Authenticator MFA disabled',
        user: authStore.buildPublicUser(refreshed),
        mfa: await loadMfaSummary(username),
        notification,
        sessionEnded
      });
    } catch (error) {
      console.error('Administrator MFA update error:', error.message);
      res.status(500).json({ error: 'Unable to update Authenticator MFA' });
    }
  });

  app.post('/api/users/:username/mfa/reset', authenticateJwt, requireAdmin, async (req, res) => {
    const username = String(req.params.username || '').trim();
    try {
      const proof = await verifyAdminAction(req);
      if (!proof.ok) return res.status(proof.status).json({ error: proof.error });
      const [target, config] = await Promise.all([
        authStore.getUserByUsername(username),
        authStore.getMfaConfig(username)
      ]);
      if (!target) return res.status(404).json({ error: 'User not found' });
      if (!config) return res.status(400).json({ error: 'Authenticator MFA is not enabled for this user' });
      if (!target.email || !isValidEmail(target.email)) {
        return res.status(400).json({ error: 'A valid email address is required to reset Authenticator MFA' });
      }
      await authStore.clearMfa(username);
      await authStore.setMfaPolicy(username, {
        mode: 'authenticator',
        requestedAt: new Date().toISOString(),
        requestedBy: req.user.username,
        requestReason: proof.reason,
        notificationStatus: 'pending',
        notificationError: ''
      });
      await authStore.revokeUserSessions(username);
      const notification = await sendMfaSetupNotification({ user: target, requestedBy: req.user.username, request: req });
      await authStore.saveAuditEvent({
        actorUsername: req.user.username,
        targetUsername: username,
        action: 'mfa.admin_reset',
        metadata: { reason: proof.reason }
      });
      res.json({
        message: `Authenticator enrollment reset for ${username}`,
        mfa: await loadMfaSummary(username),
        notification,
        sessionEnded: username === req.user.username
      });
    } catch (error) {
      console.error('Administrator MFA reset error:', error.message);
      res.status(500).json({ error: 'Unable to reset Authenticator MFA' });
    }
  });

  app.post('/api/users/:username/mfa/resend', authenticateJwt, requireAdmin, async (req, res) => {
    const username = String(req.params.username || '').trim();
    try {
      const proof = await verifyAdminAction(req);
      if (!proof.ok) return res.status(proof.status).json({ error: proof.error });
      const [target, policy, config] = await Promise.all([
        authStore.getUserByUsername(username),
        authStore.getMfaPolicy(username),
        authStore.getMfaConfig(username)
      ]);
      if (!target) return res.status(404).json({ error: 'User not found' });
      if (policy?.mode !== 'authenticator' || config) {
        return res.status(409).json({ error: 'Authenticator enrollment is not pending' });
      }
      if (!target.email || !isValidEmail(target.email)) {
        return res.status(400).json({ error: 'A valid email address is required to resend the setup email' });
      }
      const notification = await sendMfaSetupNotification({ user: target, requestedBy: req.user.username, request: req });
      await authStore.saveAuditEvent({
        actorUsername: req.user.username,
        targetUsername: username,
        action: 'mfa.notification_resent',
        metadata: { reason: proof.reason, deliveryStatus: notification.status }
      });
      res.json({ message: notification.status === 'sent' ? 'Setup email sent' : 'Setup email delivery failed', notification, mfa: await loadMfaSummary(username) });
    } catch (error) {
      console.error('MFA notification resend error:', error.message);
      res.status(500).json({ error: 'Unable to resend the setup email' });
    }
  });
}

module.exports = {
  ADMIN_REASON_MAX_LENGTH,
  ADMIN_REASON_MIN_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  buildMfaSummary,
  isValidEmail,
  registerProfileRoutes,
  validateNewPassword
};
