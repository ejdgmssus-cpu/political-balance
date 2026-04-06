// /api/articles.js - Supabase에서 기사 가져오기 (카테고리 필터 + 키워드 검색)
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;
  const category = req.query.category || "";
  const search = req.query.search || "";
  const limit = req.query.limit || "30";

  let url = `${SUPABASE_URL}/rest/v1/articles?select=*&order=created_at.desc&limit=${limit}`;
  if (category && category !== "전체") url += `&category=eq.${encodeURIComponent(category)}`;
  if (search) url += `&or=(title.ilike.*${encodeURIComponent(search)}*,description.ilike.*${encodeURIComponent(search)}*,summary.ilike.*${encodeURIComponent(search)}*)`;

  try {
    const r = await fetch(url, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
    const data = r.ok ? await r.json() : [];
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
