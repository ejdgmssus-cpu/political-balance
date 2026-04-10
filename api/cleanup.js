// /api/cleanup.js - 주요 언론사가 아닌 기사 삭제 (1회용)
export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;
  const major = ["조선일보","중앙일보","동아일보","한겨레","경향신문","한국일보","국민일보","세계일보","문화일보","KBS","MBC","SBS","JTBC","MBN","TV조선","채널A","YTN","한국경제","매일경제","서울경제","머니투데이","이데일리","파이낸셜뉴스","아시아경제","헤럴드경제","연합뉴스","뉴시스","뉴스1"];
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/articles?select=id,source&limit=500`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
    const all = r.ok ? await r.json() : [];
    const toDelete = all.filter(a => !major.includes(a.source));
    let deleted = 0;
    for (const a of toDelete) {
      const dr = await fetch(`${SUPABASE_URL}/rest/v1/articles?id=eq.${a.id}`, {
        method: "DELETE", headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
      });
      if (dr.ok) deleted++;
    }
    res.status(200).json({ total: all.length, deleted, remaining: all.length - deleted });
  } catch (e) { res.status(500).json({ error: e.message }); }
}
