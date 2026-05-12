const { Pool } = require('pg');

const TABLES = {
    users: 'defectdojo_viewer_users',
    config: 'defectdojo_viewer_config',
    configBackups: 'defectdojo_viewer_config_backups',
    redmineSync: 'defectdojo_viewer_redmine_sync',
    findings: 'defectdojo_viewer_findings'
};

const configured = Boolean(process.env.DATABASE_URL || process.env.PGHOST || process.env.PGDATABASE);
let pool = null;

const buildPoolConfig = () => {
    const config = {};
    if (process.env.DATABASE_URL) config.connectionString = process.env.DATABASE_URL;

    const sslMode = String(process.env.PGSSLMODE || '').toLowerCase();
    if (sslMode && sslMode !== 'disable') {
        config.ssl = sslMode === 'no-verify'
            ? { rejectUnauthorized: false }
            : true;
    }

    return Object.keys(config).length > 0 ? config : undefined;
};

const parseJsonValue = (value, fallback) => {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch {
            return fallback;
        }
    }
    return value;
};

const normalizeArray = (value) => (
    Array.isArray(value) ? value : []
);

const isEnabled = () => Boolean(pool);

const init = async () => {
    if (!configured) return false;

    pool = new Pool(buildPoolConfig());
    await pool.query('SELECT 1');

    await pool.query(`
        CREATE TABLE IF NOT EXISTS ${TABLES.users} (
            username text PRIMARY KEY CHECK (length(trim(username)) > 0),
            salt text NOT NULL,
            password_hash text NOT NULL,
            role text NOT NULL CHECK (length(trim(role)) > 0),
            products jsonb NOT NULL DEFAULT '[]'::jsonb,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS ${TABLES.config} (
            key text PRIMARY KEY,
            value jsonb NOT NULL,
            updated_at timestamptz NOT NULL DEFAULT now()
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS ${TABLES.configBackups} (
            id bigserial PRIMARY KEY,
            file_name text UNIQUE NOT NULL,
            label text NOT NULL,
            config jsonb NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS ${TABLES.redmineSync} (
            sync_key text PRIMARY KEY,
            record jsonb NOT NULL,
            finding_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
            issue_id text,
            status text,
            updated_at timestamptz NOT NULL DEFAULT now()
        )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS ${TABLES.redmineSync}_issue_id_idx ON ${TABLES.redmineSync} (issue_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ${TABLES.redmineSync}_finding_ids_idx ON ${TABLES.redmineSync} USING gin (finding_ids)`);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS ${TABLES.findings} (
            finding_key text PRIMARY KEY,
            finding_id text,
            product_name text,
            defectdojo_project_name text,
            sort_index integer NOT NULL DEFAULT 0,
            data jsonb NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS ${TABLES.findings}_product_name_idx ON ${TABLES.findings} (product_name)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ${TABLES.findings}_project_name_idx ON ${TABLES.findings} (defectdojo_project_name)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ${TABLES.findings}_data_idx ON ${TABLES.findings} USING gin (data jsonb_path_ops)`);

    return true;
};

const close = async () => {
    if (!pool) return;
    await pool.end();
    pool = null;
};

const withTransaction = async (callback) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const loadUsers = async () => {
    const { rows } = await pool.query(`
        SELECT username, salt, password_hash, role, products
        FROM ${TABLES.users}
        ORDER BY username
    `);

    return rows.map(row => ({
        username: row.username,
        salt: row.salt,
        hash: row.password_hash,
        role: row.role,
        products: normalizeArray(parseJsonValue(row.products, []))
    }));
};

const saveUsers = async (users = []) => {
    const normalizedUsers = users.filter(user => user?.username);
    await withTransaction(async (client) => {
        await client.query(
            `DELETE FROM ${TABLES.users} WHERE NOT (username = ANY($1::text[]))`,
            [normalizedUsers.map(user => user.username)]
        );

        for (const user of normalizedUsers) {
            await client.query(`
                INSERT INTO ${TABLES.users} (username, salt, password_hash, role, products)
                VALUES ($1, $2, $3, $4, $5::jsonb)
                ON CONFLICT (username)
                DO UPDATE SET
                    salt = EXCLUDED.salt,
                    password_hash = EXCLUDED.password_hash,
                    role = EXCLUDED.role,
                    products = EXCLUDED.products,
                    updated_at = now()
            `, [
                user.username,
                user.salt,
                user.hash,
                user.role,
                JSON.stringify(normalizeArray(user.products))
            ]);
        }
    });
};

const loadConfig = async () => {
    const { rows } = await pool.query(
        `SELECT value FROM ${TABLES.config} WHERE key = $1`,
        ['default']
    );
    return parseJsonValue(rows[0]?.value, null);
};

const saveConfig = async (config) => {
    await pool.query(`
        INSERT INTO ${TABLES.config} (key, value)
        VALUES ($1, $2::jsonb)
        ON CONFLICT (key)
        DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `, ['default', JSON.stringify(config)]);
};

const writeConfigBackup = async ({ fileName, label, config }) => {
    const { rows } = await pool.query(`
        INSERT INTO ${TABLES.configBackups} (file_name, label, config)
        VALUES ($1, $2, $3::jsonb)
        RETURNING file_name, octet_length(config::text) AS size, created_at
    `, [fileName, label, JSON.stringify(config)]);

    return {
        fileName: rows[0].file_name,
        size: Number(rows[0].size || 0),
        createdAt: rows[0].created_at.toISOString(),
        storage: 'postgresql'
    };
};

const importConfigBackup = async ({ fileName, label, config, createdAt }) => {
    const { rows } = await pool.query(`
        INSERT INTO ${TABLES.configBackups} (file_name, label, config, created_at)
        VALUES ($1, $2, $3::jsonb, COALESCE($4::timestamptz, now()))
        ON CONFLICT (file_name) DO NOTHING
        RETURNING file_name, octet_length(config::text) AS size, created_at
    `, [fileName, label, JSON.stringify(config), createdAt || null]);

    if (rows.length === 0) return null;

    return {
        fileName: rows[0].file_name,
        size: Number(rows[0].size || 0),
        createdAt: rows[0].created_at.toISOString(),
        storage: 'postgresql'
    };
};

const listConfigBackups = async () => {
    const { rows } = await pool.query(`
        SELECT file_name, octet_length(config::text) AS size, created_at
        FROM ${TABLES.configBackups}
        ORDER BY created_at DESC
    `);

    return rows.map(row => ({
        fileName: row.file_name,
        size: Number(row.size || 0),
        createdAt: row.created_at.toISOString()
    }));
};

const getConfigBackup = async (fileName) => {
    const { rows } = await pool.query(
        `SELECT config FROM ${TABLES.configBackups} WHERE file_name = $1`,
        [fileName]
    );
    return parseJsonValue(rows[0]?.config, null);
};

const loadRedmineSyncRecords = async () => {
    const { rows } = await pool.query(`
        SELECT sync_key, record
        FROM ${TABLES.redmineSync}
        ORDER BY updated_at ASC
    `);

    return rows.map(row => {
        const record = parseJsonValue(row.record, {});
        return {
            ...record,
            syncKey: record.syncKey || row.sync_key
        };
    });
};

const saveRedmineSyncRecords = async (records = []) => {
    const normalizedRecords = records.filter(record => record?.syncKey);
    await withTransaction(async (client) => {
        await client.query(
            `DELETE FROM ${TABLES.redmineSync} WHERE NOT (sync_key = ANY($1::text[]))`,
            [normalizedRecords.map(record => record.syncKey)]
        );

        for (const record of normalizedRecords) {
            await client.query(`
                INSERT INTO ${TABLES.redmineSync} (sync_key, record, finding_ids, issue_id, status)
                VALUES ($1, $2::jsonb, $3::text[], $4, $5)
                ON CONFLICT (sync_key)
                DO UPDATE SET
                    record = EXCLUDED.record,
                    finding_ids = EXCLUDED.finding_ids,
                    issue_id = EXCLUDED.issue_id,
                    status = EXCLUDED.status,
                    updated_at = now()
            `, [
                record.syncKey,
                JSON.stringify(record),
                normalizeArray(record.findingIds).map(String),
                record.issueId === undefined || record.issueId === null ? null : String(record.issueId),
                record.status || null
            ]);
        }
    });
};

const normalizeProductFilters = (products = []) => (
    normalizeArray(products)
        .map(product => String(product || '').trim())
        .filter(Boolean)
);

const loadFindings = async ({ allowedProducts, requireAllowedProducts = false } = {}) => {
    const productFilters = normalizeProductFilters(allowedProducts);
    if (requireAllowedProducts && productFilters.length === 0) return [];

    const whereClause = productFilters.length > 0
        ? `WHERE COALESCE(defectdojo_project_name, product_name, data->>'defectDojoProjectName', data->>'product_name') = ANY($1::text[])`
        : '';
    const params = productFilters.length > 0 ? [productFilters] : [];

    const { rows } = await pool.query(`
        SELECT data
        FROM ${TABLES.findings}
        ${whereClause}
        ORDER BY sort_index ASC, finding_key ASC
    `, params);

    return rows.map(row => parseJsonValue(row.data, {}));
};

const replaceFindings = async (findings = []) => {
    await withTransaction(async (client) => {
        await client.query(`TRUNCATE ${TABLES.findings}`);

        for (const finding of findings) {
            await client.query(`
                INSERT INTO ${TABLES.findings} (
                    finding_key,
                    finding_id,
                    product_name,
                    defectdojo_project_name,
                    sort_index,
                    data
                )
                VALUES ($1, $2, $3, $4, $5, $6::jsonb)
            `, [
                finding.findingKey,
                finding.findingId,
                finding.productName,
                finding.defectDojoProjectName,
                finding.sortIndex,
                JSON.stringify(finding.data)
            ]);
        }
    });
};

const clearFindings = async () => {
    await pool.query(`TRUNCATE ${TABLES.findings}`);
};

const countFindings = async () => {
    const { rows } = await pool.query(`SELECT count(*)::int AS count FROM ${TABLES.findings}`);
    return rows[0]?.count || 0;
};

module.exports = {
    isConfigured: () => configured,
    isEnabled,
    init,
    close,
    loadUsers,
    saveUsers,
    loadConfig,
    saveConfig,
    writeConfigBackup,
    importConfigBackup,
    listConfigBackups,
    getConfigBackup,
    loadRedmineSyncRecords,
    saveRedmineSyncRecords,
    loadFindings,
    replaceFindings,
    clearFindings,
    countFindings
};
