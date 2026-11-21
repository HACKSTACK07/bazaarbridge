/**
 * BazaarBridge Event Topics & Key Definitions (Authoritative Contract v7.2)
 *
 * Rules:
 * - 2 topics x 2 partitions each (free-tier safe).
 * - Topic 1: bazaar.core.events (2 partitions)
 * - Topic 2: bazaar.fulfilment.events (2 partitions)
 * - Message keys (partition keys) ensure per-aggregate ordering.
 */

const TOPIC_CORE_EVENTS = 'bazaar.core.events';
const TOPIC_FULFILMENT_EVENTS = 'bazaar.fulfilment.events';

const TOPIC_CONFIG = {
  [TOPIC_CORE_EVENTS]: {
    numPartitions: 2,
    replicationFactor: 1
  },
  [TOPIC_FULFILMENT_EVENTS]: {
    numPartitions: 2,
    replicationFactor: 1
  }
};

/**
 * Authoritative mapping of Event Type -> Topic and Partition Key Field
 */
const EVENT_CATALOG = {
  // Topic: bazaar.core.events
  'order-placed': {
    topic: TOPIC_CORE_EVENTS,
    keyField: 'order_id'
  },
  'inventory-updated': {
    topic: TOPIC_CORE_EVENTS,
    keyField: 'offer_id'
  },
  'order-item-cancelled': {
    topic: TOPIC_CORE_EVENTS,
    keyField: 'offer_id'
  },
  'offer-price-updated': {
    topic: TOPIC_CORE_EVENTS,
    keyField: 'offer_id'
  },
  'refund-credit-requested': {
    topic: TOPIC_CORE_EVENTS,
    keyField: 'order_item_id'
  },
  'notification-created': {
    topic: TOPIC_CORE_EVENTS,
    keyField: 'user_id'
  },

  // Topic: bazaar.fulfilment.events
  'fulfilment-status-updated': {
    topic: TOPIC_FULFILMENT_EVENTS,
    keyField: 'group_id'
  },
  'stock-transfer-status-updated': {
    topic: TOPIC_FULFILMENT_EVENTS,
    keyField: 'group_id'
  },
  'eta-updated': {
    topic: TOPIC_FULFILMENT_EVENTS,
    keyField: 'group_id'
  }
};

/**
 * Resolves the destination Kafka topic for a given event type.
 */
function getTopicForEvent(eventType) {
  const entry = EVENT_CATALOG[eventType];
  if (!entry) {
    throw new Error(`Unknown event type [${eventType}]. Must be defined in authoritative catalog.`);
  }
  return entry.topic;
}

/**
 * Resolves the partition message key for an event.
 */
function getKeyForEvent(eventType, payload) {
  const entry = EVENT_CATALOG[eventType];
  if (!entry) {
    throw new Error(`Unknown event type [${eventType}].`);
  }
  const key = payload[entry.keyField];
  if (!key) {
    throw new Error(`Missing required key field [${entry.keyField}] in payload for event [${eventType}].`);
  }
  return String(key);
}

module.exports = {
  TOPIC_CORE_EVENTS,
  TOPIC_FULFILMENT_EVENTS,
  TOPIC_CONFIG,
  EVENT_CATALOG,
  getTopicForEvent,
  getKeyForEvent
};
