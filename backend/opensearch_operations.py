
import getpass
from opensearchpy import OpenSearch

HOST = "os-3929470d-bazaarbridge203.l.aivencloud.com"
PORT = 11597

password = getpass.getpass("OpenSearch password: ")

client = OpenSearch(
    hosts=[{"host": HOST, "port": PORT}],
    http_auth=("avnadmin", password),
    use_ssl=True,
    verify_certs=True
)

INDEX = "offers"

try:
    # Create index with searchable fields
    if client.indices.exists(index=INDEX):
        client.indices.delete(index=INDEX)

    client.indices.create(
        index=INDEX,
        body={
            "mappings": {
                "properties": {
                    "name": {
                        "type": "text",
                        "fields": {
                            "keyword": {"type": "keyword"}
                        }
                    },
                    "description": {"type": "text"},
                    "revision": {"type": "integer"}
                }
            }
        }
    )

    print("Offers index created!")

    # Insert three dummy products
    products = [
        {
            "name": "Bluetooth Headphones",
            "description": "Wireless audio headphones",
            "revision": 1
        },
        {
            "name": "Wireless Mouse",
            "description": "Ergonomic computer mouse",
            "revision": 1
        },
        {
            "name": "Mechanical Keyboard",
            "description": "RGB gaming keyboard",
            "revision": 1
        }
    ]

    for i, product in enumerate(products, start=1):
        client.index(
            index=INDEX,
            id=str(i),
            body=product,
            refresh="wait_for"
        )

    print("Three dummy products inserted successfully!")

except Exception as e:
    print("Error:", e)

finally:
    client.close()
