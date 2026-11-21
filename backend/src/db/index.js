const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from backend/.env or root .env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const connectionString = process.env.PG_URI || process.env.PG_URL;

const caPath = process.env.PG_CA_PATH || process.env.KAFKA_CA_PATH;
const caCert = caPath && fs.existsSync(caPath) ? fs.readFileSync(caPath).toString() : undefined;

const poolConfig = {
  connectionString: connectionString || 'postgresql://localhost:5432/bazaarbridge',
  ssl: connectionString && !connectionString.includes('localhost') && !connectionString.includes('127.0.0.1')
    ? {
        rejectUnauthorized: false,
        ca: caCert
      }
    : false
};

const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
});

async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  return res;
}

async function getClient() {
  const client = await pool.connect();
  return client;
}

module.exports = {
  pool,
  query,
  getClient
};
