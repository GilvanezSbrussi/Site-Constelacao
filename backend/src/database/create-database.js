require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../.env') });

const { Client } = require('pg');

async function createDatabase() {
  if (!process.env.DATABASE_URL) {
    throw new Error('Configure DATABASE_URL no arquivo .env antes de criar o banco.');
  }

  const configuredUrl = new URL(process.env.DATABASE_URL);
  const databaseName = decodeURIComponent(configuredUrl.pathname.slice(1));
  if (!databaseName) {
    throw new Error('DATABASE_URL precisa informar o nome do banco.');
  }

  configuredUrl.pathname = '/postgres';
  const client = new Client({ connectionString: configuredUrl.toString() });
  await client.connect();

  try {
    const result = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);
    if (result.rowCount > 0) {
      console.log(`Banco ${databaseName} ja existe.`);
      return;
    }

    const quotedName = `"${databaseName.replaceAll('"', '""')}"`;
    await client.query(`CREATE DATABASE ${quotedName}`);
    console.log(`Banco ${databaseName} criado.`);
  } finally {
    await client.end();
  }
}

createDatabase().catch((error) => {
  console.error(`Falha ao criar o banco: ${error.message}`);
  process.exitCode = 1;
});