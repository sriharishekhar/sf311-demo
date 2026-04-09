import snowflake from "snowflake-sdk";
import fs from "fs";

snowflake.configure({ logLevel: "ERROR" });

function getPrivateKey(): string {
  // Vercel: key content stored directly in env var
  const keyContent = process.env.SNOWFLAKE_PRIVATE_KEY;
  if (keyContent) {
    const key = keyContent.replace(/\\n/g, "\n").trim();
    // Already full PEM — return as-is
    if (key.startsWith("-----")) return key;
    // Raw base64 (no headers) — wrap in PKCS8 PEM with proper 64-char line breaks
    const body = key.replace(/\s+/g, "").match(/.{1,64}/g)?.join("\n") ?? key;
    return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`;
  }
  // Local dev: read from file path
  const path = process.env.SNOWFLAKE_PRIVATE_KEY_PATH;
  if (path) return fs.readFileSync(path, "utf8");
  throw new Error("Neither SNOWFLAKE_PRIVATE_KEY nor SNOWFLAKE_PRIVATE_KEY_PATH is set");
}

export async function executeQuery(
  sqlText: string
): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const connection = snowflake.createConnection({
      account: process.env.SNOWFLAKE_ACCOUNT!,
      username: process.env.SNOWFLAKE_USERNAME!,
      authenticator: "SNOWFLAKE_JWT",
      privateKey: getPrivateKey(),
      database: process.env.SNOWFLAKE_DATABASE!,
      schema: process.env.SNOWFLAKE_SCHEMA!,
      warehouse: process.env.SNOWFLAKE_WAREHOUSE!,
      role: process.env.SNOWFLAKE_ROLE!,
    });

    connection.connect((err) => {
      if (err) {
        console.error("[Snowflake] Connection error:", err);
        reject(new Error(`Snowflake connection failed: ${err.message}`));
        return;
      }

      connection.execute({
        sqlText,
        complete: (execErr, _stmt, rows) => {
          connection.destroy(() => {});
          if (execErr) {
            console.error("[Snowflake] Query error:", execErr);
            reject(new Error(`Query failed: ${execErr.message}`));
            return;
          }
          const normalized = ((rows as Record<string, unknown>[]) ?? []).map(
            (row) => Object.fromEntries(
              Object.entries(row).map(([k, v]) => [k.toLowerCase(), v])
            )
          );
          resolve(normalized);
        },
      });
    });
  });
}
