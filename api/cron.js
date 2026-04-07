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

  

    const toAnalyze = newArticles.slice(0, 2);
    const analyzed = [];
    for (const article of toAnalyze) {
      try {
        const analysis = await analyzeWithGemini(article.title, article.description, article.category, GEMINI_KEY);
        analyzed.push({ ...article, ...analysis });
      } catch (e) { console.error("Gemini error:", e.message);
        analyzed.push({ ...article, summary: "AI 분석 준비 중", progressive_stance: "분석 중", progressive_reasons: '["준비 중"]', progressive_concern: "-", conservative_stance: "분석 중", conservative_reasons: '["준비 중"]', conservative_concern: "-", common_ground: "-" });
      }
      await new Promise(r => setTimeout(r, 500));
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

  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
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
  const prompt = `한국 정치·시사 전문 분석가로서 아래 뉴스를 분석하세요.

## 한국 정치 배경
- 윤석열 대통령 탄핵 후 파면, 현재 권한대행 체제, 조기 대선 예정
- 여당: 국민의힘(보수), 야당: 더불어민주당(진보)
- 보수 성향: 한미동맹, 시장경제, 원전 확대, 북한 압박
- 진보 성향: 남북대화, 복지 확대, 재생에너지, 노동권 강화

## 뉴스
제목: "${title}"
본문: "${description}"
카테고리: ${category}

## 중요: 글자수 제한을 반드시 지켜주세요!
- summary: 핵심만 1-2문장, 최대 80자
- progressive_stance: 진보 입장 한 문장, 최대 50자
- conservative_stance: 보수 입장 한 문장, 최대 50자
- progressive_reasons: 이유 2개, 각 최대 25자
- conservative_reasons: 이유 2개, 각 최대 25자
- progressive_concern: 우려 한 문장, 최대 35자
- conservative_concern: 우려 한 문장, 최대 35자
- common_ground: 공통점 한 문장, 최대 50자

JSON만 응답:
{"summary":"80자 이내 핵심 요약","progressive_stance":"50자 이내","progressive_reasons":["25자 이내","25자 이내"],"progressive_concern":"35자 이내","conservative_stance":"50자 이내","conservative_reasons":["25자 이내","25자 이내"],"conservative_concern":"35자 이내","common_ground":"50자 이내"}`;

  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
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
  try {
    const h = new URL(url).hostname.replace('www.','');
    const m = {
      "chosun.com":"조선일보","biz.chosun.com":"조선비즈",
      "donga.com":"동아일보","joongang.co.kr":"중앙일보",
      "hani.co.kr":"한겨레","khan.co.kr":"경향신문",
      "hankyung.com":"한국경제","mk.co.kr":"매일경제",
      "mt.co.kr":"머니투데이","sedaily.com":"서울경제",
      "news.kbs.co.kr":"KBS","imnews.imbc.com":"MBC",
      "news.sbs.co.kr":"SBS","news.jtbc.co.kr":"JTBC",
      "yna.co.kr":"연합뉴스","ytn.co.kr":"YTN",
      "newsis.com":"뉴시스","news1.kr":"뉴스1",
      "edaily.co.kr":"이데일리","segye.com":"세계일보",
      "ohmynews.com":"오마이뉴스","hankookilbo.com":"한국일보",
      "kmib.co.kr":"국민일보","munhwa.com":"문화일보",
      "nocutnews.co.kr":"노컷뉴스","newspim.com":"뉴스핌",
      "tf.co.kr":"더팩트","tfmedia.co.kr":"TF미디어",
      "dailyan.com":"데일리안","mediatoday.co.kr":"미디어오늘",
      "pressian.com":"프레시안","sisajournal.com":"시사저널",
      "sisain.co.kr":"시사IN","thebell.co.kr":"더벨",
      "bloter.net":"블로터","zdnet.co.kr":"ZDNet",
      "etnews.com":"전자신문","dt.co.kr":"디지털타임스",
      "asiae.co.kr":"아시아경제","fnnews.com":"파이낸셜뉴스",
      "herald.co.kr":"헤럴드경제","heraldcorp.com":"헤럴드경제",
      "bbc.com":"BBC","reuters.com":"로이터",
      "kpinews.co.kr":"KP뉴스","m-i.kr":"매일일보",
      "naver.com":"네이버뉴스","daum.net":"다음뉴스"
    };
    for (const [domain, name] of Object.entries(m)) {
      if (h === domain || h.endsWith('.' + domain)) return name;
    }
    return h.split('.')[0];
  } catch { return "뉴스"; }
}

function detectCategory(text) {
  const r = [[/국회|여야|대통령|탄핵|선거|민주당|국민의힘|의원|대선|총선|정치|특검|청문|법안|파면|정당|공천/,"정치"],[/경제|GDP|물가|금리|주가|환율|수출|반도체|산업|투자|증시/,"경제"],[/외교|한미|한일|한중|북핵|미국|중국|일본|동맹|정상회담/,"외교"],[/아파트|부동산|집값|전세|월세|분양|주택|재건축/,"부동산"],[/사회|교육|의료|의대|저출산|복지|범죄|환경|기후/,"사회"],[/원전|에너지|탈원전|재생에너지|전기요금/,"에너지"],[/노동|임금|고용|최저임금|파업|노조/,"노동"]];
  for (const [re, c] of r) if (re.test(text)) return c;
  return "정치";
}
