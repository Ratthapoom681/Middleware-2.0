const crypto = require('crypto');
const { publicEmailSettings, validateEmailSettings, validEmail } = require('./mailer.cjs');
const { MFA_ISSUER } = require('./mfa-service.cjs');

const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 128;
const TEMPORARY_PASSWORD_TTL_MS = 24 * 60 * 60 * 1000;
const MFA_INVITATION_TTL_MS = 24 * 60 * 60 * 1000;
const ADMIN_MFA_PROVIDERS = new Set(['disabled', 'google', 'microsoft', 'other']);

const parseAdminMfaProvider = (body = {}, fallback = '') => {
  if (Object.prototype.hasOwnProperty.call(body, 'mfaProvider') || Object.prototype.hasOwnProperty.call(body, 'provider')) {
    const provider = String(body.mfaProvider ?? body.provider ?? '').trim().toLowerCase();
    return ADMIN_MFA_PROVIDERS.has(provider) ? provider : '';
  }
  const legacyMode = String(body.mfaMode ?? body.mode ?? '').trim().toLowerCase();
  if (legacyMode === 'disabled') return 'disabled';
  if (legacyMode === 'authenticator') return 'other';
  return fallback;
};

const providerLabel = provider => provider === 'google'
  ? 'Google Authenticator'
  : provider === 'microsoft' ? 'Microsoft Authenticator' : 'Other authenticator';

const validateNewPassword = password => {
  const value = String(password || '');
  return value.length < PASSWORD_MIN_LENGTH || value.length > PASSWORD_MAX_LENGTH
    ? `Password must be ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters`
    : '';
};

const isValidEmail = email => {
  const value = String(email || '').trim();
  return !value || validEmail(value);
};

const buildMfaSummary = (policy, config) => {
  const mode = policy?.mode === 'authenticator' || config ? 'authenticator' : 'disabled';
  const status = mode === 'disabled' ? 'disabled' : (config ? 'enabled' : 'pending');
  return {
    mode,
    status,
    enabled: status === 'enabled',
    provider: config?.provider || policy?.provider || '',
    requestedAt: policy?.requestedAt || '',
    enabledAt: config?.enabledAt || '',
    notificationStatus: policy?.notificationStatus || 'none',
    notificationAttemptedAt: policy?.notificationAttemptedAt || '',
    notificationSentAt: policy?.notificationSentAt || '',
    notificationError: policy?.notificationError || ''
  };
};

const publicDelivery = job => job ? ({
  id: job.id,
  type: job.type,
  targetUsername: job.targetUsername,
  status: job.status,
  attemptCount: job.attemptCount,
  availableAt: job.availableAt,
  lastError: job.lastError,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
  sentAt: job.sentAt,
  deduplicated: Boolean(job.deduplicated)
}) : null;

async function queueMfaEnrollmentInvitation({
  user,
  provider,
  actorUsername,
  request,
  authStore,
  securityStore,
  securityCrypto,
  mfaService,
  getRequestOrigin,
  beforeInvitation,
  lockHeld = false
}) {
  const perform = async () => {
    const origin = getRequestOrigin(request);
    const generation = crypto.randomUUID();
    const invitationToken = mfaService.createOpaqueToken();
    const enrollment = mfaService.generateEnrollment({ username: user.username, provider });
    const encryptedSecret = mfaService.encryptSecret(enrollment.secret);
    const encryptedToken = securityCrypto.encryptOutboxSecret(invitationToken);
    const expiresAt = new Date(Date.now() + MFA_INVITATION_TTL_MS).toISOString();

    await securityStore.cancelEmails(user.username, 'mfa_setup');
    await securityStore.invalidateMfaInvitations(user.username);
    await securityStore.setMfaPolicy(user.username, {
      mode: 'authenticator',
      provider,
      enrollmentGeneration: generation,
      requestedAt: new Date().toISOString(),
      requestedBy: actorUsername,
      notificationStatus: 'queued',
      notificationAttemptedAt: '',
      notificationSentAt: '',
      notificationError: ''
    });
    let job;
    try {
      if (beforeInvitation) await beforeInvitation();
      await securityStore.createMfaInvitation({
        username: user.username,
        tokenHash: mfaService.tokenHash(invitationToken),
        provider,
        generation,
        ...encryptedSecret,
        expiresAt
      });
      job = await securityStore.enqueueEmail({
        type: 'mfa_setup',
        targetUsername: user.username,
        recipient: user.email,
        subject: `Set up ${providerLabel(provider)}`,
        metadata: {
          fullName: (await securityStore.getIdentity(user.username))?.fullName || '',
          provider,
          setupBaseUrl: `${origin}/login/mfa-setup`,
          enrollmentGeneration: generation,
          invitationExpiresAt: expiresAt
        },
        secretCiphertext: encryptedToken.ciphertext,
        secretIv: encryptedToken.iv,
        secretTag: encryptedToken.tag
      });
    } catch (error) {
      await securityStore.invalidateMfaInvitations(user.username);
      await securityStore.setMfaPolicy(user.username, {
        notificationStatus: 'failed',
        notificationError: 'Unable to queue authenticator setup email'
      });
      throw error;
    }
    await authStore.saveAuditEvent({
      actorUsername,
      targetUsername: user.username,
      action: 'mfa.notification_queued',
      metadata: { deliveryId: job.id, provider, invitationExpiresAt: expiresAt }
    });
    return publicDelivery(job);
  };
  return lockHeld
    ? perform()
    : securityStore.withMfaMutationLock(user.username, perform);
}

function registerProfileRoutes({
  app,
  authenticateJwt,
  requireAdmin,
  requirePermission = () => requireAdmin,
  authStore,
  securityStore,
  securityCrypto,
  mfaService,
  verifyPassword,
  hashPassword,
  issueSession,
  issuePasswordChangeChallenge,
  enrichPublicUser,
  getRequestOrigin
}) {
  const loadMfaSummary = async username => buildMfaSummary(
    await securityStore.getMfaPolicy(username),
    await authStore.getMfaConfig(username)
  );

  const getUserFromAdminRoute = req => (
    req.params.userId
      ? authStore.getUserByUserId(String(req.params.userId || '').trim())
      : authStore.getUserByUsername(String(req.params.username || '').trim())
  );

  const verifyTotpFactor = async (username, code) => {
    const config = await authStore.getMfaConfig(username);
    if (!config) return { ok: false, status: 400, error: 'Authenticator is not enabled' };
    if (config.lockedUntil && Date.parse(config.lockedUntil) > Date.now()) {
      return { ok: false, status: 429, error: 'Authenticator verification is temporarily locked. Try again later.' };
    }
    if (config.lockedUntil && Date.parse(config.lockedUntil) <= Date.now()) await authStore.resetMfaFailures(username);
    let accepted = false;
    try {
      const secret = mfaService.decryptSecret(config);
      const counter = mfaService.validateTotp({ secret, token: code });
      if (counter !== null) accepted = await authStore.markTotpUsed(username, counter);
    } catch { accepted = false; }
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

  const enqueueSetupEmail = input => queueMfaEnrollmentInvitation({
    ...input,
    authStore,
    securityStore,
    securityCrypto,
    mfaService,
    getRequestOrigin
  });

  const enqueueTemporaryPasswordEmail = async ({ user, temporaryPassword, expiresAt, actorUsername, request }) => {
    const encrypted = securityCrypto.encryptOutboxSecret(temporaryPassword);
    const origin = getRequestOrigin(request);
    const job = await securityStore.enqueueEmail({
      type: 'temporary_password',
      targetUsername: user.username,
      recipient: user.email,
      subject: 'Your temporary password',
      metadata: {
        fullName: (await securityStore.getIdentity(user.username))?.fullName || '',
        loginUrl: `${origin}/login/`,
        expiresAt
      },
      secretCiphertext: encrypted.ciphertext,
      secretIv: encrypted.iv,
      secretTag: encrypted.tag
    });
    await authStore.saveAuditEvent({
      actorUsername,
      targetUsername: user.username,
      action: 'password.temporary_notification_queued',
      metadata: { deliveryId: job.id }
    });
    return publicDelivery(job);
  };

  app.post('/api/login/mfa', async (req, res) => {
    if (req.body?.mode && String(req.body.mode).toLowerCase() !== 'totp') {
      return res.status(400).json({ error: 'Recovery codes are not supported. Contact an administrator.' });
    }
    const tokenHash = mfaService.tokenHash(String(req.body?.challengeToken || ''));
    const challenge = await authStore.getMfaChallenge(tokenHash, 'login');
    if (!challenge || challenge.attemptCount >= 5) {
      return res.status(400).json({ error: 'Verification challenge expired. Sign in again.', restartRequired: true });
    }
    try {
      const result = await verifyTotpFactor(challenge.username, req.body?.code);
      if (!result.ok) {
        const failure = await authStore.recordMfaChallengeFailure(tokenHash);
        if (failure?.consumed) return res.status(400).json({ error: 'Too many incorrect codes. Sign in again.', restartRequired: true });
        return res.status(result.status).json({ error: result.error });
      }
      if (!await authStore.consumeMfaChallenge(tokenHash)) {
        return res.status(400).json({ error: 'Verification challenge expired. Sign in again.', restartRequired: true });
      }
      const user = await authStore.getUserByUsername(challenge.username);
      if (!user || user.status === 'suspended') return res.status(401).json({ error: 'Unable to complete sign in' });
      const temporary = await securityStore.getTemporaryCredential(user.username);
      res.set('Cache-Control', 'no-store');
      if (temporary) return res.json(await issuePasswordChangeChallenge(user));
      return res.json(await issueSession(user, req));
    } catch (error) {
      console.error('MFA login error:', error.message);
      return res.status(500).json({ error: 'Unable to complete sign in' });
    }
  });

  app.post('/api/login/password-change', async (req, res) => {
    const tokenHash = mfaService.tokenHash(String(req.body?.challengeToken || ''));
    const passwordError = validateNewPassword(req.body?.newPassword);
    try {
      const challenge = await authStore.getMfaChallenge(tokenHash, 'password_change');
      if (!challenge || challenge.attemptCount >= 5) {
        return res.status(400).json({ error: 'Password-change session expired. Sign in again.', restartRequired: true });
      }
      if (passwordError) {
        const failure = await authStore.recordMfaChallengeFailure(tokenHash);
        return res.status(400).json({ error: failure?.consumed ? 'Too many unsuccessful attempts. Sign in again.' : passwordError, restartRequired: Boolean(failure?.consumed) });
      }
      const [user, temporary] = await Promise.all([
        authStore.getUserByUsername(challenge.username),
        securityStore.getTemporaryCredential(challenge.username)
      ]);
      if (!user || !temporary || Date.parse(temporary.expiresAt) <= Date.now()) {
        return res.status(401).json({ error: 'Temporary password expired. Contact an administrator.', restartRequired: true });
      }
      if (verifyPassword(String(req.body.newPassword), user)) {
        const failure = await authStore.recordMfaChallengeFailure(tokenHash);
        return res.status(400).json({ error: failure?.consumed ? 'Too many unsuccessful attempts. Sign in again.' : 'New password must be different from the temporary password', restartRequired: Boolean(failure?.consumed) });
      }
      if (!await authStore.consumeMfaChallenge(tokenHash)) {
        return res.status(400).json({ error: 'Password-change session expired. Sign in again.', restartRequired: true });
      }
      const next = hashPassword(String(req.body.newPassword));
      await authStore.updatePassword(user.username, { salt: next.salt, hash: next.hash, passwordAlgorithm: next.algorithm });
      await securityStore.clearTemporaryCredential(user.username);
      await authStore.revokeUserSessions(user.username);
      await authStore.saveAuditEvent({ actorUsername: user.username, targetUsername: user.username, action: 'password.temporary_changed' });
      res.set('Cache-Control', 'no-store');
      return res.json(await issueSession(await authStore.getUserByUsername(user.username), req));
    } catch (error) {
      console.error('Temporary password change error:', error.message);
      return res.status(500).json({ error: 'Unable to change password' });
    }
  });

  app.get('/api/profile', authenticateJwt, async (req, res) => {
    try {
      const user = await authStore.getUserByUsername(req.user.username);
      res.set('Cache-Control', 'no-store');
      res.json({ user: await enrichPublicUser(user), mfa: await loadMfaSummary(req.user.username) });
    } catch (error) {
      console.error('Profile load error:', error.message);
      res.status(500).json({ error: 'Unable to load profile' });
    }
  });

  const invalidInvitation = res => res.status(410).json({
    error: 'This authenticator setup link is invalid or has expired. Ask your administrator to resend it.',
    invitationInvalid: true
  });

  const loadValidInvitation = async invitationToken => {
    const tokenHash = mfaService.tokenHash(String(invitationToken || ''));
    if (!invitationToken) return { tokenHash, invitation: null };
    const invitation = await securityStore.getMfaInvitation(tokenHash);
    if (!invitation || invitation.status !== 'active') return { tokenHash, invitation: null };
    const [user, policy, existing] = await Promise.all([
      authStore.getUserByUsername(invitation.username),
      securityStore.getMfaPolicy(invitation.username),
      authStore.getMfaConfig(invitation.username)
    ]);
    const valid = user?.status === 'active'
      && !existing
      && policy?.mode === 'authenticator'
      && policy.provider === invitation.provider
      && policy.enrollmentGeneration === invitation.generation;
    return { tokenHash, invitation: valid ? invitation : null, user, policy };
  };

  app.post('/api/mfa/enrollment/start', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const { invitation, user } = await loadValidInvitation(req.body?.invitationToken);
      if (!invitation) return invalidInvitation(res);
      const secret = mfaService.decryptSecret(invitation);
      const enrollment = mfaService.buildEnrollment({ username: user.username, provider: invitation.provider, secret });
      return res.json({
        provider: invitation.provider,
        accountLabel: user.username,
        issuer: MFA_ISSUER,
        otpauthUri: enrollment.otpauthUri,
        manualKey: enrollment.manualKey,
        expiresAt: invitation.expiresAt
      });
    } catch (error) {
      console.error('Email MFA enrollment start failed:', error.message);
      return res.status(500).json({ error: 'Unable to open authenticator setup' });
    }
  });

  app.post('/api/mfa/enrollment/confirm', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const { tokenHash, invitation } = await loadValidInvitation(req.body?.invitationToken);
      if (!invitation) return invalidInvitation(res);
      const secret = mfaService.decryptSecret(invitation);
      const counter = mfaService.validateTotp({ secret, token: req.body?.code });
      if (counter === null) {
        const failure = await securityStore.recordMfaInvitationFailure(tokenHash);
        if (!failure || failure.status !== 'active') return invalidInvitation(res);
        return res.status(400).json({ error: 'Enter the current six-digit code from your authenticator' });
      }

      const enabledAt = new Date().toISOString();
      const completed = await securityStore.withMfaMutationLock(invitation.username, async () => {
        if (!securityStore.isDbEnabled()) await authStore.revokeUserSessions(invitation.username);
        return securityStore.completeMfaInvitation({ tokenHash, lastUsedCounter: counter, enabledAt });
      });
      if (!completed) return invalidInvitation(res);

      try { await securityStore.cancelEmails(completed.username, 'mfa_setup'); }
      catch (cleanupError) { console.error('Completed MFA email cleanup failed:', cleanupError.message); }
      try {
        await authStore.saveAuditEvent({
          actorUsername: completed.username,
          targetUsername: completed.username,
          action: 'mfa.enrolled',
          metadata: { provider: completed.provider, enrollment: 'email_invitation' }
        });
      } catch (auditError) { console.error('Completed MFA enrollment audit failed:', auditError.message); }
      let summary = {
        mode: 'authenticator', status: 'enabled', enabled: true,
        provider: completed.provider, enabledAt
      };
      try { summary = await loadMfaSummary(completed.username); }
      catch (summaryError) { console.error('Completed MFA summary load failed:', summaryError.message); }
      return res.json({
        message: 'Authenticator MFA enabled',
        mfa: summary,
        signInUrl: '/login/'
      });
    } catch (error) {
      console.error('Email MFA enrollment confirmation failed:', error.message);
      return res.status(500).json({ error: 'Unable to complete authenticator setup' });
    }
  });

  const enrollmentMovedToEmail = (_req, res) => res.status(410).json({
    error: 'Authenticator enrollment is available only from the setup link sent by email'
  });
  app.post('/api/profile/mfa/enrollment/start', authenticateJwt, enrollmentMovedToEmail);
  app.post('/api/profile/mfa/enrollment/confirm', authenticateJwt, enrollmentMovedToEmail);

  const administratorControlled = (_req, res) => res.status(403).json({ error: 'Your administrator manages this security setting' });
  app.patch('/api/profile', authenticateJwt, administratorControlled);
  app.patch('/api/profile/password', authenticateJwt, administratorControlled);
  app.post('/api/profile/mfa/setup', authenticateJwt, administratorControlled);
  app.post('/api/profile/mfa/confirm', authenticateJwt, administratorControlled);
  app.post('/api/profile/mfa/recovery-codes/regenerate', authenticateJwt, administratorControlled);
  app.post('/api/profile/mfa/disable', authenticateJwt, administratorControlled);

  app.post(['/api/users/id/:userId/password/reset', '/api/users/:username/password/reset'], authenticateJwt, requireAdmin, async (req, res) => {
    try {
      const target = await getUserFromAdminRoute(req);
      if (!target) return res.status(404).json({ error: 'User not found' });
      const username = target.username;
      const emailAvailable = validEmail(target.email);
      if (emailAvailable) getRequestOrigin(req);
      const temporaryPassword = crypto.randomBytes(18).toString('base64url');
      const next = hashPassword(temporaryPassword);
      await authStore.updatePassword(username, { salt: next.salt, hash: next.hash, passwordAlgorithm: next.algorithm });
      const expiresAt = new Date(Date.now() + TEMPORARY_PASSWORD_TTL_MS).toISOString();
      await securityStore.setTemporaryCredential(username, { expiresAt, createdBy: req.user.username });
      await authStore.revokeUserSessions(username);
      await securityStore.cancelEmails(username, 'temporary_password');
      const delivery = emailAvailable
        ? await enqueueTemporaryPasswordEmail({ user: target, temporaryPassword, expiresAt, actorUsername: req.user.username, request: req })
        : null;
      await authStore.saveAuditEvent({ actorUsername: req.user.username, targetUsername: username, action: 'user.password_reset', metadata: { expiresAt, emailQueued: Boolean(delivery) } });
      res.set('Cache-Control', 'no-store');
      res.json({
        message: `Temporary password generated for ${username}`,
        temporaryPassword,
        expiresAt,
        delivery,
        deliveryMode: delivery ? 'queued' : 'manual_only',
        sessionEnded: username === req.user.username
      });
    } catch (error) {
      console.error('Password reset error:', error.message);
      res.status(500).json({ error: 'Unable to reset password' });
    }
  });

  app.patch(['/api/users/id/:userId/mfa', '/api/users/:username/mfa'], authenticateJwt, requireAdmin, async (req, res) => {
    const provider = parseAdminMfaProvider(req.body);
    if (!provider) return res.status(400).json({ error: 'MFA provider must be disabled, google, microsoft, or other' });
    try {
      const target = await getUserFromAdminRoute(req);
      if (!target) return res.status(404).json({ error: 'User not found' });
      const username = target.username;
      const [config, policy] = await Promise.all([
        authStore.getMfaConfig(username), securityStore.getMfaPolicy(username)
      ]);
      const currentProvider = config?.provider || policy?.provider || '';
      let delivery = null;
      let sessionEnded = false;
      let action = 'mfa.admin_disabled';
      if (provider !== 'disabled') {
        if (!validEmail(target.email)) return res.status(400).json({ error: 'A valid email address is required for Authenticator MFA' });
        if (config && currentProvider === provider) return res.status(409).json({ error: `${providerLabel(provider)} is already enabled. Use Reset MFA to replace it.` });
        if (!config && policy?.mode === 'authenticator' && currentProvider === provider) {
          return res.status(409).json({ error: `${providerLabel(provider)} enrollment is already pending. Use Resend email.` });
        }
        const replacingEnrollment = Boolean(config || policy?.mode === 'authenticator');
        delivery = await enqueueSetupEmail({
          user: target,
          provider,
          actorUsername: req.user.username,
          request: req,
          beforeInvitation: config ? async () => {
            await authStore.clearMfa(username);
            await authStore.revokeUserSessions(username);
            sessionEnded = username === req.user.username;
          } : null
        });
        action = replacingEnrollment ? 'mfa.admin_provider_changed' : 'mfa.admin_enabled';
      } else {
        await securityStore.withMfaMutationLock(username, async () => {
          const [currentConfig, currentPolicy] = await Promise.all([
            authStore.getMfaConfig(username), securityStore.getMfaPolicy(username)
          ]);
          await securityStore.setMfaPolicy(username, {
            mode: 'disabled', provider: '', enrollmentGeneration: '', requestedAt: '', requestedBy: '', notificationStatus: 'none',
            notificationAttemptedAt: '', notificationSentAt: '', notificationError: ''
          });
          await securityStore.invalidateMfaInvitations(username);
          await securityStore.cancelEmails(username, 'mfa_setup');
          await authStore.clearMfa(username);
          if (currentConfig || currentPolicy?.mode === 'authenticator') {
            await authStore.revokeUserSessions(username);
            sessionEnded = username === req.user.username;
          }
        });
      }
      await authStore.saveAuditEvent({ actorUsername: req.user.username, targetUsername: username, action, metadata: { provider } });
      res.json({
        message: provider === 'disabled' ? 'Authenticator MFA disabled' : `${providerLabel(provider)} enrollment requested`,
        user: await enrichPublicUser(await authStore.getUserByUsername(username)),
        mfa: await loadMfaSummary(username),
        delivery,
        sessionEnded
      });
    } catch (error) {
      console.error('Administrator MFA update error:', error.message);
      res.status(500).json({ error: 'Unable to update Authenticator MFA' });
    }
  });

  app.post(['/api/users/id/:userId/mfa/reset', '/api/users/:username/mfa/reset'], authenticateJwt, requireAdmin, async (req, res) => {
    try {
      const target = await getUserFromAdminRoute(req);
      if (!target) return res.status(404).json({ error: 'User not found' });
      const username = target.username;
      const [config, policy] = await Promise.all([
        authStore.getMfaConfig(username), securityStore.getMfaPolicy(username)
      ]);
      if (!config) return res.status(400).json({ error: 'Authenticator MFA is not enabled for this user' });
      if (!validEmail(target.email)) return res.status(400).json({ error: 'A valid email address is required to reset Authenticator MFA' });
      const provider = config.provider || policy?.provider || 'other';
      const delivery = await enqueueSetupEmail({
        user: target,
        provider,
        actorUsername: req.user.username,
        request: req,
        beforeInvitation: async () => {
          await authStore.clearMfa(username);
          await authStore.revokeUserSessions(username);
        }
      });
      await authStore.saveAuditEvent({ actorUsername: req.user.username, targetUsername: username, action: 'mfa.admin_reset', metadata: { provider } });
      res.json({ message: `${providerLabel(provider)} enrollment reset for ${username}`, mfa: await loadMfaSummary(username), delivery, sessionEnded: username === req.user.username });
    } catch (error) {
      console.error('Administrator MFA reset error:', error.message);
      res.status(500).json({ error: 'Unable to reset Authenticator MFA' });
    }
  });

  app.post(['/api/users/id/:userId/mfa/resend', '/api/users/:username/mfa/resend'], authenticateJwt, requireAdmin, async (req, res) => {
    try {
      const target = await getUserFromAdminRoute(req);
      if (!target) return res.status(404).json({ error: 'User not found' });
      const username = target.username;
      const [policy, config] = await Promise.all([
        securityStore.getMfaPolicy(username), authStore.getMfaConfig(username)
      ]);
      if (String(target.status || '').toLowerCase() === 'suspended') {
        return res.status(409).json({ error: 'Reactivate this account before resending the setup email' });
      }
      if (policy?.mode !== 'authenticator' || config) return res.status(409).json({ error: 'Authenticator enrollment is not pending' });
      if (!validEmail(target.email)) return res.status(400).json({ error: 'A valid email address is required to resend the setup email' });
      const provider = policy.provider || 'other';
      const delivery = await securityStore.withMfaMutationLock(username, async () => {
        const [currentPolicy, currentConfig, activeDelivery, activeInvitation] = await Promise.all([
          securityStore.getMfaPolicy(username),
          authStore.getMfaConfig(username),
          securityStore.findActiveEmail('mfa_setup', username),
          securityStore.getActiveMfaInvitation(username)
        ]);
        if (currentPolicy?.mode !== 'authenticator' || currentConfig || currentPolicy.provider !== provider) return null;
        const reusableDelivery = activeDelivery
          && activeInvitation
          && activeDelivery.metadata?.enrollmentGeneration === activeInvitation.generation;
        return reusableDelivery
          ? publicDelivery({ ...activeDelivery, deduplicated: true })
          : enqueueSetupEmail({
            user: target,
            provider,
            actorUsername: req.user.username,
            request: req,
            lockHeld: true
          });
      });
      if (!delivery) return res.status(409).json({ error: 'Authenticator enrollment is no longer pending' });
      await authStore.saveAuditEvent({ actorUsername: req.user.username, targetUsername: username, action: 'mfa.notification_resent', metadata: { deliveryId: delivery.id, provider } });
      res.json({ message: delivery.deduplicated ? 'Setup email is already queued' : 'Setup email queued', delivery, mfa: await loadMfaSummary(username) });
    } catch (error) {
      console.error('MFA notification resend error:', error.message);
      res.status(500).json({ error: 'Unable to queue setup email' });
    }
  });

  app.get('/api/settings/email', authenticateJwt, requirePermission('hub.settings.manage'), async (req, res) => {
    try { res.json(publicEmailSettings(await securityStore.getEmailSettings())); }
    catch (error) { console.error('Email settings load error:', error.message); res.status(500).json({ error: 'Unable to load email settings' }); }
  });

  app.patch('/api/settings/email', authenticateJwt, requirePermission('hub.settings.manage'), async (req, res) => {
    try {
      const current = await securityStore.getEmailSettings();
      const clearPassword = Boolean(req.body?.clearPassword);
      let passwordFields = { passwordCiphertext: current.passwordCiphertext, passwordIv: current.passwordIv, passwordTag: current.passwordTag };
      if (clearPassword) passwordFields = { passwordCiphertext: '', passwordIv: '', passwordTag: '' };
      else if (String(req.body?.password || '')) {
        const encrypted = securityCrypto.encryptSetting(String(req.body.password));
        passwordFields = { passwordCiphertext: encrypted.ciphertext, passwordIv: encrypted.iv, passwordTag: encrypted.tag };
      }
      const candidate = {
        host: String(req.body?.host || '').trim(), port: Number(req.body?.port),
        security: String(req.body?.security || '').trim().toLowerCase(), username: String(req.body?.username || '').trim(),
        fromAddress: String(req.body?.fromAddress || '').trim(), updatedBy: req.user.username, ...passwordFields
      };
      const validationError = validateEmailSettings({ ...candidate, hasPassword: Boolean(candidate.passwordCiphertext) });
      if (validationError) return res.status(400).json({ error: validationError });
      const saved = await securityStore.saveEmailSettings(candidate);
      await authStore.saveAuditEvent({ actorUsername: req.user.username, targetUsername: '', action: 'email.settings_updated', metadata: { host: saved.host, port: saved.port, security: saved.security, usernameConfigured: Boolean(saved.username) } });
      res.json({ message: 'Email settings saved', settings: publicEmailSettings(saved) });
    } catch (error) {
      console.error('Email settings update error:', error.message);
      res.status(500).json({ error: 'Unable to save email settings' });
    }
  });

}

module.exports = {
  MFA_INVITATION_TTL_MS,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  TEMPORARY_PASSWORD_TTL_MS,
  buildMfaSummary,
  isValidEmail,
  parseAdminMfaProvider,
  queueMfaEnrollmentInvitation,
  registerProfileRoutes,
  validateNewPassword
};
