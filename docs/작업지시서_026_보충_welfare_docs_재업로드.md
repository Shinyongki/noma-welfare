# 작업지시서_026_보충_welfare_docs_재업로드
# 작성일: 2026-03-15
# 목적: welfare_docs Supabase 재업로드(Step 3) + 검증(Step 4) + 커밋

---

## 현재 상태

사전 조사 결과, 아래와 같이 확인됨.

| 단계 | 상태 |
|------|------|
| Step 1: 기존 파일 백업 | ✅ 완료 |
| Step 2: JSON 파일 교체 (28건, 원본 PDF 기반) | ✅ 완료 |
| Step 3: Supabase 삭제 + 재업로드 | ❌ 미확인 → 이번 작업에서 실행 |
| Step 4: 검증 | ❌ 미확인 → 이번 작업에서 실행 |
| 보충 전용 커밋 | ❌ 없음 → 이번 작업에서 생성 |

---

## 실행 절차

### Step 3. Supabase 삭제 + 재업로드

아래 명령어를 실행할 것.
스크립트 내부에 기존 데이터 삭제 후 재삽입 로직이 이미 포함되어 있음.

```bash
node scripts/upload_doc_embeddings.mjs
```

**실행 중 확인 사항:**
- 28건 전체가 순서대로 처리되는지 콘솔 출력 확인
- 429 오류 발생 시 자동 재시도되므로 기다릴 것 (3초 대기 후 재시도)
- 중간에 중단되면 재실행해도 무방 (삭제 후 재삽입 방식이므로 중복 없음)

실행 완료 후 콘솔 출력 전체를 보고할 것.

---

### Step 4. 검증

재업로드 완료 후 아래 검증을 순서대로 수행할 것.

**검증 1: 건수 확인**

Supabase 대시보드 접근이 불가하므로, 스크립트로 확인할 것.
아래 내용으로 `scripts/verify_welfare_docs.mjs` 파일을 생성하고 실행할 것.

```javascript
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// 1. 전체 건수
const { count } = await supabase
  .from('welfare_docs')
  .select('*', { count: 'exact', head: true });
console.log(`welfare_docs 전체 건수: ${count}건`);

// 2. chunk_index 목록
const { data } = await supabase
  .from('welfare_docs')
  .select('chunk_index, section, target_audience')
  .order('chunk_index');
console.log('\nchunk_index 목록:');
data.forEach(d => console.log(`  ${d.chunk_index}. [${d.target_audience}] ${d.section}`));

// 3. 샘플 유사도 검색 (통합돌봄 신청 쿼리)
import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GEMINI_API_KEY });
const { embeddings } = await ai.models.embedContent({
  model: 'gemini-embedding-001',
  contents: '통합돌봄 신청하고 싶어요',
  config: { taskType: 'RETRIEVAL_QUERY' },
});
const embedding = embeddings[0].values;

const { data: searchResult } = await supabase.rpc('match_welfare_docs', {
  query_embedding: embedding,
  match_threshold: 0.60,
  match_count: 3,
  audience_filter: 'both',
});
console.log('\n샘플 검색 결과 ("통합돌봄 신청하고 싶어요"):');
searchResult.forEach(r => console.log(`  similarity=${r.similarity?.toFixed(3)} | ${r.section}`));
```

```bash
node scripts/verify_welfare_docs.mjs
```

**기대 결과:**
- 전체 건수: 28건
- chunk_index 1~28 전체 존재
- 샘플 검색: similarity >= 0.65 이상 결과 1건 이상, section에 "업무절차" 또는 "법률지침" 포함

기대 결과와 다를 경우 있는 그대로 보고할 것. 임의로 판단하여 재실행하지 말 것.

---

### Step 5. 커밋

검증까지 정상 완료되면 아래 커밋을 생성할 것.

```bash
git add data/welfare_docs_chunks.json data/welfare_docs_chunks_backup_claude_generated.json scripts/verify_welfare_docs.mjs
git commit -m "v026 보충: welfare_docs_chunks 원본 PDF 기반 28건으로 교체 + Supabase 재업로드 완료"
```

---

## 완료 조건

- [ ] `node scripts/upload_doc_embeddings.mjs` 실행 완료, 28건 처리 콘솔 출력 확인
- [ ] `node scripts/verify_welfare_docs.mjs` 실행 완료, 28건 + 샘플 검색 결과 확인
- [ ] 커밋 생성 완료
- [ ] 위 3가지 결과를 Claude AI에 보고

---

## 주의 사항

- 검증 스크립트에서 `match_welfare_docs` RPC의 반환 컬럼명은 실제 Supabase 함수 정의에 따라 다를 수 있음
  (`similarity` 대신 다른 이름일 경우 결과 출력 코드 조정 필요)
- 검증 결과 건수가 28건 미만이면 재업로드 중 중단된 것이므로 Step 3 재실행
- Railway 배포는 이번 작업지시서 범위 밖. 커밋 후 자동 배포되더라도 별도 확인 필요
