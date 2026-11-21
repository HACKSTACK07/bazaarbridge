
import os
from confluent_kafka import Consumer

config = {
    "bootstrap.servers": os.environ["KAFKA_BOOTSTRAP_SERVERS"],
    "security.protocol": "SASL_SSL",
    "sasl.mechanism": "SCRAM-SHA-256",
    "sasl.username": os.environ["KAFKA_USERNAME"],
    "sasl.password": os.environ["KAFKA_PASSWORD"],
    "ssl.ca.location": os.environ["KAFKA_CA_PATH"],
    "group.id": "bazaarbridge-validation-consumer",
    "auto.offset.reset": "earliest",
    "enable.auto.commit": False
}

consumer = Consumer(config)

try:
    consumer.subscribe(["bazaar.core.events"])

    print("Listening for Kafka messages...\n")

    messages = consumer.consume(
        num_messages=2,
        timeout=15
    )

    count = 0

    for msg in messages:
        if msg.error():
            print("Error:", msg.error())
            continue

        count += 1

        print("Message received!")
        print("Topic:", msg.topic())
        print("Partition:", msg.partition())
        print("Key:", msg.key().decode() if msg.key() else None)
        print("Value:", msg.value().decode())
        print("-" * 40)

    if count > 0:
        print("\nPASSED: Kafka consumer received messages!")
    else:
        print("\nWARNING: No messages received.")

finally:
    consumer.close()
