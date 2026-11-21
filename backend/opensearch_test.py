
import getpass
from opensearchpy import OpenSearch

HOST = "os-3929470d-bazaarbridge203.l.aivencloud.com"
PORT = 11597
USERNAME = "avnadmin"

password = getpass.getpass("Enter OpenSearch password: ")

client = OpenSearch(
    hosts=[{"host": HOST, "port": PORT}],
    http_auth=(USERNAME, password),
    use_ssl=True,
    verify_certs=True,
    timeout=30
)

try:
    response = client.info()
    print("\nSUCCESS: Connected to Aiven OpenSearch!")
    print("Cluster:", response["cluster_name"])
    print("Version:", response["version"]["number"])
except Exception as error:
    print("Connection failed:", error)
finally:
    client.close()
