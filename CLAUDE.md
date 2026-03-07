# 노마(Noma) 프로젝트 지침
# CLAUDE.md — Claude Code 작업 기준서

---

## 1. 프로젝트 개요

| 항목 | 내용 |
|------|------|
| **프로젝트명** | 노마(Noma) AI 맞춤형 복지 내비게이터 |
| **소속** | 경상남도사회서비스원 |
| **목적** | 도민 일상 언어(음성 포함) 복지 검색·신청 + 내부 담당자 상담 처리·연계·협업 |
| **기술 스택** | Node.js/Express (ESM) + Gemini 2.0 Flash RAG + TailwindCSS (로컬 빌드) |
| **이메일** | Resend HTTP API (SMTP 아님 — Railway 포트 차단) |
| **배포** | Railway (Hobby 플랜), GitHub master 자동 배포 |
| **배포 URL** | https://noma-welfare-production.up.railway.app/ |
| **리포** | Shinyongki/noma-welfare |

---

## 2. 프로젝트 구조

```
사서원/
├── CLAUDE.md                                 # Claude Code용 프로젝트 지침
├── .env                                      # 환경변수
├── server.js                                 # Express 서버 (라우트 포함 단일 파일, ~3000줄)
├── package.json                              # type: "module" (ESM)
├── tailwind.config.cjs                       # TailwindCSS 설정
├── 경상남도사회서비스원_지식베이스_v2.csv     # RAG 지식베이스 CSV (29건, 통합돌봄 포함)
├── welfare_kb_detail_v3.json                 # RAG 상세 지식베이스 JSON (21건)
├── welfare_kb_tonghapdolbom.json             # 통합돌봄 KB 보강 (18건)
├── data/
│   ├── requestStore.mjs                      # 상담 신청 저장/관리 (withLock 원자화 완료)
│   ├── analyticsStore.mjs                    # 일별 이벤트 분석 (withLock 원자화 완료)
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
├── scripts/                                  # 임베딩 업로드 스크립트
│   ├── upload_kb_embeddings.mjs              # welfare_kb 임베딩 업로드
│   ├── upload_faq_embeddings.mjs             # welfare_faq 임베딩 업로드
│   └── upload_doc_embeddings.mjs             # welfare_docs 임베딩 업로드
└── docs/                                     # 기획·분석·작업지시서 문서
```

**참고:** 라우트가 별도 파일로 분리되지 않고 server.js 단일 파일에 모두 포함되어 있습니다.

---

## 3. 핵심 용어 사전

### RAG 및 AI 관련

| 용어 | 설명 |
|------|------|
| **RAG** | Supabase pgvector 3테이블 병렬 검색(welfare_kb + welfare_faq + welfare_docs) → Gemini AI에 컨텍스트로 주입해 답변 생성. 폴백: CSV/JSON 어미 제거 + 유의어 확장 + 스코어링 |
| **buildCumulativeQuery()** | 멀티턴 대화의 누적 컨텍스트로 RAG 쿼리 빌드 (v013 추가). 후속 질문에서도 초기 맥락 유지 |
| **SSE** | Server-Sent Events — Gemini 응답을 스트리밍 전달. 체감 응답 지연 최소화 |
| **STT** | Web Speech API 기반 음성→텍스트 (ko-KR). 음성 종료 시 자동 검색 |
| **TTS** | Edge TTS (ko-KR-SunHiNeural) 텍스트→음성. 실패 시 브라우저 SpeechSynthesis 폴백 |
| **staffSystemPrompt** | 담당자 AI 상담용 시스템 프롬프트. 사건 컨텍스트 + KB 요약 + 정책 문서 검색 포함 |
| **pgvectorDocSearch()** | welfare_docs 테이블 벡터 검색. 정책 문서 청크를 코사인 유사도로 매칭 (v026 추가) |
| **3테이블 병렬 검색** | Promise.all로 pgvectorSearch + pgvectorFaqSearch + pgvectorDocSearch 동시 실행 (v026 추가) |

### 커스텀 태그

| 태그 | 설명 |
|------|------|
| **`<noma-card>`** | Gemini 응답 스트림 내 서비스 카드 JSON 태그 → Stepper 카드 UI 렌더링 |
| **`<noma-apply>`** | 이름·전화번호·서비스명 3필드 수집 완료 시 Gemini가 삽입 → 자동 상담 신청 POST |
| **Stepper 카드** | ① 대상 확인 → ② 신청 방법 → ③ 받는 혜택 → ④ 연락처 4단계 펼침/접힘 UI |

### 데이터 저장

| 모듈 | 설명 |
|------|------|
| **requestStore** | 상담 신청 JSON 파일 기반 저장소. **withLock() 래핑으로 21개 함수 read-modify-write 직렬화 (v014 완료)**. 원자적 쓰기(tmp→rename) + 자동 백업(.bak) + 손상 복구 |
| **analyticsStore** | 일별 검색·신청·TTS 수 기록 JSON 저장소. **withLock() 래핑 완료 (v014)** |
| **deptServiceMap** | 서비스별 담당 부서·법적 근거·대상·자격·연계 가능 서비스 매핑 (server.js 내부) |

### 업무 워크플로우

| 개념 | 설명 |
|------|------|
| **상태 전환** | open → confirmed → contacted → connected → closed (전진만 허용) |
| **2단계 승인** | pending → dept_approved(부서 조정자) → approved(관리자). 최종 승인 시 Resend API 이메일 자동 발송 |
| **연계(referral)** | 신청자를 다른 서비스로 보내는 것. 연쇄 연계(체인) 지원 |
| **협업(collaboration)** | 자문(consultation) / 공동처리(joint) / 이관(transfer) 3유형 |
| **연계 체인** | A서비스 → B서비스 → C서비스 연쇄 이력 시각화 |

### 화면별 역할

| 화면 | 파일 | 사용자 | 주요 기능 |
|------|------|--------|----------|
| 도민 검색 | stitch/code.html | 도민 | 자연어/음성 검색, Stepper 카드, 상담 신청 |
| 관리자 | stitch/admin.html | 관리자 | KPI 현황판, 칸반, 상담 관리, 분석, 연계 조정 |
| 상담 처리 | stitch/case.html | 담당자 | 상태 스테퍼, 메모, 연계 요청, AI 상담 |
| 부서 조정 | stitch/dept.html | 부서 조정자 | 부서별 연계/협업 승인, 배정 관리 |
| 연계 요청 | stitch/referral.html | 담당자 | 서비스 연계 요청 폼 |

---

## 4. 기술 환경

### 의존성

| 분류 | 패키지 |
|------|--------|
| **런타임** | Node.js 18+, ESM ("type": "module") |
| **서버** | express, express-session, cors, helmet, express-rate-limit, dotenv |
| **AI** | @google/genai (Gemini 2.0 Flash + gemini-embedding-001, 3072차원) |
| **음성** | @andresaya/edge-tts |
| **이메일** | Resend HTTP API (https://api.resend.com/emails) |
| **프론트** | TailwindCSS 로컬 빌드, Chart.js CDN |
| **DB** | @supabase/supabase-js + pgvector (운영 중) |

### 환경변수 (.env)

| 변수명 | 용도 |
|--------|------|
| `GOOGLE_GEMINI_API_KEY` | Gemini API 키 |
| `ADMIN_PASSWORD` | 관리자 로그인 |
| `DEPT_PASSWORD` | 부서 조정자 로그인 |
| `SESSION_SECRET` | express-session 서명 키 |
| `RESEND_API_KEY` | Resend 이메일 API 키 |
| `BASE_URL` | 배포 URL (기본 http://localhost:5000) |
| `ALLOWED_ORIGINS` | CORS 허용 도메인 (콤마 구분) |
| `NODE_ENV` | production 시 secure 쿠키 |
| `PORT` | 서버 포트 (기본 5000) |
| `SUPABASE_URL` | Supabase 프로젝트 URL |
| `SUPABASE_KEY` | Supabase anon key |

### 이메일 발송

- **Resend HTTP API** (https://api.resend.com/emails) — Railway SMTP 포트 차단 대응
- 발신: `onboarding@resend.dev` (추후 커스텀 도메인 예정)
- 수신 기본: DEFAULT_RECIPIENTS 배열 (server.js 내 정의)
- 부서별 라우팅: deptServiceMap의 email 필드로 자동 확장

---

## 5. 완료 작업 이력

| 번호 | 작업명 | 핵심 변경 |
|------|--------|----------|
| 001 | 초기 설정 | Railway 배포, 환경변수, ESM 구조 |
| 002~011 | 기능 개발 | RAG, 인증, 연계, 협업, 분석, 보안 패치, Resend API 전환 |
| **012** | **confirm() 제거** | admin.html bulkChangeStatus → **토스트 UI로 교체** |
| **013** | **RAG 멀티턴** | **buildCumulativeQuery() 추가** — 멀티턴 누적 컨텍스트 RAG 쿼리 |
| **014** | **원자화** | requestStore 21개 함수 + analyticsStore **withLock() 래핑** — 동시성 안전 |
| **020** | **응답톤·TTS 개선** | defaultSystemPrompt 톤 가이드 + TTS 전처리(괄호 제거, 전화번호 한글화) + 필러 메시지 12종 |
| **021** | **질의 분석 시스템** | query_log/query_stats 테이블 + 일별 집계 + 용량 관리 4단계 + admin.html 분석 위젯 |
| **022** | **비복지 질의 가드레일** | NON_WELFARE_THRESHOLD=0.45 + 3단계 분류(비복지/소관외/소관내) + 시스템 프롬프트 가이드 |
| **023** | **엣지케이스 응대** | detectEdgeCase() 4유형(crisis/anger/pii/abuse) + 시스템 프롬프트 7유형 가이드 + 위기 즉시 이메일 + edge_alerts 테이블 + admin.html 엣지 알림 탭 |
| **024** | **응답 일관성 보장** | temperature 조정(도민 0.3/담당자 0.5) + 세션 RAG 캐시(10분 TTL) + 안정 정렬 + 일관성 프롬프트 + 이전 추천 서비스 추적 |
| **025** | **프롬프트 사각지대 보강** | 7가지 가이드(할루시네이션/의료법률/신청후문의/정보정정/복수수혜/지역관할/외국인다문화) + REFERRAL_CONTACTS + 전화번호·서비스명 할루시네이션 로깅 |
| **026** | **통합돌봄 KB 보강 + 문서DB** | welfare_kb 통합돌봄 18건 추가(총 47건) + welfare_faq 통합돌봄 FAQ 25건 + welfare_docs 정책문서 28청크 + pgvectorDocSearch + 3테이블 병렬 검색 + 통합돌봄 시스템 프롬프트 가이드 + 담당자 AI 문서 검색 |

---

## 6. 진행 중 / 백로그

| 번호 | 작업명 | 상태 | 핵심 내용 |
|------|--------|------|----------|
| 015~018 | pgvector·KB확장·소관외·FAQ | 완료 (v015~v018에서 순차 구현) | Supabase pgvector + 통합돌봄법 + 소관외 안내 + FAQ 임베딩 |

---

## 7. 데이터 소스 현황

| 소스 | 데이터 | 상태 |
|------|--------|------|
| 경상남도사회서비스원_지식베이스_v2.csv | 29건 서비스 정보 (통합돌봄 8건 포함) | 운영 중 |
| welfare_kb_detail_v3.json | 21건 상세 정보 | 운영 중 |
| welfare_kb_tonghapdolbom.json | 18건 통합돌봄 KB 보강 | 운영 중 |
| data/faq_kb_026_tonghap.json | 25건 통합돌봄 FAQ | 운영 중 |
| data/welfare_docs_chunks.json | 28건 정책 문서 청크 (통합돌봄 표준교안) | 운영 중 |
| Supabase welfare_kb | pgvector 임베딩 (47건, 3072차원) | 운영 중 |
| Supabase welfare_faq | FAQ 임베딩 | 운영 중 |
| Supabase welfare_docs | 정책 문서 임베딩 (28건, 3072차원) | 운영 중 |
| Supabase query_log | 질의 로그 (90일 보관) | 운영 중 |
| Supabase query_stats | 일별 집계 통계 | 운영 중 |
| Supabase edge_alerts | 엣지 케이스 알림 (90일 보관) | 운영 중 |

---

## 8. 주요 기술 제약 및 주의사항

1. **단일 파일 구조**: server.js ~4500줄에 모든 라우트·로직 포함. 수정 시 영향 범위 주의
2. **withLock 직렬화 필수**: read-modify-write 패턴은 반드시 `withLock()` 내부에서 수행. withLock 없는 패턴 절대 금지
3. **원자적 쓰기 유지**: requestStore/analyticsStore는 반드시 tmp→rename 방식 유지
4. **Gemini 429**: 무료 티어 분당 제한. 3초 백오프 재시도 로직 유지
5. **TTS 폴백**: Edge TTS 실패 → 브라우저 SpeechSynthesis
6. **인증 필수**: 보호 API에 requireAuth 미들웨어 적용 확인
7. **커스텀 태그 파싱**: SSE 스트림 청크 경계에서도 안전하게 동작해야 함
8. **세션**: httpOnly + sameSite(lax) + secure(production only), 8시간 유효
9. **Railway 제약**: SMTP 포트 차단 → HTTPS API(Resend)만 사용 가능
10. **CSV/JSON 파일 삭제 금지**: v015 이후에도 폴백용으로 유지

---

## 9. 협업 방식

### 역할 분담

| | Claude AI (채팅) | Claude Code (로컬) |
|-|-----------------|-------------------|
| **역할** | 전략·방향·판단·분석·문서 작성 | 코딩·파일 작업·실행·빌드 |
| **강점** | 이미지 분석, 복잡한 판단, 작업지시서 작성 | 직접 코드 수정, 빌드, 테스트 |
| **산출물** | 작업지시서 (.md / .docx) | 코드 커밋, 실행 결과 |

### 정보 전달

- **Claude AI → Claude Code**: 작업지시서 파일로 전달
- **Claude Code → Claude AI**: 텍스트는 복사, 이미지는 캡처 후 첨부

### 작업지시서 규칙

```
파일명: 작업지시서_NNN_작업명.md
예시: 작업지시서_015_VectorDB전환.md
      작업지시서_016_지식베이스확장.md
```

포함 내용:
1. **목표** — 무엇을 달성하는가
2. **배경** — 왜 필요한가, 현재 상태
3. **작업 항목** — 구체적 변경 사항 (파일명, 함수명 포함)
4. **검증 방법** — 완료 확인 기준
5. **주의사항** — 건드리면 안 되는 부분, 의존성

---

## 10. Claude Code 행동 규칙

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
