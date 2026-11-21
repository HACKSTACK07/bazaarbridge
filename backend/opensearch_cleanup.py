
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
    # Delete only the test documents
    test_ids = ["1", "2", "3", "revision-test-001"]

    for doc_id in test_ids:
        if client.exists(index="offers", id=doc_id):
            client.delete(
                index="offers",
                id=doc_id,
                refresh="wait_for"
            )
            print(f"Deleted test document: {doc_id}")

    # Verify remaining documents
    result = client.count(index="offers")

    print("\nRemaining documents:", result["count"])

    if result["count"] == 0:
        print("PASSED: All dummy data cleaned up!")
    else:
        print("WARNING: Some documents remain.")

finally:
    client.close()
