# 노마(Noma) AI 맞춤형 복지 내비게이터

## 1. 프로젝트 개요

| 항목 | 내용 |
|------|------|
| 프로젝트명 | 노마(Noma) AI 맞춤형 복지 내비게이터 |
| 소속 | 경상남도사회서비스원 |
| 목적 | 도민 일상 언어(음성 포함) 복지 검색·신청 + 내부 담당자 상담 처리·연계·협업 |
| 기술 스택 | Node.js/Express (ESM) + Gemini 2.0 Flash RAG + TailwindCSS (로컬 빌드) |
| 배포 | Railway (Hobby 플랜), GitHub master 자동 배포 |
| 배포 URL | https://noma-welfare-production.up.railway.app/ |
| 리포 | Shinyongki/noma-welfare |

---

## 2. 프로젝트 구조

```
사서원/
├── CLAUDE.md                                 # Claude Code용 프로젝트 지침
├── .env                                      # 환경변수
├── server.js                                 # Express 서버 (라우트 포함 단일 파일, ~2,880줄)
├── package.json                              # type: "module" (ESM)
├── tailwind.config.cjs                       # TailwindCSS 설정
├── 경상남도사회서비스원_지식베이스_v2.csv     # RAG 지식베이스 CSV (21건)
├── welfare_kb_detail_v3.json                 # RAG 상세 지식베이스 JSON (21건)
├── data/
│   ├── requestStore.mjs                      # 상담 신청 저장/관리 모듈
│   ├── analyticsStore.mjs                    # 일별 이벤트 분석 모듈
│   ├── requests.json                         # 상담 신청 데이터
│   └── analytics.json                        # 분석 데이터
├── stitch/                                   # 프론트엔드 (정적 파일)
│   ├── code.html                             # 도민용 메인 검색·상담 화면
│   ├── admin.html                            # 관리자/담당자/부서장 통합 대시보드
│   ├── case.html                             # 담당자 상담 처리 화면
│   ├── referral.html                         # 서비스 연계 요청 페이지
│   └── css/tailwind.css                      # 빌드된 TailwindCSS
├── src/
│   └── tailwind.css                          # TailwindCSS 소스
└── docs/                                     # 기획·분석·작업지시서 문서
```

참고: 라우트가 별도 파일로 분리되지 않고 server.js 단일 파일에 모두 포함되어 있습니다.
dept.html은 삭제됨 (007 작업 — admin.html로 통합됨).

---

## 3. 핵심 용어 사전

### RAG 및 AI 관련
- **RAG**: 지식베이스(CSV 21건 + JSON 상세)를 어미 제거 + 유의어 확장 + 스코어링으로 검색 후, Gemini AI에 컨텍스트로 주입해 답변 생성
- **SSE**: Gemini 응답을 스트리밍 전달. 체감 응답 지연 최소화
- **STT**: Web Speech API 기반 음성→텍스트 (ko-KR)
- **TTS**: Edge TTS (ko-KR-SunHiNeural). 실패 시 브라우저 SpeechSynthesis 폴백
- **staffSystemPrompt**: 담당자 AI 상담용 시스템 프롬프트

### 커스텀 태그
- **`<noma-card>`**: Gemini 응답 스트림 내 서비스 카드 JSON 태그 → Stepper 카드 UI 렌더링
- **`<noma-apply>`**: 이름·전화번호·서비스명 수집 완료 시 자동 상담 신청 POST
- **Stepper 카드**: ① 대상 확인 → ② 신청 방법 → ③ 받는 혜택 → ④ 연락처

### 데이터 저장
- **requestStore**: 상담 신청 JSON 파일 기반 저장소. 원자적 쓰기(tmp→rename) + 자동 백업(.bak) + 손상 복구
- **analyticsStore**: 일별 검색·신청·TTS 수 기록 JSON 저장소
- **deptServiceMap**: 서비스별 담당 부서·법적 근거·대상·자격·연계 가능 서비스 매핑 (server.js 내부)

### 업무 워크플로우
- **상태 전환**: open → confirmed → contacted → connected → closed (전진만 허용)
- **2단계 승인**: pending → dept_approved(부서 조정자) → approved(관리자). 최종 승인 시 이메일 자동 발송
- **연계(referral)**: 신청자를 다른 서비스로 보내는 것. 연쇄 연계(체인) 지원
- **협업(collaboration)**: 자문(consultation) / 공동처리(joint) / 이관(transfer) 3유형

### 화면별 역할

| 화면 | 파일 | 사용자 | 주요 기능 |
|------|------|--------|----------|
| 도민 검색 | stitch/code.html | 도민 | 자연어/음성 검색, Stepper 카드, 상담 신청 |
| 관리자/담당자/부서장 | stitch/admin.html | 관리자·담당자·부서장 통합 | KPI 현황판, 칸반, 상담 관리, 분석, 연계 조정, 수신 요청 |
| 상담 처리 | stitch/case.html | 담당자 | 상태 스테퍼, 메모, 연계 요청, AI 상담 |
| 연계 요청 | stitch/referral.html | 담당자 | 서비스 연계 요청 폼 |

---

## 4. 기술 환경

### 의존성
- 런타임: Node.js 18+, ESM ("type": "module")
- 서버: express, express-session, cors, helmet, express-rate-limit, dotenv
- AI: @google/genai (Gemini 2.0 Flash)
- 음성: @andresaya/edge-tts
- 이메일: Resend HTTP API (SMTP 아님 — Railway 포트 차단)
- 프론트: TailwindCSS 로컬 빌드, Chart.js CDN

### 환경변수 (.env / Railway)

| 변수명 | 용도 |
|--------|------|
| `GOOGLE_GEMINI_API_KEY` | Gemini API 키 |
| `ADMIN_PASSWORD` | 관리자/담당자 로그인 |
| `DEPT_PASSWORD` | 부서 조정자 로그인 |
| `SESSION_SECRET` | express-session 서명 키 |
| `RESEND_API_KEY` | Resend 이메일 API 키 |
| `BASE_URL` | 배포 URL (기본 http://localhost:5000) |
| `ALLOWED_ORIGINS` | CORS 허용 도메인 (콤마 구분) |
| `NODE_ENV` | production 시 secure 쿠키 |
| `PORT` | 서버 포트 (기본 5000) |

### 보안 현황
- helmet + CSP 헤더 ✅
- express-rate-limit 3종 (api/chat/tts) ✅
- sanitizeUserInput() 프롬프트 인젝션 방어 ✅
- escapeHtml() 프론트엔드 XSS 방어 (admin.html 90곳 적용) ✅
- 세션 쿠키 httpOnly + sameSite(lax) + secure(production) ✅
- CORS ALLOWED_ORIGINS 환경변수 제한 ✅
- requireAuth 미들웨어 (보호 API 전체) ✅

---

## 5. 주요 기술 제약 및 주의사항

- **단일 파일 구조**: server.js ~2,880줄에 모든 라우트·로직 포함. 수정 시 영향 범위 주의
- **원자적 쓰기**: requestStore/analyticsStore는 반드시 tmp→rename 방식 유지
- **Gemini 429**: 무료 티어 분당 제한. 3초 백오프 재시도 로직 유지
- **TTS 폴백**: Edge TTS 실패 → 브라우저 SpeechSynthesis
- **인증**: 보호 API에 requireAuth 미들웨어 필수 적용
- **커스텀 태그 파싱**: SSE 스트림 청크 경계에서도 안전하게 동작해야 함
- **Railway 제약**: SMTP 포트 차단 → HTTPS API만 사용 가능
- **CSS 빌드**: stitch/*.html 수정 후 반드시 `npm run build:css` 실행

---

## 6. 협업 방식

### 역할 분담

| | Claude AI (채팅) | Claude Code (로컬) |
|--|-----------------|-------------------|
| 역할 | 전략·방향·판단·분석 | 코딩·파일 작업·실행 |
| 강점 | 이미지 분석, 복잡한 판단, 문서 작성 | 직접 코드 수정, 빌드, 테스트 |
| 산출물 | 작업지시서 (.md) | 코드 커밋, 실행 결과 |

### 작업지시서 규칙
파일명: `작업지시서_NNN_작업명.md`

작업지시서에 포함할 내용:
1. 목표 — 무엇을 달성하는가
2. 배경 — 왜 필요한가, 현재 상태
3. 작업 항목 — 구체적 변경 사항 (파일명, 함수명 포함)
4. 검증 방법 — 완료 확인 기준
5. 주의사항 — 건드리면 안 되는 부분, 의존성

### 완료된 작업 이력

| 번호 | 작업명 | 변경 파일 |
|------|--------|----------|
| 001~004 | 초기 설정, 품질 점검, 버그 수정 | server.js, admin.html 등 |
| 005 | 연계조정 칸반 UI 개선 | stitch/admin.html |
| 006 | 승인대기 카드 + 인라인 UI + 토스트 | stitch/admin.html |
| 007 | dept.html 레거시 정리 | stitch/dept.html(삭제), server.js(-114줄) |
| 008 | 수신요청 카드 개선 + 버그수정 | stitch/admin.html |
| 009 | alert 34개 → 토스트 교체 | stitch/admin.html |
| 010A | Railway 환경변수 설정 | Railway 대시보드 |
| 010B | XSS 취약점 8곳 패치 | stitch/admin.html |

---

## 7. Claude Code 행동 규칙

1. **작업 전 확인**: grep으로 실제 줄 번호 재확인 후 수정 (줄 번호는 작업 중 밀림)
2. **백업**: 대형 수정 전 `cp 파일명 파일명.bak`
3. **CSS 빌드**: stitch/*.html 수정 후 반드시 `npm run build:css`
4. **원자적 쓰기 유지**: requestStore/analyticsStore 수정 시 tmp→rename 패턴 유지
5. **서버 재시작 확인**: server.js 수정 후 동작 확인
6. **보고 형식 준수**: 완료 항목, 변경 파일(줄 수 변동), 우려사항 포함
7. **CLAUDE.md 동기화**: 구조·기능·규칙 변경 시 이 파일 업데이트

---

## 8. 백로그 (미처리)

- `bulkChangeStatus()` confirm() 1개 → 토스트 교체 (009 범위 외 잔여)
- Slack 연동 (011 예정) — Incoming Webhook 방식
- RAG 멀티턴 컨텍스트 개선
- read-modify-write 원자화
