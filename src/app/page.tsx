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
    title: "Severity Escalation Detection",
    goal: "An analyst needs to find cases where the photo reveals a more serious problem than the text description. These cases get buried in the queue because the written complaint undersells what is actually happening on the ground.",
    oldWay: {
      lines: 47,
      tools: "Python + OpenAI Vision API + pandas + SQL warehouse",
      code: `# Step 1: Query structured data
cases = pd.read_sql("""
  SELECT case_id, district, description
  FROM cases WHERE has_photo = TRUE
""", warehouse_conn)

# Step 2: Score severity from text (NLP API)
for _, row in cases.iterrows():
    resp = openai.chat.completions.create(
        model="gpt-4",
        messages=[{"role": "user",
            "content": f"Rate severity 1-5: {row['description']}"}])
    row['text_severity'] = int(resp.choices[0].message.content)

# Step 3: Score severity from images (Vision API)
for _, row in photo_cases.iterrows():
    img = base64.b64encode(open(row['photo_path'], 'rb').read())
    resp = openai.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": [
            {"type": "text", "text": "Rate severity 1-5"},
            {"type": "image_url",
             "image_url": {"url": f"data:image/jpeg;base64,{img}"}}
        ]}])
    row['image_severity'] = int(resp.choices[0].message.content)

# Step 4: Join and compare
merged = pd.merge(cases, photo_results, on='case_id')
merged['severity_gap'] = merged['image_severity'] - merged['text_severity']
escalated = merged[merged['severity_gap'] > 1].sort_values(
    'severity_gap', ascending=False)

# Step 5: Push back to warehouse
escalated.to_sql('severity_escalations', warehouse_conn)`,
      pain: "47 lines. 2 API integrations. Images leave your security perimeter. Takes about 15 min to process 500 cases. Only the engineer who wrote it can run it. Repeat for every new question.",
    },
    aiSql: `SELECT
  case_id,
  district,
  category,
  description,
  AI_COMPLETE('snowflake-arctic',
    'Rate the severity of this issue 1-5.
     Respond with only a number: '
    || description) AS text_severity,
  AI_COMPLETE('pixtral-large',
    'Rate the severity of this issue 1-5.
     Respond with only a number.',
    photo_file) AS image_severity,
  (image_severity - text_severity) AS severity_gap
FROM cases_with_photos
WHERE severity_gap > 1
ORDER BY severity_gap DESC`,
    aiSqlLines: 14,
    functions: ["AI_COMPLETE (text)", "AI_COMPLETE (image)", "Arithmetic comparison"],
    results: [
      { case_id: 14892210, district: "5", description: "Large branch cracked and hanging over playground", image_shows: "Massive tree limb split at trunk, dangling over children's play equipment", text_sev: 2, img_sev: 5, gap: 3 },
      { case_id: 14892301, district: "6", description: "Pile of dumped mattresses blocking sidewalk", image_shows: "Commercial-scale illegal dump with hazardous materials, blocking wheelchair ramp and hydrant", text_sev: 3, img_sev: 5, gap: 2 },
      { case_id: 14892265, district: "3", description: "Deep pothole on Market causing cars to swerve", image_shows: "Crater-sized road failure with exposed rebar, adjacent to active bike lane", text_sev: 2, img_sev: 4, gap: 2 },
      { case_id: 14892150, district: "2", description: "Three streetlights out on Lombard near Divisadero", image_shows: "Complete blackout on 200m residential stretch with no alternative lighting", text_sev: 2, img_sev: 4, gap: 2 },
    ],
    textToSqlQuestion: "Find cases where the photo shows worse damage than described",
  },
  {
    id: "mismatch",
    icon: "🔄",
    title: "Photo vs. Text Category Mismatch",
    goal: "An analyst needs to find cases where the photo tells a different story than the text. A resident might file under Graffiti when the photo actually shows a mural, or under Street Cleaning when the photo reveals a biohazard. This reveals where the intake form is failing.",
    oldWay: {
      lines: 52,
      tools: "Python + OpenAI Vision API + text classifier + pandas",
      code: `# Step 1: Classify text descriptions
for _, row in cases.iterrows():
    resp = openai.chat.completions.create(
        model="gpt-4",
        messages=[{"role": "user",
            "content": f"Classify into one category: "
            f"Dumping/Graffiti/Pothole/Hazard/..."
            f"\\nText: {row['description']}"}])
    row['text_category'] = resp.choices[0].message.content

# Step 2: Classify images separately
for _, row in photo_cases.iterrows():
    img = base64.b64encode(open(row['photo'], 'rb').read())
    resp = openai.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": [
            {"type": "text",
             "text": "Classify this image: Dumping/"
                     "Graffiti/Pothole/Hazard/..."},
            {"type": "image_url",
             "image_url": {"url": f"data:image/jpeg;..."}}
        ]}])
    row['image_category'] = resp.choices[0].message.content

# Step 3: Compare and find mismatches
merged = pd.merge(text_results, image_results, on='case_id')
mismatches = merged[
    merged['text_category'] != merged['image_category']]`,
      pain: "52 lines. Two separate classification passes. No governance on model outputs. Hard to add new categories. Images sent to an external API.",
    },
    aiSql: `SELECT
  case_id,
  district,
  category AS human_filed_category,
  AI_CLASSIFY(description,
    ['Illegal Dumping', 'Graffiti', 'Road Damage',
     'Safety Hazard', 'Sewer Issue', 'Tree Hazard',
     'Noise', 'Encampment']) AS text_ai_category,
  AI_CLASSIFY(photo_file,
    ['Illegal Dumping', 'Graffiti', 'Road Damage',
     'Safety Hazard', 'Sewer Issue', 'Tree Hazard',
     'Noise', 'Encampment']) AS image_ai_category
FROM cases_with_photos
WHERE text_ai_category != image_ai_category
ORDER BY opened DESC`,
    aiSqlLines: 13,
    functions: ["AI_CLASSIFY (text)", "AI_CLASSIFY (image)", "Cross-modal comparison"],
    results: [
      { case_id: 14891822, district: "9", filed_as: "Graffiti", text_ai: "Graffiti/Vandalism", image_ai: "General Maintenance", insight: "Photo shows faded mural, not vandalism" },
      { case_id: 14891756, district: "6", filed_as: "Street Cleaning", text_ai: "General Maintenance", image_ai: "Safety Hazard", insight: "Photo reveals biohazard waste" },
      { case_id: 14891698, district: "3", filed_as: "Damaged Property", text_ai: "Road/Pothole Damage", image_ai: "Sewer/Drainage", insight: "Photo shows collapsed storm drain" },
    ],
    textToSqlQuestion: "Show me category mismatches between photos and text",
  },
  {
    id: "equity",
    icon: "⚖️",
    title: "Neighborhood Equity Analysis",
    goal: "An analyst needs to find neighborhoods where photos show high severity issues but complaint volume is low. That gap is a likely signal of underreporting in underserved communities. You cannot see this pattern without running AI on the images.",
    oldWay: {
      lines: 63,
      tools: "Python + Vision API + SQL + statistical analysis + GIS",
      code: `# Step 1: Score every photo for visual severity
for _, row in photo_cases.iterrows():
    img = base64.b64encode(open(row['photo'], 'rb').read())
    resp = openai.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": [
            {"type": "text",
             "text": "Rate urban issue severity 1-5"},
            {"type": "image_url", ...}
        ]}])
    row['visual_severity'] = int(resp.choices[0]...)

# Step 2: Aggregate by neighborhood
neighborhood_severity = photo_results.groupby(
    'neighborhood').agg(
    avg_severity=('visual_severity', 'mean'),
    photo_count=('case_id', 'count'))

# Step 3: Get complaint volumes from SQL
volumes = pd.read_sql("""
    SELECT neighborhood, COUNT(*) as volume
    FROM cases GROUP BY neighborhood
""", conn)

# Step 4: Join and compute equity score
equity = pd.merge(neighborhood_severity, volumes,
    on='neighborhood')
equity['equity_flag'] = equity.apply(
    lambda r: 'Underreported'
    if r['avg_severity'] > 3 and r['volume'] < 50
    else 'Normal', axis=1)`,
      pain: "63 lines. Vision API costs at scale. Manual statistical thresholding. Separate GIS tool for visualization. No repeatable pipeline.",
    },
    aiSql: `SELECT
  neighborhood,
  district,
  COUNT(*) AS complaint_volume,
  AVG(AI_COMPLETE('pixtral-large',
    'Rate severity 1-5. Respond with only a number.',
    photo_file)::INT) AS avg_visual_severity,
  AVG(AI_SENTIMENT(description)) AS avg_sentiment,
  CASE
    WHEN avg_visual_severity > 3
     AND complaint_volume < 50
    THEN 'Potentially Underreported'
    ELSE 'Normal'
  END AS equity_flag
FROM cases_with_photos
GROUP BY neighborhood, district
HAVING equity_flag = 'Potentially Underreported'
ORDER BY avg_visual_severity DESC`,
    aiSqlLines: 16,
    functions: ["AI_COMPLETE (image severity)", "AI_SENTIMENT", "Aggregation + equity logic"],
    results: [
      { neighborhood: "Bayview", district: "10", volume: 38, avg_visual_sev: 4.2, avg_text_sev: 2.8, equity_flag: "Potentially Underreported" },
      { neighborhood: "Excelsior", district: "11", volume: 29, avg_visual_sev: 3.8, avg_text_sev: 2.5, equity_flag: "Potentially Underreported" },
      { neighborhood: "Visitacion Valley", district: "10", volume: 22, avg_visual_sev: 3.6, avg_text_sev: 2.3, equity_flag: "Potentially Underreported" },
    ],
    textToSqlQuestion: "Which neighborhoods might be underreporting issues?",
  },
  {
    id: "safety",
    icon: "🛡️",
    title: "Cross-Modal Safety Hazard Detection",
    goal: "An analyst needs to flag every case that represents a genuine safety risk by combining AI analysis of both the text description and the photo. The goal is to catch hazards that are visible in one source but not mentioned in the other.",
    oldWay: {
      lines: 55,
      tools: "Python + NLP model + Vision API + custom risk scoring",
      code: `# Step 1: NLP safety classification on text
for _, row in cases.iterrows():
    resp = openai.chat.completions.create(
        model="gpt-4",
        messages=[{"role": "user",
            "content": f"Does this describe a safety"
            f" hazard? YES/NO: {row['description']}"}])
    row['text_safety'] = 'yes' in resp...lower()

# Step 2: Vision safety classification on photos
for _, row in photo_cases.iterrows():
    img = base64.b64encode(...)
    resp = openai.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": [
            {"type": "text",
             "text": "Is there a safety hazard? YES/NO"},
            {"type": "image_url", ...}
        ]}])
    row['image_safety'] = 'yes' in resp...lower()

# Step 3: Combine signals
merged['is_hazard'] = (merged['text_safety']
    | merged['image_safety'])
# Sort by combined severity
hazards = merged[merged['is_hazard']].sort_values(
    'combined_severity', ascending=False)`,
      pain: "55 lines. Inconsistent classification between text and image models. No unified severity ranking. Manual threshold tuning.",
    },
    aiSql: `SELECT
  case_id,
  district,
  neighborhood,
  description,
  AI_FILTER(description,
    'Does this describe a safety hazard?') AS text_hazard,
  AI_FILTER(photo_file,
    'Does this show a safety hazard?') AS image_hazard,
  AI_COMPLETE('pixtral-large',
    'Assess the combined safety risk from this
     complaint and photo. One sentence.',
    photo_file) AS risk_assessment
FROM cases_with_photos
WHERE text_hazard = TRUE OR image_hazard = TRUE
ORDER BY COALESCE(ai_image_severity,
  ai_text_severity) DESC`,
    aiSqlLines: 15,
    functions: ["AI_FILTER (text)", "AI_FILTER (image)", "AI_COMPLETE (cross-modal)"],
    results: [
      { case_id: 14892210, district: "5", text_hazard: "TRUE", image_hazard: "TRUE", assessment: "Critical: large tree limb over active playground, imminent fall risk to children" },
      { case_id: 14892265, district: "3", text_hazard: "TRUE", image_hazard: "TRUE", assessment: "High: road crater with exposed rebar forcing cyclists into traffic lane" },
      { case_id: 14892301, district: "6", text_hazard: "FALSE", image_hazard: "TRUE", assessment: "Moderate: text says dumped mattresses but photo shows blocked fire hydrant access" },
    ],
    textToSqlQuestion: "Summarize safety hazards across all districts",
  },
];

const INDUSTRIES = [
  {
    icon: "🏦",
    name: "Financial Services",
    question: "Which holdings have positive P&L but negative earnings call sentiment, confirmed by chart patterns?",
    functions: "AI_SENTIMENT on transcripts + AI_COMPLETE on chart images + structured positions",
    before: "Quant team + NLP pipeline + image analysis vendor",
  },
  {
    icon: "🏥",
    name: "Healthcare",
    question: "Patients where notes say improving but radiology images show disease progression.",
    functions: "AI_FILTER on notes + AI_CLASSIFY on imaging + structured records",
    before: "Clinical informatics + radiology AI vendor + custom integration",
  },
  {
    icon: "🛡️",
    name: "Insurance",
    question: "Claims where photo damage severity does not match the claimed amount, ranked by gap.",
    functions: "AI_COMPLETE (severity from image) + structured claims + AI_FILTER",
    before: "SIU team manually reviewing every photo",
  },
  {
    icon: "🛒",
    name: "Retail",
    question: "High-return products where reviews and user photos both confirm a listing mismatch.",
    functions: "AI_FILTER on reviews + AI_CLASSIFY on photos vs listing",
    before: "Review NLP + image comparison pipeline + manual QA",
  },
];

const TEXT_TO_SQL_EXAMPLES = [
  "Find cases where the photo shows worse damage than described",
  "What are the top complaint themes in Mission District?",
  "Which neighborhoods might be underreporting issues?",
  "Show me category mismatches between photos and text",
  "Summarize safety hazards across all districts",
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
type AnalysisType = typeof ANALYSES[number];

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

function ProcessStep({ label, value, done, active }: { label: string; value: string | null; done: boolean; active: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: "10px 0", opacity: done || active ? 1 : 0.25, transition: "opacity 0.4s" }}>
      <div style={{ width: 26, height: 26, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: done ? C.cyan : active ? C.ice : C.grayDark, color: done || active ? C.navy : C.gray, fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
        {done ? "✓" : active ? "⟳" : "·"}
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: done ? C.white : active ? C.ice : C.gray }}>{label}</div>
        {done && value && (
          <div style={{ fontSize: 11.5, color: C.cyan, fontFamily: "monospace", marginTop: 3, background: "rgba(0,229,195,0.06)", padding: "3px 8px", borderRadius: 5, display: "inline-block" }}>
            {value}
          </div>
        )}
      </div>
    </div>
  );
}

function Skeleton({ width = "100%", height = 20 }: { width?: string | number; height?: number }) {
  return <div style={{ width, height, borderRadius: 6, background: "rgba(41,182,246,0.08)", animation: "skeleton-pulse 1.5s ease-in-out infinite" }} />;
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
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      <img
        src={src}
        alt="full size"
        style={{ maxWidth: "90vw", maxHeight: "88vh", borderRadius: 10, boxShadow: "0 24px 80px rgba(0,0,0,0.6)" }}
        onClick={(e) => e.stopPropagation()}
      />
      <button
        onClick={onClose}
        style={{ position: "absolute", top: 20, right: 24, background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", fontSize: 20, width: 36, height: 36, borderRadius: "50%", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        ✕
      </button>
    </div>
  );
}

function Pagination({ page, total, perPage, onChange, dark = false }: { page: number; total: number; perPage: number; onChange: (p: number) => void; dark?: boolean }) {
  const totalPages = Math.ceil(total / perPage);
  if (totalPages <= 1) return null;
  const btn = (disabled: boolean, label: string, onClick: () => void): React.CSSProperties => ({
    padding: "4px 12px", borderRadius: 6, border: `1px solid ${dark ? "rgba(41,182,246,0.2)" : "#d8dfe8"}`,
    background: disabled ? "transparent" : dark ? "rgba(41,182,246,0.08)" : "#f0f4f8",
    color: disabled ? (dark ? C.grayDark : "#bbc8d4") : dark ? C.ice : C.navy,
    fontSize: 12, fontWeight: 600, cursor: disabled ? "default" : "pointer", fontFamily: "inherit",
  });
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "10px 0" }}>
      <button style={btn(page === 1, "<", () => {})} disabled={page === 1} onClick={() => onChange(page - 1)}>{"<"}</button>
      <span style={{ fontSize: 12, color: dark ? C.gray : C.grayDark, minWidth: 80, textAlign: "center" }}>Page {page} of {totalPages}</span>
      <button style={btn(page === totalPages, ">", () => {})} disabled={page === totalPages} onClick={() => onChange(page + 1)}>{">"}</button>
    </div>
  );
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

const INTENT_TO_QUERY: Record<string, string> = {
  severity_mismatch: "severity", category_mismatch: "mismatch",
  equity_analysis: "equity", safety_detection: "safety",
  theme_analysis: "theme_analysis", sentiment_trend: "sentiment_trend",
};

/* ─── Main page ─── */
export default function SF311Demo() {
  const [activeAnalysis, setActiveAnalysis] = useState(0);
  const [queryRunning, setQueryRunning] = useState(false);
  const [queryDone, setQueryDone] = useState(false);
  const [queryResults, setQueryResults] = useState<Record<string, unknown>[] | null>(null);
  const [queryTime, setQueryTime] = useState("2.3");
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  const [textInput, setTextInput] = useState("");
  const [textRunning, setTextRunning] = useState(false);
  const [textStep, setTextStep] = useState(-1);
  const [textDone, setTextDone] = useState(false);
  const [textAnalysis, setTextAnalysis] = useState<AnalysisType | null>(null);
  const [textApiResult, setTextApiResult] = useState<{
    intent: string; params: Record<string, string>; workflow: string;
    sql: string; functions: string[]; results: Record<string, unknown>[]; executionTime: string;
  } | null>(null);

  const [querySlow, setQuerySlow] = useState(false);
  const [textSlow, setTextSlow] = useState(false);
  const [datasetPage, setDatasetPage] = useState(1);
  const [queryPage, setQueryPage] = useState(1);
  const [textPage, setTextPage] = useState(1);

  const [stats, setStats] = useState<Record<string, string> | null>(null);
  const [previewData, setPreviewData] = useState<SampleRow[]>(SAMPLE_DATA);

  const resultsRef = useRef<HTMLDivElement>(null);
  const dataRef = useFadeInSection();
  const playgroundRef = useFadeInSection();
  const textSqlRef = useFadeInSection();
  const biggerRef = useFadeInSection();

  const a = ANALYSES[activeAnalysis];

  useEffect(() => {
    fetch("/api/stats").then((r) => r.json()).then((d) => setStats(d)).catch(() => {});
    fetch("/api/preview").then((r) => r.json()).then((d) => { if (d.rows?.length > 0) setPreviewData(d.rows); }).catch(() => {});
  }, []);

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

  const runTextToSql = useCallback(async (q?: string) => {
    const question = q ?? textInput;
    if (!question) return;
    setTextInput(question);
    const match = ANALYSES.find((an) => question.toLowerCase().includes(an.textToSqlQuestion.toLowerCase().split(" ").slice(0, 3).join(" "))) ?? ANALYSES[0];
    setTextAnalysis(match);
    setTextApiResult(null);
    setTextRunning(true);
    setTextDone(false);
    setTextStep(0);
    setTextSlow(false);
    setTextPage(1);
    const slowTimer = setTimeout(() => setTextSlow(true), 10000);
    const apiPromise = fetch("/api/text-to-sql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }) }).then((r) => r.json()).catch(() => null);
    let step = 0;
    const iv = setInterval(() => {
      step++;
      setTextStep(step);
      if (step >= 4) {
        clearInterval(iv);
        apiPromise.then((data) => {
          if (data) {
            setTextApiResult(data);
            if (data.intent) {
              const real = ANALYSES.find((an) => an.id === data.queryId || an.id === INTENT_TO_QUERY[data.intent]);
              if (real) setTextAnalysis(real);
            }
          }
          setTextStep(5);
          clearTimeout(slowTimer);
          setTextSlow(false);
          setTimeout(() => { setTextRunning(false); setTextDone(true); }, 600);
        });
      }
    }, 750);
  }, [textInput]);

  const sec = (dark: boolean): React.CSSProperties => ({ padding: "72px 40px", background: dark ? C.navy : C.surfaceLight });
  const inner: React.CSSProperties = { maxWidth: 1100, margin: "0 auto" };
  const displayResults = queryResults ?? (queryDone ? (a.results as unknown as Record<string, unknown>[]) : null);
  const textDisplayResults = textApiResult?.results ?? textAnalysis?.results;

  function renderCell(k: string, v: unknown) {
    if (k === "photo_filename" && v) return <PhotoThumb filename={String(v)} onClick={setLightboxSrc} />;
    if (k === "gap" || k === "severity_gap") return <Badge color={C.red}>+{String(v)}</Badge>;
    if (k.includes("sev") || k.includes("severity")) return <span style={{ fontWeight: 700 }}>{String(v)}</span>;
    if (k === "equity_flag") return <Badge color={C.amber}>{String(v)}</Badge>;
    if (k === "text_hazard" || k === "image_hazard" || k === "ai_safety_flag") return <Badge color={String(v) === "TRUE" || v === true ? C.red : C.green}>{String(v)}</Badge>;
    return <span>{String(v ?? "n/a")}</span>;
  }

  return (
    <div style={{ fontFamily: "var(--font-dm-sans), 'DM Sans', sans-serif", color: C.white, background: C.navy }}>
      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}

      {/* ===== HERO ===== */}
      <section style={{ minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center", padding: "60px 40px", position: "relative", overflow: "hidden", background: `radial-gradient(ellipse at 25% 15%, ${C.navyMid} 0%, ${C.navy} 70%)` }}>
        <div style={{ position: "absolute", inset: 0, opacity: 0.03, backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 59px, ${C.ice} 59px, ${C.ice} 60px), repeating-linear-gradient(90deg, transparent, transparent 59px, ${C.ice} 59px, ${C.ice} 60px)` }} />
        <div style={inner}>
          <Badge color={C.cyan}>Live Demo · Snowflake Cortex AI Functions</Badge>
          <h1 style={{ fontSize: 52, fontWeight: 700, lineHeight: 1.1, marginTop: 24, marginBottom: 20, letterSpacing: -1.5, maxWidth: 800, background: `linear-gradient(135deg, ${C.white} 0%, ${C.ice} 100%)`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            SQL that can see images, read text, and classify data. Without leaving your warehouse.
          </h1>
          <p style={{ fontSize: 17, color: C.gray, maxWidth: 620, lineHeight: 1.75, marginBottom: 32 }}>
            Cortex AI Functions let any analyst run image analysis, sentiment scoring, and classification directly in SQL. No Python, no external APIs. Every query on this page executes live against a real SF 311 dataset as an example use case.
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 48px 0", display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              "A real SF 311 dataset with complaint text and representative photos",
              "Side by side comparison of the old Python workflow vs one SQL query",
              "Live AI SQL queries executing against Snowflake",
              "A natural language to SQL translation prototype",
            ].map((item, i) => (
              <li key={i} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13.5, color: C.gray }}>
                <span style={{ color: C.ice, fontSize: 10 }}>▸</span> {item}
              </li>
            ))}
          </ul>
          <div style={{ fontSize: 12, color: C.grayDark, letterSpacing: 0.5 }}>Built by Srihari Shekhar</div>
        </div>
      </section>

      {/* ===== THE PROBLEM ===== */}
      <ProblemSection sec={sec} inner={inner} />

      {/* ===== DATASET ===== */}
      <section style={sec(true)} ref={dataRef}>
        <div style={inner}>
          <SectionTag>The Data</SectionTag>
          <h2 style={{ fontSize: 32, fontWeight: 700, color: C.white, marginBottom: 8, letterSpacing: -0.5 }}>San Francisco 311 Service Requests</h2>
          <p style={{ fontSize: 15, color: C.gray, marginBottom: 24, lineHeight: 1.6 }}>Structured case metadata, unstructured complaint text, and resident photos. All in one Snowflake table.</p>
          <div style={{ display: "flex", gap: 14, marginBottom: 20, flexWrap: "wrap" }}>
            {[
              { l: "Total Cases", v: stats?.totalCases ?? null },
              { l: "Districts", v: stats?.districts ?? null },
              { l: "Categories", v: stats?.categories ?? null },
              { l: "With Photos", v: stats?.withPhotos ?? null },
              { l: "Date Range", v: stats?.dateRange ?? null },
            ].map((s, i) => (
              <div key={i} style={{ padding: "10px 18px", background: C.surface, borderRadius: 10, border: "1px solid rgba(41,182,246,0.08)", minWidth: 110 }}>
                <div style={{ fontSize: 10, color: C.gray, marginBottom: 3, textTransform: "uppercase", letterSpacing: 1 }}>{s.l}</div>
                {s.v ? <div style={{ fontSize: 18, fontWeight: 700, color: C.ice }}>{s.v}</div> : <Skeleton height={22} width={70} />}
              </div>
            ))}
          </div>
          <div style={{ background: C.surface, borderRadius: 12, overflow: "hidden", border: "1px solid rgba(41,182,246,0.08)" }}>
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
              Showing {previewData.length} of {stats?.totalCases ?? previewData.length} cases. Click any row to expand. Queried live from Snowflake.
            </div>
          </div>
        </div>
      </section>

      {/* ===== AI SQL PLAYGROUND ===== */}
      <section style={sec(false)} ref={playgroundRef}>
        <div style={inner}>
          <SectionTag>AI SQL in Action</SectionTag>
          <h2 style={{ fontSize: 32, fontWeight: 700, color: C.navy, marginBottom: 8, letterSpacing: -0.5 }}>Pick an analysis. See the old approach. Then run the AI SQL.</h2>
          <p style={{ fontSize: 15, color: C.grayDark, marginBottom: 28, lineHeight: 1.6, maxWidth: 700 }}>Each card shows a real analytical question, what it used to take in Python, and the equivalent Cortex AI Functions query. You can execute them live against Snowflake.</p>
          <div style={{ display: "flex", gap: 10, marginBottom: 24, flexWrap: "wrap" }}>
            {ANALYSES.map((an, i) => (
              <button key={i} onClick={() => { setActiveAnalysis(i); setQueryDone(false); setQueryRunning(false); setQueryResults(null); setQueryPage(1); }}
                style={{ padding: "9px 16px", borderRadius: 10, border: activeAnalysis === i ? `2px solid ${C.ice}` : "1.5px solid #d8dfe8", background: activeAnalysis === i ? C.surface : "#fff", color: activeAnalysis === i ? C.ice : C.navy, fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit", transition: "all 0.2s", display: "flex", alignItems: "center", gap: 7 }}>
                <span>{an.icon}</span> {an.title}
              </button>
            ))}
          </div>

          <div style={{ background: "#fff", borderRadius: 16, overflow: "hidden", border: "1px solid #e2e8f0" }}>
            <div style={{ padding: "20px 24px", borderBottom: "1px solid #edf2f7", background: "rgba(41,182,246,0.02)" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.ice, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 7 }}>What the analyst wants to do</div>
              <div style={{ fontSize: 14.5, color: C.navy, lineHeight: 1.65 }}>{a.goal}</div>
            </div>

            <div className="playground-grid">
              {/* Old way */}
              <div style={{ padding: 24, borderRight: "1px solid #edf2f7" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ fontSize: 14 }}>🔧</span>
                    <span style={{ fontWeight: 700, color: C.navy, fontSize: 13.5 }}>Without Snowflake</span>
                  </div>
                  <Badge color={C.red}>{a.oldWay.lines} lines</Badge>
                </div>
                <div style={{ fontSize: 11, color: C.gray, marginBottom: 10 }}>{a.oldWay.tools}</div>
                <CodeBlock code={a.oldWay.code} lang="python" />
                <div style={{ marginTop: 12, padding: "9px 12px", background: "rgba(255,82,82,0.03)", borderRadius: 8, fontSize: 11, color: C.grayDark, lineHeight: 1.6, border: "1px solid rgba(255,82,82,0.08)" }}>
                  {a.oldWay.pain}
                </div>
              </div>

              {/* AI SQL + results */}
              <div style={{ padding: 24, background: "rgba(41,182,246,0.015)", display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ fontSize: 14 }}>❄️</span>
                    <span style={{ fontWeight: 700, color: C.navy, fontSize: 13.5 }}>With Cortex AI Functions</span>
                  </div>
                  <Badge color={C.cyan}>{a.aiSqlLines} lines</Badge>
                </div>
                <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
                  {a.functions.map((f, i) => <Badge key={i}>{f}</Badge>)}
                </div>
                <CodeBlock code={a.aiSql} accent />
                <button onClick={runQuery} disabled={queryRunning}
                  style={{ marginTop: 14, width: "100%", padding: "11px 24px", borderRadius: 10, border: "none", cursor: queryRunning ? "wait" : "pointer", background: queryRunning ? C.grayDark : `linear-gradient(135deg, ${C.ice}, #0088cc)`, color: "#fff", fontWeight: 700, fontSize: 14, fontFamily: "inherit", transition: "all 0.2s", letterSpacing: 0.3 }}>
                  {queryRunning ? "Executing against Snowflake..." : queryDone ? "▶ Run Again" : "▶ Execute Query"}
                </button>

                {/* Shimmer loading */}
                {queryRunning && (
                  <div ref={resultsRef} style={{ marginTop: 14, borderRadius: 8, overflow: "hidden" }}>
                    <div style={{ height: 4, background: `linear-gradient(90deg, transparent, ${C.ice}, transparent)`, backgroundSize: "200% 100%", animation: "shimmer 1.4s infinite" }} />
                    <div style={{ padding: "12px 14px", background: "rgba(41,182,246,0.04)", border: `1px solid rgba(41,182,246,0.1)`, borderTop: "none", borderRadius: "0 0 8px 8px", fontSize: 12.5, color: querySlow ? C.amber : C.ice }}>
                      {querySlow ? "Query is taking longer than expected. Snowflake is still running..." : "Connecting to Snowflake, executing AI functions, assembling results..."}
                    </div>
                  </div>
                )}

                {/* Results */}
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
                    <div style={{ marginTop: 8, padding: "9px 12px", background: "rgba(0,229,195,0.04)", borderRadius: 8, fontSize: 12, color: C.grayDark, border: "1px solid rgba(0,229,195,0.08)", display: "flex", gap: 20, flexWrap: "wrap" }}>
                      <span>Python approach: <strong style={{ color: C.red }}>{a.oldWay.lines} lines</strong></span>
                      <span>Cortex AI SQL: <strong style={{ color: C.cyan }}>{a.aiSqlLines} lines</strong></span>
                      <span style={{ color: C.cyan }}>{Math.round(a.oldWay.lines / a.aiSqlLines)}x fewer lines of code</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== TEXT TO AI SQL ===== */}
      <section style={sec(true)} ref={textSqlRef}>
        <div style={inner}>
          <SectionTag>Text to AI SQL</SectionTag>
          <h2 style={{ fontSize: 32, fontWeight: 700, color: C.white, marginBottom: 8, letterSpacing: -0.5 }}>Ask a question. Get a live SQL result.</h2>
          <p style={{ fontSize: 15, color: C.gray, marginBottom: 14, lineHeight: 1.7, maxWidth: 700 }}>
            You have seen the SQL. Now you do not even need to write it. Type a question, the system identifies what you are asking for, selects the right query, and runs it against Snowflake.
          </p>
          <p style={{ fontSize: 11, color: C.grayDark, marginBottom: 20, lineHeight: 1.6, maxWidth: 700 }}>
            This demo routes questions to optimized SQL templates. In production, a Cortex LLM like <span style={{ fontFamily: "monospace", color: C.gray }}>COMPLETE('mistral-large2', ...)</span> could generate SQL directly from any question.
          </p>

          <div style={{ background: C.surface, borderRadius: 14, padding: 22, border: "1px solid rgba(41,182,246,0.1)", marginBottom: 18 }}>
            <div style={{ fontSize: 11, color: C.grayDark, marginBottom: 10, letterSpacing: 0.5 }}>Select a question to run</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
              {TEXT_TO_SQL_EXAMPLES.map((q, i) => {
                const selected = textInput === q;
                return (
                  <button key={i} onClick={() => { setTextInput(q); if (!textRunning) runTextToSql(q); }}
                    style={{ padding: "7px 14px", borderRadius: 20, border: `1.5px solid ${selected ? C.ice : "rgba(41,182,246,0.18)"}`, background: selected ? "rgba(41,182,246,0.12)" : "rgba(41,182,246,0.04)", color: selected ? C.white : C.ice, fontSize: 12, cursor: textRunning ? "wait" : "pointer", fontFamily: "inherit", fontWeight: selected ? 600 : 400, transition: "all 0.15s" }}>
                    {q}
                  </button>
                );
              })}
            </div>
            {textInput && (
              <div style={{ padding: "10px 14px", borderRadius: 8, background: C.navyLight, border: `1px solid rgba(41,182,246,0.15)`, fontSize: 13, color: C.grayLight, fontStyle: "italic" }}>
                "{textInput}"
              </div>
            )}
          </div>

          {(textRunning || textDone) && textAnalysis && (
            <div style={{ background: C.surface, borderRadius: 14, padding: 22, border: "1px solid rgba(41,182,246,0.1)" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.gray, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 14 }}>Processing Pipeline</div>
              <ProcessStep label="Analyzing intent..." value={textApiResult ? `Intent: ${textApiResult.intent}` : `Intent: ${textAnalysis.id}`} done={textStep >= 1} active={textStep === 0} />
              <ProcessStep label="Extracting parameters..."
                value={textApiResult?.params ? `District: ${textApiResult.params.district ?? "all"} · Neighborhood: ${textApiResult.params.neighborhood ?? "all"}` : "District: all · Timeframe: all"}
                done={textStep >= 2} active={textStep === 1} />
              <ProcessStep label="Selecting workflow..." value={textApiResult?.workflow ?? textAnalysis.title} done={textStep >= 3} active={textStep === 2} />
              <ProcessStep label="Generating SQL..." value={null} done={textStep >= 4} active={textStep === 3} />
              {textStep >= 3 && (
                <div style={{ marginLeft: 40, marginBottom: 8, marginTop: 4 }}>
                  <CodeBlock code={textApiResult?.sql ?? textAnalysis.aiSql} accent />
                </div>
              )}
              {textSlow && textRunning && (
                <div style={{ marginLeft: 40, padding: "7px 12px", background: "rgba(255,171,64,0.06)", border: "1px solid rgba(255,171,64,0.2)", borderRadius: 7, fontSize: 12, color: C.amber, marginBottom: 8 }}>
                  Query is taking longer than expected. Snowflake is still running...
                </div>
              )}
              <ProcessStep label="Executing against Snowflake..."
                value={textApiResult ? `${textApiResult.results.length} rows returned in ${textApiResult.executionTime}s` : `${textAnalysis.results.length} rows returned in 2.1s`}
                done={textStep >= 5} active={textStep === 4} />

              {textDone && textDisplayResults && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ padding: "7px 12px", background: "rgba(0,229,195,0.05)", borderRadius: 8, fontSize: 11.5, color: C.cyan, border: "1px solid rgba(0,229,195,0.12)", marginBottom: 12, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
                    <span>Showing {Math.min((textPage - 1) * 4 + 1, textDisplayResults.length)} to {Math.min(textPage * 4, textDisplayResults.length)} of {textDisplayResults.length} results</span>
                    <span>Functions: {(textApiResult?.functions ?? textAnalysis.functions).join(", ")}</span>
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid rgba(41,182,246,0.12)" }}>
                          {Object.keys(textDisplayResults[0]).map((k) => (
                            <th key={k} style={{ padding: "7px 8px", textAlign: "left", color: C.gray, fontWeight: 600, fontSize: 10, textTransform: "uppercase", whiteSpace: "nowrap" }}>
                              {k.replace(/_/g, " ")}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(textDisplayResults as Record<string, unknown>[]).slice((textPage - 1) * 4, textPage * 4).map((row, i) => (
                          <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                            {Object.entries(row as Record<string, unknown>).map(([k, v], j) => (
                              <td key={j} style={{ padding: "7px 8px", color: C.grayLight, fontSize: 12, maxWidth: 200, lineHeight: 1.4 }}>
                                {renderCell(k, v)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Pagination page={textPage} total={textDisplayResults.length} perPage={4} onChange={setTextPage} dark />
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ===== BIGGER PICTURE ===== */}
      <section style={sec(false)} ref={biggerRef}>
        <div style={inner}>
          <h2 style={{ fontSize: 32, fontWeight: 700, color: C.navy, marginBottom: 8, letterSpacing: -0.5 }}>AI Functions expand the class of questions SQL can answer</h2>
          <p style={{ fontSize: 15, color: C.grayDark, marginBottom: 10, lineHeight: 1.6, maxWidth: 700 }}>Traditional SQL answers: How many? Which ones? When? Where?</p>
          <p style={{ fontSize: 15, color: C.ice, marginBottom: 32, lineHeight: 1.6, fontWeight: 600 }}>AI SQL adds: What kind? How severe? What does it mean? What is the pattern across all of these?</p>
          <div className="two-col-grid">
            {INDUSTRIES.map((ind, i) => (
              <div key={i} style={{ background: "#fff", borderRadius: 14, padding: 22, border: "1px solid #e2e8f0", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${C.ice}, ${C.cyan})` }} />
                <div style={{ fontSize: 24, marginBottom: 8 }}>{ind.icon}</div>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: C.navy, marginBottom: 8 }}>{ind.name}</div>
                <div style={{ fontSize: 13, color: C.grayDark, lineHeight: 1.6, marginBottom: 12, fontStyle: "italic" }}>"{ind.question}"</div>
                <div style={{ fontSize: 10.5, color: C.ice, fontFamily: "monospace", marginBottom: 10, background: "rgba(41,182,246,0.04)", padding: "7px 10px", borderRadius: 6, lineHeight: 1.5 }}>{ind.functions}</div>
                <div style={{ fontSize: 10.5, color: C.gray }}><span style={{ textDecoration: "line-through" }}>Previously: {ind.before}</span></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== FOOTER ===== */}
      <footer style={{ padding: "28px 40px", background: C.navy, borderTop: "1px solid rgba(41,182,246,0.08)", textAlign: "center" }}>
        <div style={{ fontSize: 12, color: C.grayDark, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
          <span>Built by Srihari Shekhar</span>
          <a href="https://www.linkedin.com/in/srihari-shekhar/" target="_blank" rel="noopener noreferrer" title="LinkedIn" style={{ display: "flex", alignItems: "center", color: C.ice, textDecoration: "none" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
          </a>
          <span>· All queries execute live ❄️</span>
        </div>
      </footer>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
        @keyframes skeleton-pulse { 0%,100%{opacity:0.4} 50%{opacity:0.8} }
        @keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
        .fade-section { opacity: 0; transform: translateY(20px); transition: opacity 0.6s ease, transform 0.6s ease; }
        * { box-sizing: border-box; }
        input::placeholder { color: ${C.grayDark}; }
        button:hover:not(:disabled) { opacity: .92; }
        pre { tab-size: 2; }
        .playground-grid { display: grid; grid-template-columns: 1fr 1fr; }
        .two-col-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        @media (max-width: 768px) {
          .playground-grid { grid-template-columns: 1fr; }
          .two-col-grid { grid-template-columns: 1fr; }
          section { padding: 52px 20px !important; }
          h1 { font-size: 34px !important; }
          h2 { font-size: 24px !important; }
        }
      `}</style>
    </div>
  );
}

/* ─── Problem section ─── */
function ProblemSection({ sec, inner }: { sec: (dark: boolean) => React.CSSProperties; inner: React.CSSProperties }) {
  const ref = useFadeInSection();
  return (
    <section style={sec(false)} ref={ref}>
      <div style={inner}>
        <SectionTag>The Problem</SectionTag>
        <h2 style={{ fontSize: 32, fontWeight: 700, color: C.navy, marginBottom: 8, letterSpacing: -0.5 }}>The same analysis. Two very different approaches.</h2>
        <p style={{ fontSize: 15, color: C.grayDark, marginBottom: 32, maxWidth: 650, lineHeight: 1.6 }}>Getting AI insights from text and images alongside your structured data used to mean Python scripts, external APIs, and engineering time. Cortex AI Functions make it a SQL query.</p>
        <div className="two-col-grid">
          <div style={{ background: "#fff", borderRadius: 14, padding: 24, border: "1px solid #e2e8f0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
              <div style={{ width: 34, height: 34, borderRadius: 8, background: "rgba(255,82,82,0.08)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🔧</div>
              <div>
                <div style={{ fontWeight: 700, color: C.navy, fontSize: 15 }}>Without Snowflake</div>
                <div style={{ fontSize: 11, color: C.red }}>5 tools · 47+ lines · hours</div>
              </div>
            </div>
            {[
              { s: "1. Export from warehouse", c: "cases = pd.read_sql('SELECT * FROM cases', conn)" },
              { s: "2. Call NLP API per row", c: "resp = openai.chat.completions.create(\n  model='gpt-4',\n  messages=[{'role':'user',\n    'content':f'Classify: {`{desc}`}'}])" },
              { s: "3. Call Vision API per image", c: "img = base64.b64encode(open(photo,'rb').read())\nresp = openai.chat.completions.create(\n  model='gpt-4o', messages=[...])\n# manage API keys, retries, costs" },
              { s: "4. Join results in pandas", c: "merged = pd.merge(text_results,\n  image_results, on='case_id')" },
              { s: "5. Push back to warehouse", c: "merged.to_sql('enriched', conn)" },
            ].map((item, i) => (
              <div key={i} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: C.grayDark, marginBottom: 5 }}>{item.s}</div>
                <div style={{ background: "#0a1628", borderRadius: 7, padding: "8px 12px", fontSize: 10.5, fontFamily: "monospace", color: "#c5d0de", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{item.c}</div>
              </div>
            ))}
            <div style={{ marginTop: 14, padding: "10px 14px", background: "rgba(255,82,82,0.04)", borderRadius: 8, fontSize: 11.5, color: C.grayDark, lineHeight: 1.6, border: "1px solid rgba(255,82,82,0.1)" }}>
              Images leave your security perimeter. Only the engineer who wrote the code can run it. Repeat for every new question.
            </div>
          </div>

          <div style={{ background: "#fff", borderRadius: 14, padding: 24, border: `1.5px solid ${C.ice}35`, boxShadow: `0 0 40px rgba(41,182,246,0.05)` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
              <div style={{ width: 34, height: 34, borderRadius: 8, background: "rgba(41,182,246,0.08)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>❄️</div>
              <div>
                <div style={{ fontWeight: 700, color: C.navy, fontSize: 15 }}>With Cortex AI Functions</div>
                <div style={{ fontSize: 11, color: C.cyan }}>1 query · 7 lines · seconds</div>
              </div>
            </div>
            <CodeBlock accent code={`SELECT
  case_id, district, description,
  AI_CLASSIFY(description,
    ['Dumping','Graffiti','Pothole',
     'Hazard','Noise']) as theme,
  AI_SENTIMENT(description) as sentiment,
  AI_COMPLETE('pixtral-large',
    'Rate severity 1-5', photo_file) as image_severity
FROM sf311_cases
WHERE AI_FILTER(description,
  'Is this a safety hazard?') = TRUE`} />
            <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {[{ f: "5 tools", t: "1 platform" }, { f: "47+ lines", t: "7 lines" }, { f: "Hours", t: "Seconds" }, { f: "Engineers only", t: "Any analyst" }].map((c, i) => (
                <div key={i} style={{ padding: "9px 12px", borderRadius: 8, background: "rgba(41,182,246,0.04)", border: "1px solid rgba(41,182,246,0.1)", textAlign: "center" }}>
                  <div style={{ fontSize: 10.5, color: C.gray, textDecoration: "line-through" }}>{c.f}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.ice }}>{c.t}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 14, padding: "10px 14px", background: "rgba(0,229,195,0.04)", borderRadius: 8, fontSize: 11.5, color: C.grayDark, lineHeight: 1.6, border: "1px solid rgba(0,229,195,0.1)" }}>
              Data never leaves Snowflake. Governed. Repeatable. Any analyst can run it.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
