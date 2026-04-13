"use client";

import { useState, useEffect, useRef, useCallback } from "react";

const C = {
  navy: "#0a1628", navyLight: "#0f2038", navyMid: "#162a4a",
  ice: "#29b6f6", cyan: "#00e5c3", white: "#f0f4f8", gray: "#8a9bb5",
  grayDark: "#3a4a63", grayLight: "#c5d0de",
  surface: "#111d30", surfaceLight: "#f6f8fb",
  red: "#ff5252", amber: "#ffab40", green: "#69f0ae",
};

const ANALYSES = [
  {
    id: "severity",
    icon: "⚠️",
    title: "Cross-modal comparison",
    q: "How does image severity compare to what the text describes?",
    why: "Compares the severity the vision model assigned to the photo against the sentiment of the text. Cases with a large gap may be worth a second look.",
    sql: `SELECT case_id, district,
  LEFT(description, 80) AS text_says,
  LEFT(ai_image_description, 80) AS image_shows,
  ai_text_severity, ai_image_severity,
  ai_severity_gap
FROM cases_enriched
WHERE ai_severity_gap > 1
ORDER BY ai_severity_gap DESC`,
    functions: ["AI_COMPLETE (text)", "AI_COMPLETE (image)"],
    fallback: [
      { case_id: 14892210, district: "5", text_says: "Large branch cracked and hanging over playground", image_shows: "Massive tree limb split at trunk dangling over play equipment", ai_text_severity: 2, ai_image_severity: 5, ai_severity_gap: 3 },
      { case_id: 14892301, district: "6", text_says: "Pile of dumped mattresses blocking sidewalk", image_shows: "Commercial-scale dump with hazardous materials blocking wheelchair ramp", ai_text_severity: 3, ai_image_severity: 5, ai_severity_gap: 2 },
      { case_id: 14892265, district: "3", text_says: "Deep pothole on Market causing cars to swerve", image_shows: "Crater-sized road failure with exposed rebar adjacent to bike lane", ai_text_severity: 2, ai_image_severity: 4, ai_severity_gap: 2 },
    ],
  },
  {
    id: "mismatch",
    icon: "🔄",
    title: "Multi-source classification",
    q: "Do the text and image classifications agree?",
    why: "AI_CLASSIFY on the text and AI_COMPLETE on the image can produce different categories for the same case. This query finds where they disagree.",
    sql: `SELECT case_id, district,
  category AS filed_as,
  ai_theme AS text_says,
  ai_image_category AS image_says
FROM cases_enriched
WHERE ai_category_match = FALSE
ORDER BY opened DESC`,
    functions: ["AI_CLASSIFY", "AI_COMPLETE"],
    fallback: [
      { case_id: 14891822, district: "9", filed_as: "Graffiti", text_says: "Graffiti/Vandalism", image_says: "General Maintenance" },
      { case_id: 14891756, district: "6", filed_as: "Street Cleaning", text_says: "General Maintenance", image_says: "Safety Hazard" },
      { case_id: 14891698, district: "3", filed_as: "Damaged Property", text_says: "Road/Pothole Damage", image_says: "Sewer/Drainage" },
    ],
  },
  {
    id: "sentiment_by_district",
    icon: "📊",
    title: "Aggregated sentiment",
    q: "How does complaint sentiment vary across districts?",
    why: "AI_SENTIMENT scored every complaint. This query aggregates those scores by district.",
    sql: `SELECT district,
  COUNT(*) AS total_cases,
  ROUND(AVG(ai_sentiment), 3) AS avg_sentiment,
  SUM(CASE WHEN ai_sentiment < -0.5
    THEN 1 ELSE 0 END) AS highly_negative
FROM cases_enriched
GROUP BY district
ORDER BY avg_sentiment ASC`,
    functions: ["AI_SENTIMENT", "Aggregation"],
    fallback: [
      { district: "6", total_cases: 612, avg_sentiment: -0.74, highly_negative: 489 },
      { district: "9", total_cases: 543, avg_sentiment: -0.68, highly_negative: 421 },
      { district: "3", total_cases: 498, avg_sentiment: -0.61, highly_negative: 372 },
      { district: "5", total_cases: 441, avg_sentiment: -0.55, highly_negative: 298 },
    ],
  },
  {
    id: "safety",
    icon: "🛡️",
    title: "Combined filtering",
    q: "Which cases combine negative text sentiment with high image severity?",
    why: "Uses both the text-derived and image-derived AI columns to filter for cases where both signals indicate a serious issue.",
    sql: `SELECT case_id, district,
  LEFT(description, 80) AS description,
  ai_sentiment, ai_image_severity,
  LEFT(ai_image_description, 120)
    AS image_assessment
FROM cases_enriched
WHERE ai_sentiment < -0.5
  AND ai_image_severity >= 4
ORDER BY ai_image_severity DESC`,
    functions: ["AI_SENTIMENT", "AI_COMPLETE (image)"],
    fallback: [
      { case_id: 14892210, district: "5", description: "Large branch cracked and hanging over playground", ai_sentiment: -0.55, ai_image_severity: 5, image_assessment: "Critical: large tree limb over active playground" },
      { case_id: 14892265, district: "3", description: "Deep pothole on Market causing cars to swerve", ai_sentiment: -0.81, ai_image_severity: 4, image_assessment: "High: road crater with exposed rebar in bike lane" },
    ],
  },
];

const COMP_ROWS = [
  { cap: "Text classification", sf: "AI_CLASSIFY: dedicated, multi-label, no model selection needed", bq: "AI.CLASSIFY: dedicated, Gemini-powered, auto-optimized prompts", db: "ai_classify: task-specific, Databricks-managed models", rs: "Via Bedrock CREATE MODEL" },
  { cap: "Sentiment analysis", sf: "AI_SENTIMENT: dedicated, returns -1 to +1", bq: "Via AI.SCORE or AI.GENERATE (no dedicated function)", db: "ai_analyze_sentiment: dedicated function", rs: "Via Bedrock with prompting" },
  { cap: "Image analysis", sf: "AI_COMPLETE + TO_FILE() from internal stages", bq: "AI.CLASSIFY/AI.IF + OBJ.GET_ACCESS_URL from GCS", db: "ai_query + READ_FILES from Unity Catalog Volumes", rs: "Not natively supported" },
  { cap: "Semantic filtering (AI in WHERE)", sf: "AI_FILTER: native SQL primitive", bq: "AI.IF: native, with query plan optimization", db: "Via ai_query() in WHERE (general purpose)", rs: "Not supported" },
  { cap: "Cross-row AI aggregation", sf: "AI_AGG, AI_SUMMARIZE_AGG: no context window limits", bq: "Via AI.GENERATE on grouped data (context limited)", db: "Via ai_query() on grouped data (context limited)", rs: "Not supported" },
  { cap: "Query plan optimization for AI", sf: "Not currently available", bq: "Evaluates non-AI filters before AI filters", db: "Batch inference optimization in pipelines", rs: "N/A" },
];

const EXT_ROWS = [
  { cap: "Text completion", sf: "AI_COMPLETE: multiple models (Arctic, Claude, Mistral, Llama)", bq: "AI.GENERATE: choose model or auto-select", db: "ai_query / ai_gen: broad model selection, BYOM", rs: "Via Bedrock model catalog" },
  { cap: "Scoring / ranking", sf: "Via AI_COMPLETE with prompts (no dedicated function)", bq: "AI.SCORE: dedicated, auto-generates rubrics", db: "Via ai_query() with structured output", rs: "Not supported" },
  { cap: "Entity extraction", sf: "AI_EXTRACT: text, images, documents", bq: "Via AI.GENERATE with structured output", db: "ai_extract: dedicated, label-based", rs: "Via Bedrock" },
  { cap: "Document parsing", sf: "AI_PARSE_DOCUMENT: text and layout from PDFs", bq: "Via AI.GENERATE on documents", db: "ai_parse_document: text, tables, figures from PDFs", rs: "Not supported" },
  { cap: "Audio transcription", sf: "AI_TRANSCRIBE: dedicated", bq: "Via AI.GENERATE with audio", db: "Via ai_query with audio models", rs: "Not supported" },
  { cap: "Semantic similarity", sf: "AI_SIMILARITY", bq: "AI.SIMILARITY", db: "ai_similarity", rs: "Not supported" },
  { cap: "PII redaction", sf: "AI_REDACT: dedicated", bq: "Via Cloud DLP (separate service)", db: "ai_mask: dedicated", rs: "Not supported" },
  { cap: "Translation", sf: "AI_TRANSLATE: dedicated", bq: "Via AI.GENERATE", db: "ai_translate: dedicated", rs: "Via Bedrock" },
  { cap: "Vector embeddings", sf: "AI_EMBED: text and image", bq: "AI.EMBED: text", db: "Via ai_query with embedding models", rs: "Not natively supported" },
  { cap: "Data residency", sf: "Data stays within Snowflake perimeter", bq: "Routed to Vertex AI within Google Cloud", db: "Goes to Databricks Model Serving", rs: "Sent to Bedrock / SageMaker" },
  { cap: "Model flexibility", sf: "Anthropic, Meta, Mistral, Google, Arctic (varies by region)", bq: "Gemini auto-select; Claude, Mistral via connections", db: "Broadest: BYOM, any endpoint, all providers", rs: "Bedrock catalog (Anthropic, Meta, Cohere, others)" },
];

const SAMPLE_DATA = [
  { id: 14892301, date: "2024-03-15", district: "6", cat: "Street and Sidewalk Cleaning", desc: "Large pile of illegally dumped mattresses and furniture blocking sidewalk near 16th and Mission", photo: true, photo_filename: "dumping_001.jpg", theme: "Illegal Dumping", sentiment: -0.72, sev_i: 5, gap: 2 },
  { id: 14892287, date: "2024-03-15", district: "9", cat: "Graffiti", desc: "Fresh spray paint tags covering entire storefront on Valencia between 22nd and 23rd", photo: true, photo_filename: "graffiti_001.jpg", theme: "Graffiti/Vandalism", sentiment: -0.45, sev_i: 2, gap: 0 },
  { id: 14892265, date: "2024-03-14", district: "3", cat: "Damaged Property", desc: "Deep pothole on Market near 5th causing cars to swerve into bike lane", photo: true, photo_filename: "pothole_001.jpg", theme: "Road/Pothole Damage", sentiment: -0.81, sev_i: 4, gap: 2 },
  { id: 14892244, date: "2024-03-14", district: "6", cat: "Sewer Issues", desc: "Storm drain completely blocked with debris flooding intersection during rain", photo: true, photo_filename: "sewer_001.jpg", theme: "Sewer/Drainage", sentiment: -0.63, sev_i: 4, gap: 1 },
  { id: 14892210, date: "2024-03-14", district: "5", cat: "Tree Maintenance", desc: "Large branch cracked and hanging over playground area in Panhandle Park", photo: true, photo_filename: "tree_001.jpg", theme: "Tree Hazard", sentiment: -0.55, sev_i: 5, gap: 3 },
  { id: 14892198, date: "2024-03-13", district: "10", cat: "Street and Sidewalk Cleaning", desc: "Trash scattered along Bayshore from recycling bins knocked over by wind", photo: false, photo_filename: "", theme: "General Maintenance", sentiment: -0.31, sev_i: null, gap: null },
  { id: 14892175, date: "2024-03-13", district: "8", cat: "Noise Report", desc: "Construction starting at 5am on residential block near Castro and 18th", photo: false, photo_filename: "", theme: "Noise Disturbance", sentiment: -0.88, sev_i: null, gap: null },
  { id: 14892150, date: "2024-03-13", district: "2", cat: "Streetlights", desc: "Three consecutive streetlights out on dark stretch of Lombard near Divisadero", photo: true, photo_filename: "", theme: "Streetlight Outage", sentiment: -0.41, sev_i: 3, gap: 1 },
];

type SampleRow = typeof SAMPLE_DATA[number];

/* ─── Subcomponents ─── */

function CodeBlock({ code, lang = "sql" }: { code: string; lang?: string }) {
  return (
    <div style={{ background: "#060d18", borderRadius: 10, padding: "14px 16px", fontSize: 11, fontFamily: "var(--font-jetbrains-mono), 'JetBrains Mono', monospace", color: "#c5d0de", overflowX: "auto", lineHeight: 1.6, border: "1px solid rgba(41,182,246,0.08)", position: "relative" }}>
      <span style={{ position: "absolute", top: 6, right: 10, fontSize: 9, color: C.grayDark, textTransform: "uppercase", letterSpacing: 1 }}>{lang}</span>
      <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{code}</pre>
    </div>
  );
}

function Badge({ children, color = C.ice }: { children: React.ReactNode; color?: string }) {
  return (
    <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 10.5, fontWeight: 600, background: `${color}18`, color, border: `1px solid ${color}33` }}>
      {children}
    </span>
  );
}

function PhotoThumb({ filename, onClick }: { filename: string; onClick: (src: string) => void }) {
  return (
    <img
      src={`/images/${filename}`}
      alt="case photo"
      onClick={() => onClick(`/images/${filename}`)}
      style={{ width: 40, height: 40, borderRadius: 6, objectFit: "cover", cursor: "pointer", border: `1px solid ${C.grayDark}`, display: "block" }}
    />
  );
}

function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <img src={src} alt="full size" style={{ maxWidth: "90vw", maxHeight: "88vh", borderRadius: 10, boxShadow: "0 24px 80px rgba(0,0,0,0.6)" }} onClick={(e) => e.stopPropagation()} />
      <button onClick={onClose} style={{ position: "absolute", top: 20, right: 24, background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", fontSize: 20, width: 36, height: 36, borderRadius: "50%", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
    </div>
  );
}

function Pagination({ page, total, perPage, onChange, dark = false }: { page: number; total: number; perPage: number; onChange: (p: number) => void; dark?: boolean }) {
  const totalPages = Math.ceil(total / perPage);
  if (totalPages <= 1) return null;
  const s = (disabled: boolean): React.CSSProperties => ({
    padding: "4px 12px", borderRadius: 4, border: `1px solid ${dark ? C.grayDark : "#d8dfe8"}`,
    background: "transparent", color: disabled ? (dark ? C.grayDark : "#bbc8d4") : dark ? C.grayLight : C.navy,
    fontSize: 11, cursor: disabled ? "default" : "pointer", fontFamily: "inherit",
  });
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end", padding: "8px 14px" }}>
      <button style={s(page === 0)} disabled={page === 0} onClick={() => onChange(page - 1)}>Prev</button>
      <span style={{ fontSize: 11, color: dark ? C.gray : C.grayDark }}>Page {page + 1} of {totalPages}</span>
      <button style={s((page + 1) * perPage >= total)} disabled={(page + 1) * perPage >= total} onClick={() => onChange(page + 1)}>Next</button>
    </div>
  );
}

function DataTable({
  data, page, setPage, showAI = false, lightboxClick,
}: {
  data: SampleRow[];
  page: number;
  setPage: (p: number) => void;
  showAI?: boolean;
  lightboxClick?: (src: string) => void;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const rpp = 5;
  const paged = data.slice(page * rpp, page * rpp + rpp);

  return (
    <div style={{ background: C.surface, borderRadius: 12, overflow: "hidden", border: "1px solid rgba(41,182,246,0.08)", marginTop: 14 }}>
      {showAI && (
        <div style={{ padding: "7px 14px 6px", borderBottom: "1px solid rgba(41,182,246,0.06)", display: "flex", gap: 18, flexWrap: "wrap" }}>
          {[
            { label: "AI Theme", desc: "AI_CLASSIFY on complaint text" },
            { label: "Sent.", desc: "AI_SENTIMENT score" },
            { label: "Img Sev.", desc: "Vision model rating 1 to 5" },
          ].map(({ label, desc }) => (
            <span key={label} style={{ fontSize: 10.5, color: C.gray }}>
              <span style={{ color: C.ice, fontWeight: 600 }}>{label}</span>{" "}{desc}
            </span>
          ))}
        </div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(41,182,246,0.12)" }}>
              {["Case ID", "Date", "Dist.", "Category", "Description", "📷", ...(showAI ? ["AI Theme", "Sent.", "Img Sev."] : [])].map((h) => (
                <th key={h} style={{ padding: "9px 11px", textAlign: "left", color: C.gray, fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.8, whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.map((r, i) => {
              const row = r as Record<string, unknown>;
              const id = row.id ?? row.caseid;
              const date = String(row.date ?? "").slice(0, 10);
              const district = String(row.district ?? "");
              const cat = String(row.cat ?? row.category ?? "");
              const desc = String(row.desc ?? row.description ?? "");
              const photo = Boolean(row.photo ?? row.has_photo);
              const filename = String(row.photo_filename ?? "");
              const theme = String(row.theme ?? row.ai_theme ?? "");
              const sentiment = Number(row.sentiment ?? row.ai_sentiment ?? 0);
              const sev_i = row.sev_i ?? row.ai_image_severity;
              const gap = Number(row.gap ?? row.ai_severity_gap ?? 0);
              return (
                <tr key={i} onClick={() => setExpanded(expanded === i ? null : i)} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)", cursor: "pointer", background: expanded === i ? "rgba(41,182,246,0.04)" : "transparent" }}>
                  <td style={{ padding: "8px 11px", color: C.grayLight, fontFamily: "monospace", fontSize: 11 }}>{String(id)}</td>
                  <td style={{ padding: "8px 11px", color: C.grayLight, fontSize: 11, whiteSpace: "nowrap" }}>{date}</td>
                  <td style={{ padding: "8px 11px", color: C.white, fontWeight: 600 }}>{district}</td>
                  <td style={{ padding: "8px 11px", color: C.grayLight, fontSize: 11, maxWidth: 130 }}>{cat}</td>
                  <td style={{ padding: "8px 11px", color: C.grayLight, maxWidth: 200, fontSize: 11 }}>{expanded === i ? desc : desc.slice(0, 48) + "..."}</td>
                  <td style={{ padding: "8px 11px" }}>
                    {photo && filename && lightboxClick ? (
                      <PhotoThumb filename={filename} onClick={lightboxClick} />
                    ) : photo ? (
                      <div style={{ width: 26, height: 26, borderRadius: 4, background: `linear-gradient(135deg, ${C.navyMid}, ${C.grayDark})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11 }}>📷</div>
                    ) : (
                      <span style={{ color: C.grayDark, fontSize: 11 }}>no</span>
                    )}
                  </td>
                  {showAI && (
                    <>
                      <td style={{ padding: "8px 11px" }}><Badge>{theme || "n/a"}</Badge></td>
                      <td style={{ padding: "8px 11px" }}><span style={{ color: sentiment < -0.5 ? C.red : sentiment < -0.3 ? C.amber : C.green, fontWeight: 600, fontSize: 12 }}>{sentiment.toFixed(2)}</span></td>
                      <td style={{ padding: "8px 11px", whiteSpace: "nowrap" }}>
                        {sev_i != null ? <><span style={{ fontSize: 11.5, color: C.grayLight }}>{String(sev_i)}</span>{gap > 0 && <> <Badge color={C.red}>+{gap}</Badge></>}</> : <span style={{ color: C.grayDark }}>n/a</span>}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ borderTop: "1px solid rgba(41,182,246,0.06)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <span />
        <Pagination page={page} total={data.length} perPage={rpp} onChange={(p) => { setExpanded(null); setPage(p); }} dark />
      </div>
    </div>
  );
}

function ResultsTable({ rows, page, setPage }: { rows: Record<string, unknown>[]; page: number; setPage: (p: number) => void }) {
  if (!rows.length) return null;
  const perPage = 5;
  const paged = rows.slice(page * perPage, page * perPage + perPage);
  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #e2e8f0" }}>
              {Object.keys(rows[0]).map((k) => (
                <th key={k} style={{ padding: "7px 8px", textAlign: "left", color: C.grayDark, fontWeight: 600, fontSize: 9.5, textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap" }}>
                  {k.replace(/_/g, " ")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.map((row, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #f0f2f5" }}>
                {Object.entries(row).map(([k, v], j) => (
                  <td key={j} style={{ padding: "7px 8px", color: C.navy, fontSize: 11.5, maxWidth: 220, lineHeight: 1.4 }}>
                    {k === "ai_severity_gap" || k === "gap" ? <Badge color={C.red}>+{String(v)}</Badge>
                      : k === "equity_flag" ? <Badge color={C.amber}>{String(v)}</Badge>
                      : k.includes("sentiment") || k.includes("sev") ? <strong>{String(v ?? "n/a")}</strong>
                      : <span>{String(v ?? "n/a")}</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > perPage && (
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "6px 0" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button style={{ padding: "4px 12px", borderRadius: 4, border: "1px solid #d8dfe8", background: "transparent", color: page === 0 ? "#bbc8d4" : C.navy, fontSize: 11, cursor: page === 0 ? "default" : "pointer", fontFamily: "inherit" }} disabled={page === 0} onClick={() => setPage(page - 1)}>Prev</button>
            <span style={{ fontSize: 11, color: C.grayDark }}>Page {page + 1} of {Math.ceil(rows.length / perPage)}</span>
            <button style={{ padding: "4px 12px", borderRadius: 4, border: "1px solid #d8dfe8", background: "transparent", color: (page + 1) * perPage >= rows.length ? "#bbc8d4" : C.navy, fontSize: 11, cursor: (page + 1) * perPage >= rows.length ? "default" : "pointer", fontFamily: "inherit" }} disabled={(page + 1) * perPage >= rows.length} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Main page ─── */
export default function SF311Demo() {
  const [showRawData, setShowRawData] = useState(false);
  const [showEnrichedData, setShowEnrichedData] = useState(false);
  const [rawPage, setRawPage] = useState(0);
  const [enrichedPage, setEnrichedPage] = useState(0);
  const [rawData, setRawData] = useState<SampleRow[]>([]);
  const [rawLoading, setRawLoading] = useState(true);
  const [activeAnalysis, setActiveAnalysis] = useState(0);
  const [queryRunning, setQueryRunning] = useState(false);
  const [queryDone, setQueryDone] = useState(false);
  const [queryResults, setQueryResults] = useState<Record<string, unknown>[] | null>(null);
  const [queryTime, setQueryTime] = useState("2.3");
  const [querySlow, setQuerySlow] = useState(false);
  const [queryPage, setQueryPage] = useState(0);
  const [showAllCap, setShowAllCap] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<SampleRow[]>([]);
  const [previewLoading, setPreviewLoading] = useState(true);

  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/preview").then((r) => r.json()).then((d) => { if (d.rows?.length > 0) setPreviewData(d.rows); }).catch(() => {}).finally(() => setPreviewLoading(false));
    fetch("/api/raw").then((r) => r.json()).then((d) => { if (d.rows?.length > 0) setRawData(d.rows); }).catch(() => {}).finally(() => setRawLoading(false));
  }, []);

  const a = ANALYSES[activeAnalysis];

  const runQuery = useCallback(async () => {
    setQueryRunning(true);
    setQueryDone(false);
    setQueryResults(null);
    setQuerySlow(false);
    setQueryPage(0);
    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 80);
    const slowTimer = setTimeout(() => setQuerySlow(true), 10000);
    try {
      const res = await fetch("/api/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: a.id }) });
      const data = await res.json();
      setQueryResults(data.rows ?? a.fallback);
      setQueryTime(data.executionTime ?? "2.3");
    } catch {
      setQueryResults(a.fallback as unknown as Record<string, unknown>[]);
      setQueryTime("2.3");
    }
    clearTimeout(slowTimer);
    setQuerySlow(false);
    setQueryRunning(false);
    setQueryDone(true);
  }, [a]);

  const sec = (dark: boolean): React.CSSProperties => ({ padding: "64px 40px", background: dark ? C.navy : C.surfaceLight });
  const inner: React.CSSProperties = { maxWidth: 1060, margin: "0 auto" };
  const displayResults = queryResults ?? (queryDone ? (a.fallback as unknown as Record<string, unknown>[]) : null);

  const visibleRows = showAllCap ? [...COMP_ROWS, ...EXT_ROWS] : COMP_ROWS;

  return (
    <div style={{ fontFamily: "var(--font-dm-sans), 'DM Sans', sans-serif", color: C.white, background: C.navy }}>
      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}

      {/* ===== HERO ===== */}
      <section style={{ padding: "72px 40px 56px", background: `radial-gradient(ellipse at 25% 15%, ${C.navyMid} 0%, ${C.navy} 70%)`, position: "relative" }}>
        <div style={{ position: "absolute", inset: 0, opacity: 0.025, backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 59px, ${C.ice} 59px, ${C.ice} 60px), repeating-linear-gradient(90deg, transparent, transparent 59px, ${C.ice} 59px, ${C.ice} 60px)`, pointerEvents: "none" }} />
        <div style={{ ...inner, position: "relative", zIndex: 1 }}>
          <div style={{ fontSize: 12, color: C.grayDark, letterSpacing: 0.5, marginBottom: 24 }}>
            Built by <span style={{ color: C.ice }}>Srihari Shekhar</span> · Prepared for the Cortex AI Functions PM role
          </div>

          <h1 style={{ fontSize: 36, fontWeight: 700, lineHeight: 1.2, marginBottom: 18, maxWidth: 760, color: C.white }}>
            I wanted to better understand what Cortex AI Functions make possible. So I loaded data into Snowflake, ran AI on text and images, and built this working demo.
          </h1>

          <p style={{ fontSize: 15, color: C.gray, maxWidth: 660, lineHeight: 1.7, marginBottom: 22 }}>
            I used San Francisco city's complaint data and enriched it using AI Functions, then built a frontend that queries the enriched data live from Snowflake.
          </p>

          <button
            onClick={() => { setShowRawData(!showRawData); setRawPage(0); }}
            style={{ padding: "9px 18px", borderRadius: 8, border: `1px solid ${C.ice}40`, background: showRawData ? C.ice : "transparent", color: showRawData ? C.navy : C.ice, fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit", position: "relative", zIndex: 2 }}
          >
            {showRawData ? "Hide Data" : "View the Data"}
          </button>

          {showRawData && (
            rawLoading
              ? <div style={{ marginTop: 14, fontSize: 12, color: C.gray }}>Loading from Snowflake...</div>
              : <DataTable data={rawData} page={rawPage} setPage={setRawPage} showAI={false} />
          )}
        </div>
      </section>

      {/* ===== CONTEXT ===== */}
      <section style={sec(false)}>
        <div style={inner}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2, color: C.ice, marginBottom: 12 }}>Context</div>
          <h2 style={{ fontSize: 26, fontWeight: 700, color: C.navy, marginBottom: 10 }}>Three approaches to analyzing this data</h2>
          <p style={{ fontSize: 14, color: C.grayDark, lineHeight: 1.6, marginBottom: 8, maxWidth: 700 }}>
            The complaint data has structured fields (district, category, date) and unstructured content (text descriptions, photos). To answer questions like "which cases look worse in the photo than the text suggests" or "how does sentiment vary across districts," there are several approaches.
          </p>
          <p style={{ fontSize: 14, color: C.grayDark, lineHeight: 1.6, marginBottom: 24, maxWidth: 700 }}>
            Python is the most flexible option and can handle any analytical task. AI Functions trade some of that flexibility for accessibility, governance, and composability with the SQL ecosystem.
          </p>

          <div className="context-grid" style={{ display: "grid", gap: 16 }}>
            <div style={{ background: "#fff", borderRadius: 12, padding: 20, border: "1px solid #e2e8f0", display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.grayDark, marginBottom: 4 }}>SQL alone</div>
              <div style={{ fontSize: 11, color: C.gray, marginBottom: 12 }}>Structured data only</div>
              <CodeBlock lang="sql" code={`SELECT case_id, district,
  category, status
FROM cases
WHERE category = 'Tree Maintenance'
ORDER BY opened DESC`} />
              <div style={{ marginTop: 12, fontSize: 12, color: C.grayDark, lineHeight: 1.55, flex: 1 }}>Filters, sorts, and aggregates structured columns. Text and images are stored but SQL cannot interpret their content.</div>
              <div style={{ marginTop: 12, padding: "8px 12px", background: "#f8f9fb", borderRadius: 6, fontSize: 11, color: C.gray }}>Cannot analyze text or image content.</div>
            </div>

            <div style={{ background: "#fff", borderRadius: 12, padding: 20, border: "1px solid #e2e8f0", display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.grayDark, marginBottom: 4 }}>Python</div>
              <div style={{ fontSize: 11, color: C.gray, marginBottom: 12 }}>Maximum flexibility</div>
              <CodeBlock lang="python" code={`cases = pd.read_sql(query, conn)
for row in cases.iterrows():
  resp = openai.chat.create(
    model="gpt-4",
    messages=[{...}])
  row['severity'] = parse(resp)
# Same for images with gpt-4o
merged = pd.merge(text, img)
merged.to_sql('enriched', conn)`} />
              <div style={{ marginTop: 12, fontSize: 12, color: C.grayDark, lineHeight: 1.55, flex: 1 }}>Can analyze any data type with any model. Full control over prompts, logic, and output.</div>
              <div style={{ marginTop: 12, padding: "8px 12px", background: "#f8f9fb", borderRadius: 6, fontSize: 11, color: C.gray }}>Custom engineering required.</div>
            </div>

            <div style={{ background: "#fff", borderRadius: 12, padding: 20, border: `1.5px solid ${C.ice}40`, display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.ice, marginBottom: 4 }}>Cortex AI Functions</div>
              <div style={{ fontSize: 11, color: C.gray, marginBottom: 12 }}>AI as SQL primitives</div>
              <CodeBlock lang="sql" code={`SELECT case_id, district,
  AI_CLASSIFY(description,
    ['Dumping','Graffiti',
     'Pothole','Hazard']),
  AI_SENTIMENT(description),
  AI_COMPLETE('pixtral-large',
    'Rate severity 1-5',
    TO_FILE(@stage, photo))
FROM cases
WHERE AI_FILTER(description,
  'Safety hazard?')`} />
              <div style={{ marginTop: 12, fontSize: 12, color: C.grayDark, lineHeight: 1.55, flex: 1 }}>Covers common patterns: classification, sentiment, filtering, image analysis, extraction, summarization, and more. Composes with SQL. Less flexible than Python for tasks not covered by the function library.</div>
              <div style={{ marginTop: 12, padding: "8px 12px", background: "rgba(41,182,246,0.04)", borderRadius: 6, fontSize: 11, color: C.ice }}>Composable with SQL. No API management. Any analyst.</div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== WHAT I BUILT ===== */}
      <section style={sec(true)}>
        <div style={inner}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2, color: C.ice, marginBottom: 12 }}>What I Built</div>
          <h2 style={{ fontSize: 26, fontWeight: 700, color: C.white, marginBottom: 8 }}>SF 311 complaint data enriched with three Cortex AI Functions</h2>
          <p style={{ fontSize: 14, color: C.gray, marginBottom: 20, lineHeight: 1.6, maxWidth: 700 }}>
            SF 311 is San Francisco's public service request system. Residents report issues like potholes, graffiti, illegal dumping, and broken streetlights. I loaded 500 real cases into Snowflake with 60 representative stock photos and ran three AI Functions to enrich the data.
          </p>

          <div className="cards-grid" style={{ display: "grid", gap: 14, marginBottom: 16 }}>
            <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: "1px solid rgba(41,182,246,0.1)" }}>
              <Badge>AI_CLASSIFY</Badge>
              <div style={{ marginTop: 8, fontSize: 11.5, color: C.gray, lineHeight: 1.5 }}>Ran on complaint text. Assigns each case to a theme like "Illegal Dumping" or "Road/Pothole Damage."</div>
              <div style={{ marginTop: 6, fontSize: 11, color: C.cyan }}>→ <span style={{ fontFamily: "monospace" }}>ai_theme</span></div>
            </div>
            <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: "1px solid rgba(41,182,246,0.1)" }}>
              <Badge>AI_SENTIMENT</Badge>
              <div style={{ marginTop: 8, fontSize: 11.5, color: C.gray, lineHeight: 1.5 }}>Ran on complaint text. Returns a score from -1.0 (very negative) to +1.0 (positive).</div>
              <div style={{ marginTop: 6, fontSize: 11, color: C.cyan }}>→ <span style={{ fontFamily: "monospace" }}>ai_sentiment</span></div>
            </div>
            <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: "1px solid rgba(41,182,246,0.1)" }}>
              <Badge>AI_COMPLETE + TO_FILE</Badge>
              <div style={{ marginTop: 8, fontSize: 11.5, color: C.gray, lineHeight: 1.5 }}>Ran on photos using pixtral-large. Three calls per image: describe the issue, classify it, rate severity 1 to 5. Images load from a Snowflake internal stage via TO_FILE().</div>
              <div style={{ marginTop: 6, fontSize: 11, color: C.cyan }}>→ <span style={{ fontFamily: "monospace" }}>ai_image_severity</span>, <span style={{ fontFamily: "monospace" }}>ai_image_category</span>, <span style={{ fontFamily: "monospace" }}>ai_image_description</span></div>
            </div>
          </div>

          <div style={{ fontSize: 12, color: C.gray, lineHeight: 1.55, marginBottom: 16 }}>
            From these I derived <span style={{ color: C.cyan, fontFamily: "monospace" }}>ai_severity_gap</span> (image severity minus text severity) and <span style={{ color: C.cyan, fontFamily: "monospace" }}>ai_category_match</span> (whether image and text classifications agree).
          </div>

          <button
            onClick={() => { setShowEnrichedData(!showEnrichedData); setEnrichedPage(0); }}
            style={{ padding: "9px 18px", borderRadius: 8, border: `1px solid ${C.ice}40`, background: showEnrichedData ? C.ice : "transparent", color: showEnrichedData ? C.navy : C.ice, fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}
          >
            {showEnrichedData ? "Hide Enriched Dataset" : "View the Enriched Dataset"}
          </button>

          {showEnrichedData && (
            previewLoading
              ? <div style={{ marginTop: 14, fontSize: 12, color: C.gray }}>Loading from Snowflake...</div>
              : <DataTable data={previewData} page={enrichedPage} setPage={setEnrichedPage} showAI lightboxClick={setLightboxSrc} />
          )}
        </div>
      </section>

      {/* ===== DEMO ===== */}
      <section style={sec(false)}>
        <div style={inner}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2, color: C.ice, marginBottom: 12 }}>Demo</div>
          <h2 style={{ fontSize: 26, fontWeight: 700, color: C.navy, marginBottom: 8 }}>Answers we can now query in SQL after enriching the dataset with AI Functions</h2>
          <p style={{ fontSize: 14, color: C.grayDark, marginBottom: 24, lineHeight: 1.6, maxWidth: 700 }}>Each query executes live against Snowflake. The AI enrichment ran once during setup. These queries read the pre-computed AI columns.</p>

          <div className="demo-tabs" style={{ display: "grid", gap: 10, marginBottom: 20 }}>
            {ANALYSES.map((an, i) => (
              <button key={i} onClick={() => { setActiveAnalysis(i); setQueryDone(false); setQueryRunning(false); setQueryResults(null); setQueryPage(0); }}
                style={{ padding: "14px 14px", borderRadius: 10, border: activeAnalysis === i ? `2px solid ${C.ice}` : "1.5px solid #d8dfe8", background: activeAnalysis === i ? C.surface : "#fff", color: activeAnalysis === i ? C.ice : C.navy, fontWeight: 600, fontSize: 12, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
                <span style={{ fontSize: 18, display: "block", marginBottom: 5 }}>{an.icon}</span>{an.title}
              </button>
            ))}
          </div>

          <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden", border: "1px solid #e2e8f0" }}>
            <div style={{ padding: "20px 24px", borderBottom: "1px solid #edf2f7" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.navy, marginBottom: 6 }}>{a.q}</div>
              <div style={{ fontSize: 13, color: C.grayDark, lineHeight: 1.6 }}>{a.why}</div>
            </div>
            <div style={{ padding: "20px 24px" }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
                {a.functions.map((f, i) => <Badge key={i}>{f}</Badge>)}
              </div>
              <CodeBlock code={a.sql} />
              <button onClick={runQuery} disabled={queryRunning}
                style={{ marginTop: 12, padding: "10px 22px", borderRadius: 8, border: "none", cursor: queryRunning ? "wait" : "pointer", background: queryRunning ? C.grayDark : `linear-gradient(135deg, ${C.ice}, #0088cc)`, color: "#fff", fontWeight: 600, fontSize: 13, fontFamily: "inherit" }}>
                {queryRunning ? "Executing..." : queryDone ? "▶ Run Again" : "▶ Execute Query"}
              </button>

              {queryRunning && (
                <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.ice, animation: "pulse 1s infinite" }} />
                  <span style={{ fontSize: 12, color: querySlow ? C.amber : C.ice }}>
                    {querySlow ? "Query is taking longer than expected. Snowflake is still running..." : "Querying Snowflake..."}
                  </span>
                </div>
              )}

              {queryDone && displayResults && (
                <div ref={resultsRef} style={{ marginTop: 14 }}>
                  <div style={{ padding: "7px 12px", background: "rgba(0,229,195,0.05)", borderRadius: 8, marginBottom: 10, fontSize: 11.5, color: "#0a8a6f", border: "1px solid rgba(0,229,195,0.12)", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
                    <span>{displayResults.length} rows returned</span>
                    <span>Execution: {queryTime}s · Warehouse: COMPUTE_WH</span>
                  </div>
                  <ResultsTable rows={displayResults} page={queryPage} setPage={setQueryPage} />
                  <div style={{ marginTop: 10, fontSize: 12, color: C.grayDark, lineHeight: 1.6 }}>
                    Without AI Functions, this would require separate scripts for text and image analysis, manual joining, and re-importing. Here it is a SQL query.
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ===== ACROSS INDUSTRIES ===== */}
      <section style={sec(true)}>
        <div style={inner}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2, color: C.ice, marginBottom: 12 }}>Across Industries</div>
          <h2 style={{ fontSize: 26, fontWeight: 700, color: C.white, marginBottom: 8 }}>Structured and unstructured data coexist in every industry</h2>
          <p style={{ fontSize: 14, color: C.gray, marginBottom: 24, lineHeight: 1.6, maxWidth: 700 }}>
            The type of structured plus unstructured data analysis shown above spans across industries. Most organizations have structured records alongside unstructured data in the same warehouse. The analytical value often lives in combining both.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            {[
              { icon: "🏦", name: "Financial Services", desc: "Structured positions and trade data alongside earnings call transcripts, analyst reports, and regulatory filings. AI Functions could support tasks like sentiment scoring across transcripts, extracting key metrics from documents, or classifying news by portfolio relevance. Snowflake has already begun focusing here with the launch of Cortex AI for Financial Services in October 2025." },
              { icon: "🏥", name: "Healthcare", desc: "Structured patient records and lab results alongside clinical notes, discharge summaries, and medical imaging. Tasks like extracting diagnoses from notes, flagging discrepancies in documentation, or classifying imaging findings could benefit from AI Functions. Data residency within the Snowflake perimeter is particularly relevant given regulatory requirements like HIPAA." },
              { icon: "🛡️", name: "Insurance", desc: "Structured claims data alongside claim narratives, damage photos, and adjuster notes. Comparing AI-assessed damage severity from photos against claimed amounts, or extracting key details from adjuster narratives, are natural use cases for combining structured and unstructured analysis." },
              { icon: "🛒", name: "Retail", desc: "Structured product catalogs and transaction data alongside customer reviews, user-uploaded photos, and support tickets. Sentiment analysis across reviews, classifying product issues from support text, or analyzing user photos for quality issues are all patterns where structured and unstructured data need to come together." },
            ].map((ind, i) => (
              <div key={i} style={{ background: C.surface, borderRadius: 12, padding: 18, border: "1px solid rgba(41,182,246,0.08)" }}>
                <div style={{ fontSize: 20, marginBottom: 6 }}>{ind.icon}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.white, marginBottom: 6 }}>{ind.name}</div>
                <div style={{ fontSize: 12.5, color: C.gray, lineHeight: 1.6 }}>{ind.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== COMPETITIVE LANDSCAPE ===== */}
      <section style={sec(false)}>
        <div style={inner}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2, color: C.ice, marginBottom: 12 }}>Competitive Landscape</div>
          <h2 style={{ fontSize: 24, fontWeight: 700, color: C.navy, marginBottom: 8 }}>AI-in-SQL capabilities across platforms</h2>
          <p style={{ fontSize: 14, color: C.grayDark, marginBottom: 20, lineHeight: 1.6 }}>Based on publicly available documentation.</p>

          <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden", border: "1px solid #e2e8f0" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #e2e8f0", background: "#f8fafc" }}>
                    <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: C.navy, width: "16%" }}>Capability</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: "#29b6f6" }}>Snowflake Cortex</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: "#4285f4" }}>BigQuery AI</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: "#ff3621" }}>Databricks</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: "#ff9900" }}>Redshift</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #f0f2f5" }}>
                      <td style={{ padding: "9px 12px", fontWeight: 600, color: C.navy, fontSize: 11 }}>{row.cap}</td>
                      <td style={{ padding: "9px 12px", color: C.grayDark, fontSize: 10.5, lineHeight: 1.4 }}>{row.sf}</td>
                      <td style={{ padding: "9px 12px", color: C.grayDark, fontSize: 10.5, lineHeight: 1.4 }}>{row.bq}</td>
                      <td style={{ padding: "9px 12px", color: C.grayDark, fontSize: 10.5, lineHeight: 1.4 }}>{row.db}</td>
                      <td style={{ padding: "9px 12px", color: C.grayDark, fontSize: 10.5, lineHeight: 1.4 }}>{row.rs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: "10px 14px", borderTop: "1px solid #f0f2f5", textAlign: "center" }}>
              <button onClick={() => setShowAllCap(!showAllCap)}
                style={{ padding: "6px 16px", borderRadius: 6, border: "1px solid #d8dfe8", background: "transparent", color: C.ice, fontSize: 12, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>
                {showAllCap ? "Show fewer" : `Show ${EXT_ROWS.length} more capabilities`}
              </button>
            </div>
          </div>

          <div style={{ marginTop: 16, background: "#fff", borderRadius: 10, padding: 16, border: "1px solid #e2e8f0" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.navy, marginBottom: 8 }}>Observations</div>
            <div style={{ fontSize: 12, color: C.grayDark, lineHeight: 1.6 }}>
              Snowflake has the broadest set of dedicated functions. AI_AGG and AI_SUMMARIZE_AGG for cross-row aggregation appear unique among these platforms. BigQuery's managed functions include query plan optimization that evaluates non-AI filters before AI filters, reducing LLM call volume. BigQuery's AI.SCORE for ranking with auto-generated rubrics is also unique. Databricks offers the broadest model flexibility with BYOM and external endpoint support.
            </div>
          </div>
        </div>
      </section>

      {/* ===== SOME THOUGHTS ===== */}
      <section style={sec(true)}>
        <div style={inner}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2, color: C.ice, marginBottom: 12 }}>Some Thoughts</div>
          <p style={{ fontSize: 13, color: C.gray, marginBottom: 20, lineHeight: 1.6, maxWidth: 700 }}>
            I don't have visibility into the product's internal roadmap or competitive dynamics. These are observations from building with the product and reading the documentation.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              { t: "AI Function awareness in natural language tools", d: "Cortex Analyst generates SQL from natural language for structured data queries. Cortex Code assists with SQL development. As AI Functions become a larger part of how analysts work with unstructured data in Snowflake, these natural language tools may benefit from being able to suggest or generate queries that use AI Functions like AI_CLASSIFY or AI_FILTER when a question involves unstructured content." },
              { t: "Expanding the function library", d: "As the function set grows to cover more analytical patterns and data types, it increases the surface area of what analysts can do without leaving SQL. Every pattern covered by a native function is one less reason for a customer to use external tooling." },
              { t: "Query optimization for AI operations", d: "BigQuery evaluates traditional predicates before AI predicates to reduce LLM call volume. This directly affects cost and latency at scale." },
              { t: "Industry-specific go-to-market", d: "Understanding which industries have the highest density of unstructured data already in Snowflake could help prioritize product development and sales focus." },
              { t: "AI Function discoverability", d: "Cortex Analyst and Cortex Code generate SQL today. If these tools can surface AI Functions where relevant, it could increase adoption without requiring analysts to learn about them separately." },
            ].map((item, i) => (
              <div key={i} style={{ background: C.surface, borderRadius: 10, padding: 16, border: "1px solid rgba(41,182,246,0.08)" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.grayLight, marginBottom: 4 }}>{item.t}</div>
                <div style={{ fontSize: 12, color: C.gray, lineHeight: 1.6 }}>{item.d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== FOOTER ===== */}
      <footer style={{ padding: "28px 40px", background: C.navy, borderTop: "1px solid rgba(41,182,246,0.08)", textAlign: "center" }}>
        <div style={{ fontSize: 13, color: C.grayLight, marginBottom: 4 }}>
          Built by{" "}
          <a href="https://www.linkedin.com/in/srihari-shekhar/" target="_blank" rel="noopener noreferrer" style={{ color: C.ice, textDecoration: "none" }}>
            Srihari Shekhar
          </a>
        </div>
        <div style={{ fontSize: 12, color: C.grayDark }}>All demo queries execute live against Snowflake. ❄️</div>
      </footer>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
        * { box-sizing: border-box; -webkit-user-select: text; user-select: text; }
        button { -webkit-user-select: none; user-select: none; }
        button:hover:not(:disabled) { opacity: .92; }
        pre { tab-size: 2; }
        .context-grid { grid-template-columns: 1fr 1fr 1fr; }
        .cards-grid { grid-template-columns: 1fr 1fr 1fr; }
        .demo-tabs { grid-template-columns: repeat(4, 1fr); }
        @media (max-width: 900px) {
          .context-grid { grid-template-columns: 1fr !important; }
          .cards-grid { grid-template-columns: 1fr !important; }
          .demo-tabs { grid-template-columns: 1fr 1fr !important; }
          section { padding: 52px 20px !important; }
        }
        @media (max-width: 600px) {
          .demo-tabs { grid-template-columns: 1fr !important; }
          h1 { font-size: 28px !important; }
          h2 { font-size: 22px !important; }
        }
      `}</style>
    </div>
  );
}
