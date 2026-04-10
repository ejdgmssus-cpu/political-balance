// /api/articles.js - Supabase에서 기사 가져오기 + 조회수 증가
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;

  // POST: 조회수 증가 또는 투표
  if (req.method === "POST") {
    const { id, action, side } = req.body || {};
    if (!id) return res.status(400).json({ error: "id required" });
    try {
      const getR = await fetch(`${SUPABASE_URL}/rest/v1/articles?id=eq.${id}&select=view_count,vote_progressive,vote_conservative`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
      const arr = getR.ok ? await getR.json() : [];
      const cur = arr[0] || {};

      let patch = {};
      if (action === "vote" && side) {
        if (side === "progressive") patch = { vote_progressive: (cur.vote_progressive || 0) + 1 };
        else if (side === "conservative") patch = { vote_conservative: (cur.vote_conservative || 0) + 1 };
      } else {
        patch = { view_count: (cur.view_count || 0) + 1 };
      }

      await fetch(`${SUPABASE_URL}/rest/v1/articles?id=eq.${id}`, {
        method: "PATCH",
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify(patch)
      });
      return res.status(200).json({ ok: true });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // GET: 기사 목록
  const category = req.query.category || "";
  const search = req.query.search || "";
  const limit = req.query.limit || "30";
  const sort = req.query.sort || "created_at";

  const order = sort === "views" ? "view_count.desc.nullslast" : "created_at.desc";
  let url = `${SUPABASE_URL}/rest/v1/articles?select=*&order=${order}&limit=${limit}`;
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
