// /api/cron.js - 뉴스 수집 → AI 중복 제거 → Gemini 분석 → Supabase 저장
export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;
  const NAVER_ID = process.env.NAVER_CLIENT_ID;
  const NAVER_SECRET = process.env.NAVER_CLIENT_SECRET;
  const GEMINI_KEY = process.env.GEMINI_API_KEY;

  try {
    const keywords = ["정치 시사", "경제 정책", "외교 안보", "사회 이슈", "부동산 정책", "에너지 원전"];
    let allItems = [];
    for (const kw of keywords) {
      const r = await fetch(`https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(kw)}&display=10&sort=date`,
        { headers: { "X-Naver-Client-Id": NAVER_ID, "X-Naver-Client-Secret": NAVER_SECRET } });
      if (r.ok) { const d = await r.json(); allItems.push(...(d.items || [])); }
    }

    const seen = new Set();
    const cleaned = [];
    for (const item of allItems) {
      const link = item.originallink || item.link;
      if (seen.has(link)) continue;
      seen.add(link);
      const title = cleanHtml(item.title);
      const description = cleanHtml(item.description);
      const pubDate = new Date(item.pubDate);
      const minutesAgo = (Date.now() - pubDate.getTime()) / 60000;
      const is_breaking = minutesAgo <= 10 && /속보|긴급|단독|breaking|flash/i.test(title);
      cleaned.push({ title, description, link, source: extractSource(link), category: detectCategory(title + " " + description), pub_date: pubDate.toISOString(), is_breaking });
    }

    const existingRes = await fetch(`${SUPABASE_URL}/rest/v1/articles?select=link,title&order=created_at.desc&limit=200`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
    const existing = existingRes.ok ? await existingRes.json() : [];
    const existingLinks = new Set(existing.map(e => e.link));
    const existingTitles = existing.map(e => e.title);
    let newArticles = cleaned.filter(a => !existingLinks.has(a.link));

    if (newArticles.length === 0) return res.status(200).json({ message: "새 기사 없음", count: 0 });

    // AI 중복 제거: 새 기사끼리 + 기존 기사와 비교
    try {
      newArticles = await deduplicateAll(newArticles, existingTitles, GEMINI_KEY);
    } catch(e) {}

    if (newArticles.length === 0) return res.status(200).json({ message: "중복 제거 후 새 기사 없음", count: 0 });

    const toAnalyze = newArticles.slice(0, 5);
    const analyzed = [];
    for (const article of toAnalyze) {
      try {
        const analysis = await analyzeWithGemini(article.title, article.description, article.category, GEMINI_KEY);
        analyzed.push({ ...article, ...analysis });
      } catch (e) {
        analyzed.push({ ...article, summary: "AI 분석 준비 중", progressive_stance: "분석 중", progressive_reasons: '["곧 업데이트"]', progressive_concern: "-", conservative_stance: "분석 중", conservative_reasons: '["곧 업데이트"]', conservative_concern: "-", common_ground: "-" });
      }
      await new Promise(r => setTimeout(r, 2000));
    }

    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/articles`, {
      method: "POST", headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(analyzed)
    });
    if (!insertRes.ok) console.error("Insert error:", await insertRes.text());

    res.status(200).json({ message: "완료", inserted: analyzed.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

function cleanHtml(s) { return s.replace(/<[^>]*>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&apos;/g, "'"); }

async function deduplicateAll(newArticles, existingTitles, apiKey) {
  const allTitles = newArticles.map(a => a.title);
  const recentExisting = existingTitles.slice(0, 30);
  const prompt = `뉴스 중복 제거를 해주세요.

"기존 기사" 제목들:
${JSON.stringify(recentExisting)}

"새 기사" 제목들 (인덱스 0부터):
${JSON.stringify(allTitles)}

규칙:
1. 새 기사끼리 같은 사건이면 제목이 가장 정보가 많은 1개만 유지
2. 새 기사가 기존 기사와 같은 사건이면 제거
3. 같은 사건 = 언론사만 다르고 동일한 사건/발표/사고를 다룬 기사
4. 애매하면 유지

유지할 새 기사 인덱스만 JSON 배열로 응답:`;

  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1 } })
  });
  if (!r.ok) return newArticles;
  const data = await r.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const indices = JSON.parse(text.replace(/```json|```/g, "").trim());
  return indices.map(i => newArticles[i]).filter(Boolean);
}

async function analyzeWithGemini(title, description, category, apiKey) {
  const prompt = `당신은 한국 정치 뉴스 분석 전문가입니다.

뉴스 제목: "${title}"
본문 요약: "${description}"
카테고리: ${category}

중요: 제목과 본문을 모두 읽고 맥락을 정확히 파악하세요. 이미 일어난 사건인지, 앞으로의 계획인지 구분하세요.

JSON만 응답:
{"summary":"핵심 내용 정확 요약 2-3문장","progressive_stance":"진보 핵심 입장","progressive_reasons":["이유1","이유2","이유3"],"progressive_concern":"진보 우려","conservative_stance":"보수 핵심 입장","conservative_reasons":["이유1","이유2","이유3"],"conservative_concern":"보수 우려","common_ground":"공통 접점"}`;

  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2 } })
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}`);
  const data = await r.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const p = JSON.parse(text.replace(/```json|```/g, "").trim());
  return { summary: p.summary, progressive_stance: p.progressive_stance, progressive_reasons: JSON.stringify(p.progressive_reasons), progressive_concern: p.progressive_concern, conservative_stance: p.conservative_stance, conservative_reasons: JSON.stringify(p.conservative_reasons), conservative_concern: p.conservative_concern, common_ground: p.common_ground };
}

function extractSource(url) {
  try { const h = new URL(url).hostname; const m = {"www.chosun.com":"조선일보","www.donga.com":"동아일보","www.joongang.co.kr":"중앙일보","www.hani.co.kr":"한겨레","www.khan.co.kr":"경향신문","www.hankyung.com":"한국경제","www.mk.co.kr":"매일경제","news.kbs.co.kr":"KBS","imnews.imbc.com":"MBC","news.sbs.co.kr":"SBS","news.jtbc.co.kr":"JTBC","www.yna.co.kr":"연합뉴스","www.ytn.co.kr":"YTN","www.newsis.com":"뉴시스","newsis.com":"뉴시스","www.edaily.co.kr":"이데일리","www.mt.co.kr":"머니투데이","www.segye.com":"세계일보","www.ohmynews.com":"오마이뉴스","news1.kr":"뉴스1","www.news1.kr":"뉴스1"}; return m[h] || h.replace("www.","").split(".")[0]; } catch { return "뉴스"; }
}

function detectCategory(text) {
  const r = [[/국회|여야|대통령|탄핵|선거|민주당|국민의힘|의원|대선|총선|정치|특검|청문|법안|파면|정당|공천/,"정치"],[/경제|GDP|물가|금리|주가|환율|수출|반도체|산업|투자|증시/,"경제"],[/외교|한미|한일|한중|북핵|미국|중국|일본|동맹|정상회담/,"외교"],[/아파트|부동산|집값|전세|월세|분양|주택|재건축/,"부동산"],[/사회|교육|의료|의대|저출산|복지|범죄|환경|기후/,"사회"],[/원전|에너지|탈원전|재생에너지|전기요금/,"에너지"],[/노동|임금|고용|최저임금|파업|노조/,"노동"]];
  for (const [re, c] of r) if (re.test(text)) return c;
  return "정치";
}
