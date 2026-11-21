/**
 * Kafka Client Scaffolding (Authoritative Contract v7.2)
 *
 * Rules:
 * - SASL_SSL preferred (SCRAM-SHA-256) or SSL.
 * - Free-tier safe design: 2 topics x 2 partitions.
 * - Consume with eachMessage.
 * - In-memory event stream engine for tests and offline validation.
 */

const fs = require('fs');
const path = require('path');
const {
  TOPIC_CORE_EVENTS,
  TOPIC_FULFILMENT_EVENTS,
  TOPIC_CONFIG,
  getTopicForEvent,
  getKeyForEvent
} = require('./topics');

/**
 * Assembles Kafka connection configuration from environment variables.
 */
function getKafkaConfig(overrides = {}) {
  const brokersStr = overrides.brokers ||
    process.env.KAFKA_BROKERS ||
    process.env.KAFKA_BOOTSTRAP_SERVERS ||
    'kafka-1c6d0bf5-bazaarbridge203.g.aivencloud.com:11610';

  const brokers = Array.isArray(brokersStr)
    ? brokersStr
    : brokersStr.split(',').map(b => b.trim()).filter(Boolean);

  const securityProtocol = (
    overrides.securityProtocol ||
    process.env.KAFKA_SECURITY_PROTOCOL ||
    'SASL_SSL'
  ).toUpperCase();

  const saslMechanism = (
    overrides.saslMechanism ||
    process.env.KAFKA_SASL_MECHANISM ||
    'SCRAM-SHA-256'
  ).toLowerCase().replace('_', '-');

  const username = overrides.username ||
    process.env.KAFKA_SASL_USERNAME ||
    process.env.KAFKA_USERNAME ||
    'avnadmin';

  const password = overrides.password ||
    process.env.KAFKA_SASL_PASSWORD ||
    process.env.KAFKA_PASSWORD ||
    '';

  // SSL CA Certificate resolution
  let sslConfig = true;
  const caPath = overrides.caPath ||
    process.env.KAFKA_CA_PATH ||
    path.join(__dirname, '..', '..', 'certs', 'kafka-ca.pem');

  if (fs.existsSync(caPath)) {
    try {
      const caCert = fs.readFileSync(caPath, 'utf-8');
      sslConfig = {
        rejectUnauthorized: true,
        ca: [caCert]
      };
    } catch (e) {
      // Fallback to true if read fails
      sslConfig = true;
    }
  }

  const config = {
    clientId: overrides.clientId || 'bazaarbridge-events-service',
    brokers,
    ssl: sslConfig
  };

  if (securityProtocol.includes('SASL')) {
    config.sasl = {
      mechanism: saslMechanism === 'scram-sha-256' ? 'scram-sha-256' : saslMechanism,
      username,
      password
    };
  }

  return config;
}

/**
 * Event bus client providing publish and subscribe abstractions.
 * Supports Kafkajs if available or built-in in-memory event bus for testing.
 */
class KafkaClient {
  constructor(options = {}) {
    this.config = getKafkaConfig(options);
    this.mockMode = Boolean(options.mockMode || (!this.config.sasl?.password && !process.env.KAFKA_PASSWORD));

    // In-memory bus for mock/test execution
    this._subscribers = new Map(); // topic -> Array<{ groupId, handler }>
    this._messages = new Map();    // topic -> Array<{ partition, key, value, headers, offset }>
    this._topics = new Map();

    // Register initial topics with 2 partitions each
    this._topics.set(TOPIC_CORE_EVENTS, { partitions: 2 });
    this._topics.set(TOPIC_FULFILMENT_EVENTS, { partitions: 2 });
  }

  /**
   * Publishes an event to its designated Kafka topic, partitioned by aggregate key.
   */
  async publish(eventType, payload, headers = {}) {
    const topic = getTopicForEvent(eventType);
    const key = getKeyForEvent(eventType, payload);

    // Strictly enforce contract: Raw OTP codes MUST NOT be in payloads
    if (payload.otp !== undefined) {
      throw new Error(`SECURITY VIOLATION: Raw OTP detected in event payload for [${eventType}]. Only otp_proof is permitted.`);
    }

    const message = {
      topic,
      key,
      value: JSON.stringify(payload),
      headers: {
        eventType,
        ...headers,
        timestamp: String(Date.now())
      }
    };

    if (this.mockMode) {
      return this._mockPublish(topic, message);
    }

    // When real kafkajs is loaded, delegate to producer
    if (this._producer) {
      return this._producer.send({
        topic,
        messages: [{
          key,
          value: message.value,
          headers: message.headers
        }]
      });
    }

    return message;
  }

  _mockPublish(topic, message) {
    if (!this._messages.has(topic)) {
      this._messages.set(topic, []);
    }
    const topicMessages = this._messages.get(topic);

    // Hash key to partition 0 or 1 (2 partitions per topic)
    let hash = 0;
    const str = String(message.key);
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    const partition = Math.abs(hash) % 2;

    const stored = {
      ...message,
      partition,
      offset: topicMessages.length
    };
    topicMessages.push(stored);

    // Dispatch to registered subscribers
    const topicSubscribers = this._subscribers.get(topic) || [];
    for (const sub of topicSubscribers) {
      setImmediate(async () => {
        try {
          await sub.handler({
            topic,
            partition,
            message: {
              key: Buffer.from(stored.key),
              value: Buffer.from(stored.value),
              headers: stored.headers,
              offset: stored.offset
            }
          });
        } catch (err) {
          console.error(`Error in consumer [${sub.groupId}]:`, err);
        }
      });
    }

    return stored;
  }

  /**
   * Subscribes a consumer group to a topic using eachMessage pattern.
   */
  async subscribe(topic, groupId, handler) {
    if (!this._subscribers.has(topic)) {
      this._subscribers.set(topic, []);
    }
    this._subscribers.get(topic).push({ groupId, handler });
    return { topic, groupId };
  }

  getMessages(topic) {
    return this._messages.get(topic) || [];
  }
}

module.exports = {
  getKafkaConfig,
  KafkaClient
};
