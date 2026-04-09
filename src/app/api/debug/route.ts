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
    const [ping, columns, neighborhoodEquity, neighborhood, crossSummary] = await Promise.all([
      executeQuery("SELECT 1 AS test, CURRENT_USER() AS cu, CURRENT_WAREHOUSE() AS wh"),
      executeQuery("SELECT column_name FROM information_schema.columns WHERE table_name = 'CASES_ENRICHED' AND table_schema = 'ANALYTICS' ORDER BY ordinal_position"),
      executeQuery("SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_name = 'NEIGHBORHOOD_EQUITY' AND table_schema = 'ANALYTICS'").catch(() => [{ cnt: "ERROR" }]),
      executeQuery("SELECT COUNT(*) AS cnt FROM cases_enriched WHERE neighborhood IS NOT NULL").catch(() => [{ cnt: "ERROR" }]),
      executeQuery("SELECT COUNT(*) AS cnt FROM cases_enriched WHERE ai_cross_summary IS NOT NULL").catch(() => [{ cnt: "ERROR" }]),
    ]);
    return Response.json({
      ok: true,
      env,
      ping,
      columns: columns.map(r => r.column_name ?? r.COLUMN_NAME),
      neighborhood_equity_table_exists: neighborhoodEquity[0],
      cases_with_neighborhood: neighborhood[0],
      cases_with_cross_summary: crossSummary[0],
    });
  } catch (err) {
    return Response.json({
      ok: false,
      env,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  }
}
