/**
 * 노마 시연 전 점검 스크립트
 * 실행: node scripts/pre_demo_check.mjs
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';
import { listAll } from '../data/requestStore.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GEMINI_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

let failCount = 0;

function now() {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

async function checkSupabase() {
    process.stdout.write('1. Supabase 연결... ');
    try {
        const [kb, faq, docs] = await Promise.all([
            supabase.from('welfare_kb').select('*', { count: 'exact', head: true }),
            supabase.from('welfare_faq').select('*', { count: 'exact', head: true }),
            supabase.from('welfare_docs').select('*', { count: 'exact', head: true }),
        ]);

        if (kb.error || faq.error || docs.error) {
            const err = kb.error?.message || faq.error?.message || docs.error?.message;
            console.log(`\u274C Supabase 연결 실패: ${err}`);
            failCount++;
            return;
        }
        console.log(`\u2705 (welfare_kb: ${kb.count}건, welfare_faq: ${faq.count}건, welfare_docs: ${docs.count}건)`);
    } catch (err) {
        console.log(`\u274C Supabase 연결 실패: ${err.message}`);
        failCount++;
    }
}

async function checkGemini() {
    process.stdout.write('2. Gemini API...    ');
    try {
        const result = await ai.models.embedContent({
            model: 'gemini-embedding-001',
            contents: '테스트',
            config: { taskType: 'RETRIEVAL_QUERY' },
        });
        if (result.embeddings?.[0]?.values?.length > 0) {
            console.log('\u2705');
        } else {
            console.log('\u274C Gemini 임베딩 API 응답 비정상');
            failCount++;
        }
    } catch (err) {
        console.log(`\u274C Gemini API 실패: ${err.message}`);
        failCount++;
    }
}

async function pgvectorSearch(query, threshold, count) {
    const { embeddings } = await ai.models.embedContent({
        model: 'gemini-embedding-001',
        contents: query,
        config: { taskType: 'RETRIEVAL_QUERY' },
    });
    const embedding = embeddings[0].values;
    const { data, error } = await supabase.rpc('match_welfare_kb', {
        query_embedding: embedding,
        match_threshold: threshold,
        match_count: count,
    });
    if (error) throw new Error(error.message);
    return data || [];
}

async function pgvectorDocSearch(query, threshold, count) {
    const { embeddings } = await ai.models.embedContent({
        model: 'gemini-embedding-001',
        contents: query,
        config: { taskType: 'RETRIEVAL_QUERY' },
    });
    const embedding = embeddings[0].values;
    const { data, error } = await supabase.rpc('match_welfare_docs', {
        query_embedding: embedding,
        match_threshold: threshold,
        match_count: count,
        audience_filter: 'both',
    });
    if (error) throw new Error(error.message);
    return data || [];
}

async function checkRAG() {
    console.log('3. RAG 검색 확인');

    // 장면 1
    process.stdout.write('   장면1 "퇴원 걱정": ');
    try {
        const results1 = await pgvectorSearch('퇴원했는데 혼자라서 걱정돼요', 0.45, 3);
        if (results1.length > 0) {
            const top = results1[0];
            const score = top.similarity?.toFixed(2);
            const name = top.service_name || top.section || '(알수없음)';
            const ok = top.similarity >= 0.72;
            console.log(`topScore=${score}, 1위=${name} ${ok ? '\u2705' : '\u26A0\uFE0F 임계값 미달(0.72)'}`);
            if (!ok) failCount++;
        } else {
            console.log('\u274C 검색 결과 없음');
            failCount++;
        }
    } catch (err) {
        console.log(`\u274C ${err.message}`);
        failCount++;
    }

    await new Promise(r => setTimeout(r, 1000));

    // 장면 2
    process.stdout.write('   장면2 "통합돌봄": ');
    try {
        const results2 = await pgvectorDocSearch('통합돌봄 신청하고 싶어요', 0.50, 3);
        if (results2.length > 0) {
            const top = results2[0];
            const score = top.similarity?.toFixed(2);
            const section = top.section || '(알수없음)';
            console.log(`topScore=${score}, 문서매칭=${section} \u2705`);
        } else {
            console.log('\u26A0\uFE0F 문서 매칭 없음');
            failCount++;
        }
    } catch (err) {
        console.log(`\u274C ${err.message}`);
        failCount++;
    }
}

function checkDemoData() {
    process.stdout.write('4. 데모 데이터...   ');
    try {
        const all = listAll();
        const demoItems = all.filter(r =>
            r.userPhone?.startsWith('010-0000-000') || r.userPhone?.startsWith('055-0000-000')
        );
        if (demoItems.length === 5) {
            console.log(`\u2705 (총 ${all.length}건, 데모 ${demoItems.length}건 확인)`);
        } else {
            console.log(`\u26A0\uFE0F (총 ${all.length}건, 데모 ${demoItems.length}건 — 기대 5건)`);
            failCount++;
        }
    } catch (err) {
        console.log(`\u274C ${err.message}`);
        failCount++;
    }
}

function checkEnvVars() {
    process.stdout.write('5. 환경변수...      ');
    const required = ['GOOGLE_GEMINI_API_KEY', 'SUPABASE_URL', 'SUPABASE_KEY', 'RESEND_API_KEY', 'ADMIN_PASSWORD'];
    const found = required.filter(v => !!process.env[v]);
    if (found.length === required.length) {
        console.log(`\u2705 (${found.length}/${required.length} 설정됨)`);
    } else {
        const missing = required.filter(v => !process.env[v]);
        console.log(`\u26A0\uFE0F (${found.length}/${required.length} 설정됨, 누락: ${missing.join(', ')})`);
        failCount++;
    }
}

async function main() {
    console.log('=== 노마 시연 전 점검 ===');
    console.log(`[${now()}]\n`);

    await checkSupabase();
    await checkGemini();
    await checkRAG();
    checkDemoData();
    checkEnvVars();

    console.log('');
    if (failCount === 0) {
        console.log('=== 모든 점검 통과. 시연 준비 완료 \u2705 ===');
    } else {
        console.log(`=== \u26A0\uFE0F 점검 실패 항목 ${failCount}건 있음. 위 내용 확인 필요 ===`);
        process.exit(1);
    }
}

main().catch(err => {
    console.error('[치명적 오류]', err);
    process.exit(1);
});
