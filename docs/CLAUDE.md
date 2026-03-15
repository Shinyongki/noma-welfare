# 노마(Noma) AI 맞춤형 복지 내비게이터
# Claude Code 작업 기준서 (docs/ 버전)
# v3.0 — 2026년 3월 업데이트 (v032 반영)

## 프로젝트 개요
경상남도사회서비스원의 AI 복지 내비게이터입니다. 도민이 일상 언어(음성 포함)로
복지 서비스를 검색·신청할 수 있고, 내부 담당자가 상담 사건을 처리·연계·협업할 수
있는 통합 플랫폼입니다. Node.js/Express 백엔드 + Gemini 2.0 Flash RAG 엔진 +
TailwindCSS (로컬 빌드) 프론트엔드로 구성된 모바일 웹 서비스입니다.

## 프로젝트 구조
```
사서원/
├── CLAUDE.md                                 # Claude Code용 프로젝트 지침 (메인)
├── .env                                      # 환경변수
├── server.js                                 # Express 서버 (라우트 포함 단일 파일, ~4540줄)
├── package.json                              # type: "module" (ESM)
├── tailwind.config.cjs                       # TailwindCSS 설정
├── 경상남도사회서비스원_지식베이스_v2.csv     # RAG 지식베이스 CSV (29건)
├── welfare_kb_detail_v3.json                 # RAG 상세 지식베이스 JSON (39건)
├── welfare_kb_tonghapdolbom.json             # 통합돌봄 KB 보강 (18건)
├── data/
│   ├── requestStore.mjs                      # 상담 신청 저장/관리 (withLock 원자화)
│   ├── analyticsStore.mjs                    # 일별 이벤트 분석 (withLock 원자화)
│   ├── requests.json                         # 상담 신청 데이터
│   ├── analytics.json                        # 분석 데이터
│   ├── faq_kb.json                           # FAQ 보충분
│   ├── faq_kb_026_tonghap.json               # 통합돌봄 FAQ (25건)
│   └── welfare_docs_chunks.json              # 문서 청크 (28건, 통합돌봄 표준교안)
├── stitch/                                   # 프론트엔드 (정적 파일)
│   ├── code.html                             # 도민용 메인 검색·상담 화면
│   ├── admin.html                            # 관리자 대시보드
│   ├── case.html                             # 담당자 상담 처리 화면
│   ├── dept.html                             # 부서 조정자 화면
│   ├── referral.html                         # 서비스 연계 요청 페이지
│   └── css/tailwind.css                      # 빌드된 TailwindCSS
├── src/
│   └── tailwind.css                          # TailwindCSS 소스
├── scripts/                                  # 임베딩 업로드·시연 스크립트
│   ├── upload_kb_embeddings.mjs
│   ├── upload_faq_embeddings.mjs
│   ├── upload_doc_embeddings.mjs
│   ├── insert_demo_data.mjs
│   ├── cleanup_demo_data.mjs
│   └── pre_demo_check.mjs
└── docs/                                     # 기획·분석·작업지시서 문서
    ├── PRD.md                                # 제품 요구사항 (v3.0)
    ├── IA.md                                 # 정보 아키텍처 (v3.0)
    ├── UseCase.md                            # 유스케이스 (v3.0)
    └── CLAUDE.md                             # 이 파일
```

**참고:** 라우트가 별도 파일로 분리되지 않고 server.js 단일 파일에 모두 포함되어 있습니다.

## 환경
- Node.js 18 이상, ESM ("type": "module")
- 주요 의존성: express, express-session, @google/genai, @andresaya/edge-tts, cors, helmet, express-rate-limit, @supabase/supabase-js, dotenv
- TailwindCSS v3 로컬 빌드, Chart.js CDN
- 환경변수 (.env 필수):
  - `GOOGLE_GEMINI_API_KEY`: Google Gemini API 키
  - `ADMIN_PASSWORD`: 관리자 로그인 비밀번호
  - `DEPT_PASSWORD`: 부서 조정자 로그인 비밀번호
  - `SESSION_SECRET`: express-session 서명 키
  - `RESEND_API_KEY`: Resend 이메일 API 키
  - `BASE_URL`: 배포 URL (기본 http://localhost:5000)
  - `ALLOWED_ORIGINS`: CORS 허용 도메인 (쉼표 구분)
  - `NODE_ENV`: production 시 secure 쿠키 활성화
  - `PORT`: 서버 포트 (기본 5000)
  - `SUPABASE_URL`: Supabase 프로젝트 URL
  - `SUPABASE_KEY`: Supabase anon key

---

## 주요 명령어
```bash
# 서버 실행
node server.js

# TailwindCSS 빌드
npm run build:css

# TailwindCSS 감시 모드
npm run watch:css

# 의존성 설치
npm install
```

---

## 주의사항
- **단일 파일 구조**: server.js ~4540줄에 모든 라우트·로직 포함. 수정 시 영향 범위 주의
- **withLock 직렬화 필수**: requestStore/analyticsStore read-modify-write 패턴은 반드시 `withLock()` 내부에서 수행
- **원자적 쓰기 유지**: 반드시 tmp→rename 방식 유지 + 자동 백업(.bak)
- **Gemini 429**: 무료 티어 분당 제한. 3초 백오프 재시도 로직 유지
- **TTS 폴백**: Edge TTS 실패 → 브라우저 SpeechSynthesis
- **인증 필수**: 보호 API에 requireAuth 미들웨어 적용 확인
- **커스텀 태그 파싱**: `<noma-apply>`, `<noma-card>` — SSE 스트림 청크 경계에서도 안전하게 동작
- **세션**: httpOnly + sameSite(lax) + secure(production only), 8시간 유효
- **Railway 제약**: SMTP 포트 차단 → Resend HTTP API만 사용 가능
- **CSV/JSON 파일 삭제 금지**: pgvector 폴백용으로 유지
- **JSON 본문 크기**: 1MB 제한 유지

---

## 협업 방식

### 도구 역할 분담
- Claude AI (채팅): 전략/방향 결정, 복잡한 판단, 이미지 분석, 작업지시서 작성
- Claude Code (로컬): 직접 코딩 실행, 파일 작업, 빌드, 테스트

### 정보 전달 방식
- Claude AI → Claude Code: 작업지시서 파일로 전달
- Claude Code → Claude AI: 텍스트는 복사, 이미지는 캡처 후 첨부

### 작업지시서 파일명 규칙
```
작업지시서_NNN_작업명.md
예) 작업지시서_015_VectorDB전환.md
    작업지시서_016_지식베이스확장.md
```

---

## Claude Code 행동 규칙

1. **세션 시작**: CLAUDE.md를 읽고 프로젝트 맥락을 파악할 것
2. **withLock 필수**: read-modify-write 패턴은 반드시 withLock() 내부에서 수행. 미적용 패턴 작성 금지
3. **새 API 엔드포인트**: requireAuth 미들웨어 적용 확인
4. **requestStore/analyticsStore**: 직접 수정 금지 — 반드시 공개 메서드 사용
5. **CSS**: TailwindCSS 유틸리티 클래스 사용. 인라인 style 최소화
6. **환경변수**: 하드코딩 금지 — process.env 사용
7. **server.js 수정**: 영향 범위 파악 후 작업
8. **CLAUDE.md 동기화**: 구조·기능·규칙 변경 시 CLAUDE.md 업데이트 지시 포함
9. **판단 필요 시**: Claude AI에 보고하고 방향 확인 후 진행
10. **결과 검증**: 작업 완료 후 검증 방법 기준으로 확인하고 결과 보고
