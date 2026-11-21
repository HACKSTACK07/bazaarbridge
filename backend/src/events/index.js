/**
 * BazaarBridge Events Module (Authoritative Contract v7.2)
 *
 * Exports:
 * - KafkaClient
 * - getKafkaConfig
 * - Topic constants: TOPIC_CORE_EVENTS, TOPIC_FULFILMENT_EVENTS
 * - Partition & key helpers: getTopicForEvent, getKeyForEvent
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

module.exports = {
  TOPIC_CORE_EVENTS,
  TOPIC_FULFILMENT_EVENTS,
  TOPIC_CONFIG,
  EVENT_CATALOG,
  getTopicForEvent,
  getKeyForEvent,
  getKafkaConfig,
  KafkaClient
};
