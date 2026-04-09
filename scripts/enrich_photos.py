#!/usr/bin/env python3
"""
Enrich cases_enriched with image AI data.
Steps:
  1. Assign photos to cases by category (round-robin)
  2. Run Cortex AI_COMPLETE on each unique photo (60 calls)
  3. MERGE results back into cases_enriched
"""

import os
import snowflake.connector

PRIVATE_KEY = os.path.expanduser(os.environ.get("SNOWFLAKE_PRIVATE_KEY_PATH", "~/sf311-demo/keys/snowflake_rsa_key.p8"))
STAGE = "@SF311_DEMO.ANALYTICS.PHOTOS_STAGE"

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

def run(label, sql):
    print(f"\n{label}...", flush=True)
    cur.execute(sql)
    return cur.fetchall()

# ── Step 2: Assign photos to cases by category ────────────────────────────────
run("Step 2/5: Assigning photos to cases", f"""
CREATE OR REPLACE TEMPORARY TABLE photo_assignments AS
WITH category_map (category, prefix, photo_count) AS (
  SELECT 'Graffiti',                   'graffiti',    10
  UNION ALL SELECT 'Damaged Property', 'pothole',     10
  UNION ALL SELECT 'Tree Maintenance', 'tree',        10
  UNION ALL SELECT 'Streetlights',     'light',        5
  UNION ALL SELECT 'Sewer Issues',     'sewer',        5
  UNION ALL SELECT 'Encampments',      'encampment',   5
),
other_numbered AS (
  SELECT
    c.caseid,
    c.category,
    ROW_NUMBER() OVER (PARTITION BY c.category ORDER BY c.opened) AS rn,
    m.prefix,
    m.photo_count
  FROM SF311_DEMO.ANALYTICS.CASES_ENRICHED c
  JOIN category_map m ON c.category = m.category
),
dumping_numbered AS (
  SELECT
    caseid,
    category,
    ROW_NUMBER() OVER (ORDER BY opened) AS rn
  FROM SF311_DEMO.ANALYTICS.CASES_ENRICHED
  WHERE category = 'Street and Sidewalk Cleaning'
)
SELECT
  caseid,
  category,
  prefix || '_' || LPAD(((rn - 1) % photo_count + 1)::TEXT, 3, '0') || '.jpg' AS photo_filename
FROM other_numbered

UNION ALL

SELECT
  caseid,
  category,
  CASE
    WHEN ((rn - 1) % 15) < 10
      THEN 'dumping_'  || LPAD((((rn - 1) % 15) + 1)::TEXT, 3, '0') || '.jpg'
    ELSE   'sidewalk_' || LPAD((((rn - 1) % 15) - 9)::TEXT, 3, '0') || '.jpg'
  END AS photo_filename
FROM dumping_numbered
""")

rows = run("  Verifying assignments", """
  SELECT category, COUNT(*) AS cases, COUNT(DISTINCT photo_filename) AS unique_photos
  FROM photo_assignments GROUP BY category ORDER BY category
""")
for r in rows:
    print(f"    {r[0]}: {r[1]} cases, {r[2]} unique photos")

# ── Step 3: Run Cortex AI on each unique photo ────────────────────────────────
print(f"\nStep 3/5: Running Cortex AI on unique photos (this takes ~2–5 min)...", flush=True)
cur.execute(f"""
CREATE OR REPLACE TEMPORARY TABLE photo_ai_results AS
SELECT
  photo_filename,

  AI_COMPLETE(
    'pixtral-large',
    'You are analyzing a San Francisco 311 service request photo. Describe the urban infrastructure issue in one concise sentence. Be specific about what you see.',
    TO_FILE('{STAGE}', photo_filename)
  ) AS ai_image_description,

  AI_COMPLETE(
    'pixtral-large',
    'Classify this urban infrastructure issue photo into exactly one category. Choose from: Illegal Dumping, Graffiti/Vandalism, Road/Pothole Damage, Tree Hazard, Streetlight Outage, Sewer/Drainage, Encampment, General Maintenance, Safety Hazard. Respond with only the category name, nothing else.',
    TO_FILE('{STAGE}', photo_filename)
  ) AS ai_image_category,

  TRY_CAST(TRIM(AI_COMPLETE(
    'pixtral-large',
    'Rate the severity of the urban infrastructure issue in this photo: 1=minor cosmetic, 2=moderate nuisance, 3=significant, 4=serious safety concern, 5=immediate hazard. Respond with only a single digit 1-5, nothing else.',
    TO_FILE('{STAGE}', photo_filename)
  )) AS INTEGER) AS ai_image_severity

FROM (SELECT DISTINCT photo_filename FROM photo_assignments)
""")

rows = run("  Verifying AI results", """
  SELECT COUNT(*) AS photos_processed,
         ROUND(AVG(ai_image_severity), 2) AS avg_severity,
         COUNT(DISTINCT ai_image_category) AS distinct_categories
  FROM photo_ai_results
""")
for r in rows:
    print(f"    Photos processed: {r[0]}, avg severity: {r[1]}, categories found: {r[2]}")

# ── Step 4+5: MERGE into cases_enriched ──────────────────────────────────────
rows = run("Step 4/5: Merging results into cases_enriched", """
MERGE INTO SF311_DEMO.ANALYTICS.CASES_ENRICHED AS target
USING (
  SELECT
    pa.caseid,
    pa.photo_filename,
    ai.ai_image_description,
    TRIM(ai.ai_image_category)  AS ai_image_category,
    ai.ai_image_severity,
    ai.ai_image_severity - CASE
      WHEN ce.ai_sentiment < -0.6 THEN 3
      WHEN ce.ai_sentiment < -0.3 THEN 2
      ELSE 1
    END AS ai_severity_gap,
    (TRIM(ai.ai_image_category) = ce.ai_theme) AS ai_category_match
  FROM photo_assignments pa
  JOIN photo_ai_results ai       ON pa.photo_filename = ai.photo_filename
  JOIN SF311_DEMO.ANALYTICS.CASES_ENRICHED ce ON pa.caseid = ce.caseid
  WHERE ai.ai_image_severity IS NOT NULL
) AS source
ON target.caseid = source.caseid
WHEN MATCHED THEN UPDATE SET
  has_photo            = TRUE,
  photo_filename       = source.photo_filename,
  ai_image_description = source.ai_image_description,
  ai_image_category    = source.ai_image_category,
  ai_image_severity    = source.ai_image_severity,
  ai_severity_gap      = source.ai_severity_gap,
  ai_category_match    = source.ai_category_match
""")
print(f"    Done.")

# ── Step 5: Final verification ────────────────────────────────────────────────
rows = run("Step 5/5: Final verification", """
SELECT
  COUNT(*)                                              AS total_cases,
  SUM(CASE WHEN has_photo THEN 1 ELSE 0 END)           AS cases_with_photos,
  ROUND(AVG(ai_image_severity), 2)                     AS avg_image_severity,
  SUM(CASE WHEN ai_category_match = FALSE THEN 1 ELSE 0 END) AS category_mismatches,
  SUM(CASE WHEN ai_severity_gap > 1 THEN 1 ELSE 0 END) AS severity_escalations
FROM SF311_DEMO.ANALYTICS.CASES_ENRICHED
""")
r = rows[0]
print(f"""
  Results:
    Total cases:          {r[0]}
    Cases with photos:    {r[1]}
    Avg image severity:   {r[2]}
    Category mismatches:  {r[3]}
    Severity escalations: {r[4]}
""")
print("Done! Your Next.js app will now return live data for severity, mismatch, and safety queries.")

cur.close()
conn.close()
