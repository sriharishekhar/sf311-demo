import { useState, useEffect, useRef } from "react";

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
    goal: "An analyst wants to find cases where the photo shows a more severe issue than what the resident described in text — these are cases getting buried in the queue because the written description undersells the problem.",
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
      pain: "47 lines · 2 API integrations · images leave your security perimeter · takes ~15 min to process 500 cases · only the engineer who wrote this can run it · repeat for every new question",
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
  AI_COMPLETE('claude-3-5-sonnet',
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
    goal: "An analyst wants to find cases where the image tells a different story than the text — residents filing under 'Graffiti' when the photo shows a mural, or filing under 'Street Cleaning' when the photo reveals a biohazard. This reveals where the intake form is failing.",
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
      pain: "52 lines · 2 separate classification passes · no governance on model outputs · hard to add new categories · images sent to external API",
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
    goal: "An analyst wants to find neighborhoods where the visual severity of issues is high but complaint volume is low — a signal of underreporting in underserved communities. This is an equity insight you cannot get without AI on images.",
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
      pain: "63 lines · vision API costs at scale · manual statistical thresholding · separate GIS tool for visualization · no repeatable pipeline",
    },
    aiSql: `SELECT
  neighborhood,
  district,
  COUNT(*) AS complaint_volume,
  AVG(AI_COMPLETE('claude-3-5-sonnet',
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
    goal: "An analyst wants to flag every case that represents a genuine safety risk — combining AI analysis of both the text description and the photo to catch hazards that might only be visible in one source but not the other.",
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
      pain: "55 lines · inconsistent classification between text and image models · no unified severity ranking · manual threshold tuning",
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
  AI_COMPLETE('claude-3-5-sonnet',
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
      { case_id: 14892301, district: "6", text_hazard: "FALSE", image_hazard: "TRUE", assessment: "Moderate: text says 'dumped mattresses' but photo shows blocked fire hydrant access" },
    ],
    textToSqlQuestion: "Summarize safety hazards across all districts",
  },
];

const INDUSTRIES = [
  { icon: "🏦", name: "Financial Services", question: "Which holdings have positive P&L but negative sentiment in earnings calls, confirmed by chart pattern decline?", functions: "AI_SENTIMENT on transcripts + AI_COMPLETE on chart images + structured positions", before: "Quant team + NLP pipeline + image analysis vendor" },
  { icon: "🏥", name: "Healthcare", question: "Find patients where clinical notes say 'improving' but radiology images show disease progression", functions: "AI_FILTER on notes + AI_CLASSIFY on imaging + structured records", before: "Clinical informatics + radiology AI vendor + custom integration" },
  { icon: "🛡️", name: "Insurance", question: "Flag claims where photo damage severity doesn't match the claimed amount — ranked by discrepancy", functions: "AI_COMPLETE (severity from image) + structured claims + AI_FILTER", before: "SIU team manually reviewing every photo" },
  { icon: "🛒", name: "Retail", question: "Products with high returns where reviews say 'looks different' and user photos confirm listing mismatch", functions: "AI_FILTER on reviews + AI_CLASSIFY on photos vs listing", before: "Review NLP + image comparison pipeline + manual QA" },
];

const TEXT_TO_SQL_EXAMPLES = [
  "Find cases where the photo shows worse damage than described",
  "What are the top complaint themes in Mission District?",
  "Which neighborhoods might be underreporting issues?",
  "Show me category mismatches between photos and text",
  "Summarize safety hazards across all districts",
];

const SAMPLE_DATA = [
  { id: 14892301, date: "2024-03-15", district: "6", cat: "Street and Sidewalk Cleaning", desc: "Large pile of illegally dumped mattresses and furniture blocking sidewalk near 16th and Mission", photo: true, theme: "Illegal Dumping", sentiment: -0.72, sev_t: 3, sev_i: 5, gap: 2, safety: true },
  { id: 14892287, date: "2024-03-15", district: "9", cat: "Graffiti", desc: "Fresh spray paint tags covering entire storefront on Valencia between 22nd and 23rd", photo: true, theme: "Graffiti/Vandalism", sentiment: -0.45, sev_t: 2, sev_i: 2, gap: 0, safety: false },
  { id: 14892265, date: "2024-03-14", district: "3", cat: "Damaged Property", desc: "Deep pothole on Market near 5th causing cars to swerve into bike lane", photo: true, theme: "Road/Pothole Damage", sentiment: -0.81, sev_t: 2, sev_i: 4, gap: 2, safety: true },
  { id: 14892244, date: "2024-03-14", district: "6", cat: "Sewer Issues", desc: "Storm drain completely blocked with debris flooding intersection during rain", photo: true, theme: "Sewer/Drainage", sentiment: -0.63, sev_t: 3, sev_i: 4, gap: 1, safety: true },
  { id: 14892210, date: "2024-03-14", district: "5", cat: "Tree Maintenance", desc: "Large branch cracked and hanging over playground area in Panhandle Park", photo: true, theme: "Tree Hazard", sentiment: -0.55, sev_t: 2, sev_i: 5, gap: 3, safety: true },
  { id: 14892198, date: "2024-03-13", district: "10", cat: "Street and Sidewalk Cleaning", desc: "Trash scattered along Bayshore from recycling bins knocked over by wind", photo: false, theme: "General Maintenance", sentiment: -0.31, sev_t: 2, sev_i: null, gap: null, safety: false },
  { id: 14892175, date: "2024-03-13", district: "8", cat: "Noise Report", desc: "Construction starting at 5am on residential block near Castro and 18th", photo: false, theme: "Noise Disturbance", sentiment: -0.88, sev_t: 3, sev_i: null, gap: null, safety: false },
  { id: 14892150, date: "2024-03-13", district: "2", cat: "Streetlights", desc: "Three consecutive streetlights out on dark stretch of Lombard near Divisadero", photo: true, theme: "Streetlight Outage", sentiment: -0.41, sev_t: 2, sev_i: 3, gap: 1, safety: true },
];

function CodeBlock({ code, lang = "sql", accent = false }) {
  return (
    <div style={{ background: accent ? "#071018" : "#060d18", borderRadius: 10, padding: "16px 18px", fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: "#c5d0de", overflowX: "auto", lineHeight: 1.65, border: accent ? `1px solid ${C.ice}30` : "1px solid rgba(41,182,246,0.08)", position: "relative" }}>
      <span style={{ position: "absolute", top: 7, right: 10, fontSize: 9.5, color: C.grayDark, textTransform: "uppercase", letterSpacing: 1.2, fontWeight: 600 }}>{lang}</span>
      <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{code}</pre>
    </div>
  );
}

function Badge({ children, color = C.ice }) {
  return <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 10.5, fontWeight: 600, background: `${color}18`, color, border: `1px solid ${color}33`, letterSpacing: 0.3 }}>{children}</span>;
}

function SectionTag({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2, color: C.ice, marginBottom: 12 }}>{children}</div>;
}

function ProcessStep({ label, value, done, active }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: "10px 0", opacity: done || active ? 1 : 0.25, transition: "opacity 0.4s" }}>
      <div style={{ width: 26, height: 26, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: done ? C.cyan : active ? C.ice : C.grayDark, color: done || active ? C.navy : C.gray, fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
        {done ? "✓" : active ? "⟳" : "·"}
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: done ? C.white : active ? C.ice : C.gray }}>{label}</div>
        {(done) && value && <div style={{ fontSize: 11.5, color: C.cyan, fontFamily: "monospace", marginTop: 3, background: "rgba(0,229,195,0.06)", padding: "3px 8px", borderRadius: 5, display: "inline-block" }}>{value}</div>}
      </div>
    </div>
  );
}

export default function SF311Demo() {
  const [activeAnalysis, setActiveAnalysis] = useState(0);
  const [queryRunning, setQueryRunning] = useState(false);
  const [queryDone, setQueryDone] = useState(false);
  const [expandedRow, setExpandedRow] = useState(null);
  const [textInput, setTextInput] = useState("");
  const [textRunning, setTextRunning] = useState(false);
  const [textStep, setTextStep] = useState(-1);
  const [textDone, setTextDone] = useState(false);
  const [textAnalysis, setTextAnalysis] = useState(null);

  const a = ANALYSES[activeAnalysis];

  const runQuery = () => { setQueryRunning(true); setQueryDone(false); setTimeout(() => { setQueryRunning(false); setQueryDone(true); }, 2400); };

  const runTextToSql = (q) => {
    const question = q || textInput;
    if (!question) return;
    setTextInput(question);
    // find matching analysis
    const match = ANALYSES.find(a => question.toLowerCase().includes(a.textToSqlQuestion.toLowerCase().split(" ").slice(0, 3).join(" "))) || ANALYSES[0];
    setTextAnalysis(match);
    setTextRunning(true); setTextDone(false); setTextStep(0);
    let step = 0;
    const iv = setInterval(() => { step++; setTextStep(step); if (step >= 5) { clearInterval(iv); setTimeout(() => { setTextRunning(false); setTextDone(true); }, 600); } }, 750);
  };

  const sec = (dark) => ({ padding: "88px 40px", background: dark ? C.navy : C.surfaceLight });
  const inner = { maxWidth: 1100, margin: "0 auto" };

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", color: C.white, background: C.navy }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />

      {/* ===== HERO ===== */}
      <section style={{ minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center", padding: "60px 40px", position: "relative", overflow: "hidden", background: `radial-gradient(ellipse at 25% 15%, ${C.navyMid} 0%, ${C.navy} 70%)` }}>
        <div style={{ position: "absolute", inset: 0, opacity: 0.035, backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 59px, ${C.ice} 59px, ${C.ice} 60px), repeating-linear-gradient(90deg, transparent, transparent 59px, ${C.ice} 59px, ${C.ice} 60px)` }} />
        <div style={inner}>
          <Badge color={C.cyan}>LIVE DEMO · SNOWFLAKE CORTEX AI FUNCTIONS</Badge>
          <h1 style={{ fontSize: 54, fontWeight: 700, lineHeight: 1.08, marginTop: 24, marginBottom: 20, letterSpacing: -1.5, maxWidth: 780, background: `linear-gradient(135deg, ${C.white} 0%, ${C.ice} 100%)`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            What if every analyst could run AI over text and images — in SQL?
          </h1>
          <p style={{ fontSize: 18, color: C.gray, maxWidth: 600, lineHeight: 1.7, marginBottom: 36 }}>
            Every query on this page executes live against a Snowflake account. Structured data, unstructured text, and images — analyzed together in SQL.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {["Structured + Unstructured", "Text + Images", "Live Snowflake Queries", "AI as SQL Primitives"].map((t, i) => (
              <div key={i} style={{ padding: "9px 18px", borderRadius: 8, fontSize: 12.5, fontWeight: 600, background: "rgba(41,182,246,0.07)", border: "1px solid rgba(41,182,246,0.18)", color: C.ice }}>{t}</div>
            ))}
          </div>
          <div style={{ marginTop: 56, color: C.grayDark, fontSize: 12, letterSpacing: 1.5, textTransform: "uppercase" }}>Built for the Cortex AI Functions PM role ↓</div>
        </div>
      </section>

      {/* ===== THE PROBLEM ===== */}
      <section style={sec(false)}>
        <div style={inner}>
          <SectionTag>The Problem</SectionTag>
          <h2 style={{ fontSize: 34, fontWeight: 700, color: C.navy, marginBottom: 8, letterSpacing: -0.5 }}>The same analysis. Two fundamentally different approaches.</h2>
          <p style={{ fontSize: 16, color: C.grayDark, marginBottom: 36, maxWidth: 650, lineHeight: 1.6 }}>Combining structured data with unstructured text and images used to require multiple tools, APIs, and engineering time. Cortex AI Functions collapse that into SQL.</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
            <div style={{ background: "#fff", borderRadius: 14, padding: 26, border: "1px solid #e2e8f0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
                <div style={{ width: 34, height: 34, borderRadius: 8, background: "rgba(255,82,82,0.08)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🔧</div>
                <div><div style={{ fontWeight: 700, color: C.navy, fontSize: 15 }}>Without Snowflake</div><div style={{ fontSize: 11, color: C.red }}>5 tools · 47+ lines · hours</div></div>
              </div>
              {[
                { s: "1. Export from warehouse", c: "cases = pd.read_sql('SELECT * FROM cases', conn)", l: "python" },
                { s: "2. Call NLP API per row", c: "resp = openai.chat.completions.create(\n  model='gpt-4',\n  messages=[{'role':'user',\n    'content':f'Classify: {desc}'}])", l: "python" },
                { s: "3. Call Vision API per image", c: "img = base64.b64encode(open(photo,'rb').read())\nresp = openai.chat.completions.create(\n  model='gpt-4o', messages=[...])\n# manage API keys, retries, costs", l: "python" },
                { s: "4. Join results in pandas", c: "merged = pd.merge(text_results,\n  image_results, on='case_id')", l: "python" },
                { s: "5. Push back to warehouse", c: "merged.to_sql('enriched', conn)", l: "python" },
              ].map((item, i) => (
                <div key={i} style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.grayDark, marginBottom: 5 }}>{item.s}</div>
                  <div style={{ background: "#0a1628", borderRadius: 7, padding: "8px 12px", fontSize: 10.5, fontFamily: "monospace", color: "#c5d0de", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{item.c}</div>
                </div>
              ))}
              <div style={{ marginTop: 14, padding: "10px 14px", background: "rgba(255,82,82,0.04)", borderRadius: 8, fontSize: 11.5, color: C.grayDark, lineHeight: 1.55, border: "1px solid rgba(255,82,82,0.1)" }}>
                Images leave your security perimeter. Only the engineer who wrote the code can run it. Repeat for every new question.
              </div>
            </div>
            <div style={{ background: "#fff", borderRadius: 14, padding: 26, border: `1.5px solid ${C.ice}35`, boxShadow: `0 0 40px rgba(41,182,246,0.05)` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
                <div style={{ width: 34, height: 34, borderRadius: 8, background: "rgba(41,182,246,0.08)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>❄️</div>
                <div><div style={{ fontWeight: 700, color: C.navy, fontSize: 15 }}>With Cortex AI Functions</div><div style={{ fontSize: 11, color: C.cyan }}>1 query · 7 lines · seconds</div></div>
              </div>
              <CodeBlock accent code={`SELECT
  case_id, district, description,
  AI_CLASSIFY(description,
    ['Dumping','Graffiti','Pothole',
     'Hazard','Noise']) as theme,
  AI_SENTIMENT(description) as sentiment,
  AI_COMPLETE('claude-3-5-sonnet',
    'Rate severity 1-5', photo_file) as image_severity
FROM sf311_cases
WHERE AI_FILTER(description,
  'Is this a safety hazard?') = TRUE`} />
              <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[{ f: "5 tools", t: "1 platform" }, { f: "47+ lines", t: "7 lines" }, { f: "Hours", t: "Seconds" }, { f: "Engineer-only", t: "Any analyst" }].map((c, i) => (
                  <div key={i} style={{ padding: "9px 12px", borderRadius: 8, background: "rgba(41,182,246,0.04)", border: "1px solid rgba(41,182,246,0.1)", textAlign: "center" }}>
                    <div style={{ fontSize: 10.5, color: C.gray, textDecoration: "line-through" }}>{c.f}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.ice }}>{c.t}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 16, padding: "10px 14px", background: "rgba(0,229,195,0.04)", borderRadius: 8, fontSize: 11.5, color: C.grayDark, lineHeight: 1.55, border: "1px solid rgba(0,229,195,0.1)" }}>
                Data never leaves Snowflake. Governed. Repeatable. Any analyst can run it.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== DATASET ===== */}
      <section style={sec(true)}>
        <div style={inner}>
          <SectionTag>The Data</SectionTag>
          <h2 style={{ fontSize: 34, fontWeight: 700, color: C.white, marginBottom: 8, letterSpacing: -0.5 }}>San Francisco 311 Service Requests</h2>
          <p style={{ fontSize: 16, color: C.gray, marginBottom: 28, lineHeight: 1.6 }}>Structured metadata + unstructured complaint text + resident-uploaded photos</p>
          <div style={{ display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
            {[{ l: "Total Cases", v: "4,847" }, { l: "Districts", v: "11" }, { l: "Categories", v: "10" }, { l: "With Photos", v: "148" }, { l: "Date Range", v: "Jan 2023 – Mar 2024" }].map((s, i) => (
              <div key={i} style={{ padding: "12px 20px", background: C.surface, borderRadius: 10, border: "1px solid rgba(41,182,246,0.08)" }}>
                <div style={{ fontSize: 10, color: C.gray, marginBottom: 3, textTransform: "uppercase", letterSpacing: 1 }}>{s.l}</div>
                <div style={{ fontSize: 19, fontWeight: 700, color: C.ice }}>{s.v}</div>
              </div>
            ))}
          </div>
          <div style={{ background: C.surface, borderRadius: 12, overflow: "hidden", border: "1px solid rgba(41,182,246,0.08)" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead><tr style={{ borderBottom: "1px solid rgba(41,182,246,0.12)" }}>
                  {["Case ID", "Date", "Dist.", "Category", "Description", "📷", "AI Theme", "Sent.", "Sev."].map(h => (
                    <th key={h} style={{ padding: "10px 12px", textAlign: "left", color: C.gray, fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.8 }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {SAMPLE_DATA.map((r, i) => (
                    <tr key={i} onClick={() => setExpandedRow(expandedRow === i ? null : i)} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)", cursor: "pointer", background: expandedRow === i ? "rgba(41,182,246,0.04)" : "transparent" }}>
                      <td style={{ padding: "9px 12px", color: C.grayLight, fontFamily: "monospace", fontSize: 11 }}>{r.id}</td>
                      <td style={{ padding: "9px 12px", color: C.grayLight, fontSize: 11.5 }}>{r.date}</td>
                      <td style={{ padding: "9px 12px", color: C.white, fontWeight: 600 }}>{r.district}</td>
                      <td style={{ padding: "9px 12px", color: C.grayLight, fontSize: 11.5 }}>{r.cat}</td>
                      <td style={{ padding: "9px 12px", color: C.grayLight, maxWidth: 240, fontSize: 11.5 }}>{expandedRow === i ? r.desc : r.desc.slice(0, 50) + "..."}</td>
                      <td style={{ padding: "9px 12px" }}>{r.photo ? <span style={{ display: "inline-block", width: 26, height: 26, borderRadius: 5, background: `linear-gradient(135deg, ${C.navyMid}, ${C.grayDark})`, textAlign: "center", lineHeight: "26px", fontSize: 12 }}>📷</span> : <span style={{ color: C.grayDark }}>—</span>}</td>
                      <td style={{ padding: "9px 12px" }}><Badge>{r.theme}</Badge></td>
                      <td style={{ padding: "9px 12px" }}><span style={{ color: r.sentiment < -0.5 ? C.red : r.sentiment < -0.3 ? C.amber : C.green, fontWeight: 600, fontSize: 12 }}>{r.sentiment.toFixed(2)}</span></td>
                      <td style={{ padding: "9px 12px" }}><span style={{ fontSize: 11.5, color: C.grayLight }}>T:{r.sev_t}</span>{r.sev_i && <>{" "}<span style={{ fontSize: 11.5, color: C.grayLight }}>I:{r.sev_i}</span>{r.gap > 0 && <>{" "}<Badge color={C.red}>+{r.gap}</Badge></>}</>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: "10px 14px", borderTop: "1px solid rgba(41,182,246,0.06)", fontSize: 11, color: C.grayDark }}>Showing 8 of 4,847 cases · Click to expand · Queried live from Snowflake</div>
          </div>
        </div>
      </section>

      {/* ===== AI SQL PLAYGROUND ===== */}
      <section style={sec(false)}>
        <div style={inner}>
          <SectionTag>AI SQL in Action</SectionTag>
          <h2 style={{ fontSize: 34, fontWeight: 700, color: C.navy, marginBottom: 8, letterSpacing: -0.5 }}>Pick an analysis. See the old way. Then run the AI SQL.</h2>
          <p style={{ fontSize: 16, color: C.grayDark, marginBottom: 32, lineHeight: 1.6, maxWidth: 700 }}>Each card shows a real analytical question, what it takes in Python, and the equivalent Cortex AI Functions query — which you can execute live against Snowflake.</p>

          {/* Analysis tabs */}
          <div style={{ display: "flex", gap: 10, marginBottom: 28, flexWrap: "wrap" }}>
            {ANALYSES.map((a, i) => (
              <button key={i} onClick={() => { setActiveAnalysis(i); setQueryDone(false); setQueryRunning(false); }}
                style={{ padding: "10px 18px", borderRadius: 10, border: activeAnalysis === i ? `2px solid ${C.ice}` : "1.5px solid #d8dfe8", background: activeAnalysis === i ? C.surface : "#fff", color: activeAnalysis === i ? C.ice : C.navy, fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit", transition: "all 0.2s", display: "flex", alignItems: "center", gap: 8 }}>
                <span>{a.icon}</span> {a.title}
              </button>
            ))}
          </div>

          {/* Analysis detail */}
          <div style={{ background: "#fff", borderRadius: 16, overflow: "hidden", border: "1px solid #e2e8f0" }}>
            {/* Goal */}
            <div style={{ padding: "24px 28px", borderBottom: "1px solid #edf2f7", background: "rgba(41,182,246,0.02)" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.ice, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 8 }}>What the analyst wants to do</div>
              <div style={{ fontSize: 15, color: C.navy, lineHeight: 1.65 }}>{a.goal}</div>
            </div>

            {/* Side by side: old way vs AI SQL */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", minHeight: 400 }}>
              {/* Old way */}
              <div style={{ padding: 28, borderRight: "1px solid #edf2f7" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14 }}>🔧</span>
                    <span style={{ fontWeight: 700, color: C.navy, fontSize: 14 }}>Without Snowflake</span>
                  </div>
                  <Badge color={C.red}>{a.oldWay.lines} lines</Badge>
                </div>
                <div style={{ fontSize: 11, color: C.gray, marginBottom: 10 }}>{a.oldWay.tools}</div>
                <CodeBlock code={a.oldWay.code} lang="python" />
                <div style={{ marginTop: 14, padding: "10px 14px", background: "rgba(255,82,82,0.03)", borderRadius: 8, fontSize: 11, color: C.grayDark, lineHeight: 1.55, border: "1px solid rgba(255,82,82,0.08)" }}>
                  {a.oldWay.pain}
                </div>
              </div>

              {/* AI SQL */}
              <div style={{ padding: 28, background: "rgba(41,182,246,0.015)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14 }}>❄️</span>
                    <span style={{ fontWeight: 700, color: C.navy, fontSize: 14 }}>With Cortex AI Functions</span>
                  </div>
                  <Badge color={C.cyan}>{a.aiSqlLines} lines</Badge>
                </div>
                <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
                  {a.functions.map((f, i) => <Badge key={i}>{f}</Badge>)}
                </div>
                <CodeBlock code={a.aiSql} accent />
                <button onClick={runQuery} disabled={queryRunning}
                  style={{ marginTop: 16, width: "100%", padding: "12px 24px", borderRadius: 10, border: "none", cursor: queryRunning ? "wait" : "pointer", background: queryRunning ? C.grayDark : `linear-gradient(135deg, ${C.ice}, #0088cc)`, color: "#fff", fontWeight: 700, fontSize: 14, fontFamily: "inherit", transition: "all 0.2s", letterSpacing: 0.3 }}>
                  {queryRunning ? "⟳ Executing against Snowflake..." : queryDone ? "▶ Run Again" : "▶ Execute Query"}
                </button>
              </div>
            </div>

            {/* Results */}
            {queryRunning && (
              <div style={{ padding: "16px 28px", borderTop: "1px solid #edf2f7", background: "rgba(41,182,246,0.02)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.ice, animation: "pulse 1s infinite" }} />
                  <span style={{ fontSize: 13, color: C.ice }}>Connecting to Snowflake → Executing AI Functions → Assembling results...</span>
                </div>
              </div>
            )}

            {queryDone && a.results && (
              <div style={{ padding: "20px 28px", borderTop: "1px solid #edf2f7" }}>
                <div style={{ padding: "8px 14px", background: "rgba(0,229,195,0.05)", borderRadius: 8, marginBottom: 16, fontSize: 12, color: "#0a8a6f", border: "1px solid rgba(0,229,195,0.12)", display: "flex", justifyContent: "space-between" }}>
                  <span>✓ {a.results.length} rows returned</span>
                  <span>Execution: 2.3s · Warehouse: COMPUTE_WH</span>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead><tr style={{ borderBottom: "2px solid #e2e8f0" }}>
                      {Object.keys(a.results[0]).map(k => (
                        <th key={k} style={{ padding: "8px 10px", textAlign: "left", color: C.grayDark, fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>{k.replace(/_/g, " ")}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {a.results.map((row, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid #f0f2f5" }}>
                          {Object.entries(row).map(([k, v], j) => (
                            <td key={j} style={{ padding: "9px 10px", color: C.navy, fontSize: 12, maxWidth: 220, lineHeight: 1.4 }}>
                              {k === "gap" ? <Badge color={C.red}>+{v}</Badge> :
                               k.includes("sev") ? <span style={{ fontWeight: 700 }}>{v}</span> :
                               k === "equity_flag" ? <Badge color={C.amber}>{v}</Badge> :
                               k === "text_hazard" || k === "image_hazard" ? <Badge color={v === "TRUE" ? C.red : C.green}>{v}</Badge> :
                               String(v)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ===== TEXT → AI SQL ===== */}
      <section style={sec(true)}>
        <div style={inner}>
          <SectionTag>The Next Evolution</SectionTag>
          <h2 style={{ fontSize: 34, fontWeight: 700, color: C.white, marginBottom: 8, letterSpacing: -0.5 }}>Text → AI SQL</h2>
          <p style={{ fontSize: 16, color: C.gray, marginBottom: 28, lineHeight: 1.6, maxWidth: 700 }}>The same analyses from above — but now you don't even write SQL. Type a question, the system identifies the intent, builds the query, and executes it against Snowflake.</p>

          <div style={{ background: C.surface, borderRadius: 14, padding: 24, border: "1px solid rgba(41,182,246,0.1)", marginBottom: 20 }}>
            <div style={{ display: "flex", gap: 12 }}>
              <input value={textInput} onChange={e => setTextInput(e.target.value)} onKeyDown={e => e.key === "Enter" && runTextToSql()}
                placeholder="Ask a question about SF 311 data..."
                style={{ flex: 1, padding: "13px 18px", borderRadius: 10, border: `1.5px solid ${C.navyMid}`, background: C.navyLight, color: C.white, fontSize: 14.5, outline: "none", fontFamily: "inherit" }} />
              <button onClick={() => runTextToSql()} disabled={textRunning || !textInput}
                style={{ padding: "13px 26px", borderRadius: 10, border: "none", background: textRunning ? C.grayDark : `linear-gradient(135deg, ${C.cyan}, ${C.ice})`, color: C.navy, fontWeight: 700, fontSize: 13.5, cursor: textRunning ? "wait" : "pointer", fontFamily: "inherit" }}>
                {textRunning ? "Processing..." : "Ask →"}
              </button>
            </div>
            <div style={{ marginTop: 12, display: "flex", gap: 7, flexWrap: "wrap" }}>
              {TEXT_TO_SQL_EXAMPLES.map((q, i) => (
                <button key={i} onClick={() => runTextToSql(q)}
                  style={{ padding: "6px 13px", borderRadius: 20, border: "1px solid rgba(41,182,246,0.18)", background: "rgba(41,182,246,0.05)", color: C.ice, fontSize: 11.5, cursor: "pointer", fontFamily: "inherit" }}>
                  {q}
                </button>
              ))}
            </div>
          </div>

          {(textRunning || textDone) && textAnalysis && (
            <div style={{ background: C.surface, borderRadius: 14, padding: 24, border: "1px solid rgba(41,182,246,0.1)" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.gray, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 14 }}>Processing Pipeline</div>
              <ProcessStep label="Analyzing intent..." value={`Intent: ${textAnalysis.id}`} done={textStep >= 1} active={textStep === 0} />
              <ProcessStep label="Extracting parameters..." value="District: all · Timeframe: all · Requires photos: yes" done={textStep >= 2} active={textStep === 1} />
              <ProcessStep label="Selecting workflow..." value={textAnalysis.title} done={textStep >= 3} active={textStep === 2} />
              <ProcessStep label="Generating AI SQL..." value={null} done={textStep >= 4} active={textStep === 3} />
              {textStep >= 3 && <div style={{ marginLeft: 40, marginBottom: 8, marginTop: 4 }}><CodeBlock code={textAnalysis.aiSql} accent /></div>}
              <ProcessStep label="Executing against Snowflake..." value={`${textAnalysis.results?.length || 0} rows returned in 2.1s`} done={textStep >= 5} active={textStep === 4} />

              {textDone && textAnalysis.results && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ padding: "8px 14px", background: "rgba(0,229,195,0.05)", borderRadius: 8, fontSize: 11.5, color: C.cyan, border: "1px solid rgba(0,229,195,0.12)", marginBottom: 14, display: "flex", gap: 16 }}>
                    <span>✓ Complete</span>
                    <span>Functions: {textAnalysis.functions.join(", ")}</span>
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead><tr style={{ borderBottom: "1px solid rgba(41,182,246,0.12)" }}>
                        {Object.keys(textAnalysis.results[0]).map(k => (
                          <th key={k} style={{ padding: "8px 10px", textAlign: "left", color: C.gray, fontWeight: 600, fontSize: 10, textTransform: "uppercase" }}>{k.replace(/_/g, " ")}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {textAnalysis.results.map((row, i) => (
                          <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                            {Object.entries(row).map(([k, v], j) => (
                              <td key={j} style={{ padding: "9px 10px", color: C.grayLight, fontSize: 12, maxWidth: 220, lineHeight: 1.4 }}>
                                {k === "gap" ? <Badge color={C.red}>+{v}</Badge> :
                                 k === "equity_flag" ? <Badge color={C.amber}>{v}</Badge> :
                                 k.includes("hazard") ? <Badge color={v === "TRUE" ? C.red : C.green}>{v}</Badge> :
                                 String(v)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ===== BIGGER PICTURE ===== */}
      <section style={sec(false)}>
        <div style={inner}>
          <SectionTag>The Bigger Picture</SectionTag>
          <h2 style={{ fontSize: 34, fontWeight: 700, color: C.navy, marginBottom: 8, letterSpacing: -0.5 }}>AI Functions Expand the Class of Questions SQL Can Answer</h2>
          <p style={{ fontSize: 16, color: C.grayDark, marginBottom: 12, lineHeight: 1.6, maxWidth: 700 }}>Traditional SQL answers: How many? Which ones? When? Where?</p>
          <p style={{ fontSize: 16, color: C.ice, marginBottom: 36, lineHeight: 1.6, fontWeight: 600 }}>AI SQL adds: What kind? How severe? What does it mean? What's the pattern across these?</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
            {INDUSTRIES.map((ind, i) => (
              <div key={i} style={{ background: "#fff", borderRadius: 14, padding: 22, border: "1px solid #e2e8f0", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${C.ice}, ${C.cyan})` }} />
                <div style={{ fontSize: 26, marginBottom: 8 }}>{ind.icon}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.navy, marginBottom: 8 }}>{ind.name}</div>
                <div style={{ fontSize: 13, color: C.grayDark, lineHeight: 1.55, marginBottom: 12, fontStyle: "italic" }}>"{ind.question}"</div>
                <div style={{ fontSize: 10.5, color: C.ice, fontFamily: "monospace", marginBottom: 10, background: "rgba(41,182,246,0.04)", padding: "7px 10px", borderRadius: 6, lineHeight: 1.5 }}>{ind.functions}</div>
                <div style={{ fontSize: 10.5, color: C.gray }}><span style={{ textDecoration: "line-through" }}>Previously: {ind.before}</span></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== WHAT'S NEXT ===== */}
      <section style={sec(true)}>
        <div style={inner}>
          <SectionTag>Product Thinking</SectionTag>
          <h2 style={{ fontSize: 34, fontWeight: 700, color: C.white, marginBottom: 28, letterSpacing: -0.5 }}>Where Cortex AI Functions Go Next</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            {[
              { t: "Streaming AI Enrichment", d: "Dynamic tables with AI Functions for real-time classification as data arrives — no batch jobs." },
              { t: "Cross-Table AI Joins", d: "AI_SIMILARITY to join records across tables without shared keys, using semantic meaning." },
              { t: "AI Function Chaining", d: "Composable pipelines: CLASSIFY → FILTER → SUMMARIZE in one query with optimizer-level efficiency." },
              { t: "Text → AI SQL in Snowsight", d: "Natural language query interface in the worksheet that generates AI SQL — accessible to every analyst." },
            ].map((idea, i) => (
              <div key={i} style={{ background: C.surface, borderRadius: 12, padding: 20, border: "1px solid rgba(41,182,246,0.08)" }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.ice, marginBottom: 7 }}>{idea.t}</div>
                <div style={{ fontSize: 12.5, color: C.gray, lineHeight: 1.55 }}>{idea.d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== FOOTER ===== */}
      <section style={{ padding: "36px 40px", background: C.navy, borderTop: "1px solid rgba(41,182,246,0.08)", textAlign: "center" }}>
        <div style={{ fontSize: 12.5, color: C.grayDark, marginBottom: 6 }}>Built with Snowflake Cortex AI Functions · Next.js · Vercel</div>
        <div style={{ fontSize: 11.5, color: C.grayDark }}>All queries execute live against a Snowflake account. No mocked data. ❄️</div>
      </section>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
        * { box-sizing: border-box; }
        input::placeholder { color: ${C.grayDark}; }
        button:hover:not(:disabled) { opacity:.92; }
        pre { tab-size: 2; }
      `}</style>
    </div>
  );
}
