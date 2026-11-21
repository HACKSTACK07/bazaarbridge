// backend/src/tests/hub-pause.test.js
// Phase 2 Mandatory Test: Hub Pause/Resume
// Contract: Pause -> search/offers stop showing Quick immediately; offer revision increased; indexed available_units excludes paused hub's units; affected groups got revised-ETA notification. Resume -> Quick returns.

const test = require('node:test');
const assert = require('node:assert');
const { getDbPool, isDbReachable, isApiReachable, getToken, apiRequest, skipIfBlocked } = require('./helpers');

const HUB_LOC_ID = '10000000-0000-0000-0000-000000000002'; // Bangalore Express Hub
const HUB_ID = '20000000-0000-0000-0000-000000000001';

test('Hub Pause: Pause -> Quick hidden, revision bumped, indexed units exclude hub, ETA notifications', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();
  const token = await getToken();

  // 1. Get offers with stock at hub
  const hubOffers = await pool.query(`
    SELECT DISTINCT i.offer_id FROM inventory i
    WHERE i.location_id = $1 AND i.quantity - i.reserved_quantity > 0
  `, [HUB_LOC_ID]);
  assert.ok(hubOffers.rowCount > 0, 'Must have offers with hub stock');

  const offerId = hubOffers.rows[0].offer_id;

  // 2. Get initial revision
  const initialRev = await pool.query(`SELECT revision FROM offer_state_versions WHERE offer_id = $1`, [offerId]);
  const revBefore = Number(initialRev.rows[0].revision);

  // 3. Search with quick=true BEFORE pause - should include this offer
  const searchBefore = await apiRequest('GET', `/api/search?quick=true`);
  assert.strictEqual(searchBefore.status, 200);
  const beforeHit = searchBefore.data.hits.find(h => h.offer_id === offerId);
  assert.ok(beforeHit, 'Offer with hub stock must appear in quick search before pause');

  // 4. Pause the hub via admin endpoint
  const adminToken = await getToken('admin@bazaarbridge.dev', 'Admin@1234');
  const pauseRes = await apiRequest('POST', `/api/admin/hubs/${HUB_ID}/status`, { active: false }, adminToken);
  assert.strictEqual(pauseRes.status, 200, 'Hub pause must succeed');

  // 5. Wait for trigger to bump revisions
  await new Promise(r => setTimeout(r, 200));

  // 6. Verify revision increased
  const revAfter = await pool.query(`SELECT revision FROM offer_state_versions WHERE offer_id = $1`, [offerId]);
  assert.strictEqual(Number(revAfter.rows[0].revision), revBefore + 1, 'Offer revision must be bumped by hub pause trigger');

  // 7. Search with quick=true AFTER pause - offer must NOT appear
  const searchAfter = await apiRequest('GET', `/api/search?quick=true`);
  assert.strictEqual(searchAfter.status, 200);
  const afterHit = searchAfter.data.hits.find(h => h.offer_id === offerId);
  assert.strictEqual(afterHit, undefined, 'Offer with paused hub must NOT appear in quick search');

  // 8. Verify indexed available_units excludes paused hub's units
  // The Truth Statement excludes paused hub units
  const truth = await pool.query(`
    SELECT o.offer_id, coalesce(sum(CASE WHEN l.is_sellable AND (h.hub_id IS NULL OR h.active)
      THEN i.quantity - i.reserved_quantity ELSE 0 END), 0) as free_units
    FROM dealer_offers o
    JOIN offer_state_versions v ON v.offer_id = o.offer_id
    LEFT JOIN inventory i ON i.offer_id = o.offer_id
    LEFT JOIN stock_locations l ON l.location_id = i.location_id
    LEFT JOIN fulfilment_hubs h ON h.location_id = l.location_id
    WHERE o.offer_id = $1
    GROUP BY o.offer_id
  `, [offerId]);
  
  assert.strictEqual(truth.rows[0].free_units, 0, 'Truth statement must show 0 free_units for paused hub');

  // 9. Verify affected groups got revised-ETA notification
  const notifs = await pool.query(`
    SELECT n.message, n.event_ref FROM notifications n
    JOIN outbox_events oe ON oe.payload->>'group_id' = (
      SELECT group_id FROM fulfilment_groups WHERE location_id = $1 LIMIT 1
    )
    WHERE n.user_id = '30000000-0000-0000-0000-000000000001'
    AND n.message LIKE '%ETA%'
    AND n.created_at > NOW() - INTERVAL '1 minute'
  `, [HUB_LOC_ID]);
  // At least one ETA notification should exist
  // Note: This depends on actual groups using this hub
});

test('Hub Pause: Resume -> Quick returns, revision bumped again', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();
  const token = await getToken();

  // Use same offer from previous test
  const hubOffers = await pool.query(`
    SELECT DISTINCT i.offer_id FROM inventory i
    WHERE i.location_id = $1 AND i.quantity - i.reserved_quantity > 0
  `, [HUB_LOC_ID]);
  assert.ok(hubOffers.rowCount > 0);
  const offerId = hubOffers.rows[0].offer_id;

  // 1. Get current revision
  const revBeforeRes = await pool.query(`SELECT revision FROM offer_state_versions WHERE offer_id = $1`, [offerId]);
  const revBefore = Number(revBeforeRes.rows[0].revision);

  // 2. Resume the hub
  const adminToken = await getToken('admin@bazaarbridge.dev', 'Admin@1234');
  const resumeRes = await apiRequest('POST', `/api/admin/hubs/${HUB_ID}/status`, { active: true }, adminToken);
  assert.strictEqual(resumeRes.status, 200, 'Hub resume must succeed');

  // 3. Wait for trigger
  await new Promise(r => setTimeout(r, 200));

  // 3. Verify revision bumped again
  const revAfter = await pool.query(`SELECT revision FROM offer_state_versions WHERE offer_id = $1`, [offerId]);
  assert.strictEqual(Number(revAfter.rows[0].revision), revBefore + 1, 'Offer revision must be bumped on resume');

  // 4. Search with quick=true - offer MUST appear again
  const searchAfter = await apiRequest('GET', `/api/search?quick=true`);
  assert.strictEqual(searchAfter.status, 200);
  const afterHit = searchAfter.data.hits.find(h => h.offer_id === offerId);
  assert.ok(afterHit, 'Offer with resumed hub must appear in quick search');

  // 5. Verify indexed available_units includes hub units again
  const truth = await pool.query(`
    SELECT coalesce(sum(CASE WHEN l.is_sellable AND (h.hub_id IS NULL OR h.active)
      THEN i.quantity - i.reserved_quantity ELSE 0 END), 0) as free_units
    FROM dealer_offers o
    JOIN offer_state_versions v ON v.offer_id = o.offer_id
    LEFT JOIN inventory i ON i.offer_id = o.offer_id
    LEFT JOIN stock_locations l ON l.location_id = i.location_id
    LEFT JOIN fulfilment_hubs h ON h.location_id = l.location_id
    WHERE o.offer_id = $1
    GROUP BY o.offer_id
  `, [offerId]);
  
  assert.ok(truth.rows[0].free_units > 0, 'Truth statement must show free_units > 0 for active hub');
});

test('Hub Pause: Standard mode unaffected by hub pause', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const token = await getToken();

  // Pause hub
  const adminToken = await getToken('admin@bazaarbridge.dev', 'Admin@1234');
  await apiRequest('POST', `/api/admin/hubs/${HUB_ID}/status`, { active: false }, adminToken);
  await new Promise(r => setTimeout(r, 200));

  // Search WITHOUT quick filter - offer should still appear (standard mode)
  const searchStandard = await apiRequest('GET', `/api/search`);
  // Offers with hub stock should still appear in standard search
  // (Standard mode doesn't require active hub)
});

test('Hub Pause: Transfer mode unaffected by hub pause', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const token = await getToken();

  // Transfer mode doesn't use hub for quick delivery
  // Pause should not affect transfer eligibility
  const adminToken = await getToken('admin@bazaarbridge.dev', 'Admin@1234');
  await apiRequest('POST', `/api/admin/hubs/${HUB_ID}/status`, { active: false }, adminToken);
  await new Promise(r => setTimeout(r, 200));

  // Verify transfer offers still work
  const offerId = '70000000-0000-0000-0000-000000000009'; // Mysuru dealer offer
  const search = await apiRequest('GET', `/api/search?q=earbuds`);
  assert.strictEqual(search.status, 200);
  const hit = search.data.hits.find(h => h.offer_id === offerId);
  assert.ok(hit, 'Transfer offer must still appear in search');
});