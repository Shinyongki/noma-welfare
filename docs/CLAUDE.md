# 노마(Noma) AI 맞춤형 복지 내비게이터

## 프로젝트 개요
경상남도사회서비스원의 AI 복지 내비게이터입니다. 도민이 일상 언어(음성 포함)로
복지 서비스를 검색·신청할 수 있고, 내부 담당자가 상담 사건을 처리·연계·협업할 수
있는 통합 플랫폼입니다. Node.js/Express 백엔드 + Gemini 2.0 Flash RAG 엔진 +
TailwindCSS 프론트엔드로 구성된 모바일 웹 서비스입니다.

## 프로젝트 구조
```
noma/
├── CLAUDE.md
├── .env                          # 환경변수 (GEMINI_API_KEY 등)
├── server.js                     # Express 서버 진입점
├── package.json
├── data/
│   ├── welfare_services.csv      # 지식베이스 (18건)
│   ├── requests.json             # requestStore (상담 신청 저장)
│   ├── requests.json.bak         # 자동 백업
│   └── analytics.json            # analyticsStore (일별 이벤트)
├── public/
│   ├── code.html                 # 도민용 메인 검색 화면
│   ├── admin.html                # 관리자 대시보드
│   ├── case.html                 # 담당자 상담 처리 화면
│   └── referral.html             # 서비스 연계 요청 페이지
└── routes/
    ├── chat.js                   # POST /api/chat (RAG + Gemini SSE)
    ├── tts.js                    # POST /api/tts (Edge TTS)
    ├── auth.js                   # POST /api/auth/login, GET /api/auth/status
    ├── serviceRequest.js         # POST /api/service-request/connect
    ├── referral.js               # GET+POST /api/referral/:id
    ├── case.js                   # /api/case/* (담당자 처리)
    ├── staff.js                  # POST /api/staff/chat (담당자 AI 상담)
    ├── admin.js                  # /api/admin/* (관리자)
    └── dept.js                   # /api/dept/* (부서 조정자)
```

## 환경
- Node.js 18 이상
- 주요 의존성: express, express-session, @google/generative-ai, edge-tts, nodemailer
- TailwindCSS CDN (런타임 빌드), Chart.js CDN
- 환경변수 (.env 필수):
  - `GEMINI_API_KEY`: Google Gemini API 키
  - `ADMIN_PASSWORD`: 관리자/담당자 로그인 비밀번호
  - `SESSION_SECRET`: express-session 서명 키
  - `EMAIL_USER`: Naver SMTP 사용자
  - `EMAIL_PASS`: Naver SMTP 비밀번호
  - `EMAIL_RECIPIENT`: 개발용 이메일 수신자
  - `NODE_ENV`: production 시 secure 쿠키 활성화
  - `PORT`: 서버 포트 (기본 3000)

---

## 주요 명령어
```bash
# 서버 실행
node server.js

# 개발 모드 (nodemon)
npx nodemon server.js

# 의존성 설치
npm install
```

---

## 주의사항
- requestStore/analyticsStore 파일 쓰기는 반드시 원자적 쓰기(tmp→rename) 방식 유지
- Gemini API 429 응답 시 3초 백오프 후 재시도 로직 유지할 것
- Edge TTS 실패 시 브라우저 내장 SpeechSynthesis로 폴백하는 로직 유지할 것
- 보호 API(/api/case/*, /api/dept/*, /api/admin/*, /api/staff/*)에 requireAuth 미들웨어 반드시 적용
- 상태 전환은 전진형(open→confirmed→contacted→connected→closed)만 허용, 역행 불가
- `<noma-apply>` / `<noma-card>` 태그 파싱 로직은 SSE 스트림 청크 경계에서도 안전하게 동작해야 함
- Gemini 무료 티어 분당 요청 제한 있음 (429 시 자동 재시도 처리)
- JSON 본문 크기 1MB 제한 유지 (Express body-parser 설정)
- 세션 쿠키: httpOnly + sameSite(lax) + secure(production only), 8시간 유효

---

## 협업 방식

### 도구 역할 분담
- Claude AI: 전략/방향 결정, 복잡한 판단, 이미지 분석, 작업지시서 작성
- Claude Code: 직접 코딩 실행, 파일 작업, 변환 실행

### 정보 전달 방식
- Claude AI → Claude Code: 작업지시서 파일로 전달
- Claude Code → Claude AI: 텍스트는 복사, 이미지는 캡처 후 첨부

### 작업지시서 파일명 규칙
```
작업지시서_NNN_작업명.md
예) 작업지시서_001_초기설정.md
    작업지시서_002_RAG엔진개선.md
```

---

## Claude Code 행동 규칙

1. 방향이 불명확하거나 복잡한 판단이 필요하면 작업 중단 후 보고할 것
   "이 부분은 Claude AI에서 방향을 잡고 오시면 좋을 것 같습니다"
2. 한 번에 다 구현하지 말고 분석 → 보고 → 구현 → 검증 순서로 진행할 것
3. 작업 완료 후 CLAUDE.md 업데이트 필요 여부를 반드시 먼저 물어볼 것
4. 오류 발생 시 원인과 함께 Claude AI 공유가 필요한지 판단해서 알려줄 것

### CLAUDE.md 자동 업데이트 규칙
아래 상황이 발생하면 작업 완료 후 사용자에게 먼저 물어볼 것:

"이번 작업에서 아래 내용이 추가/변경됐습니다.
CLAUDE.md에 업데이트할까요?
- [변경 항목 1]
- [변경 항목 2]"

업데이트 물어볼 타이밍:
- 새 기능이 추가됐을 때
- 새 규칙이나 약속이 정해졌을 때
- 폴더/파일 구조가 바뀔 때
- 오류 해결 후 주의사항이 생겼을 때

사용자가 "응" 또는 "추가해줘" 하면 CLAUDE.md를 직접 수정하고 완료 보고할 것.
