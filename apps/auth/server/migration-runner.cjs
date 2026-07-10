const fs = require('fs');
const path = require('path');

const runMigrations = async ({
  pool,
  migrationsDir = path.join(__dirname, 'migrations'),
  migrationsTable = 'auth_schema_migrations'
}) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${migrationsTable} (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const files = fs.readdirSync(migrationsDir)
    .filter(file => file.toLowerCase().endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

  for (const file of files) {
    const migrationId = file.replace(/\.sql$/i, '');
    const applied = await pool.query(
      `SELECT id FROM ${migrationsTable} WHERE id = $1`,
      [migrationId]
    );
    if (applied.rows.length > 0) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
      await client.query(
        `INSERT INTO ${migrationsTable} (id) VALUES ($1)`,
        [migrationId]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
};

module.exports = { runMigrations };
