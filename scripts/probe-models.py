#!/usr/bin/env python3
import os, snowflake.connector, warnings
warnings.filterwarnings("ignore")

conn = snowflake.connector.connect(
    account=os.environ["SNOWFLAKE_ACCOUNT"],
    user=os.environ["SNOWFLAKE_USERNAME"],
    private_key_file=os.path.expanduser(os.environ.get("SNOWFLAKE_PRIVATE_KEY_PATH", "~/sf311-demo/keys/snowflake_rsa_key.p8")),
    database=os.environ.get("SNOWFLAKE_DATABASE", "SF311_DEMO"),
    schema=os.environ.get("SNOWFLAKE_SCHEMA", "ANALYTICS"),
    warehouse=os.environ.get("SNOWFLAKE_WAREHOUSE", "COMPUTE_WH"),
    role=os.environ.get("SNOWFLAKE_ROLE", "ACCOUNTADMIN"),
)
cur = conn.cursor()

models = [
    # multimodal
    "pixtral-large", "llama3.2-11b-vision", "llama3.2-90b-vision",
    "claude-3-5-sonnet", "claude-3-haiku", "claude-3-opus",
    # text-only fallbacks
    "mistral-large2", "mistral-large", "llama3.1-70b", "llama3.1-8b",
    "llama3-70b", "snowflake-arctic", "reka-flash", "mixtral-8x7b",
]

print("Probing models...\n")
for m in models:
    try:
        cur.execute(f"SELECT SNOWFLAKE.CORTEX.COMPLETE('{m}', 'hi') AS r")
        cur.fetchone()
        print(f"  ✓  {m}")
    except Exception as e:
        msg = str(e)
        if "unavailable" in msg.lower():
            print(f"  ✗  {m}  (unavailable in this region)")
        elif "not enabled" in msg.lower() or "not authorized" in msg.lower():
            print(f"  ✗  {m}  (not enabled)")
        else:
            print(f"  ?  {m}  ({msg[:80]})")

cur.close(); conn.close()
