require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../.env') });

const fs = require('node:fs/promises');
const path = require('node:path');
const pool = require('./pool');

async function migrate() {
  if (!process.env.DATABASE_URL) {
    throw new Error('Configure DATABASE_URL no arquivo .env antes de executar as migrations.');
  }

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const directory = path.resolve(__dirname, '../../migrations');
    const files = (await fs.readdir(directory)).filter((name) => name.endsWith('.sql')).sort();

    for (const name of files) {
      const applied = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
      if (applied.rowCount > 0) continue;

      const sql = await fs.readFile(path.join(directory, name), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
        await client.query('COMMIT');
        console.log(`Migration aplicada: ${name}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((error) => {
  console.error(`Falha nas migrations: ${error.message}`);
  process.exitCode = 1;
});
