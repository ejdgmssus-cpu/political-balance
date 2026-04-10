# 균형잡힌 시각 - 정치 양극화 해소 앱

## 배포 가이드 (Dong님용 단계별 설명)

### 1단계: GitHub에 코드 올리기

1. **github.com** 접속 → 로그인 (계정 없으면 가입)
2. 오른쪽 위 **"+"** 버튼 → **"New repository"** 클릭
3. Repository name: **political-balance**
4. **"Create repository"** 클릭
5. 이 폴더의 모든 파일을 GitHub에 업로드
   - GitHub 페이지에서 **"uploading an existing file"** 클릭
   - `api/`, `public/`, `package.json`, `vercel.json` 파일들을 드래그&드롭
   - **"Commit changes"** 클릭

### 2단계: Vercel에 배포하기

1. **vercel.com** 접속 → **"Sign Up"** → GitHub 계정으로 로그인
2. **"Add New Project"** 클릭
3. GitHub에서 방금 만든 **political-balance** 레포지토리 선택
4. **Environment Variables** 설정 (중요!):
   - Name: `NAVER_CLIENT_ID` → Value: `네이버에서 받은 Client ID`
   - Name: `NAVER_CLIENT_SECRET` → Value: `네이버에서 받은 Client Secret`
5. **"Deploy"** 클릭
6. 2-3분 후 배포 완료! URL이 생김 (예: political-balance.vercel.app)

### 3단계: 네이버 API 설정 업데이트

1. **developers.naver.com** → 내 애플리케이션 → 균형뉴스
2. Web 서비스 URL을 Vercel에서 받은 URL로 변경
   - 예: `https://political-balance.vercel.app`

### 4단계: 앱인토스 등록

1. **apps-in-toss.toss.im** 콘솔 접속
2. 파트너 등록 (사업자등록증 필요)
3. 새 앱 등록 → Webview 방식 선택
4. Vercel URL 입력
5. 검수 제출

## 기술 스택
- Frontend: Vanilla JS (단일 HTML 파일)
- Backend: Vercel Serverless Functions
- 뉴스: 네이버 뉴스 검색 API
- AI 분석: Claude API (Anthropic)
- 댓글: localStorage (추후 Supabase로 업그레이드 가능)
