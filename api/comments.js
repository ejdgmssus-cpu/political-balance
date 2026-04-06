// /api/comments.js - 댓글 읽기/쓰기
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;

  // GET: 댓글 가져오기
  if (req.method === "GET") {
    const articleId = req.query.article_id;
    if (!articleId) return res.status(400).json({ error: "article_id required" });
    const r = await fetch(`${SUPABASE_URL}/rest/v1/comments?article_id=eq.${articleId}&order=created_at.desc&limit=50`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
    return res.status(200).json(r.ok ? await r.json() : []);
  }

  // POST: 댓글 작성
  if (req.method === "POST") {
    const { article_id, text, username, side } = req.body;
    if (!article_id || !text) return res.status(400).json({ error: "article_id and text required" });
    const r = await fetch(`${SUPABASE_URL}/rest/v1/comments`, {
      method: "POST", headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({ article_id, text, username: username || "익명시민", side: side || "center" })
    });
    return res.status(201).json(r.ok ? await r.json() : { error: "Failed" });
  }

  res.status(405).json({ error: "Method not allowed" });
}
