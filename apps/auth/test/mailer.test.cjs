const test = require('node:test');
const assert = require('node:assert/strict');
const { createMailer } = require('../server/mailer.cjs');

const completeEnvironment = {
  APP_PUBLIC_URL: 'https://security.example.test/gateway',
  SMTP_HOST: 'smtp.example.test',
  SMTP_PORT: '587',
  SMTP_SECURE: 'false',
  SMTP_USER: 'mailer',
  SMTP_PASSWORD: 'smtp-password',
  SMTP_FROM: 'Security Hub <security@example.test>'
};

test('mailer stays unavailable when SMTP settings are missing', async () => {
  const mailer = createMailer({ APP_PUBLIC_URL: 'http://localhost' });
  assert.equal(mailer.configured, false);
  await assert.rejects(
    mailer.sendMfaSetupEmail({ to: 'user@example.test' }),
    error => error.code === 'MAIL_NOT_CONFIGURED' && !error.message.includes('smtp-password')
  );
});

test('mailer rejects a public URL that contains credentials', () => {
  let transportCreated = false;
  const mailer = createMailer({
    ...completeEnvironment,
    APP_PUBLIC_URL: 'https://gateway-user:gateway-password@security.example.test'
  }, {
    nodemailerClient: {
      createTransport() {
        transportCreated = true;
      }
    }
  });

  assert.equal(mailer.configured, false);
  assert.equal(transportCreated, false);
});

test('mailer sends a trusted setup URL without MFA or SMTP secrets', async () => {
  let transportOptions;
  let message;
  const mailer = createMailer(completeEnvironment, {
    nodemailerClient: {
      createTransport(options) {
        transportOptions = options;
        return {
          async sendMail(value) {
            message = value;
            return { messageId: 'test-message' };
          }
        };
      }
    }
  });

  assert.equal(mailer.configured, true);
  const result = await mailer.sendMfaSetupEmail({
    to: 'user@example.test',
    fullName: 'Example User',
    username: 'example-user',
    requestedBy: 'admin'
  });

  assert.equal(result.messageId, 'test-message');
  assert.deepEqual(transportOptions, {
    host: 'smtp.example.test',
    port: 587,
    secure: false,
    auth: { user: 'mailer', pass: 'smtp-password' }
  });
  assert.equal(message.to, 'user@example.test');
  assert.match(message.text, /https:\/\/security\.example\.test\/gateway\/#mfa-setup/);
  assert.match(message.html, /https:\/\/security\.example\.test\/gateway\/#mfa-setup/);
  assert.doesNotMatch(`${message.text}${message.html}`, /smtp-password|otpauth|setupToken|challengeToken/);
});

test('mailer uses the current private application origin when no URL override is configured', async () => {
  let message;
  const mailer = createMailer({
    ...completeEnvironment,
    APP_PUBLIC_URL: ''
  }, {
    nodemailerClient: {
      createTransport() {
        return {
          async sendMail(value) {
            message = value;
            return { messageId: 'private-origin-message' };
          }
        };
      }
    }
  });

  assert.equal(mailer.configured, true);
  await mailer.sendMfaSetupEmail({
    to: 'user@example.test',
    username: 'private-user',
    applicationUrl: 'http://10.20.30.40:8080'
  });

  assert.match(message.text, /http:\/\/10\.20\.30\.40:8080\/#mfa-setup/);
  assert.match(message.html, /http:\/\/10\.20\.30\.40:8080\/#mfa-setup/);
});

test('mailer hides transport details when delivery fails', async () => {
  const mailer = createMailer(completeEnvironment, {
    nodemailerClient: {
      createTransport() {
        return {
          async sendMail() {
            throw new Error('Authentication failed for smtp-password');
          }
        };
      }
    }
  });

  await assert.rejects(
    mailer.sendMfaSetupEmail({ to: 'user@example.test', username: 'user' }),
    error => error.code === 'SMTP_DELIVERY_FAILED'
      && error.message === 'Unable to send MFA setup email.'
      && !error.message.includes('smtp-password')
  );
});

test('mailer supports SMTP relays without authentication', async () => {
  let options;
  const mailer = createMailer({
    ...completeEnvironment,
    SMTP_USER: '',
    SMTP_PASSWORD: ''
  }, {
    nodemailerClient: {
      createTransport(value) {
        options = value;
        return { sendMail: async () => ({}) };
      }
    }
  });

  assert.equal(mailer.configured, true);
  assert.equal(Object.hasOwn(options, 'auth'), false);
});
