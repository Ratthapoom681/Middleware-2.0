let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch { /* Installed in the production image; tests may inject a transport. */ }

const clean = value => String(value || '').replace(/[\r\n\t]+/g, ' ').trim();
const escapeHtml = value => clean(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const validEmail = value => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(clean(value)) && clean(value).length <= 254;
const providerLabel = provider => clean(provider).toLowerCase() === 'google'
  ? 'Google Authenticator'
  : clean(provider).toLowerCase() === 'microsoft' ? 'Microsoft Authenticator' : 'Other authenticator';

const publicEmailSettings = settings => ({
  host: clean(settings?.host),
  port: Number(settings?.port || 25),
  security: clean(settings?.security) || 'plain',
  username: clean(settings?.username),
  hasPassword: Boolean(settings?.passwordCiphertext),
  fromAddress: clean(settings?.fromAddress),
  configured: Boolean(clean(settings?.host) && validEmail(settings?.fromAddress)),
  updatedAt: settings?.updatedAt || '',
  updatedBy: clean(settings?.updatedBy),
  warning: clean(settings?.security) === 'plain'
    ? 'Email is sent without transport encryption. Temporary passwords can be exposed in transit.'
    : ''
});

const validateEmailSettings = values => {
  const host = clean(values?.host);
  const port = Number(values?.port);
  const security = clean(values?.security).toLowerCase();
  const username = clean(values?.username);
  const fromAddress = clean(values?.fromAddress);
  if (!host) return 'SMTP host is required';
  if (!Number.isInteger(port) || port < 1 || port > 65535) return 'SMTP port must be between 1 and 65535';
  if (!['plain', 'starttls', 'tls'].includes(security)) return 'Choose Plain, STARTTLS, or Implicit TLS';
  if (!validEmail(fromAddress)) return 'Enter a valid From address';
  const hasPassword = Boolean(values?.hasPassword || values?.passwordCiphertext);
  if (Boolean(username) !== hasPassword) return 'SMTP username and password must be configured together';
  return '';
};

const buildMessage = (job, secret = '') => {
  const metadata = job.metadata || {};
  if (job.type === 'mfa_setup') {
    const name = clean(metadata.fullName) || clean(job.targetUsername) || 'user';
    const setupUrl = clean(metadata.setupUrl);
    const authenticator = providerLabel(metadata.provider);
    return {
      text: [`Hello ${name},`, '', `${authenticator} is ready to set up for ${job.targetUsername}.`,
        `Sign in and complete enrollment: ${setupUrl}`, '', 'If you did not expect this change, contact your administrator.'].join('\n'),
      html: `<p>Hello ${escapeHtml(name)},</p><p>${escapeHtml(authenticator)} is ready to set up for <strong>${escapeHtml(job.targetUsername)}</strong>.</p><p><a href="${escapeHtml(setupUrl)}">Sign in and complete enrollment</a></p><p>If you did not expect this change, contact your administrator.</p>`
    };
  }
  if (job.type === 'temporary_password') {
    const name = clean(metadata.fullName) || clean(job.targetUsername) || 'user';
    const loginUrl = clean(metadata.loginUrl);
    return {
      text: [`Hello ${name},`, '', `A temporary password was generated for ${job.targetUsername}.`,
        `Temporary password: ${secret}`, 'It expires in 24 hours and must be changed when you sign in.',
        `Sign in: ${loginUrl}`, '', 'If you did not expect this change, contact your administrator.'].join('\n'),
      html: `<p>Hello ${escapeHtml(name)},</p><p>A temporary password was generated for <strong>${escapeHtml(job.targetUsername)}</strong>.</p><p>Temporary password: <code>${escapeHtml(secret)}</code></p><p>It expires in 24 hours and must be changed when you sign in.</p><p><a href="${escapeHtml(loginUrl)}">Sign in</a></p><p>If you did not expect this change, contact your administrator.</p>`
    };
  }
  throw Object.assign(new Error('Unsupported email delivery type'), { code: 'UNSUPPORTED_DELIVERY_TYPE', permanent: true });
};

function createEmailWorker({ store, securityCrypto, saveAuditEvent, nodemailerClient = nodemailer, pollIntervalMs = 5000 }) {
  let timer = null;
  let running = false;
  let stopped = true;

  const processOne = async () => {
    if (running || stopped) return false;
    running = true;
    let job = null;
    try {
      job = await store.claimNextEmail();
      if (!job) return false;
      if (job.type === 'temporary_password' && Date.parse(job.metadata?.expiresAt || '') <= Date.now()) {
        throw Object.assign(new Error('Temporary password expired before delivery'), { code: 'CREDENTIAL_EXPIRED', permanent: true });
      }
      const settings = await store.getEmailSettings();
      const validationError = validateEmailSettings(settings);
      if (validationError) throw Object.assign(new Error('Email delivery is not configured'), { code: 'MAIL_NOT_CONFIGURED', permanent: true });
      if (!nodemailerClient) throw new Error('Email transport is unavailable');
      let password = '';
      if (settings.passwordCiphertext) password = securityCrypto.decryptSetting({
        ciphertext: settings.passwordCiphertext, iv: settings.passwordIv, tag: settings.passwordTag
      });
      let secret = '';
      if (job.secretCiphertext) secret = securityCrypto.decryptOutboxSecret({
        ciphertext: job.secretCiphertext, iv: job.secretIv, tag: job.secretTag
      });
      const transport = nodemailerClient.createTransport({
        host: settings.host,
        port: settings.port,
        secure: settings.security === 'tls',
        requireTLS: settings.security === 'starttls',
        ignoreTLS: settings.security === 'plain',
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
        ...(settings.username ? { auth: { user: settings.username, pass: password } } : {})
      });
      const message = buildMessage(job, secret);
      await transport.sendMail({
        from: settings.fromAddress,
        to: job.recipient,
        subject: job.subject,
        text: message.text,
        html: message.html
      });
      await store.finishEmail(job);
      try {
        await saveAuditEvent?.({ actorUsername: 'email-worker', targetUsername: job.targetUsername, action: 'email.delivered', metadata: { deliveryId: job.id, type: job.type } });
      } catch (auditError) { console.error('Email delivery audit failed:', auditError.message); }
      return true;
    } catch (error) {
      if (job) {
        await store.finishEmail(job, { error: error?.code || 'DELIVERY_FAILED', permanent: Boolean(error?.permanent) });
        try {
          await saveAuditEvent?.({ actorUsername: 'email-worker', targetUsername: job.targetUsername, action: 'email.delivery_failed', metadata: { deliveryId: job.id, type: job.type, errorCode: error?.code || 'DELIVERY_FAILED' } });
        } catch (auditError) { console.error('Email failure audit failed:', auditError.message); }
      }
      return Boolean(job);
    } finally {
      running = false;
    }
  };

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(async () => {
      await processOne();
      schedule();
    }, pollIntervalMs);
    timer.unref?.();
  };

  const start = () => { if (!stopped) return; stopped = false; schedule(); };
  const stop = () => { stopped = true; if (timer) clearTimeout(timer); timer = null; };
  return { start, stop, processOne };
}

module.exports = { createEmailWorker, publicEmailSettings, validateEmailSettings, validEmail };
