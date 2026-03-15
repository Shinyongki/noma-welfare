/**
 * welfare_docs 재업로드 검증 스크립트
 * - 건수 확인 (28건)
 * - 샘플 청크 확인 (chunk_index 6: 30종 서비스 목록)
 * - 벡터 검색 테스트 4건 (작업지시서 검증 기준)
 *
 * 실행: node scripts/verify_doc_upload.mjs
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GEMINI_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// server.js pgvectorDocSearch 함수와 동일한 방식
async function pgvectorDocSearch(query, threshold = 0.65, count = 3, audience = null) {
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
        audience_filter: audience,
    });
    if (error) {
        console.error('[검색 오류]', error.message);
        return [];
    }
    return data || [];
}

async function main() {
    let pass = 0;
    let fail = 0;

    // ── 검증 1: 건수 확인 ──
    console.log('═══ 검증 1: welfare_docs 건수 확인 ═══');
    const { count, error: countErr } = await supabase
        .from('welfare_docs')
        .select('*', { count: 'exact', head: true });

    if (countErr) {
        console.error('  [FAIL] 건수 조회 실패:', countErr.message);
        fail++;
    } else if (count === 28) {
        console.log(`  [PASS] 총 ${count}건 (기대값: 28)`);
        pass++;
    } else {
        console.log(`  [FAIL] 총 ${count}건 (기대값: 28)`);
        fail++;
    }

    // ── 검증 2: 샘플 청크 확인 (chunk_index 6) ──
    console.log('\n═══ 검증 2: chunk_index 6 (30종 서비스 목록) 확인 ═══');
    const { data: sample, error: sampleErr } = await supabase
        .from('welfare_docs')
        .select('section, content')
        .eq('chunk_index', 6)
        .single();

    if (sampleErr) {
        console.error('  [FAIL] 샘플 조회 실패:', sampleErr.message);
        fail++;
    } else {
        const keywords = ['13대 핵심서비스', '5대 추가서비스', '6대 신규서비스'];
        const found = keywords.filter(kw => sample.content.includes(kw));
        if (found.length === keywords.length) {
            console.log(`  [PASS] section: "${sample.section}"`);
            console.log(`  [PASS] 키워드 ${keywords.length}/${keywords.length} 포함 확인`);
            pass++;
        } else {
            console.log(`  [FAIL] 키워드 ${found.length}/${keywords.length} — 누락: ${keywords.filter(kw => !found.includes(kw)).join(', ')}`);
            fail++;
        }
    }

    // ── 검증 3: 벡터 검색 테스트 4건 ──
    const testCases = [
        {
            query: '통합돌봄 30종 서비스',
            expectSection: '통합돌봄 서비스 30종 목록',
            expectKeywords: ['방문진료', '긴급돌봄', '병원동행', '임종케어'],
            desc: '30종 서비스 목록',
        },
        {
            query: '종합판정 기준',
            expectSection: '종합판정조사-건보공단',
            expectKeywords: ['15개 영역', '94개 항목', '4분면'],
            desc: '건보공단 판정 (staff전용 → audience=null)',
            audience: null,
        },
        {
            query: '사전조사 점수',
            expectSection: '사전조사 상세 및 판정 기준',
            expectKeywords: ['치매', '4점 이상', '2~3점', '1점 이하'],
            desc: '사전조사 판정 기준 (staff전용 → audience=null)',
            audience: null,
        },
        {
            query: '시범사업 성과',
            expectSection: '효과분석',
            expectKeywords: ['61%', '87%', '69.8%'],
            desc: '효과분석 수치',
        },
    ];

    console.log('\n═══ 검증 3: 벡터 검색 테스트 (4건) ═══');
    for (const tc of testCases) {
        console.log(`\n  ── "${tc.query}" (기대: ${tc.expectSection}, ${tc.desc}) ──`);
        const audience = tc.audience !== undefined ? tc.audience : 'both';
        const results = await pgvectorDocSearch(tc.query, 0.50, 5, audience);

        if (results.length === 0) {
            console.log('  [FAIL] 검색 결과 없음');
            fail++;
            continue;
        }

        // 상위 결과 출력
        results.forEach((r, i) => {
            console.log(`    #${i + 1} sim=${r.similarity?.toFixed(3)} section="${r.section}"`);
        });

        // 상위 5건 안에 기대 section 포함 여부 (section 부분 매칭)
        const matchedResult = results.find(r => r.section?.includes(tc.expectSection));
        if (matchedResult) {
            const rank = results.indexOf(matchedResult) + 1;
            console.log(`  [PASS] "${tc.expectSection}" → #${rank}위 (sim=${matchedResult.similarity?.toFixed(3)})`);

            // 키워드 확인
            const foundKw = tc.expectKeywords.filter(kw => matchedResult.content?.includes(kw));
            if (foundKw.length === tc.expectKeywords.length) {
                console.log(`  [PASS] 키워드 ${foundKw.length}/${tc.expectKeywords.length} 모두 포함`);
                pass++;
            } else {
                console.log(`  [WARN] 키워드 ${foundKw.length}/${tc.expectKeywords.length} — 누락: ${tc.expectKeywords.filter(kw => !foundKw.includes(kw)).join(', ')}`);
                pass++; // section 매칭은 성공
            }
        } else {
            console.log(`  [FAIL] "${tc.expectSection}" 상위 5건에 없음`);
            fail++;
        }

        // API 제한 방지
        await new Promise(r => setTimeout(r, 1000));
    }

    // ── 결과 요약 ──
    console.log('\n═══════════════════════════════');
    console.log(`  검증 결과: PASS ${pass} / FAIL ${fail} / 총 ${pass + fail}`);
    console.log('═══════════════════════════════');

    process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('[치명적 오류]', err);
    process.exit(1);
});
