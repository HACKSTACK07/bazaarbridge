/**
 * Standalone Event Pipeline & Consumer Runner (Agent C)
 *
 * Runs:
 * 1. Outbox publisher (relaying outbox_events to Kafka)
 * 2. Consumer "inventory-finalizer" (order-placed, Pattern A)
 * 3. Consumer "search-sync" (inventory-updated / offer-price-updated, Pattern B)
 *
 * Resilient Operation:
 * - When PostgreSQL, Kafka, and OpenSearch are deployed: connects to live cloud services.
 * - When services are NOT deployed: gracefully boots in local simulated mode so
 *   development and testing can continue without blockers.
 */

const {
  TOPIC_CORE_EVENTS,
  KafkaClient,
  startOutboxPublisher,
  processOrderPlaced,
  processSearchSync
} = require('./index');

const { ensureIndex, OpenSearchClient } = require('../search/index');

let pgPool = null;
try {
  const { Pool } = require('pg');
  if (process.env.PG_URI) {
    pgPool = new Pool({
      connectionString: process.env.PG_URI,
      ssl: process.env.PG_URI.includes('sslmode=require') || process.env.PG_URI.includes('sslmode=verify-ca')
        ? { rejectUnauthorized: false }
        : false,
      max: 10
    });
  }
} catch (e) {
  // pg or PG_URI not yet available
}

async function startEventPipeline(options = {}) {
  const db = options.db || pgPool;
  const kafka = options.kafkaClient || new KafkaClient();
  const search = options.searchClient || new OpenSearchClient();

  console.log('[Agent C] Starting event pipeline...');
  console.log(`[Agent C] Kafka mode: ${kafka.mockMode ? 'LOCAL SIMULATED' : 'LIVE AIVEN CLUSTER'}`);
  console.log(`[Agent C] OpenSearch mode: ${search.mockMode ? 'LOCAL SIMULATED' : 'LIVE AIVEN CLUSTER'}`);
  console.log(`[Agent C] Database mode: ${db ? 'CONNECTED' : 'STANDALONE / WAITING FOR DEPLOY'}`);

  // 1. Ensure OpenSearch index exists
  try {
    const idxRes = await ensureIndex(search);
    console.log(`[Agent C] OpenSearch offers index: ${idxRes.message}`);
  } catch (err) {
    console.warn(`[Agent C] ensureIndex notice: ${err.message}`);
  }

  // 2. Register Consumer: inventory-finalizer (order-placed)
  await kafka.subscribe(TOPIC_CORE_EVENTS, 'inventory-finalizer-group', async ({ topic, partition, message }) => {
    try {
      const payload = JSON.parse(message.value.toString());
      const eventType = message.headers?.eventType || payload?.event_type;

      if (eventType === 'order-placed' && db) {
        const eventId = message.headers?.eventId || payload?.event_id;
        const key = message.key?.toString();
        await processOrderPlaced({ eventId, payload, aggregateKey: key }, db);
      }
    } catch (err) {
      console.error('[inventory-finalizer] Error processing order-placed:', err.message);
    }
  });

  // 3. Register Consumer: search-sync (inventory-updated, offer-price-updated)
  await kafka.subscribe(TOPIC_CORE_EVENTS, 'search-sync-group', async ({ topic, partition, message }) => {
    try {
      const payload = JSON.parse(message.value.toString());
      const eventType = message.headers?.eventType || payload?.event_type;

      if ((eventType === 'inventory-updated' || eventType === 'offer-price-updated') && db) {
        const eventId = message.headers?.eventId || payload?.event_id;
        const key = message.key?.toString();
        await processSearchSync({ eventId, payload, aggregateKey: key }, db, search);
      }
    } catch (err) {
      console.error('[search-sync] Error processing search-sync event:', err.message);
    }
  });

  // 4. Start Outbox Publisher if DB is available
  let outboxController = null;
  if (db) {
    outboxController = startOutboxPublisher(db, kafka, { pollIntervalMs: 1000 });
    console.log('[Agent C] Outbox publisher started (polling every 1000ms).');
  } else {
    console.log('[Agent C] Outbox publisher idle (PostgreSQL not connected).');
  }

  return {
    kafka,
    search,
    db,
    stop: () => {
      if (outboxController) outboxController.stop();
      console.log('[Agent C] Event pipeline stopped.');
    }
  };
}

if (require.main === module) {
  startEventPipeline().catch(err => {
    console.error('[Agent C Startup Error]:', err);
  });
}

module.exports = {
  startEventPipeline
};
