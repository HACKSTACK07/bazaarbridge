
import getpass
from opensearchpy import OpenSearch
from opensearchpy.exceptions import ConflictError

client = OpenSearch(
    hosts=[{
        "host": "os-3929470d-bazaarbridge203.l.aivencloud.com",
        "port": 11597
    }],
    http_auth=("avnadmin", getpass.getpass("OpenSearch password: ")),
    use_ssl=True,
    verify_certs=True
)

INDEX = "offers"
DOC_ID = "revision-test-001"

try:
    # Step 1: Insert revision 2
    client.index(
        index=INDEX,
        id=DOC_ID,
        body={
            "name": "Revision Test Product",
            "description": "Latest product information",
            "revision": 2
        },
        refresh="wait_for"
    )

    print("Revision 2 inserted successfully!")

    # Step 2: Attempt an older revision 1
    try:
        client.index(
            index=INDEX,
            id=DOC_ID,
            body={
                "name": "Revision Test Product",
                "description": "Old product information",
                "revision": 1
            },
            version=1,
            version_type="external",
            refresh="wait_for"
        )

        print("FAILED: Older revision was accepted!")

    except ConflictError as e:
        if e.status_code == 409:
            print("PASSED: HTTP 409 version conflict received!")
        else:
            raise

    # Step 3: Verify stored document
    result = client.get(index=INDEX, id=DOC_ID)
    stored_revision = result["_source"]["revision"]

    print("Stored revision:", stored_revision)

    if stored_revision == 2:
        print("PASSED: Revision 2 is protected!")
    else:
        print("FAILED: Revision changed!")

finally:
    client.close()
