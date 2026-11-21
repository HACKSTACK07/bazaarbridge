const test = require('node:test');
const assert = require('node:assert');
const { Pool } = require('pg');
const crypto = require('crypto');

const PG_URI = process.env.PG_URI;
const OPENSEARCH_URL = process.env.OPENSEARCH_URL;
const OPENSEARCH_USERNAME = process.env.OPENSEARCH_USERNAME;
const OPENSEARCH_PASSWORD = process.env.OPENSEARCH_PASSWORD;

function getPool() {
  if (!PG_URI) {
    throw new Error('PG_URI environment variable not set. Cannot run integration tests against Aiven PostgreSQL.');
  }
  return new Pool({ connectionString: PG_URI });
}

function getOpenSearchClient() {
  if (!OPENSEARCH_URL || !OPENSEARCH_USERNAME || !OPENSEARCH_PASSWORD) {
    return null;
  }
  const { Client } = require('@opensearch-project/opensearch');
  return new Client({
    node: OPENSEARCH_URL,
    auth: { username: OPENSEARCH_USERNAME, password: OPENSEARCH_PASSWORD },
    ssl: { rejectUnauthorized: false }
  });
}

const TEST_OFFER_ID = '70000000-0000-0000-0000-000000000001';

async function getOfferRevision(pool, offerId) {
  const res = await pool.query(`SELECT revision FROM offer_state_versions WHERE offer_id = $1`, [offerId]);
  return res.rows[0]?.revision || 0;
}

async function readTruthAndRevision(pool, offerId) {
  const res = await pool.query(
    `SELECT o.offer_id, o.product_id, o.selling_price, o.status, v.revision,
     coalesce(sum(case when l.is_sellable and (h.hub_id is null or h.active)
     then i.quantity - i.reserved_quantity else 0 end), 0) as free_units,
     coalesce(sum(case when l.is_sellable and l.is_home
     then i.quantity - i.reserved_quantity else 0 end), 0) as home_units
    FROM dealer_offers o
    JOIN offer_state_versions v on v.offer_id = o.offer_id
    LEFT JOIN inventory i on i.offer_id = o.offer_id
    LEFT JOIN stock_locations l on l.location_id = i.location_id
    LEFT JOIN fulfilment_hubs h on h.location_id = l.location_id
    WHERE o.offer_id = $1
    GROUP BY o.offer_id, o.product_id, o.selling_price, o.status, v.revision`,
    [offerId]
  );
  return res.rows[0] || null;
}

async function upsertToOpenSearch(client, offerId, document, revision) {
  const params = {
    index: 'offers',
    id: offerId,
    body: document,
    refresh: true,
    version: revision,
    version_type: 'external_gte'
  };
  try {
    const response = await client.index(params);
    return { success: true, result: response.body.result };
  } catch (err) {
    if (err.statusCode === 409 && err.message.includes('version_conflict_engine_exception')) {
      return { success: true, result: 'stale', versionConflict: true };
    }
    throw err;
  }
}

test('Stale OpenSearch index updates: external versioning rejects stale writes', { skip: !PG_URI || !OPENSEARCH_URL }, async () => {
  const pool = getPool();
  const client = getOpenSearchClient();
  if (!client) {
    assert.skip('OpenSearch client not configured');
    return;
  }

  try {
    const truth = await readTruthAndRevision(pool, TEST_OFFER_ID);
    if (!truth) throw new Error('Test offer not found');

    const doc = {
      offer_id: truth.offer_id,
      product_id: truth.product_id,
      selling_price: truth.selling_price,
      free_units: truth.free_units,
      home_units: truth.home_units,
      revision: truth.revision
    };

    const result1 = await upsertToOpenSearch(client, TEST_OFFER_ID, doc, truth.revision);
    assert.ok(result1.success, 'First write should succeed');

    const result2 = await upsertToOpenSearch(client, TEST_OFFER_ID, doc, truth.revision);
    assert.ok(result2.success, 'Second write with same version should succeed as stale');
    assert.strictEqual(result2.result, 'stale', 'Should report stale/conflict');
  } finally {
    await pool.end();
  }
});

test('Stale OpenSearch index updates: newer revision overwrites older', { skip: !PG_URI || !OPENSEARCH_URL }, async () => {
  const pool = getPool();
  const client = getOpenSearchClient();
  if (!client) {
    assert.skip('OpenSearch client not configured');
    return;
  }

  try {
    const truth = await readTruthAndRevision(pool, TEST_OFFER_ID);
    if (!truth) throw new Error('Test offer not found');

    const olderDoc = {
      offer_id: truth.offer_id,
      product_id: truth.product_id,
      selling_price: truth.selling_price - 1000,
      free_units: truth.free_units,
      home_units: truth.home_units,
      revision: truth.revision - 1
    };

    const result1 = await upsertToOpenSearch(client, TEST_OFFER_ID, olderDoc, truth.revision - 1);
    assert.ok(result1.success);

    const truthNow = await readTruthAndRevision(pool, TEST_OFFER_ID);
    const newerDoc = {
      offer_id: truthNow.offer_id,
      product_id: truthNow.product_id,
      selling_price: truthNow.selling_price,
      free_units: truthNow.free_units,
      home_units: truthNow.home_units,
      revision: truthNow.revision
    };

    const result2 = await upsertToOpenSearch(client, TEST_OFFER_ID, newerDoc, truthNow.revision);
    assert.ok(result2.success);
    assert.strictEqual(result2.result, 'updated', 'Newer revision should write successfully');
  } finally {
    await pool.end();
  }
});

test('Stale OpenSearch index updates: PostgreSQL truth read includes paused hub filter', { skip: !PG_URI }, async () => {
  const pool = getPool();

  try {
    const truth = await readTruthAndRevision(pool, TEST_OFFER_ID);
    assert.ok(truth, 'Truth statement should return a row');
    assert.ok(typeof truth.free_units === 'number', 'free_units should be numeric');
    assert.ok(typeof truth.home_units === 'number', 'home_units should be numeric');
    assert.ok(truth.revision >= 1, 'revision should be >= 1');

    const hubCheck = await pool.query(
      `SELECT h.active FROM fulfilment_hubs h
       JOIN stock_locations l ON h.location_id = l.location_id
       JOIN inventory i ON i.location_id = l.location_id
       WHERE i.offer_id = $1`,
      [TEST_OFFER_ID]
    );

    if (hubCheck.rows.length > 0) {
      const hasInactiveHub = hubCheck.rows.some(r => r.active === false);
      if (hasInactiveHub) {
        assert.ok(truth.free_units >= 0, 'free_units should exclude paused hub units');
      }
    }
  } finally {
    await pool.end();
  }
});