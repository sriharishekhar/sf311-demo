import { NextRequest } from "next/server";
import { executeQuery } from "@/lib/snowflake";
import { QUERY_TEMPLATES } from "@/lib/queryTemplates";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { id } = body as { id: string };

  const template = QUERY_TEMPLATES[id];
  if (!template) {
    return Response.json({ error: "Unknown query id" }, { status: 400 });
  }

  const start = Date.now();
  try {
    const rows = await executeQuery(template.sql);
    const executionTime = ((Date.now() - start) / 1000).toFixed(1);
    return Response.json({ rows, rowCount: rows.length, executionTime });
  } catch (err) {
    const executionTime = ((Date.now() - start) / 1000).toFixed(1);
    return Response.json({
      rows: template.fallbackResults,
      rowCount: template.fallbackResults.length,
      executionTime,
      fallback: true,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
