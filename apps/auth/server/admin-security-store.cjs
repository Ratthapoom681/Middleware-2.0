const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const clean = value => String(value || '').trim();
const iso = value => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
};
const normalizeMode = value => clean(value).toLowerCase() === 'authenticator' ? 'authenticator' : 'disabled';
const MFA_PROVIDERS = new Set(['google', 'microsoft', 'other']);
const normalizeProvider = (value, mode) => {
  if (normalizeMode(mode) === 'disabled') return '';
  const provider = clean(value).toLowerCase();
  return MFA_PROVIDERS.has(provider) ? provider : 'other';
};
const normalizeDeliveryStatus = value => {
  const status = clean(value).toLowerCase();
  return ['queued', 'sending', 'sent', 'failed'].includes(status) ? status : 'none';
};
const EMAIL_TYPES = new Set(['mfa_setup', 'temporary_password']);
const MFA_INVITATION_MAX_ATTEMPTS = 5;
const MFA_INVITATION_LIFETIME_MS = 24 * 60 * 60 * 1000;
const initialFileData = () => ({
  version: 2,
  identities: {},
  policies: {},
  temporaryCredentials: {},
  emailSettings: {},
  outbox: {},
  mfaInvitations: {}
});

const normalizeGeneration = value => clean(value);

const invitationStatus = (invitation, policy = null) => {
  if (!invitation) return '';
  if (invitation.cancelledAt) return 'cancelled';
  if (invitation.consumedAt) return 'consumed';
  if (Date.parse(invitation.expiresAt || '') <= Date.now()) return 'expired';
  if (invitation.attemptCount >= MFA_INVITATION_MAX_ATTEMPTS) return 'consumed';
  if (policy && (
    policy.mode !== 'authenticator'
    || policy.provider !== invitation.provider
    || policy.enrollmentGeneration !== invitation.generation
  )) return 'superseded';
  return 'active';
};

const poolConfig = () => {
  const connectionString = process.env.AUTH_DATABASE_URL || process.env.DATABASE_URL || '';
  const config = connectionString ? { connectionString } : {};
  const sslMode = clean(process.env.PGSSLMODE).toLowerCase();
  if (sslMode && sslMode !== 'disable') config.ssl = sslMode === 'no-verify' ? { rejectUnauthorized: false } : true;
  return Object.keys(config).length ? config : undefined;
};

function createAdminSecurityStore({ dataDir }) {
  const filePath = path.join(dataDir, 'admin-security.json');
  const mfaPath = path.join(dataDir, 'mfa.json');
  const usersPath = path.join(dataDir, 'users.json');
  const dbConfigured = Boolean(process.env.AUTH_DATABASE_URL || process.env.DATABASE_URL || process.env.PGHOST || process.env.PGDATABASE);
  let pool = null;
  const fileMfaLocks = new Map();

  const readFile = () => {
    if (!fs.existsSync(filePath)) return initialFileData();
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return { ...initialFileData(), ...(parsed && typeof parsed === 'object' ? parsed : {}) };
    } catch (error) {
      console.error('Auth Service: Unable to read protected admin security data:', error.message);
      return initialFileData();
    }
  };
  const writeFile = data => {
    const tempPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tempPath, filePath);
    try { fs.chmodSync(filePath, 0o600); } catch { /* Windows does not implement POSIX modes. */ }
  };
  const mutateFile = callback => {
    const data = readFile();
    const result = callback(data);
    writeFile(data);
    return result;
  };
  const readFileMfa = () => {
    if (!fs.existsSync(mfaPath)) return {};
    try {
      const parsed = JSON.parse(fs.readFileSync(mfaPath, 'utf8'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      throw new Error(`Unable to read protected MFA data: ${error.message}`);
    }
  };
  const writeFileMfa = data => {
    const tempPath = `${mfaPath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tempPath, mfaPath);
    try { fs.chmodSync(mfaPath, 0o600); } catch { /* Windows does not implement POSIX modes. */ }
  };
  const isActiveFileUser = username => {
    if (!fs.existsSync(usersPath)) return false;
    try {
      const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
      return Array.isArray(users) && users.some(user => clean(user?.username) === username && clean(user?.status).toLowerCase() === 'active');
    } catch {
      return false;
    }
  };

  const initialize = async () => {
    if (dbConfigured) {
      pool = new Pool(poolConfig());
      await pool.query('SELECT 1');
      return;
    }
    if (!fs.existsSync(filePath)) {
      writeFile(initialFileData());
      return;
    }
    if (Number(readFile().version || 0) < 2) {
      const confirmedMfa = readFileMfa();
      mutateFile(data => {
        const migratedAt = new Date().toISOString();
        data.version = 2;
        data.mfaInvitations = data.mfaInvitations || {};
        for (const job of Object.values(data.outbox || {})) {
          if (job.type !== 'mfa_setup' || !['queued', 'sending'].includes(job.status)) continue;
          Object.assign(job, {
            status: 'cancelled',
            secretCiphertext: '',
            secretIv: '',
            secretTag: '',
            leaseExpiresAt: '',
            updatedAt: migratedAt
          });
        }
        for (const [username, policyValue] of Object.entries(data.policies || {})) {
          const policy = policyFromRow(policyValue);
          if (policy.mode !== 'authenticator' || confirmedMfa[username]?.secretCiphertext) continue;
          data.policies[username] = policyFromRow({
            ...policy,
            enrollmentGeneration: '',
            notificationStatus: 'failed',
            notificationAttemptedAt: migratedAt,
            notificationSentAt: '',
            notificationError: 'Authenticator setup email must be resent'
          });
        }
      });
    }
  };

  const withMfaMutationLock = async (username, callback) => {
    const key = clean(username);
    if (!key) throw new Error('MFA mutation username is required');
    if (pool) {
      const client = await pool.connect();
      try {
        await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [key]);
        return await callback();
      } finally {
        try { await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [key]); }
        finally { client.release(); }
      }
    }

    const previous = fileMfaLocks.get(key) || Promise.resolve();
    let release;
    const current = new Promise(resolve => { release = resolve; });
    fileMfaLocks.set(key, current);
    await previous;
    try {
      return await callback();
    } finally {
      release();
      if (fileMfaLocks.get(key) === current) fileMfaLocks.delete(key);
    }
  };

  const getIdentity = async username => {
    const key = clean(username);
    if (pool) {
      const { rows } = await pool.query(
        'SELECT full_name, company, department FROM auth_users WHERE username = $1', [key]
      );
      return rows[0] ? { fullName: rows[0].full_name, company: rows[0].company, department: rows[0].department } : null;
    }
    return { fullName: '', company: '', department: '', ...(readFile().identities[key] || {}) };
  };

  const setIdentity = async (username, values = {}) => {
    const key = clean(username);
    const identity = {
      fullName: clean(values.fullName).slice(0, 120),
      company: clean(values.company).slice(0, 120),
      department: clean(values.department).slice(0, 120)
    };
    if (pool) {
      const { rowCount } = await pool.query(`
        UPDATE auth_users SET full_name = $2, company = $3, department = $4, updated_at = now()
        WHERE username = $1
      `, [key, identity.fullName, identity.company, identity.department]);
      return rowCount ? identity : null;
    }
    mutateFile(data => { data.identities[key] = identity; });
    return identity;
  };

  const policyFromRow = row => row ? ({
    mode: normalizeMode(row.mode),
    provider: normalizeProvider(row.provider, row.mode),
    enrollmentGeneration: normalizeGeneration(row.enrollment_generation ?? row.enrollmentGeneration),
    requestedAt: iso(row.requested_at ?? row.requestedAt),
    requestedBy: clean(row.requested_by ?? row.requestedBy),
    notificationStatus: normalizeDeliveryStatus(row.notification_status ?? row.notificationStatus),
    notificationAttemptedAt: iso(row.notification_attempted_at ?? row.notificationAttemptedAt),
    notificationSentAt: iso(row.notification_sent_at ?? row.notificationSentAt),
    notificationError: clean(row.notification_error ?? row.notificationError)
  }) : ({ mode: 'disabled', provider: '', enrollmentGeneration: '', requestedAt: '', requestedBy: '', notificationStatus: 'none', notificationAttemptedAt: '', notificationSentAt: '', notificationError: '' });

  const getMfaPolicy = async username => {
    const key = clean(username);
    if (pool) {
      const { rows } = await pool.query(`
        SELECT p.* FROM auth_mfa_policy p JOIN auth_users u ON u.id = p.user_id WHERE u.username = $1
      `, [key]);
      return policyFromRow(rows[0]);
    }
    return policyFromRow(readFile().policies[key]);
  };

  const setMfaPolicy = async (username, changes = {}) => {
    const key = clean(username);
    const current = await getMfaPolicy(key);
    const next = policyFromRow({
      mode: Object.prototype.hasOwnProperty.call(changes, 'mode') ? changes.mode : current.mode,
      provider: Object.prototype.hasOwnProperty.call(changes, 'provider') ? changes.provider : current.provider,
      enrollmentGeneration: Object.prototype.hasOwnProperty.call(changes, 'enrollmentGeneration') ? changes.enrollmentGeneration : current.enrollmentGeneration,
      requestedAt: Object.prototype.hasOwnProperty.call(changes, 'requestedAt') ? changes.requestedAt : current.requestedAt,
      requestedBy: Object.prototype.hasOwnProperty.call(changes, 'requestedBy') ? changes.requestedBy : current.requestedBy,
      notificationStatus: Object.prototype.hasOwnProperty.call(changes, 'notificationStatus') ? changes.notificationStatus : current.notificationStatus,
      notificationAttemptedAt: Object.prototype.hasOwnProperty.call(changes, 'notificationAttemptedAt') ? changes.notificationAttemptedAt : current.notificationAttemptedAt,
      notificationSentAt: Object.prototype.hasOwnProperty.call(changes, 'notificationSentAt') ? changes.notificationSentAt : current.notificationSentAt,
      notificationError: Object.prototype.hasOwnProperty.call(changes, 'notificationError') ? changes.notificationError : current.notificationError
    });
    if (pool) {
      await pool.query(`
        INSERT INTO auth_mfa_policy (
          user_id, mode, provider, enrollment_generation, requested_at, requested_by, notification_status,
          notification_attempted_at, notification_sent_at, notification_error
        )
        SELECT id, $2, $3, $4, $5, $6, $7, $8, $9, $10 FROM auth_users WHERE username = $1
        ON CONFLICT (user_id) DO UPDATE SET
          mode = EXCLUDED.mode, provider = EXCLUDED.provider, enrollment_generation = EXCLUDED.enrollment_generation,
          requested_at = EXCLUDED.requested_at,
          requested_by = EXCLUDED.requested_by, notification_status = EXCLUDED.notification_status,
          notification_attempted_at = EXCLUDED.notification_attempted_at,
          notification_sent_at = EXCLUDED.notification_sent_at,
          notification_error = EXCLUDED.notification_error, updated_at = now()
      `, [key, next.mode, next.provider, next.enrollmentGeneration, next.requestedAt || null, next.requestedBy, next.notificationStatus,
        next.notificationAttemptedAt || null, next.notificationSentAt || null, next.notificationError]);
    } else {
      mutateFile(data => { data.policies[key] = next; });
    }
    return next;
  };

  const setTemporaryCredential = async (username, { expiresAt, createdBy } = {}) => {
    const key = clean(username);
    const record = { expiresAt: iso(expiresAt), createdAt: new Date().toISOString(), createdBy: clean(createdBy) };
    if (pool) {
      await pool.query(`
        INSERT INTO auth_temporary_credentials (user_id, expires_at, created_by)
        SELECT id, $2, $3 FROM auth_users WHERE username = $1
        ON CONFLICT (user_id) DO UPDATE SET expires_at = EXCLUDED.expires_at,
          created_at = now(), created_by = EXCLUDED.created_by
      `, [key, record.expiresAt, record.createdBy]);
    } else mutateFile(data => { data.temporaryCredentials[key] = record; });
    return record;
  };

  const getTemporaryCredential = async username => {
    const key = clean(username);
    if (pool) {
      const { rows } = await pool.query(`
        SELECT t.expires_at, t.created_at, t.created_by
        FROM auth_temporary_credentials t JOIN auth_users u ON u.id = t.user_id WHERE u.username = $1
      `, [key]);
      return rows[0] ? { expiresAt: iso(rows[0].expires_at), createdAt: iso(rows[0].created_at), createdBy: rows[0].created_by } : null;
    }
    return readFile().temporaryCredentials[key] || null;
  };

  const clearTemporaryCredential = async username => {
    const key = clean(username);
    if (pool) {
      await pool.query('DELETE FROM auth_temporary_credentials WHERE user_id = (SELECT id FROM auth_users WHERE username = $1)', [key]);
    } else mutateFile(data => { delete data.temporaryCredentials[key]; });
  };

  const settingsFromRow = row => ({
    host: clean(row?.host), port: Number(row?.port || 25), security: clean(row?.security) || 'plain',
    username: clean(row?.username), passwordCiphertext: clean(row?.password_ciphertext ?? row?.passwordCiphertext),
    passwordIv: clean(row?.password_iv ?? row?.passwordIv), passwordTag: clean(row?.password_tag ?? row?.passwordTag),
    fromAddress: clean(row?.from_address ?? row?.fromAddress), updatedAt: iso(row?.updated_at ?? row?.updatedAt),
    updatedBy: clean(row?.updated_by ?? row?.updatedBy)
  });

  const getEmailSettings = async () => {
    if (pool) {
      const { rows } = await pool.query('SELECT * FROM auth_email_settings WHERE singleton = true');
      return settingsFromRow(rows[0]);
    }
    return settingsFromRow(readFile().emailSettings);
  };

  const saveEmailSettings = async values => {
    const current = await getEmailSettings();
    const next = settingsFromRow({ ...current, ...values, updatedAt: new Date().toISOString() });
    if (pool) {
      await pool.query(`
        INSERT INTO auth_email_settings (
          singleton, host, port, security, username, password_ciphertext,
          password_iv, password_tag, from_address, updated_at, updated_by
        ) VALUES (true, $1, $2, $3, $4, $5, $6, $7, $8, now(), $9)
        ON CONFLICT (singleton) DO UPDATE SET host = EXCLUDED.host, port = EXCLUDED.port,
          security = EXCLUDED.security, username = EXCLUDED.username,
          password_ciphertext = EXCLUDED.password_ciphertext, password_iv = EXCLUDED.password_iv,
          password_tag = EXCLUDED.password_tag, from_address = EXCLUDED.from_address,
          updated_at = now(), updated_by = EXCLUDED.updated_by
      `, [next.host, next.port, next.security, next.username, next.passwordCiphertext,
        next.passwordIv, next.passwordTag, next.fromAddress, next.updatedBy]);
    } else mutateFile(data => { data.emailSettings = next; });
    return next;
  };

  const outboxFromRow = row => row ? ({
    id: row.id, type: row.type, targetUsername: clean(row.target_username ?? row.targetUsername),
    recipient: clean(row.recipient), subject: clean(row.subject), metadata: row.metadata || {},
    secretCiphertext: clean(row.secret_ciphertext ?? row.secretCiphertext),
    secretIv: clean(row.secret_iv ?? row.secretIv), secretTag: clean(row.secret_tag ?? row.secretTag),
    status: clean(row.status), attemptCount: Number(row.attempt_count ?? row.attemptCount ?? 0),
    availableAt: iso(row.available_at ?? row.availableAt), leaseExpiresAt: iso(row.lease_expires_at ?? row.leaseExpiresAt),
    lastError: clean(row.last_error ?? row.lastError), createdAt: iso(row.created_at ?? row.createdAt),
    updatedAt: iso(row.updated_at ?? row.updatedAt), sentAt: iso(row.sent_at ?? row.sentAt)
  }) : null;

  const updateMfaNotificationForJob = async (job, changes) => {
    if (job?.type !== 'mfa_setup' || !job.targetUsername) return;
    const jobGeneration = clean(job.metadata?.enrollmentGeneration);
    const hasStatus = Object.prototype.hasOwnProperty.call(changes, 'notificationStatus');
    const hasAttemptedAt = Object.prototype.hasOwnProperty.call(changes, 'notificationAttemptedAt');
    const hasSentAt = Object.prototype.hasOwnProperty.call(changes, 'notificationSentAt');
    const hasError = Object.prototype.hasOwnProperty.call(changes, 'notificationError');
    if (pool) {
      await pool.query(`
        UPDATE auth_mfa_policy p SET
          notification_status = CASE WHEN $3 THEN $4 ELSE p.notification_status END,
          notification_attempted_at = CASE WHEN $5 THEN $6::timestamptz ELSE p.notification_attempted_at END,
          notification_sent_at = CASE WHEN $7 THEN $8::timestamptz ELSE p.notification_sent_at END,
          notification_error = CASE WHEN $9 THEN $10 ELSE p.notification_error END,
          updated_at = now()
        FROM auth_users u
        WHERE p.user_id = u.id AND u.username = $1
          AND ($2 = '' OR p.enrollment_generation = $2)
      `, [
        job.targetUsername,
        jobGeneration,
        hasStatus,
        hasStatus ? normalizeDeliveryStatus(changes.notificationStatus) : 'none',
        hasAttemptedAt,
        hasAttemptedAt ? (iso(changes.notificationAttemptedAt) || null) : null,
        hasSentAt,
        hasSentAt ? (iso(changes.notificationSentAt) || null) : null,
        hasError,
        hasError ? clean(changes.notificationError).slice(0, 240) : ''
      ]);
      return;
    }
    mutateFile(data => {
      const current = policyFromRow(data.policies[job.targetUsername]);
      if (jobGeneration && current.enrollmentGeneration !== jobGeneration) return;
      data.policies[job.targetUsername] = policyFromRow({
        ...current,
        ...(hasStatus ? { notificationStatus: changes.notificationStatus } : {}),
        ...(hasAttemptedAt ? { notificationAttemptedAt: changes.notificationAttemptedAt } : {}),
        ...(hasSentAt ? { notificationSentAt: changes.notificationSentAt } : {}),
        ...(hasError ? { notificationError: clean(changes.notificationError).slice(0, 240) } : {})
      });
    });
  };

  const enqueueEmail = async input => {
    const type = clean(input.type);
    if (!EMAIL_TYPES.has(type)) throw new Error('Unsupported email delivery type');
    const targetUsername = clean(input.targetUsername);
    if (type === 'mfa_setup' && targetUsername) {
      const existing = await findActiveEmail(type, targetUsername);
      if (existing) return { ...existing, deduplicated: true };
    }
    const now = new Date().toISOString();
    const job = outboxFromRow({
      id: crypto.randomUUID(), type, targetUsername, recipient: input.recipient,
      subject: input.subject, metadata: input.metadata || {}, secretCiphertext: input.secretCiphertext,
      secretIv: input.secretIv, secretTag: input.secretTag, status: 'queued', attemptCount: 0,
      availableAt: now, createdAt: now, updatedAt: now
    });
    if (pool) {
      await pool.query(`
        INSERT INTO auth_email_outbox (
          id, type, target_username, recipient, subject, metadata,
          secret_ciphertext, secret_iv, secret_tag, status, available_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'queued',now())
      `, [job.id, job.type, job.targetUsername, job.recipient, job.subject, job.metadata,
        job.secretCiphertext, job.secretIv, job.secretTag]);
    } else mutateFile(data => { data.outbox[job.id] = job; });
    await updateMfaNotificationForJob(job, { notificationStatus: 'queued', notificationError: '' });
    return job;
  };

  async function findActiveEmail(type, targetUsername) {
    if (pool) {
      const { rows } = await pool.query(`
        SELECT * FROM auth_email_outbox WHERE type = $1 AND target_username = $2
          AND status IN ('queued','sending') ORDER BY created_at DESC LIMIT 1
      `, [type, targetUsername]);
      return outboxFromRow(rows[0]);
    }
    return Object.values(readFile().outbox).map(outboxFromRow).find(job => (
      job.type === type && job.targetUsername === targetUsername && ['queued', 'sending'].includes(job.status)
    )) || null;
  }

  const getEmailDelivery = async id => {
    if (pool) {
      const { rows } = await pool.query('SELECT * FROM auth_email_outbox WHERE id = $1', [clean(id)]);
      return outboxFromRow(rows[0]);
    }
    return outboxFromRow(readFile().outbox[clean(id)]);
  };

  const claimNextEmail = async () => {
    await scrubExpiredMfaInvitations();
    const lease = new Date(Date.now() + 60_000).toISOString();
    if (pool) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`UPDATE auth_email_outbox SET status='queued', lease_expires_at=NULL, updated_at=now()
          WHERE status='sending' AND lease_expires_at < now()`);
        const { rows } = await client.query(`
          SELECT * FROM auth_email_outbox WHERE status='queued' AND available_at <= now()
          ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
        `);
        if (!rows[0]) { await client.query('COMMIT'); return null; }
        const { rows: claimed } = await client.query(`
          UPDATE auth_email_outbox SET status='sending', attempt_count=attempt_count+1,
            lease_expires_at=$2, updated_at=now() WHERE id=$1 RETURNING *
        `, [rows[0].id, lease]);
        await client.query('COMMIT');
        const job = outboxFromRow(claimed[0]);
        await updateMfaNotificationForJob(job, { notificationStatus: 'sending', notificationAttemptedAt: new Date().toISOString() });
        return job;
      } catch (error) {
        await client.query('ROLLBACK'); throw error;
      } finally { client.release(); }
    }
    let claimed = null;
    mutateFile(data => {
      const now = Date.now();
      for (const job of Object.values(data.outbox)) {
        if (job.status === 'sending' && Date.parse(job.leaseExpiresAt || '') < now) job.status = 'queued';
      }
      const job = Object.values(data.outbox)
        .filter(item => item.status === 'queued' && Date.parse(item.availableAt) <= now)
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0];
      if (job) {
        job.status = 'sending'; job.attemptCount += 1; job.leaseExpiresAt = lease;
        job.updatedAt = new Date().toISOString(); claimed = outboxFromRow(job);
      }
    });
    await updateMfaNotificationForJob(claimed, { notificationStatus: 'sending', notificationAttemptedAt: new Date().toISOString() });
    return claimed;
  };

  const finishEmail = async (job, { error = '', permanent = false } = {}) => {
    const retryDelays = [60, 300, 900, 3600];
    const succeeded = !error;
    const finalFailure = !succeeded && (permanent || job.attemptCount >= 5);
    const nextStatus = succeeded ? 'sent' : (finalFailure ? 'failed' : 'queued');
    const availableAt = !succeeded && !finalFailure
      ? new Date(Date.now() + retryDelays[job.attemptCount - 1] * 1000).toISOString()
      : new Date().toISOString();
    const scrub = succeeded || finalFailure;
    if (pool) {
      await pool.query(`
        UPDATE auth_email_outbox SET status=$2, available_at=$3, lease_expires_at=NULL,
          last_error=$4, sent_at=CASE WHEN $2='sent' THEN now() ELSE sent_at END,
          secret_ciphertext=CASE WHEN $5 THEN '' ELSE secret_ciphertext END,
          secret_iv=CASE WHEN $5 THEN '' ELSE secret_iv END,
          secret_tag=CASE WHEN $5 THEN '' ELSE secret_tag END, updated_at=now() WHERE id=$1
      `, [job.id, nextStatus, availableAt, clean(error).slice(0, 240), scrub]);
    } else mutateFile(data => {
      const item = data.outbox[job.id]; if (!item) return;
      Object.assign(item, { status: nextStatus, availableAt, leaseExpiresAt: '', lastError: clean(error).slice(0, 240), updatedAt: new Date().toISOString() });
      if (succeeded) item.sentAt = new Date().toISOString();
      if (scrub) Object.assign(item, { secretCiphertext: '', secretIv: '', secretTag: '' });
    });
    await updateMfaNotificationForJob(job, {
      notificationStatus: succeeded ? 'sent' : (finalFailure ? 'failed' : 'queued'),
      notificationSentAt: succeeded ? new Date().toISOString() : '',
      notificationError: succeeded ? '' : clean(error).slice(0, 240)
    });
    return getEmailDelivery(job.id);
  };

  const cancelEmails = async (targetUsername, type = '') => {
    const key = clean(targetUsername);
    if (pool) {
      await pool.query(`UPDATE auth_email_outbox SET status='cancelled', secret_ciphertext='', secret_iv='',
        secret_tag='', lease_expires_at=NULL, updated_at=now() WHERE target_username=$1
        AND status IN ('queued','sending') AND ($2='' OR type=$2)`, [key, clean(type)]);
    } else mutateFile(data => {
      for (const job of Object.values(data.outbox)) if (job.targetUsername === key && ['queued', 'sending'].includes(job.status) && (!type || job.type === type)) {
        Object.assign(job, { status: 'cancelled', secretCiphertext: '', secretIv: '', secretTag: '', leaseExpiresAt: '', updatedAt: new Date().toISOString() });
      }
    });
  };

  const invitationFromRow = (row, policy = null) => {
    if (!row) return null;
    const invitation = {
      id: clean(row.id),
      username: clean(row.username),
      tokenHash: clean(row.token_hash ?? row.tokenHash),
      provider: normalizeProvider(row.provider, 'authenticator'),
      generation: normalizeGeneration(row.generation),
      secretCiphertext: clean(row.secret_ciphertext ?? row.secretCiphertext),
      secretIv: clean(row.secret_iv ?? row.secretIv),
      secretTag: clean(row.secret_tag ?? row.secretTag),
      attemptCount: Number(row.attempt_count ?? row.attemptCount ?? 0),
      expiresAt: iso(row.expires_at ?? row.expiresAt),
      consumedAt: iso(row.consumed_at ?? row.consumedAt),
      cancelledAt: iso(row.cancelled_at ?? row.cancelledAt),
      createdAt: iso(row.created_at ?? row.createdAt),
      updatedAt: iso(row.updated_at ?? row.updatedAt)
    };
    invitation.status = invitationStatus(invitation, policy);
    return invitation;
  };

  const policyForInvitationRow = row => {
    if (!row || !Object.prototype.hasOwnProperty.call(row, 'policy_mode')) return null;
    return policyFromRow({
      mode: row.policy_mode,
      provider: row.policy_provider,
      enrollment_generation: row.policy_generation
    });
  };

  const validateInvitationInput = input => {
    const username = clean(input.username);
    const tokenHash = clean(input.tokenHash).toLowerCase();
    const provider = clean(input.provider).toLowerCase();
    const generation = normalizeGeneration(input.generation);
    const expiresAt = iso(input.expiresAt || new Date(Date.now() + MFA_INVITATION_LIFETIME_MS));
    if (!username) throw new Error('MFA invitation username is required');
    if (!/^[a-f0-9]{64}$/.test(tokenHash)) throw new Error('MFA invitation token hash must be a SHA-256 hex digest');
    if (!MFA_PROVIDERS.has(provider)) throw new Error('Unsupported MFA invitation provider');
    if (!generation || generation.length > 200) throw new Error('MFA invitation generation is required');
    if (!expiresAt || Date.parse(expiresAt) <= Date.now()) throw new Error('MFA invitation expiry must be in the future');
    const encrypted = {
      secretCiphertext: clean(input.secretCiphertext),
      secretIv: clean(input.secretIv),
      secretTag: clean(input.secretTag)
    };
    if (!encrypted.secretCiphertext || !encrypted.secretIv || !encrypted.secretTag) {
      throw new Error('Encrypted MFA invitation secret is required');
    }
    return { username, tokenHash, provider, generation, expiresAt, ...encrypted };
  };

  const scrubExpiredMfaInvitations = async (username = '') => {
    const key = clean(username);
    if (pool) {
      const result = await pool.query(`
        UPDATE auth_mfa_enrollment_invitations i
        SET secret_ciphertext = '', secret_iv = '', secret_tag = '', updated_at = now()
        FROM auth_users u
        WHERE i.user_id = u.id AND i.expires_at <= now()
          AND i.consumed_at IS NULL AND i.cancelled_at IS NULL
          AND (i.secret_ciphertext <> '' OR i.secret_iv <> '' OR i.secret_tag <> '')
          AND ($1 = '' OR u.username = $1)
      `, [key]);
      return result.rowCount;
    }
    const snapshot = readFile();
    const hasExpiredSecret = Object.values(snapshot.mfaInvitations).some(invitation => (
      (!key || invitation.username === key)
      && !invitation.consumedAt
      && !invitation.cancelledAt
      && Date.parse(invitation.expiresAt || '') <= Date.now()
      && Boolean(invitation.secretCiphertext || invitation.secretIv || invitation.secretTag)
    ));
    if (!hasExpiredSecret) return 0;
    let count = 0;
    mutateFile(data => {
      const updatedAt = new Date().toISOString();
      for (const invitation of Object.values(data.mfaInvitations)) {
        if ((key && invitation.username !== key) || invitation.consumedAt || invitation.cancelledAt) continue;
        if (Date.parse(invitation.expiresAt || '') > Date.now()) continue;
        if (!invitation.secretCiphertext && !invitation.secretIv && !invitation.secretTag) continue;
        Object.assign(invitation, { secretCiphertext: '', secretIv: '', secretTag: '', updatedAt });
        count += 1;
      }
    });
    return count;
  };

  const createMfaInvitation = async input => {
    const values = validateInvitationInput(input || {});
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    if (pool) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: policies } = await client.query(`
          SELECT u.id AS user_id, p.mode, p.provider, p.enrollment_generation
          FROM auth_users u
          JOIN auth_mfa_policy p ON p.user_id = u.id
          WHERE u.username = $1
          FOR UPDATE OF u, p
        `, [values.username]);
        const policy = policyFromRow(policies[0]);
        if (!policies[0]) throw new Error('User not found');
        if (policy.mode !== 'authenticator' || policy.provider !== values.provider || policy.enrollmentGeneration !== values.generation) {
          throw new Error('MFA invitation does not match the current policy');
        }
        await client.query(`
          UPDATE auth_mfa_enrollment_invitations
          SET cancelled_at = COALESCE(cancelled_at, now()), secret_ciphertext = '', secret_iv = '', secret_tag = '', updated_at = now()
          WHERE user_id = $1 AND consumed_at IS NULL AND cancelled_at IS NULL
        `, [policies[0].user_id]);
        await client.query(`
          INSERT INTO auth_mfa_enrollment_invitations (
            id, user_id, token_hash, provider, generation, secret_ciphertext, secret_iv, secret_tag, expires_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        `, [id, policies[0].user_id, values.tokenHash, values.provider, values.generation,
          values.secretCiphertext, values.secretIv, values.secretTag, values.expiresAt]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      return getMfaInvitation(values.tokenHash);
    }
    let created = null;
    mutateFile(data => {
      const policy = policyFromRow(data.policies[values.username]);
      if (policy.mode !== 'authenticator' || policy.provider !== values.provider || policy.enrollmentGeneration !== values.generation) {
        throw new Error('MFA invitation does not match the current policy');
      }
      for (const invitation of Object.values(data.mfaInvitations)) {
        if (invitation.username !== values.username || invitation.consumedAt || invitation.cancelledAt) continue;
        Object.assign(invitation, {
          cancelledAt: now,
          secretCiphertext: '',
          secretIv: '',
          secretTag: '',
          updatedAt: now
        });
      }
      const record = {
        id,
        username: values.username,
        tokenHash: values.tokenHash,
        provider: values.provider,
        generation: values.generation,
        secretCiphertext: values.secretCiphertext,
        secretIv: values.secretIv,
        secretTag: values.secretTag,
        attemptCount: 0,
        expiresAt: values.expiresAt,
        consumedAt: '',
        cancelledAt: '',
        createdAt: now,
        updatedAt: now
      };
      data.mfaInvitations[id] = record;
      created = invitationFromRow(record, policy);
    });
    return created;
  };

  const getMfaInvitation = async tokenHash => {
    const hash = clean(tokenHash).toLowerCase();
    if (!hash) return null;
    await scrubExpiredMfaInvitations();
    if (pool) {
      const { rows } = await pool.query(`
        SELECT i.*, u.username, p.mode AS policy_mode, p.provider AS policy_provider,
          p.enrollment_generation AS policy_generation
        FROM auth_mfa_enrollment_invitations i
        JOIN auth_users u ON u.id = i.user_id
        LEFT JOIN auth_mfa_policy p ON p.user_id = i.user_id
        WHERE i.token_hash = $1
        LIMIT 1
      `, [hash]);
      return rows[0] ? invitationFromRow(rows[0], policyForInvitationRow(rows[0])) : null;
    }
    const data = readFile();
    const row = Object.values(data.mfaInvitations).find(item => item.tokenHash === hash);
    return row ? invitationFromRow(row, policyFromRow(data.policies[row.username])) : null;
  };

  const getActiveMfaInvitation = async username => {
    const key = clean(username);
    if (!key) return null;
    await scrubExpiredMfaInvitations(key);
    if (pool) {
      const { rows } = await pool.query(`
        SELECT i.*, u.username, p.mode AS policy_mode, p.provider AS policy_provider,
          p.enrollment_generation AS policy_generation
        FROM auth_mfa_enrollment_invitations i
        JOIN auth_users u ON u.id = i.user_id
        JOIN auth_mfa_policy p ON p.user_id = i.user_id
        WHERE u.username = $1 AND i.consumed_at IS NULL AND i.cancelled_at IS NULL
          AND i.expires_at > now() AND i.attempt_count < $2
          AND p.mode = 'authenticator' AND p.provider = i.provider
          AND p.enrollment_generation = i.generation
        ORDER BY i.created_at DESC
        LIMIT 1
      `, [key, MFA_INVITATION_MAX_ATTEMPTS]);
      return rows[0] ? invitationFromRow(rows[0], policyForInvitationRow(rows[0])) : null;
    }
    const data = readFile();
    const policy = policyFromRow(data.policies[key]);
    return Object.values(data.mfaInvitations)
      .filter(item => item.username === key)
      .map(item => invitationFromRow(item, policy))
      .filter(item => item.status === 'active')
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0] || null;
  };

  const recordMfaInvitationFailure = async tokenHash => {
    const hash = clean(tokenHash).toLowerCase();
    if (!hash) return null;
    if (pool) {
      const update = await pool.query(`
        UPDATE auth_mfa_enrollment_invitations i
        SET attempt_count = i.attempt_count + 1,
          consumed_at = CASE WHEN i.attempt_count + 1 >= $2 THEN now() ELSE i.consumed_at END,
          secret_ciphertext = CASE WHEN i.attempt_count + 1 >= $2 THEN '' ELSE i.secret_ciphertext END,
          secret_iv = CASE WHEN i.attempt_count + 1 >= $2 THEN '' ELSE i.secret_iv END,
          secret_tag = CASE WHEN i.attempt_count + 1 >= $2 THEN '' ELSE i.secret_tag END,
          updated_at = now()
        FROM auth_mfa_policy p
        WHERE i.user_id = p.user_id AND i.token_hash = $1
          AND i.consumed_at IS NULL AND i.cancelled_at IS NULL AND i.expires_at > now()
          AND i.attempt_count < $2 AND p.mode = 'authenticator'
          AND p.provider = i.provider AND p.enrollment_generation = i.generation
      `, [hash, MFA_INVITATION_MAX_ATTEMPTS]);
      return getMfaInvitation(hash);
    }
    let result = null;
    mutateFile(data => {
      const invitation = Object.values(data.mfaInvitations).find(item => item.tokenHash === hash);
      if (!invitation) return;
      const policy = policyFromRow(data.policies[invitation.username]);
      const current = invitationFromRow(invitation, policy);
      if (current.status === 'active') {
        invitation.attemptCount += 1;
        invitation.updatedAt = new Date().toISOString();
        if (invitation.attemptCount >= MFA_INVITATION_MAX_ATTEMPTS) {
          invitation.consumedAt = invitation.updatedAt;
          invitation.secretCiphertext = '';
          invitation.secretIv = '';
          invitation.secretTag = '';
        }
      }
      result = invitationFromRow(invitation, policy);
    });
    return result;
  };

  const consumeMfaInvitation = async tokenHash => {
    const hash = clean(tokenHash).toLowerCase();
    if (!hash) return null;
    if (pool) {
      const update = await pool.query(`
        UPDATE auth_mfa_enrollment_invitations i
        SET consumed_at = now(), secret_ciphertext = '', secret_iv = '', secret_tag = '', updated_at = now()
        FROM auth_mfa_policy p
        WHERE i.user_id = p.user_id AND i.token_hash = $1
          AND i.consumed_at IS NULL AND i.cancelled_at IS NULL AND i.expires_at > now()
          AND i.attempt_count < $2 AND p.mode = 'authenticator'
          AND p.provider = i.provider AND p.enrollment_generation = i.generation
      `, [hash, MFA_INVITATION_MAX_ATTEMPTS]);
      if (!update.rowCount) return null;
      const result = await getMfaInvitation(hash);
      return result;
    }
    let result = null;
    mutateFile(data => {
      const invitation = Object.values(data.mfaInvitations).find(item => item.tokenHash === hash);
      if (!invitation) return;
      const policy = policyFromRow(data.policies[invitation.username]);
      if (invitationFromRow(invitation, policy).status !== 'active') return;
      const consumedAt = new Date().toISOString();
      Object.assign(invitation, {
        consumedAt,
        secretCiphertext: '',
        secretIv: '',
        secretTag: '',
        updatedAt: consumedAt
      });
      result = invitationFromRow(invitation, policy);
    });
    return result;
  };

  const completeMfaInvitation = async ({ tokenHash, lastUsedCounter = null, enabledAt = new Date().toISOString() } = {}) => {
    const hash = clean(tokenHash).toLowerCase();
    const enabledAtIso = iso(enabledAt);
    const counter = lastUsedCounter === null || lastUsedCounter === undefined ? null : Number(lastUsedCounter);
    if (!hash || !enabledAtIso || (counter !== null && !Number.isSafeInteger(counter))) return null;
    if (pool) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(`
          SELECT i.*, u.username, u.status AS user_status, p.mode AS policy_mode, p.provider AS policy_provider,
            p.enrollment_generation AS policy_generation
          FROM auth_mfa_enrollment_invitations i
          JOIN auth_users u ON u.id = i.user_id
          JOIN auth_mfa_policy p ON p.user_id = i.user_id
          WHERE i.token_hash = $1
          FOR UPDATE OF i, p, u
        `, [hash]);
        const invitation = rows[0] ? invitationFromRow(rows[0], policyForInvitationRow(rows[0])) : null;
        if (!invitation || invitation.status !== 'active' || clean(rows[0].user_status).toLowerCase() !== 'active') {
          await client.query('ROLLBACK');
          return null;
        }
        await client.query(`
          INSERT INTO auth_mfa_config (
            user_id, provider, secret_ciphertext, secret_iv, secret_tag,
            enabled_at, last_used_counter, failed_attempts, locked_until
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,0,NULL)
          ON CONFLICT (user_id) DO UPDATE SET
            provider = EXCLUDED.provider,
            secret_ciphertext = EXCLUDED.secret_ciphertext,
            secret_iv = EXCLUDED.secret_iv,
            secret_tag = EXCLUDED.secret_tag,
            enabled_at = EXCLUDED.enabled_at,
            last_used_counter = EXCLUDED.last_used_counter,
            failed_attempts = 0,
            locked_until = NULL,
            updated_at = now()
        `, [rows[0].user_id, invitation.provider, invitation.secretCiphertext,
          invitation.secretIv, invitation.secretTag, enabledAtIso, counter]);
        await client.query('DELETE FROM auth_mfa_recovery_codes WHERE user_id = $1', [rows[0].user_id]);
        await client.query(`
          UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, now())
          WHERE user_id = $1 AND revoked_at IS NULL
        `, [rows[0].user_id]);
        await client.query(`
          UPDATE auth_mfa_enrollment_invitations
          SET consumed_at = now(), secret_ciphertext = '', secret_iv = '', secret_tag = '', updated_at = now()
          WHERE id = $1
        `, [invitation.id]);
        await client.query(`
          UPDATE auth_mfa_policy SET enrollment_generation = '', updated_at = now()
          WHERE user_id = $1 AND enrollment_generation = $2
        `, [rows[0].user_id, invitation.generation]);
        await client.query('COMMIT');
        return getMfaInvitation(hash);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
    let result = null;
    mutateFile(data => {
      const invitation = Object.values(data.mfaInvitations).find(item => item.tokenHash === hash);
      if (!invitation) return;
      const policy = policyFromRow(data.policies[invitation.username]);
      if (invitationFromRow(invitation, policy).status !== 'active' || !isActiveFileUser(invitation.username)) return;
      const mfaData = readFileMfa();
      mfaData[invitation.username] = {
        provider: invitation.provider,
        secretCiphertext: invitation.secretCiphertext,
        secretIv: invitation.secretIv,
        secretTag: invitation.secretTag,
        enabledAt: enabledAtIso,
        lastUsedCounter: counter,
        failedAttempts: 0,
        lockedUntil: '',
        recoveryCodes: []
      };
      writeFileMfa(mfaData);
      const consumedAt = new Date().toISOString();
      Object.assign(invitation, {
        consumedAt,
        secretCiphertext: '',
        secretIv: '',
        secretTag: '',
        updatedAt: consumedAt
      });
      data.policies[invitation.username] = policyFromRow({ ...policy, enrollmentGeneration: '' });
      result = invitationFromRow(invitation, data.policies[invitation.username]);
    });
    return result;
  };

  const invalidateMfaInvitations = async username => {
    const key = clean(username);
    if (!key) return 0;
    if (pool) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(`
          UPDATE auth_mfa_policy p
          SET enrollment_generation = '', updated_at = now()
          FROM auth_users u
          WHERE p.user_id = u.id AND u.username = $1
          RETURNING p.user_id
        `, [key]);
        if (!rows[0]) {
          await client.query('COMMIT');
          return 0;
        }
        const result = await client.query(`
          UPDATE auth_mfa_enrollment_invitations
          SET cancelled_at = now(), secret_ciphertext = '', secret_iv = '', secret_tag = '', updated_at = now()
          WHERE user_id = $1 AND consumed_at IS NULL AND cancelled_at IS NULL
        `, [rows[0].user_id]);
        await client.query('COMMIT');
        return result.rowCount;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
    let count = 0;
    mutateFile(data => {
      const cancelledAt = new Date().toISOString();
      if (data.policies[key]) {
        data.policies[key] = policyFromRow({ ...data.policies[key], enrollmentGeneration: '' });
      }
      for (const invitation of Object.values(data.mfaInvitations)) {
        if (invitation.username !== key || invitation.consumedAt || invitation.cancelledAt) continue;
        Object.assign(invitation, {
          cancelledAt,
          secretCiphertext: '',
          secretIv: '',
          secretTag: '',
          updatedAt: cancelledAt
        });
        count += 1;
      }
    });
    return count;
  };

  const deleteUserData = async username => {
    const key = clean(username);
    await cancelEmails(key);
    if (pool) return;
    mutateFile(data => {
      delete data.identities[key];
      delete data.policies[key];
      delete data.temporaryCredentials[key];
      for (const [id, invitation] of Object.entries(data.mfaInvitations)) {
        if (invitation.username === key) delete data.mfaInvitations[id];
      }
    });
  };

  const close = async () => { if (pool) await pool.end(); };

  return {
    initialize, close, withMfaMutationLock, getIdentity, setIdentity, getMfaPolicy, setMfaPolicy,
    getTemporaryCredential, setTemporaryCredential, clearTemporaryCredential,
    getEmailSettings, saveEmailSettings, enqueueEmail, findActiveEmail, getEmailDelivery,
    claimNextEmail, finishEmail, cancelEmails,
    createMfaInvitation, getMfaInvitation, getActiveMfaInvitation, scrubExpiredMfaInvitations,
    recordMfaInvitationFailure, consumeMfaInvitation, completeMfaInvitation, invalidateMfaInvitations,
    deleteUserData, isDbEnabled: () => Boolean(pool)
  };
}

module.exports = { createAdminSecurityStore };
