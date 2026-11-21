const fs = require('fs');
const path = require('path');
const { pool } = require('./index');

async function applySchema(reset = false) {
  const schemaPath = path.resolve(__dirname, '../../../schema.sql');
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`schema.sql not found at ${schemaPath}`);
  }

  const sql = fs.readFileSync(schemaPath, 'utf8');
  const client = await pool.connect();
  try {
    console.log('Connecting to PostgreSQL...');
    await client.query('BEGIN');

    if (reset || process.env.RESET_DB === 'true') {
      console.log('RESETTING database cleanly (DROP SCHEMA public CASCADE)...');
      await client.query('DROP SCHEMA public CASCADE;');
      await client.query('CREATE SCHEMA public;');
      await client.query('GRANT ALL ON SCHEMA public TO public;');
    }

    console.log('Applying authoritative schema.sql...');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('Authoritative schema.sql applied cleanly and successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '42P07') {
      console.error('\n[Migration Notice]: Database tables already exist.');
      console.error('To cleanly reset and re-apply schema.sql from scratch, run:');
      console.error('  npm run migrate:reset   OR   node src/db/migrate.js --reset\n');
    } else {
      console.error('Failed to apply schema:', err);
    }
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  const shouldReset = process.argv.includes('--reset') || process.env.RESET_DB === 'true';
  applySchema(shouldReset)
    .then(() => {
      console.log('Migration finished.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err.message);
      process.exit(1);
    });
}

module.exports = { applySchema };
