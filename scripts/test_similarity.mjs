import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GEMINI_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const queries = [
  { q: "통합돌봄 신청하고 싶어요", type: "IN", prev: 0.535 },
  { q: "퇴원 후 돌봄이 필요해요", type: "IN", prev: null },
  { q: "장애인 보조기기 지원", type: "IN", prev: null },
  { q: "어린이집 정보 알고 싶어요", type: "IN", prev: null },
  { q: "노인 돌봄 서비스 받고 싶어요", type: "IN", prev: null },
  { q: "기초연금 신청하고 싶어요", type: "OUT", prev: 0.707 },
  { q: "실업급여 받으려면 어떻게", type: "OUT", prev: null },
  { q: "교통 과태료 납부 방법", type: "OUT", prev: null },
  { q: "여권 발급 어디서 하나요", type: "OUT", prev: null },
  { q: "세금 신고 기한이 언제예요", type: "OUT", prev: null },
];

console.log('=== pgvector 유사도 테스트 (task_type 적용 후) ===\n');
console.log(' #  | 유형 | topScore | 이전값 | 매칭 서비스                      | 판정');
console.log('----|------|---------|--------|--------------------------------|------');

for (let i = 0; i < queries.length; i++) {
  const { q, type, prev } = queries[i];

  const { embeddings } = await ai.models.embedContent({
    model: 'gemini-embedding-001',
    contents: q,
    config: { taskType: 'RETRIEVAL_QUERY' },
  });
  const embedding = embeddings[0].values;

  const { data, error } = await supabase.rpc('match_welfare_kb', {
    query_embedding: embedding,
    match_count: 3,
    match_threshold: 0.0,
  });

  if (error) {
    console.error(`  ${i+1} | ERROR: ${error.message}`);
    continue;
  }

  const topScore = data?.[0]?.similarity ?? 0;
  const topMatch = data?.[0]?.service_name ?? '없음';
  const pass = type === 'IN' ? topScore >= 0.75 : topScore <= 0.60;
  const prevStr = prev ? prev.toFixed(3) : '  -  ';

  console.log(` ${String(i+1).padStart(2)} | ${type.padEnd(3)}  | ${topScore.toFixed(3)}   | ${prevStr}  | ${topMatch.padEnd(30)} | ${pass ? 'PASS' : 'FAIL'}`);
}
