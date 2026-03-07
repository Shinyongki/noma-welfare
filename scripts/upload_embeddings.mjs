/**
 * 임베딩 업로드 스크립트
 * CSV 21건 + 통합돌봄 JSON 8건 → Gemini gemini-embedding-001 임베딩 생성 → Supabase upsert
 *
 * 실행: node scripts/upload_embeddings.mjs
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

// CSV 파싱
function parseCSVLine(line) {
  const fields = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      fields.push(field.trim());
      field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  fields.push(field.trim());
  return fields;
}

// CSV 로드 (21건)
const csvPath = path.join(__dirname, '..', '경상남도사회서비스원_지식베이스_v2.csv');
const csvLines = fs.readFileSync(csvPath, 'utf-8').split('\n').filter(l => l.trim());
const csvHeaders = parseCSVLine(csvLines[0]);
const csvServices = csvLines.slice(1).map(line => {
  const fields = parseCSVLine(line);
  const obj = {};
  csvHeaders.forEach((h, i) => { obj[h] = fields[i] || ''; });
  return obj;
});

// 통합돌봄 JSON 로드 (8건)
const dolbomPath = path.join(__dirname, '..', 'welfare_kb_tonghapdolbom.json');
let dolbomServices = [];
if (fs.existsSync(dolbomPath)) {
  dolbomServices = JSON.parse(fs.readFileSync(dolbomPath, 'utf-8'));
  console.log(`[Load] 통합돌봄 JSON: ${dolbomServices.length}건 로드`);
}

// JSON 상세 로드 (v3, 풍부화용)
const jsonPath = path.join(__dirname, '..', 'welfare_kb_detail_v3.json');
const jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
const detailMap = Object.fromEntries(jsonData.services.map(s => [s['사업명'], s]));

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function generateEmbedding(text) {
  const result = await ai.models.embedContent({
    model: 'gemini-embedding-001',
    contents: text,
    config: { taskType: 'RETRIEVAL_DOCUMENT' },
  });
  return result.embeddings[0].values;
}

// 임베딩 입력 텍스트 생성 (6필드 + v3 상세 보강)
function buildEmbeddingText(svc) {
  const name = svc['사업명'];
  const detail = detailMap[name];

  const parts = [
    name,
    svc['키워드 태그'] || '',
    svc['지원 대상'] || '',
    svc['지원 내용'] || '',
    svc['신청 방법'] || '',
    svc['문의처'] || '',
  ];

  // v3 상세 정보 보강 (있으면)
  if (detail) {
    if (detail.responsibility) parts.push(detail.responsibility);
    if (detail.area) parts.push(detail.area);
    if (Array.isArray(detail.keyEligibility)) {
      parts.push(detail.keyEligibility.join(' '));
    }
  }

  return parts.filter(Boolean).join(' ');
}

async function main() {
  // CSV + 통합돌봄 병합
  const allServices = [...csvServices, ...dolbomServices];
  console.log(`[Upload] ${allServices.length}건 임베딩 업로드 시작 (CSV ${csvServices.length} + 통합돌봄 ${dolbomServices.length})\n`);

  let uploaded = 0;
  for (let i = 0; i < allServices.length; i++) {
    const svc = allServices[i];
    const serviceName = svc['사업명'];

    const embeddingText = buildEmbeddingText(svc);
    console.log(`  [${i + 1}/${allServices.length}] ${serviceName} — 임베딩 생성 중... (${embeddingText.length}자)`);

    const embedding = await generateEmbedding(embeddingText);

    const row = {
      category: svc['대분류'] || null,
      sub_category: svc['중분류'] || null,
      service_name: serviceName,
      keyword_tags: svc['키워드 태그'] || '',
      target_group: svc['지원 대상'] || '',
      service_content: svc['지원 내용'] || '',
      application_method: svc['신청 방법'] || '',
      contact: svc['문의처'] || '',
      source_url: svc['출처 URL'] || null,
      embedding,
    };

    const { error } = await supabase
      .from('welfare_kb')
      .upsert(row, { onConflict: 'service_name' });

    if (error) {
      console.error(`  [오류] ${serviceName}: ${error.message}`);
    } else {
      uploaded++;
      console.log(`  [완료] ${serviceName} (${embedding.length}차원)`);
    }

    await sleep(500);
  }

  console.log(`\n[Upload] 완료: ${uploaded}/${allServices.length}건 업로드됨`);
}

main().catch(err => {
  console.error('[Upload] 치명적 오류:', err);
  process.exit(1);
});
