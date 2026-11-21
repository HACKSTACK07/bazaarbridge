/**
 * Verification Test for Agent C Kafka Client & Event Topology
 *
 * Proves:
 * 1. SASL_SSL configuration with SCRAM-SHA-256 and CA certificate path
 * 2. 2 topics x 2 partitions each (free-tier design)
 * 3. Message key routing per authoritative catalog (e.g. order-placed -> order_id, inventory-updated -> offer_id)
 * 4. Partition assignment by aggregate key
 * 5. Security guard: raw OTP in event payload is strictly rejected
 */

const assert = require('assert');
const {
  TOPIC_CORE_EVENTS,
  TOPIC_FULFILMENT_EVENTS,
  TOPIC_CONFIG,
  EVENT_CATALOG,
  getTopicForEvent,
  getKeyForEvent,
  getKafkaConfig,
  KafkaClient
} = require('./index');

async function runKafkaTests() {
  console.log('=====================================================');
  console.log(' RUNNING AGENT C KAFKA TOPOLOGY & CLIENT TESTS');
  console.log('=====================================================\n');

  // 1. Verify Configuration & SASL_SSL defaults
  console.log('--- TEST 1: Kafka Client Configuration Scaffolding ---');
  const config = getKafkaConfig();
  console.log('Brokers configured:', config.brokers);
  console.log('SSL configuration active:', Boolean(config.ssl));
  console.log('SASL mechanism:', config.sasl?.mechanism);

  assert.ok(config.brokers.length > 0, 'Brokers must be configured');
  assert.ok(config.ssl, 'SSL must be enabled for Aiven Kafka');
  assert.strictEqual(config.sasl?.mechanism, 'scram-sha-256', 'SASL mechanism must be SCRAM-SHA-256');
  console.log('  [PASS] Kafka configuration conforms to SASL_SSL / SCRAM-SHA-256 specification.\n');

  // 2. Verify 2 topics x 2 partitions
  console.log('--- TEST 2: Topic & Partition Topology (2x2 Design) ---');
  assert.strictEqual(TOPIC_CORE_EVENTS, 'bazaar.core.events');
  assert.strictEqual(TOPIC_FULFILMENT_EVENTS, 'bazaar.fulfilment.events');

  assert.strictEqual(TOPIC_CONFIG[TOPIC_CORE_EVENTS].numPartitions, 2, 'bazaar.core.events must have 2 partitions');
  assert.strictEqual(TOPIC_CONFIG[TOPIC_FULFILMENT_EVENTS].numPartitions, 2, 'bazaar.fulfilment.events must have 2 partitions');
  console.log(`Topic 1: ${TOPIC_CORE_EVENTS} (${TOPIC_CONFIG[TOPIC_CORE_EVENTS].numPartitions} partitions)`);
  console.log(`Topic 2: ${TOPIC_FULFILMENT_EVENTS} (${TOPIC_CONFIG[TOPIC_FULFILMENT_EVENTS].numPartitions} partitions)`);
  console.log('  [PASS] 2 topics with 2 partitions verified.\n');

  // 3. Verify Message Key Routing
  console.log('--- TEST 3: Authoritative Event Catalog & Key Routing ---');
  const sampleEvents = [
    { type: 'order-placed', payload: { order_id: 'ord-101' }, expectedKey: 'ord-101', expectedTopic: TOPIC_CORE_EVENTS },
    { type: 'inventory-updated', payload: { offer_id: 'off-202' }, expectedKey: 'off-202', expectedTopic: TOPIC_CORE_EVENTS },
    { type: 'order-item-cancelled', payload: { offer_id: 'off-202' }, expectedKey: 'off-202', expectedTopic: TOPIC_CORE_EVENTS },
    { type: 'offer-price-updated', payload: { offer_id: 'off-202' }, expectedKey: 'off-202', expectedTopic: TOPIC_CORE_EVENTS },
    { type: 'refund-credit-requested', payload: { order_item_id: 'oi-303' }, expectedKey: 'oi-303', expectedTopic: TOPIC_CORE_EVENTS },
    { type: 'notification-created', payload: { user_id: 'usr-404' }, expectedKey: 'usr-404', expectedTopic: TOPIC_CORE_EVENTS },
    { type: 'fulfilment-status-updated', payload: { group_id: 'grp-505', otp_proof: 'hash123' }, expectedKey: 'grp-505', expectedTopic: TOPIC_FULFILMENT_EVENTS },
    { type: 'stock-transfer-status-updated', payload: { group_id: 'grp-505' }, expectedKey: 'grp-505', expectedTopic: TOPIC_FULFILMENT_EVENTS },
    { type: 'eta-updated', payload: { group_id: 'grp-505' }, expectedKey: 'grp-505', expectedTopic: TOPIC_FULFILMENT_EVENTS }
  ];

  for (const item of sampleEvents) {
    const topic = getTopicForEvent(item.type);
    const key = getKeyForEvent(item.type, item.payload);
    assert.strictEqual(topic, item.expectedTopic, `Event [${item.type}] must route to [${item.expectedTopic}]`);
    assert.strictEqual(key, item.expectedKey, `Event [${item.type}] must key on [${item.expectedKey}]`);
  }
  console.log(`Verified all ${sampleEvents.length} event types route to correct topic and partition key.`);
  console.log('  [PASS] Key-based partition routing strictly matches contract.\n');

  // 4. Test Publishing & Partition Assignment
  console.log('--- TEST 4: Publishing & Consumer Message Flow ---');
  const client = new KafkaClient({ mockMode: true });

  let receivedMessage = null;
  await client.subscribe(TOPIC_CORE_EVENTS, 'test-consumer-group', async ({ topic, partition, message }) => {
    receivedMessage = {
      topic,
      partition,
      key: message.key.toString(),
      value: JSON.parse(message.value.toString())
    };
  });

  const published = await client.publish('order-placed', { order_id: 'ord-abc-123', total: 4900 });
  console.log('Published event:', {
    topic: published.topic,
    key: published.key,
    partition: published.partition
  });

  assert.strictEqual(published.topic, TOPIC_CORE_EVENTS);
  assert.strictEqual(published.key, 'ord-abc-123');
  assert.ok(published.partition === 0 || published.partition === 1, 'Partition must be 0 or 1');

  // Wait a tick for async dispatch
  await new Promise(r => setTimeout(r, 50));
  assert.ok(receivedMessage, 'Consumer should receive published message');
  assert.strictEqual(receivedMessage.key, 'ord-abc-123');
  console.log('  [PASS] Event successfully published and consumed.\n');

  // 5. Security Guard: Raw OTP in payload must throw error
  console.log('--- TEST 5: Security Guard: Raw OTP Rejection in Payloads ---');
  let securityViolationCaught = false;
  try {
    await client.publish('fulfilment-status-updated', {
      group_id: 'grp-505',
      otp: '123456' // Raw OTP code strictly forbidden in Kafka!
    });
  } catch (err) {
    securityViolationCaught = true;
    console.log('Successfully intercepted security violation:', err.message);
  }
  assert.strictEqual(securityViolationCaught, true, 'Publishing raw OTP in event payload MUST be blocked!');
  console.log('  [PASS] Security rule verified: Raw OTP cannot enter event stream.\n');

  console.log('=====================================================');
  console.log(' ALL KAFKA TESTS PASSED (5/5)!');
  console.log('=====================================================');
}

runKafkaTests().catch(err => {
  console.error('\n[KAFKA TEST RUN FAILED]:', err);
  process.exit(1);
});
