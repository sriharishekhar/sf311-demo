import { executeQuery } from "@/lib/snowflake";

const FALLBACK_STATS = {
  totalCases: "4,847",
  districts: "11",
  categories: "10",
  withPhotos: "148",
  dateRange: "Jan 2023 – Mar 2024",
};

export async function GET() {
  try {
    const [countRows, photoRows, rangeRows, districtRows, catRows] = await Promise.all([
      executeQuery("SELECT COUNT(*) AS total FROM cases_enriched"),
      executeQuery("SELECT COUNT(*) AS cnt FROM cases_enriched WHERE has_photo = TRUE"),
      executeQuery("SELECT MIN(opened) AS min_date, MAX(opened) AS max_date FROM cases_enriched"),
      executeQuery("SELECT COUNT(DISTINCT district) AS cnt FROM cases_enriched"),
      executeQuery("SELECT COUNT(DISTINCT category) AS cnt FROM cases_enriched"),
    ]);

    const total = Number(countRows[0]?.TOTAL ?? countRows[0]?.total ?? 0);
    const photos = Number(photoRows[0]?.CNT ?? photoRows[0]?.cnt ?? 0);
    const districts = Number(districtRows[0]?.CNT ?? districtRows[0]?.cnt ?? 0);
    const categories = Number(catRows[0]?.CNT ?? catRows[0]?.cnt ?? 0);
    const minDate = String(rangeRows[0]?.MIN_DATE ?? rangeRows[0]?.min_date ?? "");
    const maxDate = String(rangeRows[0]?.MAX_DATE ?? rangeRows[0]?.max_date ?? "");

    const fmt = (d: string) => {
      const dt = new Date(d);
      return dt.toLocaleDateString("en-US", { month: "short", year: "numeric" });
    };

    return Response.json({
      totalCases: total.toLocaleString(),
      districts: String(districts),
      categories: String(categories),
      withPhotos: photos.toLocaleString(),
      dateRange: minDate && maxDate ? `${fmt(minDate)} – ${fmt(maxDate)}` : FALLBACK_STATS.dateRange,
    });
  } catch {
    return Response.json(FALLBACK_STATS);
  }
}
