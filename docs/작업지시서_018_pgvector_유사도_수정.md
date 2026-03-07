# 작업지시서_018_pgvector_유사도_정상화
# 작성일: 2026-03-07
# 우선순위: 긴급 (v017 소관 외 감지가 이 작업에 의존)

---

## 1. 목표

Supabase pgvector 벡터 검색의 유사도(similarity)를 정상화하여,
소관 내 서비스 쿼리 시 topScore ≥ 0.75, 소관 외 쿼리 시 topScore ≤ 0.60을 달성한다.

현재 상태:
- "통합돌봄 신청하고 싶어요" → topScore 0.535 (기대: ≥0.80)
- "기초연금 신청하고 싶어요" → topScore 0.707 (기대: ≤0.60)
- 소관 내/외 유사도가 겹쳐서 OUT_OF_SCOPE_THRESHOLD(0.72) 판별 불가

---

## 2. 배경

### 이미 확인된 사항 (재확인 불필요)
- welfare_kb 테이블: 29건 정상 (id 1~21 기존, id 43~50 통합돌봄)
- embedding 컬럼: 3072차원 정상
- match_welfare_kb 함수: vector(3072) 대응 확인
- 임베딩 모델: gemini-embedding-001 (server.js, upload_embeddings.mjs 동일)

### 핵심 의심 원인 (3가지, 우선순위 순)
1. **임베딩 입력 텍스트 빈약** — upload_embeddings.mjs에서 service_name만 임베딩했을 가능성
2. **task_type 미지정 또는 불일치** — 문서는 RETRIEVAL_DOCUMENT, 쿼리는 RETRIEVAL_QUERY 사용 필요
3. **match_welfare_kb 함수의 거리 계산 방향** — `1 - distance` 변환 누락 가능

---

## 3. 작업 항목

### Phase A: 진단 (코드 변경 없음)

#### A-1. upload_embeddings.mjs 임베딩 텍스트 확인

파일: `scripts/upload_embeddings.mjs`

확인할 것:
```
- 임베딩 생성 시 어떤 텍스트를 모델에 전달하는가?
- service_name만? 아니면 키워드+대상+내용+방법+문의처를 결합?
- task_type 파라미터를 사용하는가? 값은?
```

아래 패턴을 찾아서 기록:
```javascript
// 이런 코드를 찾아라:
const text = item.service_name;  // ← 이것만이면 문제
// vs
const text = `${item.service_name} ${item.keyword_tags} ${item.service_content} ...`;  // ← 이래야 정상

// task_type 확인:
model.embedContent({ content: ..., taskType: "RETRIEVAL_DOCUMENT" })  // ← 있는지?
```

**결과를 기록할 것:**
- [ ] 임베딩 텍스트 구성: (어떤 필드를 결합했는지)
- [ ] task_type 사용 여부: (있으면 값, 없으면 "미사용")

#### A-2. server.js 쿼리 임베딩 코드 확인

파일: `server.js`

검색 키워드: `embedContent`, `embed`, `embedding`, `RETRIEVAL_QUERY`

확인할 것:
```
- 사용자 쿼리를 임베딩할 때 어떤 텍스트를 전달하는가?
- task_type을 "RETRIEVAL_QUERY"로 지정하는가?
- buildCumulativeQuery() 결과를 그대로 임베딩하는가, 아니면 원본 쿼리만?
```

**결과를 기록할 것:**
- [ ] 쿼리 임베딩 텍스트: (원본 쿼리? 누적 쿼리?)
- [ ] task_type 사용 여부: (있으면 값, 없으면 "미사용")

#### A-3. match_welfare_kb SQL 함수 로직 확인

Supabase에 직접 접근 불가하므로, server.js에서 이 함수를 호출하는 코드를 찾아 확인:

```javascript
// 이런 패턴을 찾아라:
supabase.rpc('match_welfare_kb', { ... })
```

또한, 프로젝트 내 SQL 파일이나 작업지시서_015*.md에서 함수 정의를 찾아라:
```sql
-- CREATE OR REPLACE FUNCTION match_welfare_kb(...)
-- 특히 ORDER BY와 RETURN 값 확인:
-- ORDER BY embedding <=> query_embedding  ← cosine distance (낮을수록 유사)
-- 1 - (embedding <=> query_embedding) AS similarity  ← 변환 필요
```

**결과를 기록할 것:**
- [ ] similarity 계산식: (1 - distance인지, raw distance인지)
- [ ] match_threshold 기본값:
- [ ] match_count 기본값:

---

### Phase B: 수정 (진단 결과에 따라 선택 적용)

#### B-1. 임베딩 텍스트 풍부화 (A-1에서 빈약한 경우)

파일: `scripts/upload_embeddings.mjs`

수정 내용: 임베딩 입력 텍스트를 풍부하게 재구성

```javascript
// 변경 전 (예상):
const textToEmbed = item.service_name;

// 변경 후:
const textToEmbed = [
  item.service_name,           // 사업명
  item.keyword_tags,           // 키워드 태그
  item.service_target,         // 지원 대상
  item.service_content,        // 지원 내용
  item.application_method,     // 신청 방법
  item.contact_info,           // 문의처
].filter(Boolean).join(' ');
```

⚠️ 주의: 실제 JSON 필드명은 `welfare_kb_detail_v3.json`의 키를 확인하여 정확히 맞출 것.

#### B-2. task_type 추가 (미사용인 경우)

**문서 임베딩 (upload_embeddings.mjs):**
```javascript
const result = await model.embedContent({
  content: { parts: [{ text: textToEmbed }] },
  taskType: "RETRIEVAL_DOCUMENT"  // ← 추가
});
```

**쿼리 임베딩 (server.js):**
```javascript
const result = await model.embedContent({
  content: { parts: [{ text: userQuery }] },
  taskType: "RETRIEVAL_QUERY"  // ← 추가
});
```

⚠️ 주의: Gemini embedding API의 실제 파라미터명 확인 필요.
@google/genai SDK 기준: `embedContent({ content, taskType })` 또는 `embedContent({ model, content, taskType })`
taskType 유효값: "RETRIEVAL_QUERY", "RETRIEVAL_DOCUMENT", "SEMANTIC_SIMILARITY", "CLASSIFICATION", "CLUSTERING"

#### B-3. match_welfare_kb 함수 수정 (거리 방향 문제인 경우)

이것은 Supabase SQL Editor에서 수동 실행해야 합니다.
Claude Code가 직접 실행 불가 → SQL을 출력하고 사용자에게 실행 요청.

확인할 SQL:
```sql
-- 현재 함수 정의 확인
SELECT pg_get_functiondef(oid) 
FROM pg_proc 
WHERE proname = 'match_welfare_kb';
```

수정이 필요한 경우 (similarity가 raw distance인 경우):
```sql
CREATE OR REPLACE FUNCTION match_welfare_kb(
  query_embedding vector(3072),
  match_threshold float DEFAULT 0.3,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  id bigint,
  service_name text,
  category text,
  subcategory text,
  service_target text,
  service_content text,
  application_method text,
  contact_info text,
  keyword_tags text,
  source_url text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    wk.id,
    wk.service_name,
    wk.category,
    wk.subcategory,
    wk.service_target,
    wk.service_content,
    wk.application_method,
    wk.contact_info,
    wk.keyword_tags,
    wk.source_url,
    1 - (wk.embedding <=> query_embedding) AS similarity  -- ← 핵심: 1 - distance
  FROM welfare_kb wk
  WHERE 1 - (wk.embedding <=> query_embedding) > match_threshold
  ORDER BY wk.embedding <=> query_embedding  -- ← 거리 기준 오름차순 (가까운 것 먼저)
  LIMIT match_count;
END;
$$;
```

---

### Phase C: 재업로드 및 검증

#### C-1. 임베딩 재업로드 (B-1 또는 B-2 수정한 경우)

```bash
node scripts/upload_embeddings.mjs
```

⚠️ 주의사항:
- 기존 데이터 덮어쓰기(upsert) 방식인지 확인. 아니면 기존 데이터 삭제 후 재삽입 필요
- 29건 전체 재업로드 확인 (id 1~21 + id 43~50)
- 업로드 후 Supabase에서 건수 확인: `SELECT count(*) FROM welfare_kb;`

#### C-2. 유사도 테스트 (10개 쿼리)

서버 재시작 후 아래 쿼리로 테스트. 
방법: 직접 API 호출 또는 브라우저에서 검색

**소관 내 테스트 (기대: topScore ≥ 0.75)**

| # | 쿼리 | 기대 매칭 서비스 | 이전 topScore | 목표 |
|---|------|-----------------|--------------|------|
| 1 | "통합돌봄 신청하고 싶어요" | 통합돌봄 신청·연계 안내 | 0.535 | ≥0.75 |
| 2 | "퇴원 후 돌봄이 필요해요" | 긴급돌봄지원사업 | 미측정 | ≥0.75 |
| 3 | "장애인 보조기기 지원" | 보조기기센터 | 미측정 | ≥0.75 |
| 4 | "어린이집 정보" | 경상남도청어린이집 | 미측정 | ≥0.75 |
| 5 | "노인 돌봄 서비스" | 노인맞춤돌봄지원 | 미측정 | ≥0.75 |

**소관 외 테스트 (기대: topScore ≤ 0.60)**

| # | 쿼리 | 이전 topScore | 목표 |
|---|------|--------------|------|
| 6 | "기초연금 신청하고 싶어요" | 0.707 | ≤0.60 |
| 7 | "실업급여 받으려면" | 미측정 | ≤0.60 |
| 8 | "교통 과태료 납부" | 미측정 | ≤0.60 |
| 9 | "여권 발급 방법" | 미측정 | ≤0.60 |
| 10 | "세금 신고 기한" | 미측정 | ≤0.60 |

**테스트 방법:**
server.js의 vectorSearchKnowledgeBase() 함수 내에서 console.log로 topScore를 출력하거나,
별도 테스트 스크립트 작성:

```javascript
// test_similarity.mjs (임시)
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GEMINI_API_KEY });

const queries = [
  "통합돌봄 신청하고 싶어요",
  "퇴원 후 돌봄이 필요해요",
  "장애인 보조기기 지원",
  "기초연금 신청하고 싶어요",
  "실업급여 받으려면",
  "여권 발급 방법",
];

for (const q of queries) {
  // ⚠️ 실제 SDK 메서드명 확인 필요
  const embedResult = await genai.models.embedContent({
    model: "gemini-embedding-001",
    content: { parts: [{ text: q }] },
    taskType: "RETRIEVAL_QUERY",
  });
  
  const embedding = embedResult.embedding.values;
  
  const { data, error } = await supabase.rpc('match_welfare_kb', {
    query_embedding: embedding,
    match_threshold: 0.0,  // 테스트용: 임계값 없이 전부 반환
    match_count: 3,
  });
  
  const topScore = data?.[0]?.similarity ?? 0;
  const topMatch = data?.[0]?.service_name ?? '없음';
  console.log(`[${topScore.toFixed(3)}] "${q}" → ${topMatch}`);
}
```

⚠️ 위 스크립트는 참고용. 실제 @google/genai SDK의 embedContent API 시그니처에 맞게 수정할 것.

#### C-3. OUT_OF_SCOPE_THRESHOLD 재조정

유사도 정상화 후, 소관 내 최저 topScore와 소관 외 최고 topScore 사이에 임계값을 설정:

```
소관 내 최저: X (목표 ≥0.75)
소관 외 최고: Y (목표 ≤0.60)
→ 임계값 = (X + Y) / 2 부근, 약 0.65~0.70
```

파일: `server.js`
검색: `OUT_OF_SCOPE_THRESHOLD`
현재값: 0.72 → 테스트 결과에 맞게 조정

---

## 4. 검증 기준

| 항목 | 기준 |
|------|------|
| 소관 내 5개 쿼리 topScore | 전부 ≥ 0.75 |
| 소관 외 5개 쿼리 topScore | 전부 ≤ 0.60 |
| 소관 내/외 topScore 갭 | ≥ 0.15 (겹침 없음) |
| OUT_OF_SCOPE_THRESHOLD | 갭 중앙에 설정 |
| v017 소관 외 카드 렌더링 | 소관 외 쿼리 시 amber 카드 표시, Stepper 카드 억제 |
| 기존 기능 정상 | code.html 검색, 상담 신청, case.html 정상 동작 |

---

## 5. 주의사항

### 절대 변경 금지
- server.js 전체 구조 (단일 파일 유지)
- withLock() 패턴 (requestStore, analyticsStore)
- keywordSearchKnowledgeBase() 폴백 함수 (pgvector 실패 시 사용)
- Gemini 시스템 프롬프트 (추가만, 재작성 금지)
- 임베딩 모델명: gemini-embedding-001

### Supabase 제약
- anon key로는 DDL(CREATE/ALTER) 실행 불가
- match_welfare_kb 함수 수정이 필요한 경우 → SQL을 출력하고 사용자에게 Supabase SQL Editor 실행 요청
- service_role key 미보유

### 작업 순서 엄수
1. Phase A 전체 완료 → 결과 보고
2. Phase B는 Phase A 결과에 따라 선택 적용
3. Phase C는 Phase B 완료 후 실행
4. 각 Phase 완료 시 중간 결과 보고

---

## 6. 보고 양식

각 Phase 완료 시 아래 형식으로 보고:

```
### Phase [A/B/C] 완료 보고

**A-1 결과:**
- 임베딩 텍스트: [구성 내용]
- task_type: [값 또는 미사용]

**A-2 결과:**
- 쿼리 임베딩 텍스트: [구성 내용]
- task_type: [값 또는 미사용]

**A-3 결과:**
- similarity 계산식: [내용]
- match_threshold: [값]

**수정 사항:** [B-1/B-2/B-3 중 적용한 것]
**테스트 결과:** [10개 쿼리 topScore 표]
**다음 단계:** [조치 필요 사항]
```
