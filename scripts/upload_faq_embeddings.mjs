/**
 * FAQ 임베딩 업로드 스크립트
 * welfare_kb_detail_v3.json의 서비스별 FAQ + data/faq_kb.json 보충분
 * → Gemini gemini-embedding-001 임베딩 생성 → Supabase welfare_faq upsert
 *
 * 실행: node scripts/upload_faq_embeddings.mjs
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
  // 1. 서비스별 FAQ 로드 (welfare_kb_detail_v3.json)
  const jsonPath = path.join(__dirname, '..', 'welfare_kb_detail_v3.json');
  const jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

  const allFaqs = [];

  // v3.json 서비스별 FAQ
  for (const svc of jsonData.services) {
    if (!svc.faq || svc.faq.length === 0) continue;
    for (const f of svc.faq) {
      allFaqs.push({
        service_name: svc['사업명'],
        category: f.category || 'general',
        question: f.q,
        answer: f.a,
        persona: null,
        keywords: null,
      });
    }
  }

  // 2. 보충분 FAQ 로드 (data/faq_kb.json + data/faq_kb_026_tonghap.json)
  const faqKbFiles = [
    path.join(__dirname, '..', 'data', 'faq_kb.json'),
    path.join(__dirname, '..', 'data', 'faq_kb_026_tonghap.json'),
  ];
  for (const faqKbPath of faqKbFiles) {
    if (fs.existsSync(faqKbPath)) {
      const supplementFaqs = JSON.parse(fs.readFileSync(faqKbPath, 'utf-8'));
      console.log(`[Load] FAQ 보충분: ${path.basename(faqKbPath)} (${supplementFaqs.length}건)`);
      for (const f of supplementFaqs) {
        allFaqs.push({
          service_name: f.related_service || f.category || '공통',
          category: f.faq_type || 'general',
          question: f.question,
          answer: f.answer,
          persona: f.persona || null,
          keywords: f.keywords || null,
        });
      }
    }
  }

  console.log(`[FAQ Upload] 총 ${allFaqs.length}건 임베딩 업로드 시작\n`);

  let uploaded = 0;
  let errors = 0;

  for (let i = 0; i < allFaqs.length; i++) {
    const faq = allFaqs[i];

    // 임베딩 텍스트: 질문 + 키워드 + 답변
    const textToEmbed = [
      faq.question,
      faq.keywords,
      faq.answer,
    ].filter(Boolean).join(' ');

    console.log(`  [${i + 1}/${allFaqs.length}] ${faq.service_name} | ${faq.category} | "${faq.question.substring(0, 40)}..."`);

    try {
      const embedding = await generateEmbedding(textToEmbed);

      const row = {
        service_name: faq.service_name,
        category: faq.category,
        question: faq.question,
        answer: faq.answer,
        persona: faq.persona,
        embedding,
      };

      const { error } = await supabase
        .from('welfare_faq')
        .upsert(row, { onConflict: 'service_name,question' });

      if (error) {
        console.error(`  [오류] ${error.message}`);
        errors++;
      } else {
        uploaded++;
      }
    } catch (err) {
      console.error(`  [임베딩 오류] ${err.message}`);
      errors++;
      // 429 에러 시 3초 대기 후 재시도
      if (err.message?.includes('429') || err.message?.includes('RESOURCE_EXHAUSTED')) {
        console.log('  [대기] API 제한 — 3초 대기 후 재시도...');
        await sleep(3000);
        i--; // 재시도
        continue;
      }
    }

    await sleep(500);
  }

  console.log(`\n[FAQ Upload] 완료: ${uploaded}/${allFaqs.length}건 업로드 (오류: ${errors}건)`);
}

main().catch(err => {
  console.error('[FAQ Upload] 치명적 오류:', err);
  process.exit(1);
});
