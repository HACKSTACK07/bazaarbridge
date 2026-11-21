
import os
import getpass
import psycopg

print("Testing PostgreSQL connection...")

try:
    database_url = os.getenv("PG_URI")

    if not database_url:
        database_url = getpass.getpass("Enter PostgreSQL connection URI: ")

    with psycopg.connect(
        database_url,
        connect_timeout=15,
        sslmode="require"
    ) as conn:

        with conn.cursor() as cur:
            cur.execute("SELECT version(), current_database()")
            version, database = cur.fetchone()

            print("\nSUCCESS: PostgreSQL connected!")
            print("Database:", database)
            print("Version:", version.split(",")[0])

            cur.execute("SELECT 1")
            print("Query test:", cur.fetchone()[0])

            print("\nPASSED: PostgreSQL reconnection test!")

except Exception as error:
    print("\nFAILED:", error)
