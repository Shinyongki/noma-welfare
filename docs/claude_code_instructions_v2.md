# Claude Code 작업 지시문 v2
# 노마(Noma) — 지식베이스 v3 연동 (CSV v2 + JSON v3)

> **대상 파일**: `server.js`
> **추가 파일 2개** (server.js와 같은 디렉토리에 복사):
> - `경상남도사회서비스원_지식베이스_v2.csv`
> - `welfare_kb_detail_v3.json`
>
> **작업 순서**: 1 → 2 → 3 → 4 → 5 순서대로 진행
> **주의**: 이전 지시문(v1)의 작업이 아직 반영되지 않은 상태를 기준으로 작성됨

---

## 작업 1. CSV 파일 경로 변경

### 찾을 코드 (283줄 근처)

```js
const KB_FILE = path.join(__dirname, '경상남도사회서비스원_지식베이스.csv');
```

### 교체할 코드

```js
const KB_FILE = path.join(__dirname, '경상남도사회서비스원_지식베이스_v2.csv');
```

> **변경 이유**: v2 CSV는 기존 19개에서 21개 서비스로 확장되었고, 전체 키워드 태그가 보강됨.
> 사업명도 `민간 사회복지시설 경영컨설팅` → `품질관리 종합 컨설팅사업`으로 변경됨.

---

## 작업 2. welfare_kb_detail_v3.json 로딩 함수 추가

`loadWelfareKB()` 함수 정의 바로 아래 (약 660줄 근처, `loadWelfareKB();` 호출문 다음)에 아래 코드를 추가해줘.

```js
// ── Welfare KB Detail (JSON) Loading ──
const kbDetailPath = path.join(__dirname, 'welfare_kb_detail_v3.json');
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

## 작업 3. ragContext 구성 부분 수정 (약 906줄 근처)

### 찾을 코드

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

## 작업 4. defaultSystemPrompt 수정 (약 971줄 근처)

`defaultSystemPrompt` 안의 `[상담 원칙]` 섹션에서 **2번 항목(`[Strict Grounding]`) 바로 아래**에 다음 항목을 추가해줘.

### 추가 위치

```
2. [Strict Grounding] ... (기존 내용 유지)
← 여기에 2-1 추가
3. 지식베이스에 관련 서비스가 없으면 ...
```

### 추가할 내용

```
2-1. [상세 정보 활용] 지식베이스 검색 결과에 비용·핵심자격·제외대상·FAQ·유사서비스구분 항목이 포함되어 있으면 반드시 활용하세요.
  - 사용자가 비용을 물으면 '비용' 항목을 그대로 안내하세요. 없으면 "담당자에게 문의해 주세요"라고 안내하세요.
  - 사용자가 "저 해당되나요?"라고 물으면 '핵심자격'과 '제외대상'을 참고해 판단하세요. 확실하지 않으면 "전화로 확인해 보시는 게 좋을 것 같아요"라고 안내하세요.
  - 사용자가 두 서비스의 차이를 물으면 '유사서비스구분' 항목을 참고해 쉬운 말로 설명하세요.
  - FAQ에 사용자 질문과 유사한 내용이 있으면 해당 답변을 우선 참고하세요.
  - 단, 이 정보도 검색 결과에 포함된 경우에만 사용하세요. 없는 내용을 지어내지 마세요.
2-2. [대상자 범위] 경상남도사회서비스원의 사업은 도민(이용자)뿐 아니라 사회복지시설 종사자, 기관 담당자, 일반 시민도 문의 대상이 됩니다.
  - 도민 대상 서비스를 종사자·기관이 문의해도 안내하세요. (예: 시설에서 이용자를 위해 문의)
  - 기관·종사자 대상 서비스(대체인력, 컨설팅, 안전점검 등)도 일반 시민이 문의하면 안내하세요.
  - 서비스 대상을 구분할 때 "이 서비스는 기관용이라 안내드리기 어려워요"라고 말하지 마세요.
```

---

## 작업 5. 수동 리로드 API 추가

관리자 API 라우트(`/api/admin/`) 근처에 아래 엔드포인트를 추가해줘.

```js
// KB Detail 수동 리로드 (서버 재시작 없이 JSON 교체 반영)
app.post('/api/admin/reload-kb', requireAuth, (req, res) => {
  loadKBDetail();
  res.json({
    success: true,
    count: Object.keys(welfareKBDetail).length,
    reloadedAt: new Date().toISOString()
  });
});
```

---

## 파일 배치 요약

| 파일명 | 위치 | 비고 |
|--------|------|------|
| `경상남도사회서비스원_지식베이스_v2.csv` | `server.js`와 같은 디렉토리 | 기존 CSV 대체 |
| `welfare_kb_detail_v3.json` | `server.js`와 같은 디렉토리 | 신규 추가 |

---

## 완료 후 확인 사항

### 1. 서버 시작 로그

```
Loaded 21 welfare service records.
[KB Detail] 21개 서비스 로딩 완료
```

두 줄 모두 출력되어야 정상. 숫자가 21이어야 함 (19면 구 CSV 사용 중).

### 2. 테스트 질문

| 질문 | 기대 동작 |
|------|----------|
| "긴급돌봄이랑 재가센터 차이가 뭐예요?" | 유사서비스구분 항목 기반 쉬운 설명 |
| "비용은 얼마예요?" | 비용 항목 그대로 안내 (무료 등) |
| "저 해당이 되나요?" | 핵심자격·제외대상 기반 판단 |
| "시설 노무 컨설팅 받고 싶어요" | 품질관리 종합 컨설팅사업 또는 맞춤형 통합지원 안내 |
| "혼자 사는데 응급상황이 걱정돼요" | 응급안전안심서비스 + 라이프링 안내 |
| "사회서비스원이 어떤 일을 하나요?" | 전체 사업 영역(공공돌봄·민간지원·시설운영 등) 안내 |

### 3. 수동 리로드 테스트

JSON 파일 교체 후 서버 재시작 없이 반영하려면:

```
POST /api/admin/reload-kb
(관리자 로그인 세션 필요)
```

응답 예시:
```json
{
  "success": true,
  "count": 21,
  "reloadedAt": "2026-03-04T00:00:00.000Z"
}
```

---

## 변경된 지식베이스 내용 참고

### CSV v2 vs v1 주요 변경사항

| 구분 | 내용 |
|------|------|
| 사업명 변경 | `민간 사회복지시설 경영컨설팅` → `품질관리 종합 컨설팅사업` |
| 키워드 보강 | 19개 전체 서비스 — 이용자 관점 외 종사자·기관·일반인 질의 커버 |
| 신규 추가 | `1인가구 안전안심 라이프링 긴급구조 알림` (공공돌봄) |
| 신규 추가 | `맞춤형 통합지원` (민간지원) |
| **합계** | **19개 → 21개** |

### JSON v3 vs v2 주요 변경사항

| 구분 | 내용 |
|------|------|
| 사업명 변경 | `민간 사회복지시설 경영컨설팅` → `품질관리 종합 컨설팅사업` (내용 보강 포함) |
| 대분류 수정 | 창원·김해 종합재가센터 → `공공돌봄`에서 `국공립시설`로 변경 |
| 신규 추가 | `1인가구 안전안심 라이프링 긴급구조 알림` |
| 신규 추가 | `맞춤형 통합지원` |
| **합계** | **19개 → 21개** |
