// /api/cron.js - 뉴스 수집 → Gemini 분석 → Supabase 저장
export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;
  const NAVER_ID = process.env.NAVER_CLIENT_ID;
  const NAVER_SECRET = process.env.NAVER_CLIENT_SECRET;
  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  try {
    const keywords = ["정치 국회", "경제 정책", "외교 안보", "부동산 정책", "에너지 원전", "노동 고용"];
    let allItems = [];
    for (const kw of keywords) {
      const r = await fetch(`https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(kw)}&display=10&sort=date`,
        { headers: { "X-Naver-Client-Id": NAVER_ID, "X-Naver-Client-Secret": NAVER_SECRET } });
      if (r.ok) { const d = await r.json(); allItems.push(...(d.items || [])); }
    }
    // 주요 언론사만 허용
    const allowedSources = new Set([
      "chosun.com","joongang.co.kr","donga.com","hani.co.kr","khan.co.kr",
      "hankookilbo.com","kmib.co.kr","segye.com","munhwa.com",
      "news.kbs.co.kr","imnews.imbc.com","news.sbs.co.kr","news.jtbc.co.kr",
      "mbn.co.kr","tvchosun.com","channela.com","ytn.co.kr",
      "hankyung.com","mk.co.kr","sedaily.com","mt.co.kr","edaily.co.kr",
      "fnnews.com","asiae.co.kr","herald.co.kr","heraldcorp.com",
      "yna.co.kr","newsis.com","news1.kr"
    ]);
    const isAllowed = (url) => { try { const h = new URL(url).hostname.replace('www.',''); return [...allowedSources].some(d => h === d || h.endsWith('.'+d)); } catch { return false; } };

    const seen = new Set();
    const cleaned = [];
    for (const item of allItems) {
      const link = item.originallink || item.link;
      if (!isAllowed(link)) continue;
      if (seen.has(link)) continue;
      seen.add(link);
      const title = cleanHtml(item.title);
      const description = cleanHtml(item.description);
      const pubDate = new Date(item.pubDate);
      const minutesAgo = (Date.now() - pubDate.getTime()) / 60000;
      // 연예·스포츠·날씨 기사 제외
      if (/드라마|영화|아이돌|연예|시청률|흥행|개봉|출연|배우|가수|컴백|앨범|예능|스포츠|야구|축구|골프|올림픽|날씨|기온/.test(title)) continue;
      const is_breaking = minutesAgo <= 10 && /속보|긴급|단독|breaking|flash/i.test(title);
      const naverLink = item.link;
      cleaned.push({ title, description, link, naverLink, source: extractSource(link), category: detectCategory(title + " " + description), pub_date: pubDate.toISOString(), is_breaking });
    }

    const existingRes = await fetch(`${SUPABASE_URL}/rest/v1/articles?select=link&order=created_at.desc&limit=200`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
    const existing = existingRes.ok ? await existingRes.json() : [];
    const existingLinks = new Set(existing.map(e => e.link));
    let newArticles = cleaned.filter(a => !existingLinks.has(a.link));
    if (newArticles.length === 0) return res.status(200).json({ message: "새 기사 없음", count: 0 });

    const toAnalyze = newArticles.slice(0, 3);
    const analyzed = [];
    for (const article of toAnalyze) {
      const thumbnail = await fetchThumbnail(article.naverLink || article.link);
      const { naverLink, ...rest } = article;
      try {
        const analysis = await analyzeWithGemini(rest.title, rest.description, rest.category, GEMINI_KEY);
        analyzed.push({ ...rest, ...analysis, thumbnail });
      } catch (e) {
        console.error("Gemini error:", e.message);
        analyzed.push({ ...rest, summary: "AI 분석 준비 중", progressive_stance: "분석 중", progressive_reasons: '["준비 중"]', progressive_concern: "-", conservative_stance: "분석 중", conservative_reasons: '["준비 중"]', conservative_concern: "-", common_ground: "-", thumbnail });
      }
      }
    }
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/articles`, {
      method: "POST", headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(analyzed)
    });
    if (!insertRes.ok) console.error("Insert error:", await insertRes.text());
    // Retry unanalyzed articles
    const pendingRes = await fetch(`${SUPABASE_URL}/rest/v1/articles?summary=eq.AI%20%EB%B6%84%EC%84%9D%20%EC%A4%80%EB%B9%84%20%EC%A4%91&select=id,title,description,category,link&limit=2`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
    const pending = pendingRes.ok ? await pendingRes.json() : [];
    let retriedOk = 0;
    for (const p of pending) {
      try {
        const analysis = await analyzeWithGemini(p.title, p.description, p.category, GEMINI_KEY);
        const thumbnail = await fetchThumbnail(p.link);
        const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/articles?id=eq.${p.id}`, {
          method: "PATCH", headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify({ ...analysis, thumbnail })
        });
        if (patchRes.ok) retriedOk++; else console.error("Patch error:", await patchRes.text());
      } catch(e) { console.error("Retry error:", e.message); }
    }
    res.status(200).json({ message: "완료", inserted: analyzed.length, retried: retriedOk });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

function cleanHtml(s) { return s.replace(/<[^>]*>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&apos;/g, "'").replace(/&#x3D;/g, "=").replace(/&#x27;/g, "'").replace(/&#\w+;/g, ""); }

async function fetchThumbnail(url) {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" }, redirect: "follow", signal: ctrl.signal });
    clearTimeout(tid);
    if (!r.ok) return "";
    const html = await r.text();
    const m = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
    return m ? m[1] : "";
  } catch { return ""; }
}

async function analyzeWithGemini(title, description, category, apiKey) {
  const prompt = `당신은 한국 정치·시사 뉴스 분석 AI입니다.
아래 뉴스를 읽고, 현재 한국 정치 상황을 반영하여 진보와 보수 양쪽 시각으로 분석하세요.

## 분석할 뉴스
제목: "${title}"
본문: "${description}"
카테고리: ${category}

## 반드시 지킬 규칙
1. 모든 문장은 "~함", "~임", "~됨" 체로 통일
2. 글자수 제한을 반드시 지킴
3. 진보/보수 입장은 해당 진영이 실제로 취할 입장을 근거 있게 작성

## 글자수 제한
- summary: 핵심 요약 1문장, 최대 60자
- progressive_stance/conservative_stance: 각 1문장, 최대 40자
- progressive_reasons/conservative_reasons: 각 근거 2개, 각 20자 이내
- progressive_concern/conservative_concern: 각 우려 1문장, 최대 30자
- common_ground: 공통점 1문장, 최대 40자

JSON만 응답:
{"summary":"","progressive_stance":"","progressive_reasons":["",""],"progressive_concern":"","conservative_stance":"","conservative_reasons":["",""],"conservative_concern":"","common_ground":""}`;

  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
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
      "chosun.com":"조선일보","biz.chosun.com":"조선비즈","donga.com":"동아일보","joongang.co.kr":"중앙일보",
      "hani.co.kr":"한겨레","khan.co.kr":"경향신문","hankyung.com":"한국경제","mk.co.kr":"매일경제",
      "mt.co.kr":"머니투데이","sedaily.com":"서울경제","news.kbs.co.kr":"KBS","imnews.imbc.com":"MBC",
      "news.sbs.co.kr":"SBS","news.jtbc.co.kr":"JTBC","yna.co.kr":"연합뉴스","ytn.co.kr":"YTN",
      "newsis.com":"뉴시스","news1.kr":"뉴스1","edaily.co.kr":"이데일리","segye.com":"세계일보",
      "ohmynews.com":"오마이뉴스","hankookilbo.com":"한국일보","kmib.co.kr":"국민일보","munhwa.com":"문화일보",
      "nocutnews.co.kr":"노컷뉴스","newspim.com":"뉴스핌","tf.co.kr":"더팩트","dailyan.com":"데일리안",
      "mediatoday.co.kr":"미디어오늘","pressian.com":"프레시안","sisajournal.com":"시사저널","sisain.co.kr":"시사IN",
      "thebell.co.kr":"더벨","bloter.net":"블로터","zdnet.co.kr":"ZDNet","etnews.com":"전자신문",
      "dt.co.kr":"디지털타임스","asiae.co.kr":"아시아경제","fnnews.com":"파이낸셜뉴스",
      "herald.co.kr":"헤럴드경제","heraldcorp.com":"헤럴드경제","bbc.com":"BBC","reuters.com":"로이터",
      "naver.com":"네이버뉴스","daum.net":"다음뉴스",
      "idaegu.com":"아이대구","idaegu.co.kr":"아이대구","dkilbo.com":"대구일보","inews24.com":"아이뉴스24",
      "imaeil.com":"매일신문","kado.net":"강원도민일보","joongdo.co.kr":"중도일보","jjan.kr":"전북일보",
      "gjdream.com":"광주드림","newsfreezone.co.kr":"뉴스프리존",
      "newsclaim.co.kr":"뉴스클레임","pennmike.com":"펜앤드마이크","economychosun.com":"이코노미조선",
      "ccdailynews.com":"충청데일리","amenews.kr":"아시아머니","yonhapnewstv.co.kr":"연합뉴스TV",
      "metroseoul.co.kr":"메트로","ppss.kr":"ㅍㅍㅅㅅ","obsnews.co.kr":"OBS",
      "bzeronews.com":"비즈니스포스트","pointdaily.co.kr":"포인트데일리","ccnnews.co.kr":"충북넷",
      "ksmnews.co.kr":"경상매일","tokenpost.kr":"토큰포스트","news2day.co.kr":"뉴스투데이",
      "ajunews.com":"아주경제","newdaily.co.kr":"뉴데일리","mbn.co.kr":"MBN","tvchosun.com":"TV조선",
      "channela.com":"채널A","news.tf.co.kr":"더팩트","bizwatch.co.kr":"비즈워치",
      "kukinews.com":"쿠키뉴스","wikitree.co.kr":"위키트리","insight.co.kr":"인사이트",
      "mydaily.co.kr":"마이데일리","starnewskorea.com":"스타뉴스","sports.khan.co.kr":"스포츠경향"
    };
    for (const [domain, name] of Object.entries(m)) {
      if (h === domain || h.endsWith('.' + domain)) return name;
    }
    // fallback: 도메인에서 의미 있는 이름 추출
    const parts = h.replace(/\.co\.kr$|\.com$|\.net$|\.kr$|\.or\.kr$/,'').split('.');
    return parts[parts.length - 1];
  } catch { return "뉴스"; }
}

function detectCategory(text) {
  const r = [[/국회|여야|대통령|탄핵|선거|민주당|국민의힘|의원|대선|총선|정치|특검|청문|법안|파면|정당|공천/,"정치"],[/경제|GDP|물가|금리|주가|환율|수출|반도체|산업|투자|증시/,"경제"],[/외교|한미|한일|한중|북핵|미국|중국|일본|동맹|정상회담/,"외교"],[/아파트|부동산|집값|전세|월세|분양|주택|재건축/,"부동산"],[/사회|교육|의료|의대|저출산|복지|범죄|환경|기후/,"사회"],[/원전|에너지|탈원전|재생에너지|전기요금/,"에너지"],[/노동|임금|고용|최저임금|파업|노조/,"노동"]];
  for (const [re, c] of r) if (re.test(text)) return c;
  return "정치";
}
