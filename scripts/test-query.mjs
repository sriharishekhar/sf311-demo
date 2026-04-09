import snowflake from "snowflake-sdk";
import fs from "fs";

snowflake.configure({ logLevel: "ERROR" });

const connection = snowflake.createConnection({
  account: "JXFAAZN-TDB41070",
  username: "SRIHARISHEKHAR",
  authenticator: "SNOWFLAKE_JWT",
  privateKey: fs.readFileSync("/Users/sriharishekhar/sf311-demo/keys/snowflake_rsa_key.p8", "utf8"),
  database: "SF311_DEMO",
  schema: "ANALYTICS",
  warehouse: "COMPUTE_WH",
  role: "ACCOUNTADMIN",
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
