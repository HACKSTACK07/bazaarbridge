const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { Pool } = require('pg');

const PG_URI = process.env.PG_URI;

function getPool() {
  if (!PG_URI) {
    throw new Error('PG_URI environment variable not set. Cannot run integration tests against Aiven PostgreSQL.');
  }
  return new Pool({ connectionString: PG_URI });
}

const TEST_OFFER_ID = '70000000-0000-0000-0000-000000000001';
const TEST_USER_ID = '30000000-0000-0000-0000-000000000001';

async function insertProcessedEvent(pool, eventId, consumerName) {
  const res = await pool.query(
    `INSERT INTO processed_events (event_id, consumer_name) VALUES ($1, $2)
     ON CONFLICT DO NOTHING RETURNING event_id`,
    [eventId, consumerName]
  );
  return res.rowCount === 1;
}

async function simulateInventoryUpdatedConsumer(pool, eventId, offerId, consumerName) {
  const isNew = await insertProcessedEvent(pool, eventId, consumerName);
  if (!isNew) return { processed: false, reason: 'duplicate' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO outbox_events (event_type, aggregate_key, payload)
       VALUES ('inventory-updated', $1, $2)`,
      [offerId, JSON.stringify({ offer_id: offerId, trigger: 'test' })]
    );
    await client.query('COMMIT');
    return { processed: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

test('Duplicate event processing: same event_id processed twice by same consumer is idempotent', { skip: !PG_URI }, async () => {
  const pool = getPool();
  const eventId = crypto.randomUUID();
  const consumerName = 'test-inventory-consumer';

  try {
    const result1 = await simulateInventoryUpdatedConsumer(pool, eventId, TEST_OFFER_ID, consumerName);
    assert.strictEqual(result1.processed, true, 'First processing should succeed');

    const result2 = await simulateInventoryUpdatedConsumer(pool, eventId, TEST_OFFER_ID, consumerName);
    assert.strictEqual(result2.processed, false, 'Second processing should be skipped');
    assert.strictEqual(result2.reason, 'duplicate', 'Should report duplicate');

    const count = await pool.query(`SELECT COUNT(*) FROM processed_events WHERE event_id = $1 AND consumer_name = $2`, [eventId, consumerName]);
    assert.strictEqual(parseInt(count.rows[0].count), 1, 'Exactly one processed_events row should exist');
  } finally {
    await pool.end();
  }
});

test('Duplicate event processing: same event_id by DIFFERENT consumers both process', { skip: !PG_URI }, async () => {
  const pool = getPool();
  const eventId = crypto.randomUUID();

  try {
    const result1 = await simulateInventoryUpdatedConsumer(pool, eventId, TEST_OFFER_ID, 'consumer-a');
    const result2 = await simulateInventoryUpdatedConsumer(pool, eventId, TEST_OFFER_ID, 'consumer-b');

    assert.strictEqual(result1.processed, true);
    assert.strictEqual(result2.processed, true);

    const count = await pool.query(`SELECT COUNT(*) FROM processed_events WHERE event_id = $1`, [eventId]);
    assert.strictEqual(parseInt(count.rows[0].count), 2, 'Two processed_events rows should exist (one per consumer)');
  } finally {
    await pool.end();
  }
});

test('Duplicate event processing: concurrent duplicate detection race', { skip: !PG_URI }, async () => {
  const pool = getPool();
  const eventId = crypto.randomUUID();
  const consumerName = 'race-consumer';

  try {
    const promises = Array.from({ length: 10 }, () => simulateInventoryUpdatedConsumer(pool, eventId, TEST_OFFER_ID, consumerName));
    const results = await Promise.all(promises);

    const processedCount = results.filter(r => r.processed).length;
    assert.strictEqual(processedCount, 1, 'Exactly one should process, rest should detect duplicate');

    const count = await pool.query(`SELECT COUNT(*) FROM processed_events WHERE event_id = $1 AND consumer_name = $2`, [eventId, consumerName]);
    assert.strictEqual(parseInt(count.rows[0].count), 1);
  } finally {
    await pool.end();
  }
});