import { QUERY_TEMPLATES } from "./queryTemplates";

const SF_NEIGHBORHOODS = [
  "Mission", "SoMa", "Tenderloin", "Bayview", "Excelsior",
  "Castro", "Haight", "Richmond", "Sunset", "Potrero",
  "Bernal Heights", "Noe Valley", "Pacific Heights", "Marina",
  "North Beach", "Chinatown", "Financial District", "Visitacion Valley",
  "Portola", "Ingleside", "West Portal", "Glen Park",
];

const INTENT_RULES: Array<{
  intent: string;
  keywords: string[];
}> = [
  { intent: "severity_mismatch", keywords: ["severity", "worse", "photo shows", "escalation", "gap", "understate", "underreport photo", "damage than described"] },
  { intent: "category_mismatch", keywords: ["mismatch", "wrong category", "miscategor", "image vs text", "classified differently", "category mismatch", "photos and text"] },
  { intent: "equity_analysis", keywords: ["equity", "underreport", "underserved", "volume", "fairness", "bias", "underreporting"] },
  { intent: "safety_detection", keywords: ["safety", "hazard", "dangerous", "risk", "urgent", "danger"] },
  { intent: "theme_analysis", keywords: ["theme", "pattern", "top complaint", "classify", "breakdown", "common", "complaint type"] },
  { intent: "sentiment_trend", keywords: ["sentiment", "angry", "frustrated", "getting worse", "mood", "negative"] },
];

const INTENT_TO_QUERY_ID: Record<string, string> = {
  severity_mismatch: "severity",
  category_mismatch: "mismatch",
  equity_analysis: "equity",
  safety_detection: "safety",
  theme_analysis: "theme_analysis",
  sentiment_trend: "sentiment_trend",
};

export interface RouterResult {
  intent: string;
  params: {
    district?: string;
    neighborhood?: string;
  };
  queryId: string;
  sql: string;
  functions: string[];
  workflow: string;
}

export function routeIntent(question: string): RouterResult {
  const lower = question.toLowerCase();

  // Detect intent by keyword scoring
  let bestIntent = "severity_mismatch";
  let bestScore = 0;

  for (const rule of INTENT_RULES) {
    const score = rule.keywords.reduce(
      (acc, kw) => acc + (lower.includes(kw.toLowerCase()) ? 1 : 0),
      0
    );
    if (score > bestScore) {
      bestScore = score;
      bestIntent = rule.intent;
    }
  }

  // Extract district number (1–11)
  const districtMatch = lower.match(/district\s*(\d{1,2})|district\s+([a-z]+)/);
  const numMatch = lower.match(/\b([1-9]|10|11)\b/);
  const district = districtMatch?.[1] ?? numMatch?.[1];

  // Extract neighborhood name
  const neighborhood = SF_NEIGHBORHOODS.find((n) =>
    lower.includes(n.toLowerCase())
  );

  const params: RouterResult["params"] = {};
  if (district) params.district = district;
  if (neighborhood) params.neighborhood = neighborhood;

  const queryId = INTENT_TO_QUERY_ID[bestIntent] ?? "severity";
  const template = QUERY_TEMPLATES[queryId];

  // Add WHERE filters for district/neighborhood if extracted
  let sql = template.sql;
  if (district || neighborhood) {
    const hasWhere = sql.toUpperCase().includes("WHERE");
    const filters: string[] = [];
    if (district) filters.push(`district = '${district}'`);
    if (neighborhood) filters.push(`neighborhood ILIKE '%${neighborhood}%'`);
    const clause = filters.join(" AND ");
    if (hasWhere) {
      sql = sql.replace(/ORDER BY/i, `AND ${clause}\nORDER BY`);
    } else {
      sql = sql.replace(/GROUP BY/i, `WHERE ${clause}\nGROUP BY`);
    }
  }

  const WORKFLOW_NAMES: Record<string, string> = {
    severity_mismatch: "Severity Escalation Detection",
    category_mismatch: "Photo vs. Text Category Mismatch",
    equity_analysis: "Neighborhood Equity Analysis",
    safety_detection: "Cross-Modal Safety Hazard Detection",
    theme_analysis: "Theme Breakdown Analysis",
    sentiment_trend: "Sentiment Trend by District",
  };

  return {
    intent: bestIntent,
    params,
    queryId,
    sql,
    functions: template.functions,
    workflow: WORKFLOW_NAMES[bestIntent] ?? bestIntent,
  };
}
