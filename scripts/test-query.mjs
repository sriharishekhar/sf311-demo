import snowflake from "snowflake-sdk";
import fs from "fs";

snowflake.configure({ logLevel: "ERROR" });

const connection = snowflake.createConnection({
  account: process.env.SNOWFLAKE_ACCOUNT,
  username: process.env.SNOWFLAKE_USERNAME,
  authenticator: "SNOWFLAKE_JWT",
  privateKey: fs.readFileSync(process.env.SNOWFLAKE_PRIVATE_KEY_PATH ?? "/Users/sriharishekhar/sf311-demo/keys/snowflake_rsa_key.p8", "utf8"),
  database: process.env.SNOWFLAKE_DATABASE ?? "SF311_DEMO",
  schema: process.env.SNOWFLAKE_SCHEMA ?? "ANALYTICS",
  warehouse: process.env.SNOWFLAKE_WAREHOUSE ?? "COMPUTE_WH",
  role: process.env.SNOWFLAKE_ROLE ?? "ACCOUNTADMIN",
});

connection.connect((err) => {
  if (err) { console.error("Connect error:", err); process.exit(1); }

  connection.execute({
    sqlText: `SELECT AI_COMPLETE('pixtral-large', 'Describe this image in one sentence.', TO_FILE('@SF311_DEMO.ANALYTICS.PHOTOS_STAGE', 'graffiti_001.jpg')) AS result`,
    complete: (err, _stmt, rows) => {
      connection.destroy(() => {});
      if (err) { console.error("Query error:", err); process.exit(1); }
      console.log(JSON.stringify(rows, null, 2));
    },
  });
});
