const app = require('./app');
const path = require('path');
const dotenv = require('dotenv');
const { startExpiryCleanup } = require('./api/expiry');
const { checkConnection } = require('./db');

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const PORT = process.env.PORT || 11597 || 5000;

app.listen(PORT, async () => {
  console.log(`BazaarBridge Express API Server running on port ${PORT}`);
  
  try {
    const dbStatus = await checkConnection();
    if (dbStatus.ok) {
      console.log(`[DB] Successfully connected to PostgreSQL (database: ${dbStatus.db})`);
    } else {
      console.warn(`[DB] Warning: PostgreSQL not reachable: ${dbStatus.error}`);
      console.warn(`[DB] Please ensure PG_URI or PG_URL is set in your .env file.`);
    }
  } catch (e) {
    console.warn(`[DB] Warning: Connection check failed:`, e.message);
  }

  startExpiryCleanup();
});
