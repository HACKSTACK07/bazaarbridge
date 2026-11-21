// backend/src/tests/helpers.js
// Shared test helpers and environment verifiers for BazaarBridge integration tests
// Owned and maintained by Agent D (Seed/QA)

const http = require('http');
const https = require('https');
const url = require('url');

const API_BASE = process.env.API_BASE || 'http://localhost:11597';
const PG_URI = process.env.PG_URI;

let pg = null;
try {
  pg = require('pg');
} catch (e1) {
  try {
    // Check if installed in scratch directory
    pg = require('../../../../.gemini/antigravity/scratch/node_modules/pg');
  } catch (e2) {}
}

let pool = null;
function getDbPool() {
  if (!PG_URI) return null;
  if (!pg) return null;
  if (!pool) {
    pool = new pg.Pool({ connectionString: PG_URI });
  }
  return pool;
}

/**
 * Perform HTTP request helper
 */
function apiRequest(method, endpoint, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(endpoint, API_BASE);
    const isHttps = parsedUrl.protocol === 'https:';
    const lib = isHttps ? https : http;

    const headers = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const payload = body ? JSON.stringify(body) : null;
    if (payload) {
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = lib.request(parsedUrl, {
      method,
      headers,
      timeout: 5000
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = data ? JSON.parse(data) : {};
        } catch {
          parsed = { raw: data };
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: parsed
        });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

/**
 * Obtains JWT token via POST /api/auth/login
 */
async function getToken(email = 'demo@bazaarbridge.dev', password = 'Demo@1234') {
  try {
    const res = await apiRequest('POST', '/api/auth/login', { email, password });
    if (res.status === 200 && res.data && res.data.token) {
      return res.data.token;
    }
    throw new Error(`Login failed with status ${res.status}: ${JSON.stringify(res.data)}`);
  } catch (err) {
    throw new Error(`Failed to obtain token for ${email}: ${err.message}`);
  }
}

/**
 * Checks if the Express API server is reachable
 */
async function isApiReachable() {
  try {
    const res = await apiRequest('GET', '/api/search/filters');
    return res.status === 200;
  } catch {
    return false;
  }
}

/**
 * Checks if PostgreSQL database is reachable
 */
async function isDbReachable() {
  const p = getDbPool();
  if (!p) return false;
  try {
    const client = await p.connect();
    const res = await client.query('SELECT 1 as connected');
    client.release();
    return res.rows[0].connected === 1;
  } catch {
    return false;
  }
}

/**
 * Standard gate referee assertion for blocked prerequisites
 */
function skipIfBlocked(condition, serviceName, t) {
  if (!condition) {
    console.log(`[BLOCKED] Service "${serviceName}" is unavailable in this environment.`);
    console.log('          Per agent-rules.md: "Never report BLOCKED as PASS."');
    if (t && typeof t.skip === 'function') {
      t.skip(`BLOCKED: ${serviceName} is not available.`);
    }
    return true;
  }
  return false;
}

/**
 * Pause a consumer by name
 */
async function pauseConsumer(name) {
  const pool = getDbPool();
  if (!pool) return false;
  try {
    await pool.query(`UPDATE consumer_control SET paused = true WHERE consumer_name = $1`, [name]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resume a consumer by name
 */
async function resumeConsumer(name) {
  const pool = getDbPool();
  if (!pool) return false;
  try {
    await pool.query(`UPDATE consumer_control SET paused = false WHERE consumer_name = $1`, [name]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reset offer inventory to specific quantity
 */
async function resetOffer(offerId, qty) {
  const pool = getDbPool();
  if (!pool) return false;
  try {
    await pool.query(`UPDATE inventory SET quantity = $1, reserved_quantity = 0 WHERE offer_id = $2`, [qty, offerId]);
    await pool.query(`UPDATE offer_state_versions SET revision = revision + 1 WHERE offer_id = $1`, [offerId]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Set transfer status
 */
async function setTransferStatus(orderItemId, status) {
  const pool = getDbPool();
  if (!pool) return false;
  try {
    await pool.query(`UPDATE stock_transfers SET status = $1 WHERE order_item_id = $2`, [status, orderItemId]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete inventory row
 */
async function deleteInventoryRow(offerId, locationId) {
  const pool = getDbPool();
  if (!pool) return false;
  try {
    await pool.query(`DELETE FROM inventory WHERE offer_id = $1 AND location_id = $2`, [offerId, locationId]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read OTP hash for a fulfilment group
 */
async function readOtp(groupId) {
  const pool = getDbPool();
  if (!pool) return null;
  try {
    const res = await pool.query(`SELECT otp_hash FROM fulfilment_groups WHERE group_id = $1`, [groupId]);
    return res.rows[0]?.otp_hash || null;
  } catch {
    return null;
  }
}

module.exports = {
  API_BASE,
  PG_URI,
  getDbPool,
  apiRequest,
  getToken,
  isApiReachable,
  isDbReachable,
  skipIfBlocked,
  pauseConsumer,
  resumeConsumer,
  resetOffer,
  setTransferStatus,
  deleteInventoryRow,
  readOtp
};
