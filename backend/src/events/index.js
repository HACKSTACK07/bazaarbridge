/**
 * BazaarBridge Events Module (Authoritative Contract v7.2)
 *
 * Exports:
 * - KafkaClient, getKafkaConfig
 * - Topics & Key routing: TOPIC_CORE_EVENTS, TOPIC_FULFILMENT_EVENTS, getTopicForEvent, getKeyForEvent
 * - Outbox publisher: publishPendingEvents, startOutboxPublisher
 * - Consumers:
 *   - inventory-finalizer: processOrderPlaced (Pattern A)
 *   - search-sync: processSearchSync (Pattern B)
 */

const {
  TOPIC_CORE_EVENTS,
  TOPIC_FULFILMENT_EVENTS,
  TOPIC_CONFIG,
  EVENT_CATALOG,
  getTopicForEvent,
  getKeyForEvent
} = require('./topics');

const {
  getKafkaConfig,
  KafkaClient
} = require('./kafka');

const {
  publishPendingEvents,
  startOutboxPublisher
} = require('./outbox_publisher');

const {
  CONSUMER_NAME: FINALIZER_CONSUMER_NAME,
  processOrderPlaced
} = require('./inventory_finalizer');

const {
  CONSUMER_NAME: SEARCH_SYNC_CONSUMER_NAME,
  processSearchSync
} = require('./search_sync');

module.exports = {
  // Topics & Routing
  TOPIC_CORE_EVENTS,
  TOPIC_FULFILMENT_EVENTS,
  TOPIC_CONFIG,
  EVENT_CATALOG,
  getTopicForEvent,
  getKeyForEvent,

  // Kafka Client
  getKafkaConfig,
  KafkaClient,

  // Outbox Publisher
  publishPendingEvents,
  startOutboxPublisher,

  // Consumers
  FINALIZER_CONSUMER_NAME,
  processOrderPlaced,
  SEARCH_SYNC_CONSUMER_NAME,
  processSearchSync
};
