
import getpass
from opensearchpy import OpenSearch

client = OpenSearch(
    hosts=[{
        "host": "os-3929470d-bazaarbridge203.l.aivencloud.com",
        "port": 11597
    }],
    http_auth=("avnadmin", getpass.getpass("OpenSearch password: ")),
    use_ssl=True,
    verify_certs=True
)

try:
    response = client.search(
        index="offers",
        body={
            "query": {
                "match": {
                    "name": {
                        "query": "bluetoth",
                        "fuzziness": "AUTO"
                    }
                }
            }
        }
    )

    print("\n--- TYPO TOLERANCE SEARCH ---")

    for hit in response["hits"]["hits"]:
        print("Product:", hit["_source"]["name"])
        print("Score:", hit["_score"])

    if response["hits"]["total"]["value"] > 0:
        print("\nPASSED: Typo-tolerant search found products!")
    else:
        print("\nFAILED: No matching products found.")

finally:
    client.close()
