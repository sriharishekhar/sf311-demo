#!/usr/bin/env python3
"""Upload images from public/images/ to @SF311_DEMO.ANALYTICS.PHOTOS_STAGE"""

import os
import glob
import snowflake.connector

IMAGES_DIR = os.path.expanduser("~/sf311-demo/public/images")
PRIVATE_KEY = os.path.expanduser(os.environ.get("SNOWFLAKE_PRIVATE_KEY_PATH", "~/sf311-demo/keys/snowflake_rsa_key.p8"))

conn = snowflake.connector.connect(
    account=os.environ["SNOWFLAKE_ACCOUNT"],
    user=os.environ["SNOWFLAKE_USERNAME"],
    private_key_file=PRIVATE_KEY,
    database=os.environ.get("SNOWFLAKE_DATABASE", "SF311_DEMO"),
    schema=os.environ.get("SNOWFLAKE_SCHEMA", "ANALYTICS"),
    warehouse=os.environ.get("SNOWFLAKE_WAREHOUSE", "COMPUTE_WH"),
    role=os.environ.get("SNOWFLAKE_ROLE", "ACCOUNTADMIN"),
)

cur = conn.cursor()

images = sorted(glob.glob(os.path.join(IMAGES_DIR, "*.jpg")))
print(f"Found {len(images)} images to upload\n")

for path in images:
    filename = os.path.basename(path)
    result = cur.execute(
        f"PUT file://{path} @SF311_DEMO.ANALYTICS.PHOTOS_STAGE "
        f"AUTO_COMPRESS=FALSE OVERWRITE=TRUE"
    ).fetchone()
    status = result[6] if result else "unknown"
    print(f"  {'✓' if status == 'UPLOADED' else '⚠'} {filename} — {status}")

cur.execute("SELECT COUNT(*) FROM DIRECTORY(@SF311_DEMO.ANALYTICS.PHOTOS_STAGE)")
count = cur.fetchone()[0]
print(f"\n{count} files now in stage")

cur.close()
conn.close()
