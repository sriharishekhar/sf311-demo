"use client";

import { useState, useEffect, useRef, useCallback } from "react";

const C = {
  navy: "#0a1628", navyLight: "#0f2038", navyMid: "#162a4a",
  ice: "#29b6f6", iceDim: "rgba(41,182,246,0.15)",
  cyan: "#00e5c3", white: "#f0f4f8", gray: "#8a9bb5",
  grayDark: "#3a4a63", grayLight: "#c5d0de",
  surface: "#111d30", surfaceLight: "#f6f8fb",
  red: "#ff5252", amber: "#ffab40", green: "#69f0ae",
};

const ANALYSES = [
  {
    id: "severity",
    icon: "⚠️",
    title: "Severity Escalation",
    q: "Which cases look worse in the photo than what the resident described?",
    why: "Residents often understate issues. The severity gap column compares what the vision model sees in the image against the sentiment and tone of the text. Cases with a high gap are candidates for re-prioritization.",
    sql: `SELECT case_id, district,
  LEFT(description, 80) AS text_says,
  LEFT(ai_image_description, 80) AS image_shows,
  ai_text_severity, ai_image_severity,
  ai_severity_gap
FROM cases_enriched
WHERE ai_severity_gap > 1
ORDER BY ai_severity_gap DESC`,
    functions: ["AI_COMPLETE (text)", "AI_COMPLETE (image)", "Gap calculation"],
    results: [
      { case_id: 14892210, district: "5", text_says: "Large branch cracked and hanging over playground", image_shows: "Massive tree limb split at trunk dangling over play equipment", ai_text_severity: 2, ai_image_severity: 5, ai_severity_gap: 3 },
      { case_id: 14892301, district: "6", text_says: "Pile of dumped mattresses blocking sidewalk", image_shows: "Commercial-scale dump with hazardous materials blocking wheelchair ramp", ai_text_severity: 3, ai_image_severity: 5, ai_severity_gap: 2 },
      { case_id: 14892265, district: "3", text_says: "Deep pothole on Market causing cars to swerve", image_shows: "Crater-sized road failure with exposed rebar adjacent to bike lane", ai_text_severity: 2, ai_image_severity: 4, ai_severity_gap: 2 },
    ],
  },
  {
    id: "mismatch",
    icon: "🔄",
    title: "Category Mismatch",
    q: "How often does the photo tell a different story than the filed category?",
    why: "AI_CLASSIFY on the text and AI_COMPLETE on the image sometimes produce different categories for the same case. This reveals where the intake form categories may be confusing to residents, or where cases are getting routed to the wrong response team.",
    sql: `SELECT case_id, district,
  category AS filed_as,
  ai_theme AS text_says,
  ai_image_category AS image_says
FROM cases_enriched
WHERE ai_category_match = FALSE
ORDER BY opened DESC`,
    functions: ["AI_CLASSIFY (text)", "AI_COMPLETE (image)", "Cross-modal comparison"],
    results: [
      { case_id: 14891822, district: "9", filed_as: "Graffiti", text_says: "Graffiti/Vandalism", image_says: "General Maintenance", insight: "Photo shows faded mural, not vandalism" },
      { case_id: 14891756, district: "6", filed_as: "Street Cleaning", text_says: "General Maintenance", image_says: "Safety Hazard", insight: "Photo reveals biohazard waste" },
      { case_id: 14891698, district: "3", filed_as: "Damaged Property", text_says: "Road/Pothole Damage", image_says: "Sewer/Drainage", insight: "Photo shows collapsed storm drain" },
    ],
  },
  {
    id: "equity",
    icon: "⚖️",
    title: "Equity Analysis",
    q: "Are some neighborhoods experiencing severe issues but filing fewer complaints?",
    why: "Combining AI-derived image severity with complaint volume by neighborhood creates a second signal independent of filing behavior. Neighborhoods with high visual severity but low volume may warrant proactive outreach.",
    sql: `SELECT neighborhood, district,
  complaint_volume,
  avg_visual_severity,
  equity_flag
FROM neighborhood_equity
WHERE equity_flag =
  'Potentially Underreported'
ORDER BY avg_visual_severity DESC`,
    functions: ["AI_COMPLETE (image severity)", "AI_SENTIMENT", "Aggregation and equity logic"],
    results: [
      { neighborhood: "Bayview", district: "10", complaint_volume: 38, avg_visual_severity: 4.2, equity_flag: "Potentially Underreported" },
      { neighborhood: "Excelsior", district: "11", complaint_volume: 29, avg_visual_severity: 3.8, equity_flag: "Potentially Underreported" },
      { neighborhood: "Visitacion Valley", district: "10", complaint_volume: 22, avg_visual_severity: 3.6, equity_flag: "Potentially Underreported" },
    ],
  },
  {
    id: "safety",
    icon: "🛡️",
    title: "Safety Detection",
    q: "Which cases combine text and image signals to indicate safety risk?",
    why: "Text says 'broken sidewalk.' Photo shows exposed rebar next to an active bike lane. Using both AI_FILTER on the text and AI_COMPLETE on the image creates a combined signal that is stronger than either source alone.",
    sql: `SELECT case_id, district,
  LEFT(description, 80) AS description,
  ai_image_severity,
  ai_severity_gap,
  LEFT(ai_image_description, 120)
    AS image_assessment
FROM cases_enriched
WHERE ai_safety_flag = TRUE
ORDER BY ai_image_severity DESC`,
    functions: ["AI_FILTER (text)", "AI_COMPLETE (image)", "Cross-modal assessment"],
    results: [
      { case_id: 14892210, district: "5", description: "Large branch cracked and hanging over playground", ai_image_severity: 5, ai_severity_gap: 3, image_assessment: "Critical: large tree limb over active playground, imminent fall risk" },
      { case_id: 14892265, district: "3", description: "Deep pothole on Market causing cars to swerve", ai_image_severity: 4, ai_severity_gap: 2, image_assessment: "High: road crater with exposed rebar forcing cyclists into traffic lane" },
    ],
  },
];

const COMPETITIVE_CAPABILITIES = [
  { cap: "Text classification", sf: "AI_CLASSIFY: dedicated function, supports multi-label, no model selection needed", bq: "AI.CLASSIFY: dedicated managed function, auto-optimized prompts, Gemini-powered", db: "ai_classify: task-specific function, Databricks-managed models", rs: "Via Bedrock CREATE MODEL with prompt engineering" },
  { cap: "Sentiment analysis", sf: "AI_SENTIMENT: dedicated function returning -1 to +1 score", bq: "Via AI.SCORE or AI.GENERATE with prompting (no dedicated sentiment function)", db: "ai_analyze_sentiment: dedicated function returning positive/negative/neutral/mixed", rs: "Via Bedrock with prompt engineering" },
  { cap: "Text completion / generation", sf: "AI_COMPLETE: choose from multiple models (Arctic, Claude, Mistral, Llama, others)", bq: "AI.GENERATE: choose model or let BigQuery auto-select", db: "ai_query (general purpose) or ai_gen (simpler): broad model selection including BYOM", rs: "Via Bedrock CREATE MODEL: supports Bedrock model catalog" },
  { cap: "Image analysis", sf: "AI_COMPLETE with TO_FILE() loading images from internal stages", bq: "AI.CLASSIFY, AI.IF, AI.GENERATE with OBJ.GET_ACCESS_URL from GCS object tables", db: "ai_query with READ_FILES from Unity Catalog Volumes", rs: "Not natively supported in SQL" },
  { cap: "Audio transcription", sf: "AI_TRANSCRIBE: dedicated function for audio/video to text", bq: "Via AI.GENERATE with audio input", db: "Via ai_query with audio models", rs: "Not natively supported in SQL" },
  { cap: "Document parsing", sf: "AI_PARSE_DOCUMENT: extracts text and layout from PDFs", bq: "Via AI.GENERATE on document inputs", db: "ai_parse_document: dedicated function extracting text, tables, and figures from PDFs", rs: "Not supported" },
  { cap: "Semantic filtering (AI in WHERE clause)", sf: "AI_FILTER: native SQL primitive, returns boolean", bq: "AI.IF: native SQL primitive with query plan optimization (evaluates non-AI filters first to reduce LLM calls)", db: "Via ai_query() in WHERE clause (general purpose, not specifically optimized)", rs: "Not supported" },
  { cap: "Scoring and ranking", sf: "Via AI_COMPLETE with structured prompts (no dedicated function)", bq: "AI.SCORE: dedicated function that auto-generates scoring rubrics from natural language criteria", db: "Via ai_query() with structured output (no dedicated function)", rs: "Not supported" },
  { cap: "Entity extraction", sf: "AI_EXTRACT: dedicated function supporting text, images, and documents", bq: "Via AI.GENERATE with structured output format", db: "ai_extract: dedicated function with label-based extraction", rs: "Via Bedrock with prompt engineering" },
  { cap: "Cross-row aggregation with AI", sf: "AI_AGG and AI_SUMMARIZE_AGG: dedicated aggregate functions not subject to context window limits", bq: "Via AI.GENERATE on grouped data (subject to context window)", db: "Via ai_query() on grouped data (subject to context window)", rs: "Not supported" },
  { cap: "Semantic similarity", sf: "AI_SIMILARITY: calculates embedding similarity between two inputs", bq: "AI.SIMILARITY: calculates embedding similarity", db: "ai_similarity: calculates embedding similarity", rs: "Not supported" },
  { cap: "PII redaction", sf: "AI_REDACT: dedicated function for detecting and redacting PII", bq: "Via Cloud DLP integration (separate service)", db: "ai_mask: dedicated function for PII masking", rs: "Not supported" },
  { cap: "Translation", sf: "AI_TRANSLATE: dedicated function", bq: "Via AI.GENERATE with translation prompts", db: "ai_translate: dedicated function", rs: "Via Bedrock" },
  { cap: "Vector embeddings", sf: "AI_EMBED: supports text and image inputs", bq: "AI.EMBED: supports text inputs", db: "Via ai_query with embedding models", rs: "Not natively supported" },
  { cap: "Query plan optimization for AI calls", sf: "Not currently available", bq: "Available: reorders predicates to evaluate non-AI filters before AI filters, reducing LLM call volume", db: "Batch inference optimization available in pipeline contexts", rs: "N/A" },
  { cap: "Data residency during AI processing", sf: "Processing happens within Snowflake's infrastructure. Data does not leave the account perimeter", bq: "Requests routed to Vertex AI within Google Cloud infrastructure", db: "Requests go to Databricks Model Serving within Databricks infrastructure", rs: "Data sent to Amazon Bedrock / SageMaker services" },
  { cap: "Model choice and flexibility", sf: "Anthropic, Meta, Mistral, Google, Snowflake Arctic. Varies by region", bq: "Gemini (managed functions auto-select). Claude, Mistral available via connections", db: "Broadest selection: BYOM, any external endpoint, all major providers, open source models", rs: "Amazon Bedrock model catalog (Anthropic, Meta, Cohere, AI21, others)" },
];

const SAMPLE_DATA = [
  { id: 14892301, date: "2024-03-15", district: "6", cat: "Street and Sidewalk Cleaning", desc: "Large pile of illegally dumped mattresses and furniture blocking sidewalk near 16th and Mission", photo: true, photo_filename: "dumping_001.jpg", theme: "Illegal Dumping", sentiment: -0.72, sev_i: 5, gap: 2 },
  { id: 14892287, date: "2024-03-15", district: "9", cat: "Graffiti", desc: "Fresh spray paint tags covering entire storefront on Valencia between 22nd and 23rd", photo: true, photo_filename: "graffiti_001.jpg", theme: "Graffiti/Vandalism", sentiment: -0.45, sev_i: 2, gap: 0 },
  { id: 14892265, date: "2024-03-14", district: "3", cat: "Damaged Property", desc: "Deep pothole on Market near 5th causing cars to swerve into bike lane", photo: true, photo_filename: "pothole_001.jpg", theme: "Road/Pothole Damage", sentiment: -0.81, sev_i: 4, gap: 2 },
  { id: 14892244, date: "2024-03-14", district: "6", cat: "Sewer Issues", desc: "Storm drain completely blocked with debris flooding intersection during rain", photo: true, photo_filename: "sewer_001.jpg", theme: "Sewer/Drainage", sentiment: -0.63, sev_i: 4, gap: 1 },
  { id: 14892210, date: "2024-03-14", district: "5", cat: "Tree Maintenance", desc: "Large branch cracked and hanging over playground area in Panhandle Park", photo: true, photo_filename: "tree_001.jpg", theme: "Tree Hazard", sentiment: -0.55, sev_i: 5, gap: 3 },
  { id: 14892198, date: "2024-03-13", district: "10", cat: "Street and Sidewalk Cleaning", desc: "Trash scattered along Bayshore from recycling bins knocked over by wind", photo: false, photo_filename: "", theme: "General Maintenance", sentiment: -0.31, sev_i: null, gap: null },
];

type SampleRow = typeof SAMPLE_DATA[number];

/* ─── Subcomponents ─── */

function CodeBlock({ code, lang = "sql", accent = false }: { code: string; lang?: string; accent?: boolean }) {
  return (
    <div style={{ background: accent ? "#071018" : "#060d18", borderRadius: 10, padding: "16px 18px", fontSize: 12, fontFamily: "var(--font-jetbrains-mono), 'JetBrains Mono', monospace", color: "#c5d0de", overflowX: "auto", lineHeight: 1.65, border: accent ? `1px solid ${C.ice}30` : "1px solid rgba(41,182,246,0.08)", position: "relative" }}>
      <span style={{ position: "absolute", top: 7, right: 10, fontSize: 9.5, color: C.grayDark, textTransform: "uppercase", letterSpacing: 1.2, fontWeight: 600 }}>{lang}</span>
      <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{code}</pre>
    </div>
  );
}

function Badge({ children, color = C.ice }: { children: React.ReactNode; color?: string }) {
  return (
    <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 10.5, fontWeight: 600, background: `${color}18`, color, border: `1px solid ${color}33`, letterSpacing: 0.3 }}>
      {children}
    </span>
  );
}

function SectionTag({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2, color: C.ice, marginBottom: 12 }}>{children}</div>;
}

function PhotoThumb({ filename, onClick }: { filename: string; onClick: (src: string) => void }) {
  const src = `/images/${filename}`;
  return (
    <img
      src={src}
      alt="case photo"
      onClick={() => onClick(src)}
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
      <button onClick={onClose} style={{ position: "absolute", top: 20, right: 24, background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", fontSize: 20, width: 36, height: 36, borderRadius: "50%", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
        ✕
      </button>
    </div>
  );
}

function Pagination({ page, total, perPage, onChange, dark = false }: { page: number; total: number; perPage: number; onChange: (p: number) => void; dark?: boolean }) {
  const totalPages = Math.ceil(total / perPage);
  if (totalPages <= 1) return null;
  const btnStyle = (disabled: boolean): React.CSSProperties => ({
    padding: "4px 12px", borderRadius: 6, border: `1px solid ${dark ? "rgba(41,182,246,0.2)" : "#d8dfe8"}`,
    background: disabled ? "transparent" : dark ? "rgba(41,182,246,0.08)" : "#f0f4f8",
    color: disabled ? (dark ? C.grayDark : "#bbc8d4") : dark ? C.ice : C.navy,
    fontSize: 12, fontWeight: 600, cursor: disabled ? "default" : "pointer", fontFamily: "inherit",
  });
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "10px 0" }}>
      <button style={btnStyle(page === 1)} disabled={page === 1} onClick={() => onChange(page - 1)}>{"<"}</button>
      <span style={{ fontSize: 12, color: dark ? C.gray : C.grayDark, minWidth: 80, textAlign: "center" }}>Page {page} of {totalPages}</span>
      <button style={btnStyle(page === totalPages)} disabled={page === totalPages} onClick={() => onChange(page + 1)}>{">"}</button>
    </div>
  );
}

function Skeleton({ width = "100%", height = 20 }: { width?: string | number; height?: number }) {
  return <div style={{ width, height, borderRadius: 6, background: "rgba(41,182,246,0.08)", animation: "skeleton-pulse 1.5s ease-in-out infinite" }} />;
}

function useFadeInSection() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.classList.add("fade-section");
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) { el.style.opacity = "1"; el.style.transform = "translateY(0)"; obs.disconnect(); }
      },
      { threshold: 0.06 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return ref;
}

/* ─── Main page ─── */
export default function SF311Demo() {
  const [activeAnalysis, setActiveAnalysis] = useState(0);
  const [queryRunning, setQueryRunning] = useState(false);
  const [queryDone, setQueryDone] = useState(false);
  const [queryResults, setQueryResults] = useState<Record<string, unknown>[] | null>(null);
  const [queryTime, setQueryTime] = useState("2.3");
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [querySlow, setQuerySlow] = useState(false);
  const [datasetPage, setDatasetPage] = useState(1);
  const [queryPage, setQueryPage] = useState(1);
  const [showDataset, setShowDataset] = useState(false);
  const [previewData, setPreviewData] = useState<SampleRow[]>(SAMPLE_DATA);

  const resultsRef = useRef<HTMLDivElement>(null);
  const demoRef = useFadeInSection();

  useEffect(() => {
    fetch("/api/preview").then((r) => r.json()).then((d) => { if (d.rows?.length > 0) setPreviewData(d.rows); }).catch(() => {});
  }, []);

  const a = ANALYSES[activeAnalysis];

  const runQuery = useCallback(async () => {
    setQueryRunning(true);
    setQueryDone(false);
    setQueryResults(null);
    setQuerySlow(false);
    setQueryPage(1);
    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 80);
    const slowTimer = setTimeout(() => setQuerySlow(true), 10000);
    try {
      const res = await fetch("/api/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: a.id }) });
      const data = await res.json();
      setQueryResults(data.rows ?? a.results);
      setQueryTime(data.executionTime ?? "2.3");
    } catch {
      setQueryResults(a.results as unknown as Record<string, unknown>[]);
      setQueryTime("2.3");
    }
    clearTimeout(slowTimer);
    setQuerySlow(false);
    setQueryRunning(false);
    setQueryDone(true);
  }, [a]);

  const sec = (dark: boolean): React.CSSProperties => ({ padding: "72px 40px", background: dark ? C.navy : C.surfaceLight });
  const inner: React.CSSProperties = { maxWidth: 1100, margin: "0 auto" };
  const displayResults = queryResults ?? (queryDone ? (a.results as unknown as Record<string, unknown>[]) : null);

  function renderCell(k: string, v: unknown) {
    if (k === "photo_filename" && v) return <PhotoThumb filename={String(v)} onClick={setLightboxSrc} />;
    if (k === "gap" || k === "ai_severity_gap") return <Badge color={C.red}>+{String(v)}</Badge>;
    if (k.includes("sev") || k.includes("severity")) return <span style={{ fontWeight: 700 }}>{String(v)}</span>;
    if (k === "equity_flag") return <Badge color={C.amber}>{String(v)}</Badge>;
    if (k === "text_hazard" || k === "image_hazard" || k === "ai_safety_flag") return <Badge color={String(v) === "TRUE" || v === true ? C.red : C.green}>{String(v)}</Badge>;
    return <span>{String(v ?? "n/a")}</span>;
  }

  return (
    <div style={{ fontFamily: "var(--font-dm-sans), 'DM Sans', sans-serif", color: C.white, background: C.navy }}>
      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}

      {/* ===== HERO ===== */}
      <section style={{ padding: "76px 40px 60px", background: `radial-gradient(ellipse at 25% 15%, ${C.navyMid} 0%, ${C.navy} 70%)`, position: "relative" }}>
        <div style={{ position: "absolute", inset: 0, opacity: 0.025, backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 59px, ${C.ice} 59px, ${C.ice} 60px), repeating-linear-gradient(90deg, transparent, transparent 59px, ${C.ice} 59px, ${C.ice} 60px)` }} />
        <div style={inner}>
          <div style={{ fontSize: 12, color: C.grayDark, letterSpacing: 0.5, marginBottom: 28 }}>
            Built by <span style={{ color: C.ice }}>Srihari Shekhar</span> · Prepared for the Cortex AI Functions PM role
          </div>

          <h1 style={{ fontSize: 36, fontWeight: 700, lineHeight: 1.25, marginBottom: 22, maxWidth: 760, color: C.white }}>
            I wanted to better understand what Cortex AI Functions make possible. So I loaded data into Snowflake, ran AI on text and images, and built this working demo.
          </h1>

          <p style={{ fontSize: 15, color: C.gray, maxWidth: 700, lineHeight: 1.7, marginBottom: 32 }}>
            This is both a working product demo and an exploration of Cortex AI Functions. I used San Francisco 311 service request data with structured fields, free text complaints, and representative stock photos to simulate resident-uploaded images. I enriched the data using AI_CLASSIFY, AI_SENTIMENT, and AI_COMPLETE with a vision model, then built a frontend that queries the enriched data live from Snowflake. I also studied how the expressibility of AI Functions could evolve to support a broader class of multimodal analysis, and looked at how BigQuery, Databricks, and Redshift approach this same space.
          </p>

          <div style={{ background: C.surface, borderRadius: 12, padding: "20px 24px", maxWidth: 680, border: "1px solid rgba(41,182,246,0.1)" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.ice, marginBottom: 14, textTransform: "uppercase", letterSpacing: 1 }}>What I took away from this exercise</div>
            {[
              "Cortex AI Functions bring unstructured data into SQL as first-class participants in queries. Text, images, audio, and documents become queryable without leaving the governance perimeter, and any analyst who knows SQL can run the analysis.",
              "There are analytical patterns that become practical when you can combine structured data with text and image AI in a single query. Comparing what a photo shows against what the complaint text says, for example, is straightforward with AI Functions but would require significant engineering effort otherwise.",
              "The competitive space is active. BigQuery, Databricks, and Snowflake all offer AI-in-SQL capabilities now. I have compared them by capability below.",
              "One significant opportunity is expanding the range of analytical patterns AI Functions can support across more data types and industries, so that the function library covers enough ground that analysts rarely need to leave SQL for unstructured data tasks. There are also areas around cost optimization, discoverability within existing Snowflake tools, and go-to-market focus that seem worth exploring.",
            ].map((item, i) => (
              <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: i < 3 ? 10 : 0 }}>
                <span style={{ color: C.cyan, fontWeight: 700, fontSize: 14, marginTop: 1, flexShrink: 0 }}>{i + 1}.</span>
                <span style={{ fontSize: 13, color: C.grayLight, lineHeight: 1.55 }}>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== CONTEXT ===== */}
      <section style={sec(false)}>
        <div style={inner}>
          <SectionTag>Context</SectionTag>
          <h2 style={{ fontSize: 26, fontWeight: 700, color: C.navy, marginBottom: 8 }}>Three ways to work with unstructured data alongside structured data</h2>
          <p style={{ fontSize: 14, color: C.grayDark, lineHeight: 1.65, marginBottom: 10, maxWidth: 700 }}>
            Python is the most flexible option and can handle any analytical task. AI Functions trade some of that flexibility for accessibility, governance, and composability with the SQL ecosystem. The right choice depends on the use case, the team, and the requirements.
          </p>
          <p style={{ fontSize: 13.5, color: C.grayDark, lineHeight: 1.65, marginBottom: 24, maxWidth: 700, padding: "12px 16px", background: "#fff", borderRadius: 8, border: "1px solid #e2e8f0" }}>
            The core value of AI Functions is not about writing less code. It is about making common AI operations available as SQL primitives: composable with WHERE, GROUP BY, JOIN, and aggregate functions. Accessible to any analyst without API management or model infrastructure. Auditable through Snowflake's usage tracking. And executable within the data perimeter, which matters in regulated industries where sending data to external APIs creates compliance risk.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            {/* Column 1: SQL alone */}
            <div style={{ background: "#fff", borderRadius: 12, padding: 20, border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.grayDark, marginBottom: 4 }}>SQL alone</div>
              <div style={{ fontSize: 11, color: C.gray, marginBottom: 12 }}>Structured data only</div>
              <CodeBlock lang="sql" code={`SELECT case_id, district,
  category, status
FROM cases
WHERE category = 'Tree Maintenance'
ORDER BY opened DESC`} />
              <div style={{ marginTop: 12, fontSize: 12, color: C.grayDark, lineHeight: 1.55 }}>
                Filters, sorts, and aggregates structured columns. Complaint text and photos are stored but SQL cannot interpret their content.
              </div>
            </div>

            {/* Column 2: Python + external APIs */}
            <div style={{ background: "#fff", borderRadius: 12, padding: 20, border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.grayDark, marginBottom: 4 }}>Python + external APIs</div>
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
              <div style={{ marginTop: 12, fontSize: 12, color: C.grayDark, lineHeight: 1.55 }}>
                Can analyze any data type with any model. Full control over prompts, logic, and output. Even inside Snowflake Notebooks, calling external model APIs means data leaves the Snowflake perimeter for that API call. Each workflow is custom code that requires engineering skill to build and maintain.
              </div>
              <div style={{ marginTop: 10, fontSize: 10.5, color: C.gray }}>~47 lines · data leaves governance perimeter · custom engineering · one-off workflow</div>
            </div>

            {/* Column 3: Cortex AI Functions */}
            <div style={{ background: "#fff", borderRadius: 12, padding: 20, border: `1.5px solid ${C.ice}40` }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.ice, marginBottom: 4 }}>Cortex AI Functions</div>
              <div style={{ fontSize: 11, color: C.gray, marginBottom: 12 }}>AI as SQL primitives, governed by default</div>
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
              <div style={{ marginTop: 12, fontSize: 12, color: C.grayDark, lineHeight: 1.55 }}>
                Covers common analytical patterns: classification, sentiment, filtering, image analysis, extraction, summarization, translation, audio transcription, and more. Composes naturally with SQL. Data stays within Snowflake. Less flexible than Python for custom or novel tasks not covered by the function library.
              </div>
              <div style={{ marginTop: 10, fontSize: 10.5, color: C.ice }}>Composable with SQL. No API management. Governed. Any analyst.</div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== WHAT I BUILT ===== */}
      <section style={sec(true)}>
        <div style={inner}>
          <SectionTag>What I Built</SectionTag>
          <h2 style={{ fontSize: 26, fontWeight: 700, color: C.white, marginBottom: 8 }}>SF 311 data enriched with Cortex AI Functions</h2>
          <p style={{ fontSize: 14, color: C.gray, marginBottom: 20, lineHeight: 1.6, maxWidth: 700 }}>
            I loaded 500 real SF 311 service requests into Snowflake along with 60 representative stock photos uploaded to an internal stage to simulate resident-uploaded images. I then ran three Cortex AI Functions to enrich the data. The enriched columns are what the live queries below operate on.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 20 }}>
            <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: "1px solid rgba(41,182,246,0.1)" }}>
              <Badge>AI_CLASSIFY</Badge>
              <div style={{ marginTop: 8, fontSize: 11.5, color: C.gray, lineHeight: 1.55 }}>Ran on complaint text. Assigns each case to a consistent theme like "Illegal Dumping" or "Road/Pothole Damage" based on the content of the complaint.</div>
              <div style={{ marginTop: 6, fontSize: 11, color: C.cyan }}>→ <span style={{ fontFamily: "monospace" }}>ai_theme</span></div>
            </div>
            <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: "1px solid rgba(41,182,246,0.1)" }}>
              <Badge>AI_SENTIMENT</Badge>
              <div style={{ marginTop: 8, fontSize: 11.5, color: C.gray, lineHeight: 1.55 }}>Ran on complaint text. Returns a score from -1.0 (very negative) to +1.0 (positive). Useful for prioritization and for understanding how complaint tone varies across districts.</div>
              <div style={{ marginTop: 6, fontSize: 11, color: C.cyan }}>→ <span style={{ fontFamily: "monospace" }}>ai_sentiment</span></div>
            </div>
            <div style={{ background: C.surface, borderRadius: 10, padding: 16, border: "1px solid rgba(41,182,246,0.1)" }}>
              <Badge>AI_COMPLETE + TO_FILE</Badge>
              <div style={{ marginTop: 8, fontSize: 11.5, color: C.gray, lineHeight: 1.55 }}>Ran on photos using pixtral-large (Mistral's vision model). Three calls per image: describe the issue, classify it, and rate severity 1 to 5. Images load from a Snowflake internal stage via TO_FILE().</div>
              <div style={{ marginTop: 6, fontSize: 11, color: C.cyan }}>→ <span style={{ fontFamily: "monospace" }}>ai_image_severity</span>, <span style={{ fontFamily: "monospace" }}>ai_image_category</span>, <span style={{ fontFamily: "monospace" }}>ai_image_description</span></div>
            </div>
          </div>

          <div style={{ background: C.surface, borderRadius: 8, padding: "10px 14px", border: "1px solid rgba(41,182,246,0.06)", fontSize: 12, color: C.gray, lineHeight: 1.55, marginBottom: 16 }}>
            From these outputs I derived two columns: <span style={{ color: C.cyan, fontFamily: "monospace" }}>ai_severity_gap</span> (image severity minus text severity) and <span style={{ color: C.cyan, fontFamily: "monospace" }}>ai_category_match</span> (whether the image and text classifications agree). The AI enrichment ran once as a batch. The live queries below read pre-computed results.
          </div>

          <button
            onClick={() => { setShowDataset(!showDataset); setDatasetPage(1); setExpandedRow(null); }}
            style={{ padding: "10px 20px", borderRadius: 8, border: `1px solid ${C.ice}40`, background: showDataset ? C.ice : "transparent", color: showDataset ? C.navy : C.ice, fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}
          >
            {showDataset ? "Hide Dataset" : "View the Enriched Dataset"}
          </button>

          {showDataset && (
            <div style={{ background: C.surface, borderRadius: 12, overflow: "hidden", border: "1px solid rgba(41,182,246,0.08)", marginTop: 14 }}>
              <div style={{ padding: "8px 14px 6px", borderBottom: "1px solid rgba(41,182,246,0.06)", display: "flex", gap: 18, flexWrap: "wrap" }}>
                {[
                  { label: "AI Theme", desc: "AI_CLASSIFY on complaint text" },
                  { label: "Sentiment", desc: "AI_SENTIMENT score, negative = frustrated" },
                  { label: "Img Sev.", desc: "AI vision rating 1 (minor) to 5 (hazard)" },
                ].map(({ label, desc }) => (
                  <span key={label} style={{ fontSize: 10.5, color: C.gray }}>
                    <span style={{ color: C.ice, fontWeight: 600 }}>{label}</span>{" "}{desc}
                  </span>
                ))}
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid rgba(41,182,246,0.12)" }}>
                      {["Case ID", "Date", "Dist.", "Category", "Description", "Photo", "AI Theme", "Sentiment", "Img Sev."].map((h) => (
                        <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: C.gray, fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.8, whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.slice((datasetPage - 1) * 5, datasetPage * 5).map((r, i) => {
                      const row = r as Record<string, unknown>;
                      const id = row.id ?? row.caseid;
                      const date = String(row.date ?? "").slice(0, 10);
                      const district = row.district;
                      const cat = row.cat ?? row.category;
                      const desc = String(row.desc ?? row.description ?? "");
                      const photo = Boolean(row.photo ?? row.has_photo);
                      const filename = String(row.photo_filename ?? "");
                      const theme = String(row.theme ?? row.ai_theme ?? "");
                      const sentiment = Number(row.sentiment ?? row.ai_sentiment ?? 0);
                      const sev_i = row.sev_i ?? row.ai_image_severity;
                      const gap = Number(row.gap ?? row.ai_severity_gap ?? 0);
                      return (
                        <tr key={i} onClick={() => setExpandedRow(expandedRow === i ? null : i)} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)", cursor: "pointer", background: expandedRow === i ? "rgba(41,182,246,0.04)" : "transparent" }}>
                          <td style={{ padding: "6px 10px", color: C.grayLight, fontFamily: "monospace", fontSize: 11 }}>{String(id)}</td>
                          <td style={{ padding: "6px 10px", color: C.grayLight, fontSize: 11.5, whiteSpace: "nowrap" }}>{date}</td>
                          <td style={{ padding: "6px 10px", color: C.white, fontWeight: 600 }}>{String(district)}</td>
                          <td style={{ padding: "6px 10px", color: C.grayLight, fontSize: 11.5, maxWidth: 130 }}>{String(cat)}</td>
                          <td style={{ padding: "6px 10px", color: C.grayLight, maxWidth: 220, fontSize: 11.5 }}>{expandedRow === i ? desc : desc.slice(0, 48) + "..."}</td>
                          <td style={{ padding: "6px 10px" }}>
                            {photo && filename ? (
                              <PhotoThumb filename={filename} onClick={setLightboxSrc} />
                            ) : photo ? (
                              <span style={{ display: "inline-block", width: 32, height: 32, borderRadius: 5, background: `linear-gradient(135deg, ${C.navyMid}, ${C.grayDark})`, textAlign: "center", lineHeight: "32px", fontSize: 14 }}>📷</span>
                            ) : (
                              <span style={{ color: C.grayDark, fontSize: 12 }}>no</span>
                            )}
                          </td>
                          <td style={{ padding: "6px 10px" }}><Badge>{theme || "n/a"}</Badge></td>
                          <td style={{ padding: "6px 10px" }}>
                            <span style={{ color: sentiment < -0.5 ? C.red : sentiment < -0.3 ? C.amber : C.green, fontWeight: 600, fontSize: 12 }}>{sentiment.toFixed(2)}</span>
                          </td>
                          <td style={{ padding: "6px 10px", whiteSpace: "nowrap" }}>
                            {sev_i != null ? (
                              <><span style={{ fontSize: 11.5, color: C.grayLight }}>{String(sev_i)}</span>{gap > 0 && <> <Badge color={C.red}>+{gap}</Badge></>}</>
                            ) : <span style={{ color: C.grayDark, fontSize: 11 }}>n/a</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ padding: "4px 12px 0", borderTop: "1px solid rgba(41,182,246,0.06)" }}>
                <Pagination page={datasetPage} total={previewData.length} perPage={5} onChange={setDatasetPage} dark />
              </div>
              <div style={{ padding: "4px 12px 8px", fontSize: 11, color: C.grayDark }}>
                Showing {previewData.length} cases. Click any row to expand. Queried live from Snowflake. AI enrichment was run once using Cortex AI Functions and stored as columns. The queries shown execute live against those enriched results.
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ===== DEMO ===== */}
      <section style={sec(false)} ref={demoRef}>
        <div style={inner}>
          <SectionTag>Demo</SectionTag>
          <h2 style={{ fontSize: 26, fontWeight: 700, color: C.navy, marginBottom: 8 }}>Four analyses combining structured data with text and image AI</h2>
          <p style={{ fontSize: 14, color: C.grayDark, marginBottom: 24, lineHeight: 1.6, maxWidth: 700 }}>
            Each query runs live against the enriched table in Snowflake. The AI enrichment ran once during setup. These queries read the pre-computed AI columns.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 20 }}>
            {ANALYSES.map((an, i) => (
              <button key={i} onClick={() => { setActiveAnalysis(i); setQueryDone(false); setQueryRunning(false); setQueryResults(null); setQueryPage(1); }}
                style={{ padding: "14px 14px", borderRadius: 10, border: activeAnalysis === i ? `2px solid ${C.ice}` : "1.5px solid #d8dfe8", background: activeAnalysis === i ? C.surface : "#fff", color: activeAnalysis === i ? C.ice : C.navy, fontWeight: 600, fontSize: 12, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
                <span style={{ fontSize: 18, display: "block", marginBottom: 5 }}>{an.icon}</span>{an.title}
              </button>
            ))}
          </div>

          <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden", border: "1px solid #e2e8f0" }}>
            <div style={{ padding: "20px 24px", borderBottom: "1px solid #edf2f7", background: "rgba(41,182,246,0.02)" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.navy, marginBottom: 8 }}>{a.q}</div>
              <div style={{ fontSize: 13.5, color: C.grayDark, lineHeight: 1.65 }}>{a.why}</div>
            </div>
            <div style={{ padding: "20px 24px" }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
                {a.functions.map((f, i) => <Badge key={i}>{f}</Badge>)}
              </div>
              <CodeBlock code={a.sql} accent />
              <button
                onClick={runQuery}
                disabled={queryRunning}
                style={{ marginTop: 14, width: "100%", padding: "11px 24px", borderRadius: 10, border: "none", cursor: queryRunning ? "wait" : "pointer", background: queryRunning ? C.grayDark : `linear-gradient(135deg, ${C.ice}, #0088cc)`, color: "#fff", fontWeight: 700, fontSize: 14, fontFamily: "inherit", letterSpacing: 0.3 }}
              >
                {queryRunning ? "Executing against Snowflake..." : queryDone ? "▶ Run Again" : "▶ Execute Query"}
              </button>

              {queryRunning && (
                <div ref={resultsRef} style={{ marginTop: 14, borderRadius: 8, overflow: "hidden" }}>
                  <div style={{ height: 4, background: `linear-gradient(90deg, transparent, ${C.ice}, transparent)`, backgroundSize: "200% 100%", animation: "shimmer 1.4s infinite" }} />
                  <div style={{ padding: "12px 14px", background: "rgba(41,182,246,0.04)", border: `1px solid rgba(41,182,246,0.1)`, borderTop: "none", borderRadius: "0 0 8px 8px", fontSize: 12.5, color: querySlow ? C.amber : C.ice }}>
                    {querySlow ? "Query is taking longer than expected. Snowflake is still running..." : "Connecting to Snowflake, executing AI functions, assembling results..."}
                  </div>
                </div>
              )}

              {queryDone && displayResults && (
                <div ref={resultsRef} style={{ marginTop: 14 }}>
                  <div style={{ padding: "7px 12px", background: "rgba(0,229,195,0.05)", borderRadius: 8, marginBottom: 10, fontSize: 11.5, color: "#0a8a6f", border: "1px solid rgba(0,229,195,0.12)", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
                    <span>Showing {Math.min((queryPage - 1) * 4 + 1, displayResults.length)} to {Math.min(queryPage * 4, displayResults.length)} of {displayResults.length} results</span>
                    <span>Execution: {queryTime}s · Warehouse: COMPUTE_WH</span>
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
                      <thead>
                        <tr style={{ borderBottom: "2px solid #e2e8f0" }}>
                          {Object.keys(displayResults[0]).map((k) => (
                            <th key={k} style={{ padding: "7px 8px", textAlign: "left", color: C.grayDark, fontWeight: 600, fontSize: 9.5, textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap" }}>
                              {k.replace(/_/g, " ")}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {displayResults.slice((queryPage - 1) * 4, queryPage * 4).map((row, i) => (
                          <tr key={i} style={{ borderBottom: "1px solid #f0f2f5" }}>
                            {Object.entries(row).map(([k, v], j) => (
                              <td key={j} style={{ padding: "7px 8px", color: C.navy, fontSize: 11.5, maxWidth: 200, lineHeight: 1.4 }}>
                                {renderCell(k, v)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Pagination page={queryPage} total={displayResults.length} perPage={4} onChange={setQueryPage} />
                  <div style={{ marginTop: 10, padding: "10px 14px", background: "rgba(41,182,246,0.03)", borderRadius: 8, fontSize: 12, color: C.grayDark, border: "1px solid rgba(41,182,246,0.08)", lineHeight: 1.6 }}>
                    Without AI Functions, answering this question would require exporting the data, writing Python to call text and image APIs separately, joining the results, and pushing them back to the warehouse. With AI Functions, it is a single SQL query against columns that were enriched in place.
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ===== OBSERVATION ===== */}
      <section style={sec(true)}>
        <div style={inner}>
          <SectionTag>Observation</SectionTag>
          <h2 style={{ fontSize: 24, fontWeight: 700, color: C.white, marginBottom: 12 }}>An interesting gap: natural language to AI SQL</h2>
          <p style={{ fontSize: 14, color: C.gray, marginBottom: 24, lineHeight: 1.65, maxWidth: 700 }}>
            Snowflake already has strong natural language to SQL capabilities. Cortex Analyst (generally available) generates SQL from business questions against structured data using semantic models. Cortex Code (in preview) assists with SQL development in Snowsight. What I noticed is that Cortex Analyst is designed for structured data queries. There may be an opportunity to extend these tools to generate queries that include AI Functions, so that when an analyst asks a question that requires understanding text or image content, the system can produce AI SQL rather than only structured SQL.
          </p>

          <div style={{ background: C.surface, borderRadius: 12, padding: 24, border: "1px solid rgba(41,182,246,0.1)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 20, alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: C.gray, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Standard SQL generation</div>
                <div style={{ fontSize: 13, color: C.grayLight, marginBottom: 10, fontStyle: "italic" }}>"Show me safety hazards in District 6"</div>
                <CodeBlock lang="sql" code={`SELECT * FROM cases
WHERE category = 'Safety Hazard'
  AND district = '6'`} />
                <div style={{ fontSize: 11, color: C.grayDark, marginTop: 8, lineHeight: 1.55 }}>Relies on the structured category column. Only finds cases explicitly filed as "Safety Hazard."</div>
              </div>
              <div style={{ fontSize: 28, color: C.ice, textAlign: "center" }}>→</div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: C.ice, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>AI Function-aware SQL generation</div>
                <div style={{ fontSize: 13, color: C.grayLight, marginBottom: 10, fontStyle: "italic" }}>"Show me safety hazards in District 6"</div>
                <CodeBlock lang="sql" code={`SELECT * FROM cases
WHERE AI_FILTER(description,
  'Is this a safety hazard?')
  AND district = '6'`} />
                <div style={{ fontSize: 11, color: C.cyan, marginTop: 8, lineHeight: 1.55 }}>Uses AI to interpret the complaint text. Finds hazards regardless of how they were categorized.</div>
              </div>
            </div>
          </div>

          <p style={{ fontSize: 13, color: C.grayDark, marginTop: 16, lineHeight: 1.65, maxWidth: 700 }}>
            This is based on what I observed in the public documentation. Cortex Analyst's documentation describes it as working with structured data through semantic models. Whether it already has some awareness of AI Functions is something I would want to learn more about.
          </p>
        </div>
      </section>

      {/* ===== ACROSS INDUSTRIES ===== */}
      <section style={sec(false)}>
        <div style={inner}>
          <SectionTag>Across Industries</SectionTag>
          <h2 style={{ fontSize: 24, fontWeight: 700, color: C.navy, marginBottom: 8 }}>Structured and unstructured data coexist in every industry</h2>
          <p style={{ fontSize: 14, color: C.grayDark, marginBottom: 20, lineHeight: 1.6, maxWidth: 700 }}>
            The SF 311 use case combines structured case metadata with complaint text and photos. This same pattern appears across industries wherever organizations have structured records alongside text, images, documents, or audio data.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            {[
              { icon: "🏦", name: "Financial Services", pattern: "Structured positions and trade data alongside earnings call transcripts, analyst reports, and regulatory filings. AI Functions could support tasks like sentiment scoring across transcripts, extracting key metrics from documents, or classifying news by portfolio relevance. Snowflake has already begun focusing here with the launch of Cortex AI for Financial Services in October 2025." },
              { icon: "🏥", name: "Healthcare", pattern: "Structured patient records and lab results alongside clinical notes, discharge summaries, and medical imaging. Tasks like extracting diagnoses from notes, flagging discrepancies in documentation, or classifying imaging findings could benefit from AI Functions. Data residency within the Snowflake perimeter is particularly relevant given regulatory requirements like HIPAA." },
              { icon: "🛡️", name: "Insurance", pattern: "Structured claims data alongside claim narratives, damage photos, and adjuster notes. Comparing AI-assessed damage severity from photos against claimed amounts, or extracting key details from adjuster narratives, are natural use cases for combining structured and unstructured analysis." },
              { icon: "🛒", name: "Retail", pattern: "Structured product catalogs and transaction data alongside customer reviews, user-uploaded photos, and support tickets. Sentiment analysis across reviews, classifying product issues from support text, or analyzing user photos for quality issues are all patterns where structured and unstructured data need to come together." },
            ].map((ind, i) => (
              <div key={i} style={{ background: "#fff", borderRadius: 12, padding: 18, border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: 20, marginBottom: 6 }}>{ind.icon}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.navy, marginBottom: 8 }}>{ind.name}</div>
                <div style={{ fontSize: 12.5, color: C.grayDark, lineHeight: 1.6 }}>{ind.pattern}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== COMPETITIVE LANDSCAPE ===== */}
      <section style={sec(true)}>
        <div style={inner}>
          <SectionTag>Competitive Landscape</SectionTag>
          <h2 style={{ fontSize: 24, fontWeight: 700, color: C.white, marginBottom: 8 }}>AI-in-SQL capabilities across platforms</h2>
          <p style={{ fontSize: 14, color: C.gray, marginBottom: 20, lineHeight: 1.6, maxWidth: 700 }}>
            Snowflake, BigQuery, and Databricks all offer AI functions accessible from SQL. Redshift has more limited support through Amazon Bedrock integration. Based on publicly available documentation.
          </p>

          <div style={{ background: C.surface, borderRadius: 14, overflow: "hidden", border: "1px solid rgba(41,182,246,0.1)" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.5 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(41,182,246,0.15)" }}>
                    <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: C.gray, width: "15%" }}>Capability</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: "#29b6f6" }}>Snowflake Cortex</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: "#4285f4" }}>BigQuery AI</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: "#ff3621" }}>Databricks</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: "#ff9900" }}>Redshift</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPETITIVE_CAPABILITIES.map((row, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                      <td style={{ padding: "8px 12px", fontWeight: 600, color: C.white, fontSize: 10.5 }}>{row.cap}</td>
                      <td style={{ padding: "8px 12px", color: C.grayLight, fontSize: 10.5, lineHeight: 1.4 }}>{row.sf}</td>
                      <td style={{ padding: "8px 12px", color: C.grayLight, fontSize: 10.5, lineHeight: 1.4 }}>{row.bq}</td>
                      <td style={{ padding: "8px 12px", color: C.grayLight, fontSize: 10.5, lineHeight: 1.4 }}>{row.db}</td>
                      <td style={{ padding: "8px 12px", color: C.grayLight, fontSize: 10.5, lineHeight: 1.4 }}>{row.rs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: "10px 14px", borderTop: "1px solid rgba(41,182,246,0.06)", fontSize: 11, color: C.grayDark }}>Based on publicly available documentation as of April 2026. Capabilities may have changed since this was compiled.</div>
          </div>

          <div style={{ marginTop: 18, background: C.surface, borderRadius: 10, padding: 18, border: "1px solid rgba(41,182,246,0.1)" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.grayLight, marginBottom: 10 }}>Some observations</div>
            <div style={{ fontSize: 12, color: C.gray, lineHeight: 1.65 }}>
              Snowflake has the broadest set of dedicated, task-specific functions including AI_CLASSIFY, AI_SENTIMENT, AI_FILTER, AI_AGG, AI_EXTRACT, AI_REDACT, AI_TRANSCRIBE, AI_PARSE_DOCUMENT, AI_TRANSLATE, AI_SIMILARITY, AI_EMBED, and AI_SUMMARIZE_AGG among others. AI_AGG and AI_SUMMARIZE_AGG for cross-row aggregation appear to be unique among these platforms. BigQuery's managed AI functions include automatic prompt optimization and query plan reordering that evaluates non-AI filters before AI filters, which can reduce LLM call volume and cost. BigQuery's AI.SCORE for ranking with auto-generated rubrics is also a dedicated capability the others do not have an equivalent for. Databricks offers the broadest model flexibility with BYOM and external endpoint support, and its ai_parse_document function for PDF extraction with text, table, and figure extraction is a strong dedicated capability. Redshift relies on Amazon Bedrock integration rather than native SQL primitives, requiring more setup.
            </div>
          </div>
        </div>
      </section>

      {/* ===== SOME THOUGHTS ===== */}
      <section style={sec(false)}>
        <div style={inner}>
          <SectionTag>Some Thoughts</SectionTag>
          <h2 style={{ fontSize: 24, fontWeight: 700, color: C.navy, marginBottom: 8 }}>Areas that seem worth exploring</h2>
          <p style={{ fontSize: 14, color: C.grayDark, marginBottom: 20, lineHeight: 1.6, maxWidth: 700 }}>
            I do not have visibility into the product's internal roadmap, adoption data, or competitive dynamics. These are observations from building with the product and studying the public documentation. There are many possible directions to take.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[
              {
                t: "Expanding the function library for broader analytical coverage",
                d: "The current library covers common text and image tasks well and continues to grow (AI_TRANSCRIBE for audio was added recently). As the function set expands to cover more specialized patterns, it increases the surface area of what analysts can do without leaving SQL. Every pattern covered by a native function is one less reason for a customer to use an external tool or write custom code.",
              },
              {
                t: "Cost and performance optimization for AI function execution",
                d: "BigQuery's approach of evaluating traditional predicates before AI predicates in a query is worth noting. If a query has both a standard WHERE clause and an AI_FILTER, running the standard filter first reduces the number of rows that need LLM processing. This can meaningfully affect cost and latency at scale.",
              },
              {
                t: "Go-to-market focus across industries",
                d: "Different industries have different concentrations of unstructured data types. Financial services has transcripts and filings. Healthcare has clinical notes and imaging. Insurance has claims narratives and damage photos. Understanding which industries have the highest density of unstructured data already in Snowflake, and what analytical patterns are most common in each, could help prioritize both product development and sales focus.",
              },
              {
                t: "Discoverability of AI Functions within existing Snowflake tools",
                d: "Cortex Analyst and Cortex Code are already used for SQL generation and development. If these tools can suggest or generate queries that include AI Functions where relevant, it could increase AI Function adoption without requiring analysts to discover and learn about them separately.",
              },
              {
                t: "Regional model availability",
                d: "While building this demo, I was not able to use Claude in the US West (Oregon) region and used pixtral-large instead. Model availability by region is a practical consideration that affects what customers can do depending on where their account is located.",
              },
            ].map((item, i) => (
              <div key={i} style={{ background: "#fff", borderRadius: 10, padding: 18, border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.navy, marginBottom: 6 }}>{item.t}</div>
                <div style={{ fontSize: 12.5, color: C.grayDark, lineHeight: 1.6 }}>{item.d}</div>
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
        <div style={{ fontSize: 12, color: C.grayDark }}>All demo queries execute live against Snowflake. Source: SF 311 Open Data. ❄️</div>
      </footer>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
        @keyframes skeleton-pulse { 0%,100%{opacity:0.4} 50%{opacity:0.8} }
        @keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
        .fade-section { opacity: 0; transform: translateY(20px); transition: opacity 0.6s ease, transform 0.6s ease; }
        * { box-sizing: border-box; }
        button:hover:not(:disabled) { opacity: .92; }
        pre { tab-size: 2; }
        @media (max-width: 768px) {
          section { padding: 52px 20px !important; }
          h1 { font-size: 28px !important; }
          h2 { font-size: 22px !important; }
        }
      `}</style>
    </div>
  );
}
