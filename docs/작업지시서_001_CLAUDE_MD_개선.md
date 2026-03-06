# 작업지시서_001_CLAUDE_MD_개선

**목표:** CLAUDE.md에 server.js 구조 지도, 판단 기준, 보고 형식, 테스트 패턴을 추가하여
Claude Code가 매번 3,001줄을 전체 스캔하지 않아도 되도록 한다.

---

## 배경

현황파악(000) 결과:
- server.js 3,001줄 단일 파일, 함수 26개, API 라우트 68개
- 현재 CLAUDE.md에는 "단일 파일 구조"라고만 적혀 있고 내부 지도 없음
- 판단 기준, 보고 형식, 테스트 패턴 모두 없음
- 특이사항 6건 발견 (아래 주의사항 섹션에 반영 필요)

---

## 작업 항목

CLAUDE.md 파일을 열어서 아래 섹션들을 **추가**한다. 기존 내용은 건드리지 말 것.

---

### 추가할 섹션 1: server.js 구조 지도

기존 `## 주의사항` 섹션 바로 위에 삽입:

```markdown
## server.js 구조 지도

총 3,001줄. 수정 전 반드시 해당 영역 먼저 확인할 것.

### 주요 함수 위치 (grep으로 확인)
함수 위치는 코드 변경에 따라 달라질 수 있으므로, 작업 전 아래 명령으로 확인:
```bash
grep -n "^function\|^const.*=.*async\|^async function\|^app\." server.js | head -80
```

### 함수 목록 및 역할
| 함수명 | 역할 |
|--------|------|
| loadKBDetail() | welfare_kb_detail_v3.json 로딩 |
| loadWelfareKB() | CSV 지식베이스 로딩 |
| stripKoreanSuffixes() | 한국어 어미 제거 (RAG 전처리) |
| expandSearchTerms() | 유의어 확장 검색 |
| sanitizeUserInput() | 입력값 보안 처리 |
| checkResponseForLeaks() | 응답 내 민감정보 유출 검사 |
| generateCaseToken() | 사건 접근 토큰 생성 |
| validateCaseToken() | 사건 토큰 검증 |
| requireAuth() | 관리자 인증 미들웨어 |
| requireDeptAuth() | 부서 조정자 인증 미들웨어 |
| requireCaseAuth() | 사건 접근 인증 미들웨어 |
| sendEmail() | Resend API 이메일 발송 |
| parseCSVLine() | CSV 파싱 |
| getDeptServiceNames() | 부서별 서비스 목록 |
| getRecipients() | 부서별 이메일 수신자 결정 |
| sanitizeEmailHeader() | 이메일 헤더 살균 |
| summarizeChatHistory() | 대화 이력 AI 요약 |
| generateAssignmentRationale() | AI 배정 근거 생성 |
| buildServiceRequestEmailHTML() | 상담 신청 이메일 HTML |
| buildReferralEmailHTML() | 연계 이메일 HTML |
| buildCollaborationEmailHTML() | 협업 이메일 HTML |
| prepareTTSText() | TTS 텍스트 전처리 |
| synthesizeTTS() | Edge TTS 합성 (재시도 포함) |
| getSafeReferralChain() | 연계 체인 조회 |
| getDeptNameById() | 부서 ID→이름 변환 |
| getDeptName() | 부서명 조회 |

### API 라우트 그룹 (총 68개)
| 그룹 | 경로 패턴 | 개수 |
|------|----------|------|
| 인증 | /api/auth/*, /api/dept-auth/*, /api/unified-auth/* | 9개 |
| 도민용 | /api/chat, /api/services, /api/service-request/*, /api/tts | 4개 |
| 상담 처리 | /api/case/:id/* | 10개 |
| 담당자 AI | /api/staff/* | 2개 |
| 연계 | /api/referral/* | 2개 |
| 부서 조정자 | /api/dept/*, /api/dept-coord/*, /api/target-dept/* | 13개 |
| 관리자 | /api/admin/* | 13개 |
| 시스템 | GET /, GET /admin, GET /dept, /api/smtp-check | 4개 |

### 프론트엔드 파일 규모
| 파일 | 줄 수 | 역할 |
|------|-------|------|
| stitch/admin.html | 5,195줄 | 관리자 대시보드 |
| stitch/code.html | 2,511줄 | 도민 검색·상담 |
| stitch/dept.html | 1,443줄 | 부서 조정자 |
| stitch/case.html | 1,437줄 | 담당자 상담 처리 |
| stitch/referral.html | 38줄 | 서비스 연계 요청 |
| data/requestStore.mjs | 835줄 | 상담 저장 모듈 |
| data/analyticsStore.mjs | 99줄 | 분석 데이터 모듈 |
```

---

### 추가할 섹션 2: 판단 기준

기존 `## Claude Code 행동 규칙` 섹션 안에 아래 내용을 **맨 마지막에** 추가:

```markdown
### 스스로 해도 되는 것 vs 반드시 멈추고 보고할 것

**스스로 해도 됨 (보고 후 진행):**
- 버그 수정 (기존 로직 유지)
- 오타·주석·로그 추가/수정
- UI 스타일 수정 (TailwindCSS 클래스)
- 에러 메시지 문구 수정
- 환경변수 기본값 추가

**반드시 멈추고 Claude AI에 보고:**
- RAG 스코어링 로직 변경 (stripKoreanSuffixes, expandSearchTerms, 가중치)
- Gemini 시스템 프롬프트 수정 (staffSystemPrompt 포함)
- 인증·보안 관련 변경 (requireAuth, requireDeptAuth, requireCaseAuth)
- 데이터 구조 변경 (requests.json 스키마, linkage 필드)
- 2단계 승인 워크플로우 로직 변경
- 이메일 발송 로직 변경 (sendEmail, buildXxxEmailHTML)
- 상태 전환 규칙 변경 (open→confirmed→... 순서)
- 새 API 라우트 추가
- requestStore/analyticsStore 파일 쓰기 방식 변경
```

---

### 추가할 섹션 3: 작업 완료 보고 형식

`## 협업 방식` 섹션 안에 아래 내용을 **맨 마지막에** 추가:

```markdown
### 작업 완료 보고 형식
작업 완료 후 Claude AI에 아래 형식으로 보고:

```
[작업 완료 보고]
작업지시서: 작업지시서_NNN_작업명

변경 파일:
- server.js (N줄 → N줄)
- stitch/xxx.html

변경 내용:
- 함수명 또는 라우트: 변경 내용 한 줄 요약

테스트 방법:
- curl 또는 브라우저에서 확인하는 방법

우려사항 / 미완성:
- (없으면 "없음")

CLAUDE.md 업데이트 필요 여부:
- (필요하면 항목 나열, 없으면 "없음")
```
```

---

### 추가할 섹션 4: 자주 쓰는 테스트 명령어

`## 주요 명령어` 섹션 바로 아래에 삽입:

```markdown
## 자주 쓰는 테스트 명령어

```bash
# 서버 정상 실행 확인
curl http://localhost:5000/api/auth/status

# 인증 상태 확인
curl -c cookie.txt -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password":"YOUR_PASSWORD"}'

# 서비스 목록 조회
curl http://localhost:5000/api/services

# RAG 채팅 테스트
curl -X POST http://localhost:5000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"돌봄이 필요해요","history":[]}'

# 상담 신청 테스트
curl -X POST http://localhost:5000/api/service-request/connect \
  -H "Content-Type: application/json" \
  -d '{"serviceName":"긴급돌봄지원","userName":"테스트","userPhone":"010-0000-0000","chatHistory":[]}'

# 이메일 설정 확인
curl http://localhost:5000/api/smtp-check

# 지식베이스 리로드 (인증 필요)
curl -b cookie.txt -X POST http://localhost:5000/api/admin/reload-kb
```
```

---

### 추가할 섹션 5: 알려진 기술 부채 및 주의사항

기존 `## 주의사항` 섹션 **맨 아래에** 추가:

```markdown
### 알려진 기술 부채 (건드리기 전 Claude AI에 문의)
- `.env`에 레거시 SMTP 변수 잔존 (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS) — 코드에서 미사용, 정리 예정
- `/dept` 라우트가 `/admin`으로 리다이렉트 — dept.html은 정적 파일 직접 접근으로만 사용 중
- `stitch/gn_main.html` (16줄) — 용도 미정, 임의 삭제 금지
- `stitch/referral.html` (38줄) — 미완성 가능성, 수정 시 Claude AI 확인 필요
- `server.js` 단일 파일 3,001줄 — 라우트 분리는 Phase 2 이후 검토 예정, 현재는 분리하지 말 것
```

---

## 검증 방법

작업 완료 후 아래 확인:

```bash
# CLAUDE.md 줄 수 확인 (기존보다 늘어나야 함)
wc -l CLAUDE.md

# 추가된 섹션 헤더 확인
grep "^##" CLAUDE.md
```

예상 출력 (순서대로):
```
## 프로젝트 개요
## 프로젝트 구조
## 환경
## 주요 명령어
## 자주 쓰는 테스트 명령어   ← 신규
## server.js 구조 지도       ← 신규
## 주의사항
## 협업 방식
## Claude Code 행동 규칙
```

---

## 주의사항

- 기존 CLAUDE.md 내용은 절대 삭제하거나 수정하지 말 것
- 추가만 할 것
- 마크다운 코드블록 내부의 백틱(```) 처리 주의
- 작업 완료 후 변경된 CLAUDE.md 전체를 Claude AI에게 텍스트로 전달
