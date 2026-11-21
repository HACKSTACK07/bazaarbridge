
import os
from confluent_kafka import Producer

config = {
    "bootstrap.servers": os.environ["KAFKA_BOOTSTRAP_SERVERS"],
    "security.protocol": "SASL_SSL",
    "sasl.mechanism": "SCRAM-SHA-256",
    "sasl.username": os.environ["KAFKA_USERNAME"],
    "sasl.password": os.environ["KAFKA_PASSWORD"],
    "ssl.ca.location": os.environ["KAFKA_CA_PATH"],
}

producer = Producer(config)
results = []

def delivery_report(err, msg):
    if err:
        print(f"Delivery failed: {err}")
    else:
        results.append(msg.partition())
        print(
            f"Delivered | Topic: {msg.topic()} | "
            f"Partition: {msg.partition()} | "
            f"Key: {msg.key().decode()}"
        )

for i in range(2):
    producer.produce(
        topic="bazaar.core.events",
        key="order-101",
        value=f"Test order event {i + 1}",
        callback=delivery_report
    )

remaining = producer.flush(15)

if remaining:
    print(f"FAILED: {remaining} messages not delivered.")
elif len(results) == 2:
    print("\n--- PARTITION CONSISTENCY TEST ---")
    print(f"Partitions: {results}")
    print("PASSED" if results[0] == results[1] else "FAILED")
