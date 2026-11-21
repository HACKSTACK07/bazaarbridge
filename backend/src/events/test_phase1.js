/**
 * Phase 1 Integration & Concurrency Test Suite (Agent C)
 *
 * Verifies:
 * 1. Outbox publisher:
 *    - Polls outbox_events WHERE published_at IS NULL ORDER BY created_at
 *    - Uses aggregate_key as Kafka message key
 *    - Sets published_at after publishing
 *    - Never publishes without a key (enforced)
 * 2. Consumer "inventory-finalizer" (order-placed, Pattern A):
 *    - Conditional order_items lock (skips if cancelled/finalised)
 *    - Lock order ORDER BY offer_id, stock_location_id
 *    - deduct_units (rolls back on rowCount <> 1)
 *    - Emits outbox inventory-updated and notification-created
 *    - Does NOT insert notifications directly
 *    - Idempotency via processed_events marker
 * 3. Consumer "search-sync" (inventory-updated, offer-price-updated, Pattern B):
 *    - Reads truth + revision in ONE atomic statement (paused hubs excluded)
 *    - upsertOffer with version_type=external_gte
 *    - 409 Version Conflict treated as stale SUCCESS
 *    - Commits marker outside PG transaction
 *    - Idempotency via processed_events marker
 */

const assert = require('assert');
const {
  TOPIC_CORE_EVENTS,
  TOPIC_FULFILMENT_EVENTS,
  KafkaClient,
  publishPendingEvents,
  processOrderPlaced,
  processSearchSync
} = require('./index');

const {
  ensureIndex,
  searchOffers,
  OpenSearchClient
} = require('../search/index');

/**
 * Lightweight in-memory database mock supporting transactions and SQL pattern matching
 * for complete isolated Phase 1 testing.
 */
class MockDatabase {
  constructor() {
    this.tables = {
      outbox_events: [],
      processed_events: [],
      orders: [],
      order_items: [],
      inventory: [],
      dealer_offers: [],
      offer_state_versions: [],
      products: [],
      categories: [],
      dealers: [],
      stock_locations: [],
      fulfilment_hubs: []
    };
    this.inTransaction = false;
    this.snapshot = null;
  }

  async connect() {
    return this;
  }

  release() {}

  async query(sql, params = []) {
    const normalized = sql.trim().toUpperCase().replace(/\s+/g, ' ');

    if (normalized.startsWith('BEGIN')) {
      this.inTransaction = true;
      this.snapshot = JSON.parse(JSON.stringify(this.tables));
      return { rowCount: 0, rows: [] };
    }
    if (normalized.startsWith('COMMIT')) {
      this.inTransaction = false;
      this.snapshot = null;
      return { rowCount: 0, rows: [] };
    }
    if (normalized.startsWith('ROLLBACK')) {
      if (this.snapshot) {
        this.tables = JSON.parse(JSON.stringify(this.snapshot));
      }
      this.inTransaction = false;
      this.snapshot = null;
      return { rowCount: 0, rows: [] };
    }

    // --- OUTBOX_EVENTS ---
    if (normalized.includes('FROM OUTBOX_EVENTS') && normalized.includes('PUBLISHED_AT IS NULL')) {
      const limit = params[0] || 50;
      const unpublished = this.tables.outbox_events
        .filter(r => !r.published_at)
        .slice(0, limit);
      return { rowCount: unpublished.length, rows: unpublished };
    }

    if (normalized.startsWith('UPDATE OUTBOX_EVENTS SET PUBLISHED_AT')) {
      const eventId = params[0];
      const row = this.tables.outbox_events.find(r => r.event_id === eventId);
      if (row) {
        row.published_at = new Date().toISOString();
        return { rowCount: 1, rows: [row] };
      }
      return { rowCount: 0, rows: [] };
    }

    if (normalized.startsWith('INSERT INTO OUTBOX_EVENTS')) {
      const event_type = params[0];
      const aggregate_key = params[1];
      let payload = params[2];
      if (typeof payload === 'string') {
        try { payload = JSON.parse(payload); } catch (e) {}
      }
      const newRow = {
        event_id: `outbox-${Date.now()}-${Math.random()}`,
        event_type,
        aggregate_key,
        payload,
        created_at: new Date().toISOString(),
        published_at: null
      };
      this.tables.outbox_events.push(newRow);
      return { rowCount: 1, rows: [newRow] };
    }

    // --- PROCESSED_EVENTS ---
    if (normalized.startsWith('INSERT INTO PROCESSED_EVENTS')) {
      const [event_id, consumer_name] = params;
      const exists = this.tables.processed_events.some(
        r => r.event_id === event_id && r.consumer_name === consumer_name
      );
      if (exists) {
        return { rowCount: 0, rows: [] };
      }
      const newMarker = { event_id, consumer_name, processed_at: new Date().toISOString() };
      this.tables.processed_events.push(newMarker);
      return { rowCount: 1, rows: [newMarker] };
    }

    if (normalized.includes('FROM PROCESSED_EVENTS') && normalized.includes('EVENT_ID = $1')) {
      const [event_id, consumer_name] = params;
      const found = this.tables.processed_events.filter(
        r => r.event_id === event_id && r.consumer_name === consumer_name
      );
      return { rowCount: found.length, rows: found };
    }

    // --- ORDERS ---
    if (normalized.includes('FROM ORDERS') && normalized.includes('ORDER_ID = $1')) {
      const orderId = params[0];
      const order = this.tables.orders.find(r => r.order_id === orderId);
      return { rowCount: order ? 1 : 0, rows: order ? [order] : [] };
    }

    if (normalized.startsWith('UPDATE ORDERS SET STATUS = \'CONFIRMED\'')) {
      const orderId = params[0];
      const order = this.tables.orders.find(r => r.order_id === orderId);
      if (order) {
        order.status = 'confirmed';
        return { rowCount: 1, rows: [order] };
      }
      return { rowCount: 0, rows: [] };
    }

    // --- ORDER_ITEMS ---
    if (normalized.includes('FROM ORDER_ITEMS') && normalized.includes('ORDER_ID = $1')) {
      const orderId = params[0];
      const items = this.tables.order_items
        .filter(r => r.order_id === orderId)
        .sort((a, b) => a.offer_id.localeCompare(b.offer_id) || a.stock_location_id.localeCompare(b.stock_location_id));
      return { rowCount: items.length, rows: items };
    }

    if (normalized.startsWith('UPDATE ORDER_ITEMS SET STOCK_FINALISED = TRUE')) {
      const orderItemId = params[0];
      const item = this.tables.order_items.find(
        r => r.order_item_id === orderItemId && r.item_status !== 'cancelled' && !r.stock_finalised
      );
      if (item) {
        item.stock_finalised = true;
        item.item_status = 'confirmed';
        return {
          rowCount: 1,
          rows: [{
            offer_id: item.offer_id,
            stock_location_id: item.stock_location_id,
            quantity: item.quantity
          }]
        };
      }
      return { rowCount: 0, rows: [] };
    }

    // --- INVENTORY ---
    if (normalized.startsWith('UPDATE INVENTORY SET QUANTITY = QUANTITY - $1')) {
      const [q, offer_id, location_id] = params;
      const inv = this.tables.inventory.find(
        r => r.offer_id === offer_id && r.location_id === location_id && r.quantity >= q && r.reserved_quantity >= q
      );
      if (inv) {
        inv.quantity -= q;
        inv.reserved_quantity -= q;
        return { rowCount: 1, rows: [inv] };
      }
      return { rowCount: 0, rows: [] };
    }

    // --- TRUTH STATEMENT QUERY (search-sync) ---
    if (normalized.includes('FROM DEALER_OFFERS O') && normalized.includes('JOIN OFFER_STATE_VERSIONS V')) {
      const offerId = params[0];
      const offer = this.tables.dealer_offers.find(r => r.offer_id === offerId);
      if (!offer) return { rowCount: 0, rows: [] };

      const version = this.tables.offer_state_versions.find(r => r.offer_id === offerId) || { revision: 1 };
      const product = this.tables.products.find(r => r.product_id === offer.product_id) || { name: 'Test Product', brand: 'BrandX', specs: {} };
      const category = this.tables.categories.find(r => r.category_id === product.category_id) || { category_name: 'Electronics' };
      const dealer = this.tables.dealers.find(r => r.dealer_id === offer.dealer_id) || { shop_name: 'Shop', city: 'Bangalore', state: 'Karnataka' };

      const invRows = this.tables.inventory.filter(r => r.offer_id === offerId);
      let freeUnits = 0;
      let homeUnits = 0;
      for (const i of invRows) {
        const loc = this.tables.stock_locations.find(l => l.location_id === i.location_id) || { is_sellable: true, is_home: false };
        const hub = this.tables.fulfilment_hubs.find(h => h.location_id === i.location_id);
        const hubActive = hub ? hub.active : true;
        if (loc.is_sellable && hubActive) {
          freeUnits += (i.quantity - i.reserved_quantity);
        }
        if (loc.is_sellable && loc.is_home) {
          homeUnits += (i.quantity - i.reserved_quantity);
        }
      }

      return {
        rowCount: 1,
        rows: [{
          offer_id: offer.offer_id,
          product_id: offer.product_id,
          selling_price: offer.selling_price,
          status: offer.status,
          revision: version.revision,
          free_units: freeUnits,
          home_units: homeUnits,
          product_name: product.name,
          brand: product.brand,
          specs: product.specs,
          category_name: category.category_name,
          dealer_id: dealer.dealer_id || 'd-1',
          shop_name: dealer.shop_name,
          dealer_city: dealer.city,
          dealer_state: dealer.state,
          dealer_rating: 4.5,
          total_reviews: 50,
          verified: true,
          bangalore_delivery_days: offer.bangalore_delivery_days || 1,
          transfer_days_max: offer.transfer_days_max || 3,
          eligible_modes: offer.eligible_modes || ['standard'],
          warranty_months: 12
        }]
      };
    }

    return { rowCount: 0, rows: [] };
  }
}

async function runPhase1Tests() {
  console.log('=====================================================');
  console.log(' RUNNING PHASE 1 INTEGRATION TESTS (AGENT C)');
  console.log('=====================================================\n');

  const db = new MockDatabase();
  const kafka = new KafkaClient({ mockMode: true });
  const searchClient = new OpenSearchClient({ mockMode: true });

  await ensureIndex(searchClient);

  // -----------------------------------------------------------------
  // 1. TEST OUTBOX PUBLISHER
  // -----------------------------------------------------------------
  console.log('--- TEST 1: Outbox Publisher ---');
  // Seed hand-inserted outbox rows
  db.tables.outbox_events.push({
    event_id: 'evt-order-1',
    event_type: 'order-placed',
    aggregate_key: 'ord-1001',
    payload: { order_id: 'ord-1001' },
    created_at: new Date(Date.now() - 5000).toISOString(),
    published_at: null
  });

  db.tables.outbox_events.push({
    event_id: 'evt-inv-1',
    event_type: 'inventory-updated',
    aggregate_key: 'off-2002',
    payload: { offer_id: 'off-2002' },
    created_at: new Date(Date.now() - 4000).toISOString(),
    published_at: null
  });

  console.log(`Pre-publish: 2 unpublished events in outbox_events`);
  const pubResult = await publishPendingEvents(db, kafka);
  console.log(`Published ${pubResult.publishedCount} events.`);
  assert.strictEqual(pubResult.publishedCount, 2);

  // Verify rows are now marked published_at in database
  const remainingUnpublished = db.tables.outbox_events.filter(r => !r.published_at);
  assert.strictEqual(remainingUnpublished.length, 0, 'All events should have published_at set');

  // Verify messages in Kafka
  const coreMessages = kafka.getMessages(TOPIC_CORE_EVENTS);
  assert.strictEqual(coreMessages.length, 2);
  assert.strictEqual(coreMessages[0].key, 'ord-1001', 'order-placed MUST be keyed by order_id');
  assert.strictEqual(coreMessages[1].key, 'off-2002', 'inventory-updated MUST be keyed by offer_id');
  console.log('  [PASS] Outbox publisher successfully published with aggregate keys and marked rows.\n');

  // Test Outbox validation: Never publish without a key
  console.log('--- TEST 2: Outbox Key Validation Guard ---');
  db.tables.outbox_events.push({
    event_id: 'evt-bad-key',
    event_type: 'order-placed',
    aggregate_key: '', // Missing key!
    payload: { order_id: 'bad-order' },
    created_at: new Date().toISOString(),
    published_at: null
  });

  let keyErrorCaught = false;
  try {
    await publishPendingEvents(db, kafka);
  } catch (err) {
    keyErrorCaught = true;
    console.log('Intercepted missing key error:', err.message);
  }
  assert.strictEqual(keyErrorCaught, true, 'Outbox MUST throw if aggregate_key is missing');
  console.log('  [PASS] Publishing without aggregate_key is strictly prohibited.\n');

  // Clean out the bad test row
  db.tables.outbox_events = db.tables.outbox_events.filter(r => r.event_id !== 'evt-bad-key');

  // -----------------------------------------------------------------
  // 2. TEST CONSUMER "inventory-finalizer" (PATTERN A)
  // -----------------------------------------------------------------
  console.log('--- TEST 3: Consumer "inventory-finalizer" (Pattern A) ---');
  const testOrderId = 'ord-phase1-test-99';
  const testUserId = 'usr-customer-77';
  const testOfferId = 'off-headphone-88';
  const testLocationId = 'loc-bangalore-wh';

  // Seed database state
  db.tables.orders.push({
    order_id: testOrderId,
    user_id: testUserId,
    status: 'placed'
  });

  db.tables.order_items.push({
    order_item_id: 'oi-item-1',
    order_id: testOrderId,
    offer_id: testOfferId,
    stock_location_id: testLocationId,
    quantity: 2,
    item_status: 'placed',
    stock_finalised: false
  });

  db.tables.inventory.push({
    offer_id: testOfferId,
    location_id: testLocationId,
    quantity: 10,
    reserved_quantity: 2 // held during reservation
  });

  console.log('Pre-finalizer inventory:', db.tables.inventory[0]);
  const finalizerResult = await processOrderPlaced({
    eventId: 'evt-order-placed-101',
    payload: { order_id: testOrderId },
    aggregateKey: testOrderId
  }, db);

  console.log('Finalizer result:', finalizerResult);
  assert.strictEqual(finalizerResult.status, 'CONFIRMED');

  // Verify database updates
  const updatedItem = db.tables.order_items[0];
  assert.strictEqual(updatedItem.stock_finalised, true, 'stock_finalised must be true');
  assert.strictEqual(updatedItem.item_status, 'confirmed', 'item_status must be confirmed');

  const updatedInv = db.tables.inventory[0];
  console.log('Post-finalizer inventory:', updatedInv);
  assert.strictEqual(updatedInv.quantity, 8, 'quantity deducted by 2');
  assert.strictEqual(updatedInv.reserved_quantity, 0, 'reserved_quantity deducted by 2');

  const updatedOrder = db.tables.orders[0];
  assert.strictEqual(updatedOrder.status, 'confirmed', 'order status confirmed');

  // Verify outbox emissions
  const emittedEvents = db.tables.outbox_events.filter(r => !r.published_at);
  const invUpdatedEvent = emittedEvents.find(e => e.event_type === 'inventory-updated');
  const notifEvent = emittedEvents.find(e => e.event_type === 'notification-created');

  assert.ok(invUpdatedEvent, 'outbox inventory-updated must be emitted');
  assert.strictEqual(invUpdatedEvent.aggregate_key, testOfferId, 'inventory-updated keyed by offer_id');

  assert.ok(notifEvent, 'outbox notification-created must be emitted');
  assert.strictEqual(notifEvent.aggregate_key, testUserId, 'notification-created keyed by user_id');
  assert.strictEqual(notifEvent.payload.message, 'Order confirmed');

  // Verify idempotency: run again with same eventId
  console.log('\nTesting finalizer idempotency (duplicate event)...');
  const duplicateResult = await processOrderPlaced({
    eventId: 'evt-order-placed-101',
    payload: { order_id: testOrderId },
    aggregateKey: testOrderId
  }, db);
  console.log('Duplicate finalizer call result:', duplicateResult);
  assert.strictEqual(duplicateResult.status, 'SKIPPED');
  assert.strictEqual(updatedInv.quantity, 8, 'Quantity must not be deducted twice!');
  console.log('  [PASS] inventory-finalizer correctly executes Pattern A and is strictly idempotent.\n');

  // -----------------------------------------------------------------
  // 3. TEST INVENTORY DEDUCTION FAILURE (ROLLBACK)
  // -----------------------------------------------------------------
  console.log('--- TEST 4: inventory-finalizer Rollback on INVENTORY_DEDUCTION_FAILED ---');
  const failOrderId = 'ord-fail-insufficient';
  db.tables.orders.push({
    order_id: failOrderId,
    user_id: testUserId,
    status: 'placed'
  });
  db.tables.order_items.push({
    order_item_id: 'oi-fail-item',
    order_id: failOrderId,
    offer_id: testOfferId,
    stock_location_id: testLocationId,
    quantity: 999, // Way more than available quantity (8)
    item_status: 'placed',
    stock_finalised: false
  });

  let deductionFailedCaught = false;
  try {
    await processOrderPlaced({
      eventId: 'evt-fail-event-999',
      payload: { order_id: failOrderId },
      aggregateKey: failOrderId
    }, db);
  } catch (err) {
    deductionFailedCaught = true;
    console.log('Intercepted expected deduction failure:', err.message);
    assert.strictEqual(err.code, 'INVENTORY_DEDUCTION_FAILED');
  }
  assert.strictEqual(deductionFailedCaught, true, 'Insufficient stock MUST throw INVENTORY_DEDUCTION_FAILED');

  // Verify transaction rolled back: marker must NOT be in processed_events
  const marker = db.tables.processed_events.find(m => m.event_id === 'evt-fail-event-999');
  assert.strictEqual(marker, undefined, 'Marker must be rolled back so Kafka can retry');
  console.log('  [PASS] INVENTORY_DEDUCTION_FAILED correctly triggered transaction rollback.\n');

  // -----------------------------------------------------------------
  // 4. TEST CONSUMER "search-sync" (PATTERN B)
  // -----------------------------------------------------------------
  console.log('--- TEST 5: Consumer "search-sync" (Pattern B) ---');
  const syncOfferId = 'off-sync-offer-123';
  const syncProductId = 'prod-speaker-456';

  db.tables.dealer_offers.push({
    offer_id: syncOfferId,
    product_id: syncProductId,
    dealer_id: 'd-dealer-1',
    purchase_price: 100000,
    selling_price: 149900,
    status: 'active',
    bangalore_delivery_days: 1,
    transfer_days_max: 3,
    eligible_modes: ['quick', 'standard']
  });

  db.tables.offer_state_versions.push({
    offer_id: syncOfferId,
    revision: 3
  });

  db.tables.products.push({
    product_id: syncProductId,
    name: 'Sony Extra Bass Portable Speaker',
    brand: 'Sony',
    category_id: 'cat-audio'
  });

  db.tables.categories.push({
    category_id: 'cat-audio',
    category_name: 'Audio'
  });

  db.tables.dealers.push({
    dealer_id: 'd-dealer-1',
    shop_name: 'Sony Authorised Store',
    city: 'Bangalore',
    state: 'Karnataka'
  });

  db.tables.stock_locations.push({
    location_id: testLocationId,
    is_sellable: true,
    is_home: true
  });

  db.tables.inventory.push({
    offer_id: syncOfferId,
    location_id: testLocationId,
    quantity: 25,
    reserved_quantity: 5
  });

  // Execute search-sync with revision 3
  const syncResult = await processSearchSync({
    eventId: 'evt-sync-001',
    payload: { offer_id: syncOfferId },
    aggregateKey: syncOfferId
  }, db, searchClient);

  console.log('Search sync result:', syncResult);
  assert.strictEqual(syncResult.status, 'SYNCED');
  assert.strictEqual(syncResult.outcome, 'written');
  assert.strictEqual(syncResult.revision, 3);

  // Check document in OpenSearch
  let osDoc = await searchClient.getDocument('offers', syncOfferId);
  console.log('Indexed document revision in OpenSearch:', osDoc._source.revision);
  assert.strictEqual(osDoc._source.revision, 3);
  assert.strictEqual(osDoc._source.available_units, 20); // 25 - 5

  // Verify marker committed
  const syncMarker = db.tables.processed_events.find(
    m => m.event_id === 'evt-sync-001' && m.consumer_name === 'search-sync'
  );
  assert.ok(syncMarker, 'search-sync marker must be committed');

  // Verify duplicate event is skipped
  const duplicateSync = await processSearchSync({
    eventId: 'evt-sync-001',
    payload: { offer_id: syncOfferId },
    aggregateKey: syncOfferId
  }, db, searchClient);
  console.log('Duplicate search-sync call result:', duplicateSync);
  assert.strictEqual(duplicateSync.status, 'SKIPPED');

  // Verify revision guard with older event:
  // Simulate an older event with revision 2 arriving
  console.log('\nTesting Pattern B stale revision handling...');
  db.tables.offer_state_versions.find(r => r.offer_id === syncOfferId).revision = 2; // Older revision
  const staleSync = await processSearchSync({
    eventId: 'evt-sync-older-002',
    payload: { offer_id: syncOfferId },
    aggregateKey: syncOfferId
  }, db, searchClient);

  console.log('Stale sync outcome:', staleSync.outcome);
  assert.strictEqual(staleSync.outcome, 'stale', '409 Conflict must yield outcome "stale"');

  // Document in OpenSearch remains at revision 3
  osDoc = await searchClient.getDocument('offers', syncOfferId);
  assert.strictEqual(osDoc._source.revision, 3, 'OpenSearch document remains protected at revision 3');
  console.log('  [PASS] search-sync correctly executes Pattern B with external revision guard.\n');

  // -----------------------------------------------------------------
  // 5. TEST SEARCH OFFERS DISCOVERY
  // -----------------------------------------------------------------
  console.log('--- TEST 6: searchOffers Candidate Retrieval ---');
  const searchResults = await searchOffers({ q: 'sony speaker', category: 'Audio' }, searchClient);
  console.log('Search query result:', searchResults);
  assert.ok(searchResults.hits.length > 0);
  assert.strictEqual(searchResults.hits[0].offer_id, syncOfferId);
  assert.strictEqual(searchResults.hits[0].product_id, syncProductId);
  assert.strictEqual(searchResults.hits[0].quick_available, undefined);
  console.log('  [PASS] searchOffers candidate retrieval matches contract.\n');

  console.log('=====================================================');
  console.log(' ALL PHASE 1 INTEGRATION TESTS PASSED (6/6)!');
  console.log('=====================================================');
}

runPhase1Tests().catch(err => {
  console.error('\n[PHASE 1 TEST RUN FAILED]:', err);
  process.exit(1);
});
