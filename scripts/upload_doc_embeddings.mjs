/**
 * 문서 청크 임베딩 업로드 스크립트
 * data/welfare_docs_chunks.json → Gemini gemini-embedding-001 임베딩 생성 → Supabase welfare_docs upsert
 *
 * 실행: node scripts/upload_doc_embeddings.mjs
 * 필수 환경변수: GOOGLE_GEMINI_API_KEY, SUPABASE_URL, SUPABASE_KEY
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const REQUIRED_VARS = ['GOOGLE_GEMINI_API_KEY', 'SUPABASE_URL', 'SUPABASE_KEY'];
for (const v of REQUIRED_VARS) {
  if (!process.env[v]) {
    console.error(`환경변수 ${v}가 설정되지 않았습니다.`);
    process.exit(1);
  }
}

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GEMINI_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function generateEmbedding(text) {
  const result = await ai.models.embedContent({
    model: 'gemini-embedding-001',
    contents: text,
    config: { taskType: 'RETRIEVAL_DOCUMENT' },
  });
  return result.embeddings[0].values;
}

async function main() {
  // 기존 데이터 삭제
  const { error: deleteError } = await supabase
    .from('welfare_docs')
    .delete()
    .eq('doc_source', '통합돌봄_표준교안_읍면동_260226');

  if (deleteError) {
    console.error('기존 데이터 삭제 실패:', deleteError.message);
    process.exit(1);
  }
  console.log('[Doc] 기존 데이터 삭제 완료. 재업로드 시작...');

  const chunksPath = path.join(__dirname, '..', 'data', 'welfare_docs_chunks.json');
  const chunks = JSON.parse(fs.readFileSync(chunksPath, 'utf-8'));

  console.log(`[Doc Upload] ${chunks.length}건 문서 청크 임베딩 업로드 시작\n`);

  let uploaded = 0;
  let errors = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    // 임베딩 텍스트: section + summary + content
    const textToEmbed = [
      chunk.section,
      chunk.summary,
      chunk.content,
    ].filter(Boolean).join(' ');

    console.log(`  [${i + 1}/${chunks.length}] ${chunk.section} (${textToEmbed.length}자)`);

    try {
      const embedding = await generateEmbedding(textToEmbed);

      const row = {
        doc_source: chunk.doc_source,
        doc_title: chunk.doc_title,
        doc_type: chunk.doc_type,
        section: chunk.section,
        page_numbers: chunk.page_numbers,
        chunk_index: chunk.chunk_index,
        content: chunk.content,
        summary: chunk.summary,
        target_audience: chunk.target_audience,
        embedding,
      };

      const { error } = await supabase
        .from('welfare_docs')
        .insert(row);

      if (error) {
        console.error(`  [오류] ${error.message}`);
        errors++;
      } else {
        uploaded++;
        console.log(`  [완료] ${chunk.section} (${embedding.length}차원)`);
      }
    } catch (err) {
      console.error(`  [임베딩 오류] ${err.message}`);
      errors++;
      if (err.message?.includes('429') || err.message?.includes('RESOURCE_EXHAUSTED')) {
        console.log('  [대기] API 제한 — 3초 대기 후 재시도...');
        await sleep(3000);
        i--;
        continue;
      }
    }

    await sleep(500);
  }

  console.log(`\n[Doc Upload] 완료: ${uploaded}/${chunks.length}건 업로드 (오류: ${errors}건)`);
}

main().catch(err => {
  console.error('[Doc Upload] 치명적 오류:', err);
  process.exit(1);
});
