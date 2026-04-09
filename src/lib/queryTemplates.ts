export interface QueryTemplate {
  id: string;
  sql: string;
  functions: string[];
  fallbackResults: Record<string, unknown>[];
}

export const QUERY_TEMPLATES: Record<string, QueryTemplate> = {
  severity: {
    id: "severity",
    sql: `SELECT caseid, district, category,
  LEFT(description, 120) AS description,
  LEFT(ai_image_description, 120) AS image_shows,
  ai_image_severity,
  ai_severity_gap AS severity_gap
FROM cases_enriched
WHERE has_photo = TRUE
  AND ai_image_severity IS NOT NULL
  AND ai_severity_gap IS NOT NULL
  AND ai_severity_gap > 1
ORDER BY ai_severity_gap DESC
LIMIT 25`,
    functions: ["AI_COMPLETE (text)", "AI_COMPLETE (image)", "Arithmetic comparison"],
    fallbackResults: [
      { caseid: 14892210, district: "5", description: "Large branch cracked and hanging over playground", image_shows: "Massive tree limb split at trunk, dangling over children's play equipment", ai_image_severity: 5, severity_gap: 3 },
      { caseid: 14892301, district: "6", description: "Pile of dumped mattresses blocking sidewalk", image_shows: "Commercial-scale illegal dump with hazardous materials, blocking wheelchair ramp and hydrant", ai_image_severity: 5, severity_gap: 2 },
      { caseid: 14892265, district: "3", description: "Deep pothole on Market causing cars to swerve", image_shows: "Crater-sized road failure with exposed rebar, adjacent to active bike lane", ai_image_severity: 4, severity_gap: 2 },
    ],
  },

  mismatch: {
    id: "mismatch",
    sql: `SELECT caseid, district, category AS human_category,
  ai_theme AS text_ai_says,
  ai_image_category AS image_ai_says,
  LEFT(description, 100) AS description,
  LEFT(ai_image_description, 100) AS image_description
FROM cases_enriched
WHERE has_photo = TRUE
  AND ai_category_match = FALSE
ORDER BY opened DESC
LIMIT 25`,
    functions: ["AI_CLASSIFY (text)", "AI_CLASSIFY (image)", "Cross-modal comparison"],
    fallbackResults: [
      { caseid: 14891822, district: "9", human_category: "Graffiti", text_ai_says: "Graffiti/Vandalism", image_ai_says: "General Maintenance", description: "Faded paint on wall", image_description: "Photo shows faded mural, not vandalism" },
      { caseid: 14891756, district: "6", human_category: "Street Cleaning", text_ai_says: "General Maintenance", image_ai_says: "Safety Hazard", description: "Trash on sidewalk", image_description: "Photo reveals biohazard waste" },
    ],
  },

  equity: {
    id: "equity",
    sql: `SELECT neighborhood, district,
  complaint_volume,
  ROUND(avg_visual_severity, 2) AS avg_visual_severity,
  ROUND(avg_text_severity, 2) AS avg_text_severity,
  safety_count,
  equity_flag
FROM neighborhood_equity
ORDER BY
  CASE WHEN equity_flag = 'Potentially Underreported' THEN 0 ELSE 1 END,
  avg_visual_severity DESC`,
    functions: ["AI_COMPLETE (image severity)", "AI_SENTIMENT", "Aggregation + equity logic"],
    fallbackResults: [
      { neighborhood: "Bayview", district: "10", complaint_volume: 38, avg_visual_severity: 4.2, avg_text_severity: 2.8, safety_count: 12, equity_flag: "Potentially Underreported" },
      { neighborhood: "Excelsior", district: "11", complaint_volume: 29, avg_visual_severity: 3.8, avg_text_severity: 2.5, safety_count: 8, equity_flag: "Potentially Underreported" },
    ],
  },

  safety: {
    id: "safety",
    sql: `SELECT caseid, district, neighborhood, category,
  LEFT(description, 120) AS description,
  ai_image_severity,
  ai_severity_gap,
  LEFT(ai_image_description, 150) AS assessment
FROM cases_enriched
WHERE has_photo = TRUE
  AND ai_image_severity IS NOT NULL
  AND (ai_image_severity >= 4 OR ai_severity_gap > 1)
ORDER BY ai_image_severity DESC NULLS LAST
LIMIT 25`,
    functions: ["AI_COMPLETE (image severity)", "AI_COMPLETE (image description)", "Severity threshold filter"],
    fallbackResults: [
      { caseid: 14892210, district: "5", neighborhood: "Haight", category: "Tree Maintenance", description: "Large branch cracked and hanging over playground", ai_image_severity: 5, ai_severity_gap: 3, assessment: "Critical: large tree limb over active playground, imminent fall risk to children" },
      { caseid: 14892265, district: "3", neighborhood: "SoMa", category: "Damaged Property", description: "Deep pothole on Market causing cars to swerve", ai_image_severity: 4, ai_severity_gap: 2, assessment: "High: road crater with exposed rebar forcing cyclists into traffic lane" },
    ],
  },

  theme_analysis: {
    id: "theme_analysis",
    sql: `SELECT ai_theme,
  COUNT(*) AS case_count,
  ROUND(AVG(ai_sentiment), 3) AS avg_sentiment
FROM cases_enriched
GROUP BY ai_theme
ORDER BY case_count DESC`,
    functions: ["AI_CLASSIFY (theme)", "AI_SENTIMENT", "Aggregation"],
    fallbackResults: [
      { ai_theme: "General Maintenance", case_count: 1240, avg_sentiment: -0.42 },
      { ai_theme: "Illegal Dumping", case_count: 890, avg_sentiment: -0.71 },
      { ai_theme: "Road/Pothole Damage", case_count: 654, avg_sentiment: -0.65 },
    ],
  },

  sentiment_trend: {
    id: "sentiment_trend",
    sql: `SELECT district,
  ROUND(AVG(ai_sentiment), 3) AS avg_sentiment,
  COUNT(*) AS total_cases,
  SUM(CASE WHEN ai_sentiment < -0.3 THEN 1 ELSE 0 END) AS negative_cases
FROM cases_enriched
GROUP BY district
ORDER BY avg_sentiment ASC`,
    functions: ["AI_SENTIMENT", "Aggregation by district"],
    fallbackResults: [
      { district: "6", avg_sentiment: -0.74, total_cases: 612, negative_cases: 489 },
      { district: "9", avg_sentiment: -0.68, total_cases: 543, negative_cases: 421 },
    ],
  },
};
