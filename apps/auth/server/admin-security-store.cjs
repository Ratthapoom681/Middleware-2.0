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
const normalizeDeliveryStatus = value => {
  const status = clean(value).toLowerCase();
  return ['queued', 'sending', 'sent', 'failed'].includes(status) ? status : 'none';
};
const initialFileData = () => ({ version: 1, identities: {}, policies: {}, temporaryCredentials: {}, emailSettings: {}, outbox: {} });

const poolConfig = () => {
  const connectionString = process.env.AUTH_DATABASE_URL || process.env.DATABASE_URL || '';
  const config = connectionString ? { connectionString } : {};
  const sslMode = clean(process.env.PGSSLMODE).toLowerCase();
  if (sslMode && sslMode !== 'disable') config.ssl = sslMode === 'no-verify' ? { rejectUnauthorized: false } : true;
  return Object.keys(config).length ? config : undefined;
};

function createAdminSecurityStore({ dataDir }) {
  const filePath = path.join(dataDir, 'admin-security.json');
  const dbConfigured = Boolean(process.env.AUTH_DATABASE_URL || process.env.DATABASE_URL || process.env.PGHOST || process.env.PGDATABASE);
  let pool = null;

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

  const initialize = async () => {
    if (dbConfigured) {
      pool = new Pool(poolConfig());
      await pool.query('SELECT 1');
      return;
    }
    if (!fs.existsSync(filePath)) writeFile(initialFileData());
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
    requestedAt: iso(row.requested_at ?? row.requestedAt),
    requestedBy: clean(row.requested_by ?? row.requestedBy),
    notificationStatus: normalizeDeliveryStatus(row.notification_status ?? row.notificationStatus),
    notificationAttemptedAt: iso(row.notification_attempted_at ?? row.notificationAttemptedAt),
    notificationSentAt: iso(row.notification_sent_at ?? row.notificationSentAt),
    notificationError: clean(row.notification_error ?? row.notificationError)
  }) : ({ mode: 'disabled', requestedAt: '', requestedBy: '', notificationStatus: 'none', notificationAttemptedAt: '', notificationSentAt: '', notificationError: '' });

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
          user_id, mode, requested_at, requested_by, notification_status,
          notification_attempted_at, notification_sent_at, notification_error
        )
        SELECT id, $2, $3, $4, $5, $6, $7, $8 FROM auth_users WHERE username = $1
        ON CONFLICT (user_id) DO UPDATE SET
          mode = EXCLUDED.mode, requested_at = EXCLUDED.requested_at,
          requested_by = EXCLUDED.requested_by, notification_status = EXCLUDED.notification_status,
          notification_attempted_at = EXCLUDED.notification_attempted_at,
          notification_sent_at = EXCLUDED.notification_sent_at,
          notification_error = EXCLUDED.notification_error, updated_at = now()
      `, [key, next.mode, next.requestedAt || null, next.requestedBy, next.notificationStatus,
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

  const enqueueEmail = async input => {
    const type = clean(input.type);
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
    if (type === 'mfa_setup') await setMfaPolicy(targetUsername, { notificationStatus: 'queued', notificationError: '' });
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
        if (job.type === 'mfa_setup') await setMfaPolicy(job.targetUsername, { notificationStatus: 'sending', notificationAttemptedAt: new Date().toISOString() });
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
    if (claimed?.type === 'mfa_setup') await setMfaPolicy(claimed.targetUsername, { notificationStatus: 'sending', notificationAttemptedAt: new Date().toISOString() });
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
    if (job.type === 'mfa_setup') await setMfaPolicy(job.targetUsername, {
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

  const deleteUserData = async username => {
    const key = clean(username);
    await cancelEmails(key);
    if (pool) return;
    mutateFile(data => {
      delete data.identities[key];
      delete data.policies[key];
      delete data.temporaryCredentials[key];
    });
  };

  const close = async () => { if (pool) await pool.end(); };

  return {
    initialize, close, getIdentity, setIdentity, getMfaPolicy, setMfaPolicy,
    getTemporaryCredential, setTemporaryCredential, clearTemporaryCredential,
    getEmailSettings, saveEmailSettings, enqueueEmail, getEmailDelivery,
    claimNextEmail, finishEmail, cancelEmails, deleteUserData, isDbEnabled: () => Boolean(pool)
  };
}

module.exports = { createAdminSecurityStore };
