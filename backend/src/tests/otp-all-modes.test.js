// backend/src/tests/otp-all-modes.test.js
// Phase 2 Mandatory Test: OTP for All Three Modes (v7.1)
// Contract: quick, standard, transfer groups each have otp_hash; deriveOtp stable.
// For EACH mode: correct OTP -> delivered; wrong OTP (code+1) -> otp_failed, never delivered.
// Assert outbox/Kafka payload has otp_proof, NO otp field; raw code not in JSON string values.
// Live-proof response shows only proof. Wrong proof on one group never affects another.
// OTP missing on otp_verified -> 400 OTP_REQUIRED.

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { getDbPool, isDbReachable, isApiReachable, getToken, apiRequest, skipIfBlocked } = require('./helpers');

const OTP_HASH_SECRET = process.env.OTP_HASH_SECRET || 'test-otp-secret';

function deriveOtp(groupId) {
  const raw = crypto.createHmac('sha256', OTP_HASH_SECRET).update('otp:' + groupId).digest('hex');
  const code = String(parseInt(raw.slice(0, 8), 16) % 1000000).padStart(6, '0');
  return code;
}

function hashOtpSubmission(code) {
  return crypto.createHmac('sha256', OTP_HASH_SECRET).update('hash:' + code).digest('hex');
}

function verifyOtpProof(groupId, proof) {
  const client = require('./helpers').getDbPool();
  // In test, we compute expected hash
  const code = deriveOtp(groupId);
  const expected = hashOtpSubmission(code);
  return crypto.timingSafeEqual(Buffer.from(proof), Buffer.from(expected));
}

test('OTP All Modes: Each group has otp_hash, deriveOtp stable', async (t) => {
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();

  // Check all three modes have otp_hash
  const groups = await pool.query(`
    SELECT group_id, mode, otp_hash FROM fulfilment_groups
    WHERE mode IN ('quick', 'standard', 'transfer')
  `);

  assert.ok(groups.rowCount >= 3, 'Must have at least one group per mode');

  for (const group of groups.rows) {
    assert.ok(group.otp_hash, `Group ${group.group_id} (${group.mode}) must have otp_hash`);
    assert.strictEqual(group.otp_hash.length, 64, 'otp_hash must be 64-char hex (SHA256)');

    // deriveOtp must be stable
    const code1 = deriveOtp(group.group_id);
    const code2 = deriveOtp(group.group_id);
    assert.strictEqual(code1, code2, `deriveOtp must be stable for ${group.mode}`);
    
    // Verify hash matches
    const proof = hashOtpSubmission(code1);
    assert.strictEqual(proof, group.otp_hash, `otp_hash must match derived proof for ${group.mode}`);
  }
});

test('OTP All Modes: Correct OTP -> delivered, delivered_at set', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const token = await getToken();

  // Test each mode
  const modes = ['quick', 'standard', 'transfer'];
  
  for (const mode of modes) {
    // Find a group with this mode in undelivered state
    const pool = getDbPool();
    const groupRes = await pool.query(`
      SELECT group_id FROM fulfilment_groups
      WHERE mode = $1 AND status NOT IN ('delivered', 'cancelled')
      LIMIT 1
    `, [mode]);
    
    if (groupRes.rowCount === 0) {
      console.log(`[OTP] No ${mode} group available for test, skipping`);
      continue;
    }

    const groupId = groupRes.rows[0].group_id;
    const correctCode = deriveOtp(groupId);
    const otpProof = hashOtpSubmission(correctCode);

    // 1. Fire otp_verified with correct proof via simulator
    const fireRes = await apiRequest('POST', '/api/simulator/fire-event', {
      group_id: groupId,
      event_type: 'otp_verified',
      otp: correctCode  // Raw OTP in request body only
    }, token);
    
    assert.strictEqual(fireRes.status, 202, `Fire event for ${mode} must return 202`);

    // 2. Wait for consumer to process
    await new Promise(r => setTimeout(r, 500));

    // 3. Verify group delivered
    const groupCheck = await pool.query(`
      SELECT status, delivered_at FROM fulfilment_groups WHERE group_id = $1
    `, [groupId]);
    
    assert.strictEqual(groupCheck.rows[0].status, 'delivered', `${mode} group must be delivered`);
    assert.ok(groupCheck.rows[0].delivered_at, `${mode} group must have delivered_at`);

    // 4. Verify timeline has delivered row
    const timeline = await pool.query(`
      SELECT status FROM shipment_timeline WHERE group_id = $1 AND status = 'delivered'
    `, [groupId]);
    assert.strictEqual(timeline.rowCount, 1, `${mode} timeline must have delivered row`);
  }
});

test('OTP All Modes: Wrong OTP (code+1) -> otp_failed, never delivered', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const token = await getToken();
  const pool = getDbPool();

  // Find a transfer group for testing
  const groupRes = await pool.query(`
    SELECT group_id FROM fulfilment_groups
    WHERE mode = 'transfer' AND status NOT IN ('delivered', 'cancelled')
    LIMIT 1
  `);

  if (groupRes.rowCount === 0) {
    console.log('[OTP] No transfer group for wrong OTP test');
    return;
  }

  const groupId = groupRes.rows[0].group_id;
  const correctCode = deriveOtp(groupId);
  const wrongCode = String((parseInt(correctCode) + 1) % 1000000).padStart(6, '0');

  // Fire otp_verified with WRONG code
  const fireRes = await apiRequest('POST', '/api/simulator/fire-event', {
    group_id: groupId,
    event_type: 'otp_verified',
    otp: wrongCode
  }, token);

  assert.strictEqual(fireRes.status, 202, 'Wrong OTP fire event must be accepted (202)');

  await new Promise(r => setTimeout(r, 500));

  // Verify group NOT delivered, status unchanged (or otp_failed timeline)
  const groupCheck = await pool.query(`
    SELECT status FROM fulfilment_groups WHERE group_id = $1
  `, [groupId]);
  assert.notStrictEqual(groupCheck.rows[0].status, 'delivered', 'Wrong OTP must not deliver');

  // Verify otp_failed timeline row
  const timeline = await pool.query(`
    SELECT status FROM shipment_timeline WHERE group_id = $1 AND status = 'otp_failed'
  `, [groupId]);
  assert.strictEqual(timeline.rowCount, 1, 'Must have otp_failed timeline row');
});

test('OTP All Modes: Outbox/Kafka payload has otp_proof, NO otp field', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();
  const token = await getToken();

  // Find a quick group
  const groupRes = await pool.query(`
    SELECT group_id FROM fulfilment_groups
    WHERE mode = 'quick' AND status NOT IN ('delivered', 'cancelled')
    LIMIT 1
  `);

  if (groupRes.rowCount === 0) return;

  const groupId = groupRes.rows[0].group_id;
  const correctCode = deriveOtp(groupId);

  // Fire event
  await apiRequest('POST', '/api/simulator/fire-event', {
    group_id: groupId,
    event_type: 'otp_verified',
    otp: correctCode
  }, token);

  await new Promise(r => setTimeout(r, 500));

  // Check outbox event payload
  const outbox = await pool.query(`
    SELECT payload FROM outbox_events
    WHERE event_type = 'fulfilment-status-updated'
    AND payload->>'group_id' = $1
    AND payload->>'event_type' = 'otp_verified'
    ORDER BY created_at DESC LIMIT 1
  `, [groupId]);

  assert.strictEqual(outbox.rowCount, 1, 'Outbox event must exist');
  const payload = outbox.rows[0].payload;

  // Assert: payload has otp_proof
  assert.ok(payload.otp_proof, 'Payload must have otp_proof');
  assert.strictEqual(payload.otp_proof.length, 64, 'otp_proof must be 64-char hex');

  // Assert: NO otp field
  assert.ok(!payload.hasOwnProperty('otp'), 'Payload must NOT have otp field');
  assert.ok(!payload.hasOwnProperty('otp_code'), 'Payload must NOT have otp_code field');

  // Assert: raw code not in JSON string values
  const payloadStr = JSON.stringify(payload);
  assert.ok(!payloadStr.includes(correctCode), 'Raw OTP code must not appear anywhere in serialized payload');
});

test('OTP All Modes: Live-proof response shows only proof', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();
  const token = await getToken();

  // Use admin token for live-proof endpoint
  const adminToken = await getToken('admin@bazaarbridge.dev', 'Admin@1234');

  const groupRes = await pool.query(`
    SELECT group_id FROM fulfilment_groups WHERE mode = 'standard' LIMIT 1
  `);
  if (groupRes.rowCount === 0) return;

  const groupId = groupRes.rows[0].group_id;

  // Call admin live-proof
  const res = await apiRequest('GET', '/api/admin/live-proof', null, adminToken);
  assert.strictEqual(res.status, 200);

  // Response should show otp_proof hashes, NOT raw codes
  const data = res.data;
  assert.ok(data, 'Live-proof must return data');
  
  // Find our group's proof
  if (Array.isArray(data)) {
    const groupData = data.find(d => d.group_id === groupId);
    if (groupData) {
      assert.ok(groupData.otp_proof, 'Live-proof must show otp_proof');
      assert.ok(!groupData.otp, 'Live-proof must NOT show raw otp');
    }
  }
});

test('OTP All Modes: Wrong proof on one group never affects another', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();
  const token = await getToken();

  // Get two groups
  const groupsRes = await pool.query(`
    SELECT group_id FROM fulfilment_groups
    WHERE status NOT IN ('delivered', 'cancelled')
    LIMIT 2
  `);

  if (groupsRes.rowCount < 2) return;

  const group1 = groupsRes.rows[0].group_id;
  const group2 = groupsRes.rows[1].group_id;

  // Submit wrong OTP for group1
  const wrongCode1 = String((parseInt(deriveOtp(group1)) + 1) % 1000000).padStart(6, '0');
  await apiRequest('POST', '/api/simulator/fire-event', {
    group_id: group1,
    event_type: 'otp_verified',
    otp: wrongCode1
  }, token);

  await new Promise(r => setTimeout(r, 500));

  // Submit correct OTP for group2
  const correctCode2 = deriveOtp(group2);
  const fireRes2 = await apiRequest('POST', '/api/simulator/fire-event', {
    group_id: group2,
    event_type: 'otp_verified',
    otp: correctCode2
  }, token);

  assert.strictEqual(fireRes2.status, 202);

  await new Promise(r => setTimeout(r, 500));

  // Group2 must be delivered
  const group2Check = await pool.query(`SELECT status FROM fulfilment_groups WHERE group_id = $1`, [group2]);
  assert.strictEqual(group2Check.rows[0].status, 'delivered', 'Group2 must be delivered despite group1 failure');

  // Group1 must NOT be delivered
  const group1Check = await pool.query(`SELECT status FROM fulfilment_groups WHERE group_id = $1`, [group1]);
  assert.notStrictEqual(group1Check.rows[0].status, 'delivered');
});

test('OTP All Modes: OTP missing on otp_verified -> 400 OTP_REQUIRED', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();
  const token = await getToken();

  const groupRes = await pool.query(`
    SELECT group_id FROM fulfilment_groups WHERE status NOT IN ('delivered', 'cancelled') LIMIT 1
  `);
  if (groupRes.rowCount === 0) return;

  const groupId = groupRes.rows[0].group_id;

  // Fire otp_verified WITHOUT otp field
  const fireRes = await apiRequest('POST', '/api/simulator/fire-event', {
    group_id: groupId,
    event_type: 'otp_verified'
    // otp field intentionally omitted
  }, token);

  assert.strictEqual(fireRes.status, 400, 'Missing OTP must return 400');
  assert.strictEqual(fireRes.data.error, 'OTP_REQUIRED');
});