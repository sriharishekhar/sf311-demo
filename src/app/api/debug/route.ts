import { executeQuery } from "@/lib/snowflake";

export async function GET() {
  const env = {
    SNOWFLAKE_ACCOUNT: !!process.env.SNOWFLAKE_ACCOUNT,
    SNOWFLAKE_USERNAME: !!process.env.SNOWFLAKE_USERNAME,
    SNOWFLAKE_DATABASE: !!process.env.SNOWFLAKE_DATABASE,
    SNOWFLAKE_SCHEMA: !!process.env.SNOWFLAKE_SCHEMA,
    SNOWFLAKE_WAREHOUSE: !!process.env.SNOWFLAKE_WAREHOUSE,
    SNOWFLAKE_ROLE: !!process.env.SNOWFLAKE_ROLE,
    SNOWFLAKE_PRIVATE_KEY: !!process.env.SNOWFLAKE_PRIVATE_KEY,
    SNOWFLAKE_PRIVATE_KEY_PATH: !!process.env.SNOWFLAKE_PRIVATE_KEY_PATH,
    // Show first 60 chars of private key to check formatting (no secret content)
    PRIVATE_KEY_PREVIEW: process.env.SNOWFLAKE_PRIVATE_KEY
      ? process.env.SNOWFLAKE_PRIVATE_KEY.substring(0, 60)
      : "(not set)",
    ACCOUNT_VALUE: process.env.SNOWFLAKE_ACCOUNT || "(not set)",
  };

  try {
    const rows = await executeQuery("SELECT 1 AS test, CURRENT_USER() AS cu, CURRENT_WAREHOUSE() AS wh");
    return Response.json({ ok: true, env, rows });
  } catch (err) {
    return Response.json({
      ok: false,
      env,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  }
}
