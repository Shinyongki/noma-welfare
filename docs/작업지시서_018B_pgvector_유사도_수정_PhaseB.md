# 작업지시서_018B_pgvector_유사도_수정_PhaseB
# 작성일: 2026-03-07
# 선행 작업: Phase A 진단 완료 — 원인 2가지 확정

---

## 1. Phase A 진단 결과 요약

| 원인 | 내용 | 영향도 |
|------|------|--------|
| **task_type 미지정** | 문서/쿼리 양쪽 모두 task_type 없이 임베딩 생성 | **핵심** (임베딩 공간 정렬 안 됨) |
| **임베딩 텍스트 불완전** | 신청방법·문의처 미포함 (4필드 → 6필드로 확장) | 보조 개선 |
| **CSV/JSON 분리 업로드** | 기존 21건(CSV)과 통합돌봄 8건(JSON)이 별도 업로드 | 일관성 확인 필요 |

---

## 2. 수정 작업

### 작업 순서 (반드시 이 순서대로)
1. upload_embeddings.mjs 수정 (task_type + 텍스트 풍부화)
2. server.js 쿼리 임베딩 수정 (task_type 추가)
3. 전체 29건 재업로드
4. 유사도 테스트
5. OUT_OF_SCOPE_THRESHOLD 재조정

---

### B-1. upload_embeddings.mjs 수정

파일: `scripts/upload_embeddings.mjs`

#### 수정 1: task_type 추가

현재 코드에서 `embedContent` 호출 부분을 찾아 task_type 추가:

```javascript
// 변경 전 (현재):
const result = await model.embedContent(textToEmbed);
// 또는
const result = await model.embedContent({ content: textToEmbed });

// 변경 후:
const result = await model.embedContent({
  content: textToEmbed,
  taskType: "RETRIEVAL_DOCUMENT"
});
```

⚠️ @google/genai SDK 버전에 따라 API 시그니처가 다를 수 있음:

```javascript
// 방법 A: @google/genai 최신
const genai = new GoogleGenerativeAI(apiKey);
const model = genai.getGenerativeModel({ model: "gemini-embedding-001" });
const result = await model.embedContent({
  content: { parts: [{ text: textToEmbed }] },
  taskType: "RETRIEVAL_DOCUMENT"
});
const embedding = result.embedding.values;

// 방법 B: @google/genai (새 SDK)
import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey });
const result = await ai.models.embedContent({
  model: "gemini-embedding-001",
  contents: textToEmbed,
  config: { taskType: "RETRIEVAL_DOCUMENT" }
});
const embedding = result.embeddings[0].values;
```

**현재 코드의 SDK import 방식을 확인하고 그에 맞는 방법을 적용할 것.**
확실하지 않으면 `package.json`에서 `@google/genai` 또는 `@google/generative-ai` 버전을 확인하고,
`node_modules/@google/genai/dist/` 또는 `node_modules/@google/generative-ai/dist/` 에서 embedContent 타입 정의를 확인.

#### 수정 2: 임베딩 텍스트 풍부화

임베딩 입력 텍스트를 6필드로 확장:

```javascript
// 변경 전 (현재, 4필드):
const textToEmbed = [
  item.사업명 || item.service_name,
  item.키워드태그 || item.keyword_tags,
  item.지원대상 || item.service_target,
  item.지원내용 || item.service_content,
].filter(Boolean).join(' ');

// 변경 후 (6필드):
const textToEmbed = [
  item.사업명 || item.service_name,
  item.키워드태그 || item.keyword_tags,
  item.지원대상 || item.service_target,
  item.지원내용 || item.service_content,
  item.신청방법 || item.application_method,
  item.문의처 || item.contact_info,
].filter(Boolean).join(' ');
```

⚠️ 실제 필드명은 코드에서 사용 중인 변수명을 따를 것. 한글 키/영문 키 혼용 가능.

#### 수정 3: 29건 통합 업로드 보장

현재 CSV 21건만 처리하는 로직이라면, JSON 8건도 함께 처리하도록 수정:

```javascript
// welfare_kb_detail_v3.json에 29건 전부 있는지 확인
// 있으면 → 이 파일 하나만 읽어서 전체 업로드
// 없으면 → CSV 21건 + welfare_kb_tonghapdolbom.json 8건 병합 후 업로드
```

확인 명령:
```bash
# welfare_kb_detail_v3.json에 몇 건인지:
node -e "const d=require('./welfare_kb_detail_v3.json'); console.log('v3 건수:', Array.isArray(d)?d.length:Object.keys(d).length)"

# 통합돌봄 JSON에 몇 건인지:
node -e "const d=require('./welfare_kb_tonghapdolbom.json'); console.log('통합돌봄 건수:', Array.isArray(d)?d.length:Object.keys(d).length)"
```

29건이 하나의 파일에 없으면, 두 소스를 합쳐서 전부 업로드하도록 수정.

---

### B-2. server.js 쿼리 임베딩 수정

파일: `server.js`

검색 키워드: `embedContent`, `pgvector`, `vectorSearch`

#### 수정: 쿼리 임베딩에 task_type 추가

```javascript
// 변경 전 (현재):
const result = await model.embedContent(queryText);
// 또는
const result = await model.embedContent({ content: queryText });

// 변경 후:
const result = await model.embedContent({
  content: queryText,
  taskType: "RETRIEVAL_QUERY"   // ← 쿼리는 반드시 RETRIEVAL_QUERY
});
```

⚠️ upload_embeddings.mjs와 동일한 SDK 호출 패턴을 사용할 것.
⚠️ server.js에서 embedContent를 호출하는 곳이 여러 곳일 수 있음 — 전부 찾아서 적용.

---

### B-3. 전체 29건 재업로드

수정 완료 후 실행:

```bash
node scripts/upload_embeddings.mjs
```

확인 사항:
- 29건 전부 업로드 로그 확인
- upsert 방식이면 기존 데이터 자동 덮어쓰기
- insert 방식이면 기존 데이터 먼저 삭제 필요 (또는 ON CONFLICT 처리)

업로드 후 검증:
```bash
# 건수 확인 (server.js 또는 별도 스크립트에서)
# Supabase REST API로 확인 가능:
curl -s "https://iagfrjslzqegulzahsiu.supabase.co/rest/v1/welfare_kb?select=id,service_name" \
  -H "apikey: $SUPABASE_KEY" \
  -H "Authorization: Bearer $SUPABASE_KEY" | node -e "
    let d=''; process.stdin.on('data',c=>d+=c); 
    process.stdin.on('end',()=>{const r=JSON.parse(d); console.log('총 건수:', r.length); r.forEach(x=>console.log(x.id, x.service_name))})"
```

---

### B-4. 유사도 테스트

아래 테스트 스크립트를 생성하여 실행:

파일: `scripts/test_similarity.mjs` (임시, 테스트 후 삭제 가능)

```javascript
import dotenv from 'dotenv';
dotenv.config();

// ⚠️ 아래 import는 server.js의 실제 패턴을 따를 것
// server.js에서 Gemini SDK import 방식 확인 후 동일하게 작성

const queries = [
  // 소관 내 (기대: ≥ 0.75)
  { q: "통합돌봄 신청하고 싶어요", type: "IN", prev: 0.535 },
  { q: "퇴원 후 돌봄이 필요해요", type: "IN", prev: null },
  { q: "장애인 보조기기 지원", type: "IN", prev: null },
  { q: "어린이집 정보 알고 싶어요", type: "IN", prev: null },
  { q: "노인 돌봄 서비스 받고 싶어요", type: "IN", prev: null },
  // 소관 외 (기대: ≤ 0.60)
  { q: "기초연금 신청하고 싶어요", type: "OUT", prev: 0.707 },
  { q: "실업급여 받으려면 어떻게", type: "OUT", prev: null },
  { q: "교통 과태료 납부 방법", type: "OUT", prev: null },
  { q: "여권 발급 어디서 하나요", type: "OUT", prev: null },
  { q: "세금 신고 기한이 언제예요", type: "OUT", prev: null },
];

// server.js에서 embedContent + supabase.rpc 호출하는 패턴을 그대로 복사해서 사용
// 핵심: taskType: "RETRIEVAL_QUERY" 적용 확인

console.log('=== pgvector 유사도 테스트 ===\n');
console.log('번호 | 유형 | topScore | 이전값  | 매칭 서비스 | 판정');
console.log('-----|------|---------|--------|-----------|-----');

for (let i = 0; i < queries.length; i++) {
  const { q, type, prev } = queries[i];
  
  // 여기에 임베딩 + RPC 호출 로직
  // const embedding = await getEmbedding(q, "RETRIEVAL_QUERY");
  // const { data } = await supabase.rpc('match_welfare_kb', { query_embedding: embedding, match_threshold: 0.0, match_count: 3 });
  
  const topScore = data?.[0]?.similarity ?? 0;
  const topMatch = data?.[0]?.service_name ?? '없음';
  const pass = type === 'IN' ? topScore >= 0.75 : topScore <= 0.60;
  const prevStr = prev ? prev.toFixed(3) : '  -  ';
  
  console.log(`  ${i+1}  | ${type.padEnd(3)} | ${topScore.toFixed(3)}   | ${prevStr} | ${topMatch.substring(0,15).padEnd(15)} | ${pass ? '✅ PASS' : '❌ FAIL'}`);
}
```

⚠️ 위 스크립트는 뼈대. server.js의 실제 SDK 호출 패턴(import, 인스턴스 생성, embedContent 호출)을 복사해서 완성할 것.

---

### B-5. OUT_OF_SCOPE_THRESHOLD 재조정

테스트 결과를 바탕으로:

```
소관 내 최저 topScore = X
소관 외 최고 topScore = Y
갭 = X - Y

if (갭 >= 0.15) {
  // 충분한 분리 → 중앙값으로 설정
  OUT_OF_SCOPE_THRESHOLD = (X + Y) / 2
} else {
  // 갭이 좁음 → 추가 조치 필요 (보고)
}
```

파일: `server.js`
검색: `OUT_OF_SCOPE_THRESHOLD`
현재값: `0.72`
→ 테스트 결과에 따라 값 수정

---

## 3. 주의사항

### 절대 변경 금지
- server.js 전체 구조 (단일 파일)
- withLock() 패턴
- keywordSearchKnowledgeBase() 폴백 함수
- Gemini 시스템 프롬프트 (추가만, 재작성 금지)
- 임베딩 모델명: `gemini-embedding-001`

### SDK 호환성 주의
- `@google/genai`와 `@google/generative-ai`는 다른 패키지
- embedContent 파라미터명이 다름 (taskType vs config.taskType 등)
- **반드시 현재 코드의 import 방식과 동일하게 작성**
- 확실하지 않으면 `package.json` → `node_modules/` 타입 정의 확인

### Supabase 제약
- anon key로 DDL 불가
- match_welfare_kb 함수 수정이 필요해지면 → SQL을 출력하고 "이 SQL을 Supabase SQL Editor에서 실행해 주세요"라고 보고
- upload_embeddings.mjs의 upsert/insert 방식에 따라 기존 데이터 처리 주의

### 롤백 계획
- 수정 전 upload_embeddings.mjs 백업: `cp scripts/upload_embeddings.mjs scripts/upload_embeddings.mjs.bak`
- server.js embedContent 수정은 최소 범위 (task_type 파라미터 1줄 추가)
- 문제 발생 시 task_type 파라미터만 제거하면 원복

---

## 4. 완료 보고 양식

```
### Phase B 완료 보고

**B-1 수정 내용:**
- task_type: RETRIEVAL_DOCUMENT 추가 (파일명, 라인번호)
- 텍스트 필드: [기존 4필드 → 6필드 변경 내역]
- 29건 통합: [처리 방식]

**B-2 수정 내용:**
- task_type: RETRIEVAL_QUERY 추가 (파일명, 라인번호)
- 수정 위치 개수: [N곳]

**B-3 재업로드:**
- 업로드 건수: [N건]
- 방식: [upsert/delete+insert]

**B-4 테스트 결과:**
| # | 쿼리 | 유형 | topScore | 이전 | 매칭 서비스 | 판정 |
|---|------|------|---------|------|-----------|------|
| 1 | ... | IN | 0.XXX | 0.535 | ... | ✅/❌ |
...

**B-5 임계값:**
- 소관 내 최저: X
- 소관 외 최고: Y  
- 갭: X - Y
- OUT_OF_SCOPE_THRESHOLD: [새 값]

**Supabase SQL 실행 필요 여부:** [예/아니오]
(예인 경우 SQL 첨부)
```

---

## 5. 예상 소요

| 단계 | 예상 시간 |
|------|----------|
| B-1 upload_embeddings.mjs 수정 | 5분 |
| B-2 server.js 수정 | 3분 |
| B-3 재업로드 | 2분 (API 호출 29건) |
| B-4 테스트 스크립트 작성 + 실행 | 10분 |
| B-5 임계값 조정 | 2분 |
| **합계** | **~22분** |
