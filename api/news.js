// /api/news.js - 네이버 뉴스 검색 (검색 탭용)
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const query = req.query.q || "정치";
  const display = req.query.display || "20";
  const sort = req.query.sort || "date";
  try {
    const r = await fetch(`https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(query)}&display=${display}&sort=${sort}`,
      { headers: { "X-Naver-Client-Id": process.env.NAVER_CLIENT_ID, "X-Naver-Client-Secret": process.env.NAVER_CLIENT_SECRET } });
    if (!r.ok) throw new Error(`Naver API ${r.status}`);
    const data = await r.json();
    const items = data.items.map((item, i) => ({
      id: Date.now() + i,
      title: item.title.replace(/<[^>]*>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"),
      description: item.description.replace(/<[^>]*>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&"),
      link: item.originallink || item.link,
      source: extractSource(item.originallink || item.link),
      pubDate: item.pubDate,
      timeAgo: getTimeAgo(new Date(item.pubDate)),
    }));
    res.status(200).json({ items, total: data.total });
  } catch (e) { res.status(500).json({ error: e.message }); }
}
function extractSource(url) { try { const h = new URL(url).hostname; const m = {"www.chosun.com":"조선일보","www.donga.com":"동아일보","www.joongang.co.kr":"중앙일보","www.hani.co.kr":"한겨레","www.khan.co.kr":"경향신문","news.kbs.co.kr":"KBS","news.sbs.co.kr":"SBS","news.jtbc.co.kr":"JTBC","www.yna.co.kr":"연합뉴스"}; return m[h] || h.replace("www.","").split(".")[0]; } catch { return "뉴스"; } }
function getTimeAgo(d) { const s = Math.floor((new Date()-d)/1000); if(s<60)return"방금 전"; if(s<3600)return`${Math.floor(s/60)}분 전`; if(s<86400)return`${Math.floor(s/3600)}시간 전`; return`${Math.floor(s/86400)}일 전`; }
