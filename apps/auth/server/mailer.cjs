const nodemailer = require('nodemailer');

const cleanText = (value, fallback = '') => {
  const text = String(value || '').replace(/[\r\n\t]+/g, ' ').trim();
  return text || fallback;
};

const escapeHtml = value => cleanText(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const parseApplicationUrl = value => {
  const text = cleanText(value);
  if (!text) return null;

  try {
    const candidate = new URL(text);
    if (
      (candidate.protocol === 'http:' || candidate.protocol === 'https:')
      && !candidate.username
      && !candidate.password
    ) {
      candidate.hash = '';
      candidate.search = '';
      candidate.pathname = `${candidate.pathname.replace(/\/+$/, '')}/`;
      return candidate;
    }
  } catch {
    // The caller receives a generic configuration error if no fallback exists.
  }
  return null;
};

const readConfiguration = env => {
  const host = cleanText(env.SMTP_HOST);
  const from = cleanText(env.SMTP_FROM);
  const user = cleanText(env.SMTP_USER);
  const password = String(env.SMTP_PASSWORD || '');
  const port = Number(String(env.SMTP_PORT || ''));
  const secureValue = cleanText(env.SMTP_SECURE, 'false').toLowerCase();
  const secure = secureValue === '1' || secureValue === 'true';
  const secureValueValid = ['0', '1', 'false', 'true'].includes(secureValue);

  const configuredPublicUrl = cleanText(env.APP_PUBLIC_URL);
  const publicUrl = parseApplicationUrl(configuredPublicUrl);
  const publicUrlValid = !configuredPublicUrl || Boolean(publicUrl);

  const credentialsMatch = Boolean(user) === Boolean(password);
  const configured = Boolean(
    host
    && from
    && Number.isInteger(port)
    && port > 0
    && port <= 65535
    && credentialsMatch
    && secureValueValid
    && publicUrlValid
  );

  return { configured, host, port, secure, user, password, from, publicUrl };
};

const safeError = (code, message) => Object.assign(new Error(message), { code });

const createMailer = (env = process.env, { nodemailerClient = nodemailer } = {}) => {
  const configuration = readConfiguration(env);
  const transport = configuration.configured
    ? nodemailerClient.createTransport({
        host: configuration.host,
        port: configuration.port,
        secure: configuration.secure,
        ...(configuration.user
          ? { auth: { user: configuration.user, pass: configuration.password } }
          : {})
      })
    : null;

  const sendMfaSetupEmail = async ({ to, fullName, username, requestedBy, applicationUrl } = {}) => {
    if (!transport) {
      throw safeError('MAIL_NOT_CONFIGURED', 'MFA setup email is unavailable.');
    }

    const publicUrl = parseApplicationUrl(applicationUrl) || configuration.publicUrl;
    if (!publicUrl) {
      throw safeError('MAIL_NOT_CONFIGURED', 'MFA setup email is unavailable.');
    }

    const recipient = cleanText(to);
    if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(recipient)) {
      throw safeError('INVALID_RECIPIENT', 'A valid recipient email address is required.');
    }

    const accountName = cleanText(username, 'your account');
    const greetingName = cleanText(fullName, accountName);
    const administrator = cleanText(requestedBy, 'an administrator');
    const setupUrl = new URL('#mfa-setup', publicUrl).toString();
    const text = [
      `Hello ${greetingName},`,
      '',
      `Authenticator MFA is ready to set up for ${accountName}.`,
      `Sign in and complete enrollment: ${setupUrl}`,
      '',
      `Requested by: ${administrator}`,
      'If you did not expect this change, contact your administrator.'
    ].join('\n');
    const html = [
      `<p>Hello ${escapeHtml(greetingName)},</p>`,
      `<p>Authenticator MFA is ready to set up for <strong>${escapeHtml(accountName)}</strong>.</p>`,
      `<p><a href="${escapeHtml(setupUrl)}">Sign in and complete enrollment</a></p>`,
      `<p>Requested by: ${escapeHtml(administrator)}</p>`,
      '<p>If you did not expect this change, contact your administrator.</p>'
    ].join('');

    try {
      return await transport.sendMail({
        from: configuration.from,
        to: recipient,
        subject: 'Set up Authenticator MFA',
        text,
        html
      });
    } catch {
      throw safeError('SMTP_DELIVERY_FAILED', 'Unable to send MFA setup email.');
    }
  };

  return { configured: configuration.configured, sendMfaSetupEmail };
};

module.exports = { createMailer };
