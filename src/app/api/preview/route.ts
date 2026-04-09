import { executeQuery } from "@/lib/snowflake";

export async function GET() {
  try {
    const rows = await executeQuery(`
      SELECT
        caseid AS id,
        TO_CHAR(opened, 'YYYY-MM-DD') AS date,
        district,
        category AS cat,
        LEFT(description, 200) AS desc,
        has_photo AS photo,
        photo_filename,
        COALESCE(ai_theme, 'Unknown') AS theme,
        COALESCE(ai_sentiment, 0) AS sentiment,
        ai_image_severity AS sev_i,
        COALESCE(ai_severity_gap, 0) AS gap
      FROM cases_enriched
      ORDER BY opened DESC
      LIMIT 100
    `);

    // Normalize keys to lowercase
    const normalized = rows.map((r) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) {
        out[k.toLowerCase()] = v;
      }
      return out;
    });

    return Response.json({ rows: normalized });
  } catch {
    return Response.json({ rows: null });
  }
}
