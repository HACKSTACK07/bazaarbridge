/**
 * BazaarBridge Outbox Publisher (Authoritative Contract v7.2)
 *
 * Rules:
 * - Polls outbox_events WHERE published_at IS NULL ORDER BY created_at ASC.
 * - Publishes to the destination Kafka topic determined by event_type.
 * - Uses aggregate_key AS THE KAFKA MESSAGE KEY (guarantees per-aggregate ordering).
 * - NEVER publish without a key (enforce aggregate_key present).
 * - After publishing, marks published_at = now().
 * - Survives restarts (idempotent, uncommitted rows remain published_at IS NULL).
 * - 2 partitions per topic design.
 */

const { getTopicForEvent } = require('./topics');

/**
 * Polls and publishes one batch of pending outbox events.
 *
 * @param {object} db - Database client or pool with query() method
 * @param {object} kafkaClient - Kafka client instance with publish() method
 * @param {number} [batchSize=50] - Number of events to fetch per poll
 * @returns {Promise<{ publishedCount: number, eventIds: string[] }>}
 */
async function publishPendingEvents(db, kafkaClient, batchSize = 50) {
  if (!db || !kafkaClient) {
    throw new Error('Both db and kafkaClient are required for publishPendingEvents');
  }

  // 1. Fetch unpublished outbox rows in monotonic created_at order
  const fetchQuery = `
    SELECT event_id, event_type, aggregate_key, payload, created_at
    FROM outbox_events
    WHERE published_at IS NULL
    ORDER BY created_at ASC
    LIMIT $1;
  `;

  const res = await db.query(fetchQuery, [batchSize]);
  const rows = res.rows || [];

  if (rows.length === 0) {
    return { publishedCount: 0, eventIds: [] };
  }

  const publishedEventIds = [];

  for (const row of rows) {
    const { event_id, event_type, aggregate_key } = row;

    // Enforce contract rule: Never publish without a key
    if (!aggregate_key || !String(aggregate_key).trim()) {
      throw new Error(`CRITICAL INTEGRITY ERROR: Outbox event [${event_id}] has no aggregate_key. Never publish without a key.`);
    }

    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : (row.payload || {});

    // Enforce OTP security: raw code must NEVER travel in outbox or Kafka
    if (payload.otp !== undefined) {
      throw new Error(`SECURITY VIOLATION: Raw OTP found in outbox event [${event_id}].`);
    }

    // Resolve destination topic per authoritative catalog
    const topic = getTopicForEvent(event_type);

    // Publish to Kafka: aggregate_key MUST be the Kafka message key
    await kafkaClient.publish(event_type, payload, {
      eventId: String(event_id),
      aggregateKey: String(aggregate_key),
      createdAt: String(row.created_at || Date.now())
    });

    // Mark event as published in PostgreSQL
    const markQuery = `
      UPDATE outbox_events
      SET published_at = now()
      WHERE event_id = $1 AND published_at IS NULL;
    `;
    await db.query(markQuery, [event_id]);

    publishedEventIds.push(event_id);
  }

  return {
    publishedCount: publishedEventIds.length,
    eventIds: publishedEventIds
  };
}

/**
 * Creates and starts a continuous background outbox publisher loop.
 *
 * @param {object} db - Database pool
 * @param {object} kafkaClient - Kafka client
 * @param {object} [options]
 * @param {number} [options.pollIntervalMs=1000] - Polling interval in ms
 * @param {number} [options.batchSize=50] - Batch size
 * @returns {object} Controller with stop() method
 */
function startOutboxPublisher(db, kafkaClient, options = {}) {
  const pollIntervalMs = options.pollIntervalMs || 1000;
  const batchSize = options.batchSize || 50;

  let isRunning = true;
  let timer = null;

  async function pollLoop() {
    if (!isRunning) return;
    try {
      await publishPendingEvents(db, kafkaClient, batchSize);
    } catch (err) {
      console.error('[OutboxPublisher Error]:', err.message);
    } finally {
      if (isRunning) {
        timer = setTimeout(pollLoop, pollIntervalMs);
      }
    }
  }

  timer = setTimeout(pollLoop, 100);

  return {
    stop: () => {
      isRunning = false;
      if (timer) clearTimeout(timer);
    }
  };
}

module.exports = {
  publishPendingEvents,
  startOutboxPublisher
};
