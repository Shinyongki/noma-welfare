/**
 * 시연용 데모 데이터 5건 삽입 스크립트
 * 실행: node scripts/insert_demo_data.mjs
 */
import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { save, listAll } from '../data/requestStore.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
}

function formatKoDate(date) {
    const y = date.getFullYear();
    const mo = date.getMonth() + 1;
    const d = date.getDate();
    const h = date.getHours();
    const mi = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    const ampm = h < 12 ? '오전' : '오후';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${y}. ${mo}. ${d}. ${ampm} ${h12}:${mi}:${s}`;
}

const demoItems = [
    {
        serviceName: '긴급돌봄지원사업',
        userName: '김순자',
        userPhone: '010-0000-0001',
        status: 'open',
        daysAgo: 1,
        conversationSummary: '72세 독거 어르신으로, 최근 입원 후 퇴원하여 가정에서 혼자 생활 중. 일상생활 지원이 필요한 상황으로 긴급돌봄 서비스 연결이 필요함.',
        assignmentRationale: '긴급돌봄지원사업은 갑작스러운 질병·사고 등으로 돌봄 공백이 발생한 경우 긴급 재가서비스를 제공하는 사업으로, 본 사례는 퇴원 후 독거 어르신의 즉각적 돌봄 필요 상황에 해당하여 경상남도사회서비스원 돌봄서비스과에서 담당.',
    },
    {
        serviceName: 'AI 온하나케어 스마트 돌봄',
        userName: '박철수',
        userPhone: '010-0000-0002',
        status: 'confirmed',
        daysAgo: 2,
        conversationSummary: '홀로 사는 65세 남성으로 AI 기기를 통한 건강 모니터링 서비스에 관심. 자녀가 해외 거주 중으로 원격 안부 확인 필요.',
        assignmentRationale: 'AI 온하나케어 스마트 돌봄은 AI 스피커를 활용한 건강 모니터링 및 응급 연계 서비스로, 독거 고령자의 원격 안전 확인에 적합. 전략기획과 담당.',
    },
    {
        serviceName: '장애인보조기기 지원',
        userName: '이민정',
        userPhone: '010-0000-0003',
        status: 'contacted',
        daysAgo: 3,
        conversationSummary: '지체장애 2급 30대 여성으로 전동휠체어 교체 필요. 현재 사용 중인 기기가 노후화되어 이동에 불편함을 겪고 있음.',
        assignmentRationale: '장애인보조기기 지원사업은 등록 장애인의 재활 및 자립을 위한 보조기기 구입·수리 지원 사업으로, 지체장애인의 이동 보조기기 지원에 해당. 사회서비스품질과 담당.',
    },
    {
        serviceName: '노인맞춤돌봄서비스 광역관리',
        userName: '최영호',
        userPhone: '010-0000-0004',
        status: 'connected',
        daysAgo: 4,
        conversationSummary: '독거 어르신 78세 남성으로 기초생활수급자. 일상적 돌봄과 정서 지원이 지속적으로 필요하며 인근 자원봉사 연계도 요청.',
        assignmentRationale: '노인맞춤돌봄서비스는 취약 노인의 일상생활 지원 및 사회참여를 지원하는 사업으로, 기초수급 독거 어르신의 맞춤형 돌봄에 적합. 돌봄서비스과 담당.',
    },
    {
        serviceName: '경상남도 사회복지시설 대체인력 지원',
        userName: '사회복지법인 늘봄',
        userPhone: '055-0000-0005',
        status: 'closed',
        daysAgo: 5,
        conversationSummary: '창원 소재 노인복지관으로, 직원 출산휴가 기간 중 대체인력 지원 요청. 2명 필요, 기간은 3개월 예정.',
        assignmentRationale: '사회복지시설 대체인력 지원사업은 시설 종사자의 법정 휴가 기간 중 대체인력을 파견하는 사업으로, 본 신청 건은 출산휴가 대체에 해당. 사회서비스품질과 담당.',
    },
];

async function main() {
    console.log('=== 데모 데이터 삽입 시작 ===\n');

    for (const item of demoItems) {
        const date = daysAgo(item.daysAgo);
        const request = {
            id: crypto.randomUUID(),
            serviceName: item.serviceName,
            userName: item.userName,
            userPhone: item.userPhone,
            createdAt: formatKoDate(date),
            createdAtISO: date.toISOString(),
            status: item.status,
            conversationSummary: item.conversationSummary,
            assignmentRationale: item.assignmentRationale,
            referrals: [],
            linkages: [],
            notes: [],
        };

        await save(request);
        console.log(`  [삽입] ${item.userName} / ${item.serviceName} / ${item.status}`);
    }

    // 확인
    const all = listAll();
    const demoCount = all.filter(r =>
        r.userPhone?.startsWith('010-0000-000') || r.userPhone?.startsWith('055-0000-000')
    ).length;

    console.log(`\n=== 삽입 완료 ===`);
    console.log(`  전체 건수: ${all.length}건`);
    console.log(`  데모 데이터: ${demoCount}건`);

    if (demoCount === 5) {
        console.log('  결과: 정상 삽입 확인');
    } else {
        console.log(`  결과: 기대 5건, 실제 ${demoCount}건 — 확인 필요`);
    }
}

main().catch(err => {
    console.error('[오류]', err);
    process.exit(1);
});
