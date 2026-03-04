# Claude Code 작업 지시문
# 노마(Noma) — welfare_kb_detail_v2.json 연동 및 프롬프트 보완

> **작업 파일**: `server.js`  
> **추가 파일**: `welfare_kb_detail_v2.json` (server.js와 같은 위치에 복사)  
> **작업 순서**: 1 → 2 → 3 → 4 → 5 순서대로 진행

---

## 작업 1. welfare_kb_detail_v2.json 로딩 함수 추가

`requestStore`, `analyticsStore`를 초기화하는 코드 근처에 아래 코드를 추가해줘.

```js
const kbDetailPath = path.join(__dirname, 'welfare_kb_detail_v2.json');
let welfareKBDetail = {};

function loadKBDetail() {
  try {
    const raw = fs.readFileSync(kbDetailPath, 'utf-8');
    const parsed = JSON.parse(raw);
    welfareKBDetail = Object.fromEntries(
      parsed.services.map(s => [s['사업명'], s])
    );
    console.log(`[KB Detail] ${Object.keys(welfareKBDetail).length}개 서비스 로딩 완료`);
  } catch (e) {
    console.error('[KB Detail] 로딩 실패 — 기존 데이터 유지:', e.message);
  }
}

loadKBDetail();
```

---

## 작업 2. ragContext 구성 부분 수정 (약 892~906줄)

### 현재 코드 (찾아서 교체)

```js
ragContext += `   - 대상: ${svc['지원 대상']}\n   - 방법: ${svc['신청 방법']}\n   - 혜택: ${svc['지원 내용']}\n   - 연락처: ${svc['문의처']}\n\n`;
```

### 교체할 코드

```js
ragContext += `   - 대상: ${svc['지원 대상']}\n   - 방법: ${svc['신청 방법']}\n   - 혜택: ${svc['지원 내용']}\n   - 연락처: ${svc['문의처']}\n`;

const detail = welfareKBDetail[svc['사업명']];
if (detail) {
  if (detail.cost?.summary)
    ragContext += `   - 비용: ${detail.cost.summary}\n`;
  if (detail.keyEligibility?.length)
    ragContext += `   - 핵심자격: ${detail.keyEligibility.join(' / ')}\n`;
  if (detail.notEligible?.length)
    ragContext += `   - 제외대상: ${detail.notEligible.map(n => `${n.case}(대안:${n.alternative})`).join(' / ')}\n`;
  if (detail.differentFrom?.length)
    ragContext += `   - 유사서비스구분: ${detail.differentFrom.map(d => `vs ${d.compareWith}: ${d.difference}`).join(' / ')}\n`;
  if (detail.faq?.length)
    ragContext += `   - FAQ: ${detail.faq.map(f => `Q.${f.q}→A.${f.a}`).join(' | ')}\n`;
  if (detail.urgencyLevel)
    ragContext += `   - 긴급도: ${detail.urgencyLevel}\n`;
  if (detail.processDays)
    ragContext += `   - 처리소요: ${detail.processDays}\n`;
}
ragContext += '\n';
```

---

## 작업 3. defaultSystemPrompt 수정 (약 954줄)

`defaultSystemPrompt` 안의 `[상담 원칙]` 섹션에서  
**2번 항목(`[Strict Grounding]`) 바로 아래**에 다음 항목을 추가해줘.

### 추가할 내용

```
2-1. [상세 정보 활용] 지식베이스 검색 결과에 비용·핵심자격·제외대상·FAQ·유사서비스구분 항목이 포함되어 있으면 반드시 활용하세요.
  - 사용자가 비용을 물으면 '비용' 항목을 그대로 안내하세요. 없으면 "담당자에게 문의해 주세요"라고 안내하세요.
  - 사용자가 "저 해당되나요?"라고 물으면 '핵심자격'과 '제외대상'을 참고해 판단하세요. 확실하지 않으면 "전화로 확인해 보시는 게 좋을 것 같아요"라고 안내하세요.
  - 사용자가 두 서비스의 차이를 물으면 '유사서비스구분' 항목을 참고해 쉬운 말로 설명하세요.
  - FAQ에 사용자 질문과 유사한 내용이 있으면 해당 답변을 우선 참고하세요.
  - 단, 이 정보도 검색 결과에 포함된 경우에만 사용하세요. 없는 내용을 지어내지 마세요.
```

---

## 작업 4. 수동 리로드 API 추가

관리자 API 라우트(`/api/admin/`) 근처에 아래 엔드포인트를 추가해줘.

```js
// welfare_kb_detail_v2.json 수동 리로드
app.post('/api/admin/reload-kb', requireAuth, (req, res) => {
  loadKBDetail();
  res.json({
    success: true,
    count: Object.keys(welfareKBDetail).length,
    reloadedAt: new Date().toISOString()
  });
});
```

> **용도**: JSON 파일을 교체한 뒤 서버 재시작 없이 바로 반영할 때 사용.  
> 관리자 로그인 후 `POST /api/admin/reload-kb` 호출하면 즉시 적용됨.

---

## 작업 5. welfare_kb_detail_v2.json 파일 배치

`welfare_kb_detail_v2.json` 파일을 `server.js`와 **같은 디렉토리**에 복사해줘.

---

## 완료 후 확인 사항

### 1. 서버 시작 로그 확인
```
[KB Detail] 19개 서비스 로딩 완료
```
위 로그가 출력되면 정상.

### 2. 테스트 질문 3가지
| 질문 | 기대 동작 |
|------|----------|
| "긴급돌봄이랑 재가센터 차이가 뭐예요?" | 유사서비스구분 항목 기반 답변 |
| "비용은 얼마예요?" | 비용 항목 기반 답변 |
| "저 해당이 되나요?" | 핵심자격·제외대상 항목 기반 판단 |

### 3. 수동 리로드 테스트
```
POST /api/admin/reload-kb
```
응답 예시:
```json
{
  "success": true,
  "count": 19,
  "reloadedAt": "2026-03-04T00:00:00.000Z"
}
```

---

## JSON 파일 교체 후 반영 방법

| 상황 | 방법 |
|------|------|
| 서버 재시작 가능 | 파일 교체 후 재시작 |
| 재시작 없이 즉시 반영 | `POST /api/admin/reload-kb` 호출 |
