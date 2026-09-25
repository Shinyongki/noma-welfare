// scripts/seed_cases.mjs — 파일럿 검증용 가상 대상자 등록
//
// 실행: node scripts/seed_cases.mjs                  가상 대상자 4명
//       node scripts/seed_cases.mjs --roster         + 명부 검증용 가상 생활지원사 16명 × 가상어르신 15명
//       node scripts/seed_cases.mjs --remove-roster  명부 검증용 데이터(seed-roster-*)만 지운다
//
// 가상 데이터만 넣는다. 실제 명단 CSV는 저장소에 두지 않는다.
// 기존 requests.json의 케이스는 유지하고, 같은 id가 있으면 건너뛴다.
// 서버를 끈 상태에서 실행한다 — 서버와 이 스크립트는 쓰기 잠금을 공유하지 않는다.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, '..', 'data', 'requests.json');
const TARGETS_FILE = path.join(__dirname, '..', 'data', 'linkage_targets_sancheong.json');
const args = process.argv.slice(2);

// 가상 대상자 — 이름·연락처 모두 누가 봐도 가상인 값
const SEED = [
    { id: 'seed-elder-001', userName: '가상어르신 하나', userPhone: '010-0000-0001', worker: '가상생활지원사1' },
    { id: 'seed-elder-002', userName: '가상어르신 둘',   userPhone: '010-0000-0002', worker: '가상생활지원사1' },
    { id: 'seed-elder-003', userName: '가상어르신 셋',   userPhone: '010-0000-0003', worker: '가상생활지원사2' },
    { id: 'seed-elder-004', userName: '가상어르신 넷',   userPhone: '010-0000-0004', worker: '가상생활지원사2' },
];

function readStore() {
    try {
        if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    } catch (err) {
        console.error('requests.json을 읽지 못했습니다:', err.message);
        process.exit(1);
    }
    return {};
}

const store = readStore();
const now = new Date();
let added = 0;
let removed = 0;

if (args.includes('--remove-roster')) {
    for (const id of Object.keys(store)) {
        if (id.startsWith('seed-roster-')) { delete store[id]; removed++; }
    }
    console.log(`명부 검증용 데이터 ${removed}건 삭제`);
}

for (const s of args.includes('--remove-roster') ? [] : SEED) {
    if (store[s.id]) {
        console.log(`건너뜀 (이미 있음): ${s.userName}`);
        continue;
    }
    store[s.id] = {
        id: s.id,
        serviceName: '노인맞춤돌봄서비스',
        userName: s.userName,
        userPhone: s.userPhone,
        sigun: '산청군',
        worker: s.worker,
        createdAt: now.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
        createdAtISO: now.toISOString(),
        status: 'open',
        referrals: [],
        linkages: [],
        notes: [],
    };
    added++;
    console.log(`등록: ${s.userName} (담당 ${s.worker})`);
}

// ── 명부 검증용 (--roster) ──
// 16명 × 15명 = 240명. 명부의 모든 상태 탭이 채워지도록 상황을 섞는다.
// 난수 씨앗을 고정해 매번 같은 구성이 나온다. 날짜만 실행 시각 기준이다.
if (args.includes('--roster')) {
    const targets = JSON.parse(fs.readFileSync(TARGETS_FILE, 'utf-8'));
    let seed = 20260925;
    const rng = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const int = (a, b) => a + Math.floor(rng() * (b - a + 1));
    const pick = arr => arr[Math.floor(rng() * arr.length)];
    const DAY = 24 * 60 * 60 * 1000;
    const ago = (days, hours = int(1, 9)) => new Date(now.getTime() - days * DAY - hours * 60 * 60 * 1000).toISOString();
    const DEPT = '산청 수행기관';
    const TEXTS = [
        '오늘 방문했더니 식사를 거의 못 하셨어요.',
        '계단에서 넘어질 뻔하셨다고 합니다. 무릎이 아프다고 하세요.',
        '약을 제때 드시지 않는 것 같아요. 약 봉투가 그대로 있습니다.',
        '보일러가 고장 나서 방이 차갑습니다.',
        '요즘 말수가 줄고 우울해 보이세요.',
        '병원 예약이 있는데 같이 갈 사람이 없다고 하십니다.',
        '냉장고에 드실 음식이 거의 없었습니다.',
        '욕실 바닥이 미끄러워 씻기가 무섭다고 하세요.',
        '밤에 잠을 잘 못 주무신다고 합니다.',
        '특별한 일 없이 잘 지내고 계십니다.',
    ];
    const report = (days, { reviewed = true, closure = null } = {}) => {
        const createdAt = ago(days);
        const reviewedAt = reviewed ? new Date(new Date(createdAt).getTime() + int(1, 20) * 60 * 60 * 1000).toISOString() : null;
        return {
            id: 'fr-' + crypto.randomUUID(), type: 'field_report', text: pick(TEXTS), createdAt, createdBy: '',
            reviewedAt, reviewedBy: reviewed ? DEPT : null,
            closure: closure ? { reason: closure, at: reviewedAt, by: DEPT } : null,
        };
    };
    const linkage = (fromReport, kind, days) => {
        const at = ago(days, 0);
        const t = pick(targets);
        const base = {
            id: crypto.randomUUID(), fromReportId: fromReport ? fromReport.id : null,
            result: null, reason: '보고 내용 확인 후 연계', executionStatus: null, newRequestId: null,
            sequenceOrder: null, sequenceGroupId: null, createdAt: at, updatedAt: at, notes: [],
        };
        if (kind.startsWith('referral')) {
            const l = {
                ...base, category: 'referral', type: 'service_referral', fromDept: null, toDept: null,
                target: { id: t.id, serviceName: t.serviceName, agencyName: t.agencyName }, targetService: t.serviceName,
                approvalStatus: 'accepted',
                approvalHistory: [
                    { action: 'submitted', by: '담당자', comment: '', at },
                    { action: 'accepted', by: '시스템', comment: '외부 연계 자동 수락', at },
                ],
            };
            if (kind === 'referral-done') {
                const ok = rng() < 0.75;
                l.result = { accepted: ok, agencyName: t.agencyName, reason: ok ? '' : '대상 요건에 맞지 않음', recordedAt: at, recordedBy: DEPT };
                l.executionStatus = 'completed';
            }
            return l;
        }
        const l = {
            ...base, category: 'collaboration', type: 'consultation', fromDept: 'sancheong-1', toDept: 'virtual-b',
            target: null, targetService: null, approvalStatus: 'pending',
            approvalHistory: [{ action: 'submitted', by: '담당자', comment: '', at }],
        };
        if (kind === 'collab-rejected') {
            l.approvalStatus = 'rejected';
            l.approvalHistory.push({ action: 'rejected', by: '산청해민노인통합지원센터', comment: '담당 인력이 부족해 이번 달은 어렵습니다', at });
        }
        return l;
    };

    const tally = {};
    for (let i = 1; i <= 240; i++) {
        const no = String(i).padStart(3, '0');
        const id = `seed-roster-${no}`;
        if (store[id]) continue;
        const notes = [];
        const linkages = [];
        let registered = 60;
        const b = rng();
        let kind;
        if (b < 0.14) {          // 새 보고
            kind = 'new';
            if (rng() < 0.5) notes.push(report(int(8, 18)));
            notes.push(report(int(0, 3), { reviewed: false }));
        } else if (b < 0.24) {   // 결과 미기록
            kind = 'unrecorded';
            const r = report(int(2, 12)); notes.push(r); linkages.push(linkage(r, 'referral', int(0, 2)));
        } else if (b < 0.31) {   // 연계 진행 (내부 연계 대기)
            kind = 'linking';
            const r = report(int(2, 12)); notes.push(r); linkages.push(linkage(r, 'collab', int(0, 2)));
        } else if (b < 0.43) {   // 3주 이상 보고 없음
            kind = 'stale';
            notes.push(report(int(22, 45)));
        } else if (b < 0.52) {   // 조치 불필요
            kind = 'closed';
            notes.push(report(int(1, 18), { closure: rng() < 0.5 ? '일시적인 불편으로 확인됨' : '' }));
        } else if (b < 0.62) {   // 연계 완료 (반려 포함)
            kind = 'linked';
            const r = report(int(3, 15)); notes.push(r);
            linkages.push(linkage(r, rng() < 0.3 ? 'collab-rejected' : 'referral-done', int(1, 3)));
        } else if (b < 0.67) {   // 보고 없음 (등록 3주 전)
            kind = 'none';
            registered = int(3, 18);
        } else {                 // 확인
            kind = 'reviewed';
            notes.push(report(int(1, 18)));
        }
        // 보고 없이 만든 연계 — 흐름 맨 아래 줄 확인용
        if (rng() < 0.04) linkages.push(linkage(null, 'referral', int(0, 5)));
        tally[kind] = (tally[kind] || 0) + 1;

        const reg = new Date(now.getTime() - registered * DAY);
        store[id] = {
            id,
            serviceName: '노인맞춤돌봄서비스',
            userName: `가상어르신 ${no}`,
            userPhone: `010-0000-${String(1000 + i)}`,
            sigun: '산청군',
            worker: `가상생활지원사${Math.ceil(i / 15)}`,
            createdAt: reg.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
            createdAtISO: reg.toISOString(),
            status: 'open',
            referrals: [],
            linkages,
            notes,
        };
        added++;
    }
    console.log('명부 검증용 구성:', JSON.stringify(tally));
    console.log('생활지원사 로그인 이름: 가상생활지원사1 ~ 가상생활지원사16');
}

if (added > 0 || removed > 0) {
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8');
    fs.renameSync(tmp, DATA_FILE);
}

console.log(`\n완료: ${added}건 추가, 전체 ${Object.keys(store).length}건`);
console.log('생활지원사 로그인 이름: 가상생활지원사1 / 가상생활지원사2');
console.log('주의: ENCRYPTION_KEY가 설정된 환경에서는 서버가 다음 쓰기 때 이름·연락처를 암호화합니다.');
