import { NextRequest } from "next/server";
import { executeQuery } from "@/lib/snowflake";
import { QUERY_TEMPLATES } from "@/lib/queryTemplates";
import { routeIntent } from "@/lib/intentRouter";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { question } = body as { question: string };

  if (!question) {
    return Response.json({ error: "Missing question" }, { status: 400 });
  }

  const routed = routeIntent(question);
  const template = QUERY_TEMPLATES[routed.queryId];

  const start = Date.now();
  try {
    const results = await executeQuery(routed.sql);
    const executionTime = ((Date.now() - start) / 1000).toFixed(1);
    return Response.json({
      intent: routed.intent,
      params: routed.params,
      workflow: routed.workflow,
      sql: routed.sql,
      functions: routed.functions,
      results,
      rowCount: results.length,
      executionTime,
    });
  } catch (err) {
    const executionTime = ((Date.now() - start) / 1000).toFixed(1);
    return Response.json({
      intent: routed.intent,
      params: routed.params,
      workflow: routed.workflow,
      sql: routed.sql,
      functions: routed.functions,
      results: template.fallbackResults,
      rowCount: template.fallbackResults.length,
      executionTime,
      fallback: true,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
