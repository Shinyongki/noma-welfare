// scripts/seed_cases.mjs — 파일럿 검증용 가상 대상자 등록
//
// 실행: node scripts/seed_cases.mjs                  가상 대상자 4명
//       node scripts/seed_cases.mjs --roster         명부·캡처용 가상어르신 244명을 새로 만든다 (기존 seed-* 케이스는 지우고 다시 만듦)
//       node scripts/seed_cases.mjs --remove-roster  명부 검증용 데이터(seed-roster-*)만 지운다
//
// 가상 데이터만 넣는다. 실제 명단 CSV는 저장소에 두지 않는다.
// 기본 실행은 기존 케이스를 유지하고 같은 id가 있으면 건너뛴다. --roster는 seed-* 케이스만 새로 만들고 나머지는 둔다.
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

for (const s of (args.includes('--remove-roster') || args.includes('--roster')) ? [] : SEED) {
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

// ── 명부·캡처용 (--roster) ──
// 가상어르신 244명(기본 4명 + 16명 × 15명)을 매번 새로 만든다. 기존 seed-* 케이스는 지우고 다시 만든다
// (예전 기록이 없어진 연계처 id를 가리키지 않도록).
// 상태 분포는 확률이 아니라 정해진 인원으로 나눈다. 난수 씨앗을 고정해 매번 같은 구성이 나오고,
// 날짜만 실행 시각 기준이다. 캡처 직전에 다시 돌리면 "새 보고"가 다시 새 보고가 된다.
// 날짜 여유: 확인 상태 어르신의 마지막 보고는 12일 이내, 3주 이상은 25일 이후 — 며칠 뒤 캡처해도 상태가 바뀌지 않는다.
if (args.includes('--roster')) {
    const { elderSummary } = await import('../data/pilotStatus.mjs');
    const targets = JSON.parse(fs.readFileSync(TARGETS_FILE, 'utf-8'));
    const tById = id => { const t = targets.find(x => x.id === id); if (!t) throw new Error('연계처 없음: ' + id); return t; };

    // 목표 분포 (합계 244) — 기본 4명 몫을 포함한다
    const TARGET = { new: 8, unrecorded: 5, linking: 3, stale: 10, closed: 12, none: 20, reviewed: 186 };

    for (const id of Object.keys(store)) {
        if (id.startsWith('seed-roster-') || id.startsWith('seed-elder-')) { delete store[id]; removed++; }
    }

    let seed = 20260926;
    const rng = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const int = (a, b) => a + Math.floor(rng() * (b - a + 1));
    const pick = arr => arr[Math.floor(rng() * arr.length)];
    const HOUR = 60 * 60 * 1000, DAY = 24 * HOUR;
    const nowMs = now.getTime();
    const iso = ms => new Date(Math.min(ms, nowMs - HOUR)).toISOString();
    const DEPT = '산청 수행기관';
    const RECEIVER = '산청해민노인통합지원센터';
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
        '같은 말을 여러 번 하시고 날짜를 헷갈려 하세요.',
        '특별한 일 없이 잘 지내고 계십니다.',
        '특별한 일 없이 잘 지내고 계십니다.',
    ];
    // 보고 내용에 어울리는 연계처 (없으면 아무 연계처)
    const FIT = {
        '식사': ['sancheong-ic-meal'], '넘어질': ['sancheong-ic-housing', 'sancheong-visit-health'], '약을': ['sancheong-visit-health'],
        '보일러': ['sancheong-emergency-welfare', 'sancheong-ic-housing'], '우울': ['sancheong-mental'], '병원': ['sancheong-ic-escort'],
        '음식': ['sancheong-ic-meal', 'sancheong-emergency-welfare'], '욕실': ['sancheong-ic-housing'], '잠을': ['sancheong-mental'],
        '같은 말': ['sancheong-dementia'],
    };
    const fitTarget = text => {
        const k = Object.keys(FIT).find(k => text.includes(k));
        return tById(k ? pick(FIT[k]) : pick(targets).id);
    };

    const report = (days, { reviewed = true, closure, text } = {}) => {
        const created = nowMs - days * DAY - int(1, 9) * HOUR;
        const rev = reviewed ? iso(created + int(1, 20) * HOUR) : null;
        return {
            id: 'fr-' + crypto.randomUUID(), type: 'field_report', text: text || pick(TEXTS), createdAt: iso(created), createdBy: '',
            reviewedAt: rev, reviewedBy: reviewed ? DEPT : null,
            closure: closure !== undefined ? { reason: closure, at: rev, by: DEPT } : null,
        };
    };
    const after = (isoStr, hMin, hMax) => new Date(isoStr).getTime() + int(hMin, hMax) * HOUR;
    const referral = (fromReport, t, result) => {
        const at = iso(fromReport ? after(fromReport.reviewedAt || fromReport.createdAt, 1, 20) : nowMs - int(2, 8) * DAY);
        const l = {
            id: crypto.randomUUID(), category: 'referral', type: 'service_referral', fromDept: null, toDept: null,
            target: { id: t.id, serviceName: t.serviceName, agencyName: t.agencyName }, targetService: t.serviceName,
            result: null, fromReportId: fromReport ? fromReport.id : null, reason: '', approvalStatus: 'accepted',
            approvalHistory: [
                { action: 'submitted', by: '담당자', comment: '', at },
                { action: 'accepted', by: '시스템', comment: '외부 연계 자동 수락', at },
            ],
            executionStatus: null, newRequestId: null, sequenceOrder: null, sequenceGroupId: null, createdAt: at, updatedAt: at, notes: [],
        };
        if (result) {
            const rAt = iso(after(at, 2, 48));
            l.result = { accepted: result.accepted, agencyName: t.agencyName, reason: result.reason || '', recordedAt: rAt, recordedBy: DEPT };
            l.executionStatus = 'completed';
            l.updatedAt = rAt;
        }
        return l;
    };
    const collab = (fromReport, status, reason) => {
        const at = iso(after(fromReport.reviewedAt || fromReport.createdAt, 1, 20));
        const l = {
            id: crypto.randomUUID(), category: 'collaboration', type: 'consultation', fromDept: 'sancheong-1', toDept: 'virtual-b',
            target: null, targetService: null, result: null, fromReportId: fromReport.id,
            reason: '방문 일정이 겹쳐 공동으로 살펴봐 주시기를 부탁드립니다', approvalStatus: 'pending',
            approvalHistory: [{ action: 'submitted', by: '담당자', comment: '', at }],
            executionStatus: null, newRequestId: null, sequenceOrder: null, sequenceGroupId: null, createdAt: at, updatedAt: at, notes: [],
        };
        if (status !== 'pending') {
            const dAt = iso(after(at, 2, 30));
            l.approvalStatus = status;
            l.approvalHistory.push({ action: status, by: RECEIVER, comment: reason || '', at: dAt });
            l.updatedAt = dAt;
        }
        return l;
    };

    const elder = (id, userName, userPhone, worker, registeredDays, notes, linkages) => {
        const reg = new Date(nowMs - registeredDays * DAY);
        store[id] = {
            id, serviceName: '노인맞춤돌봄서비스', userName, userPhone, sigun: '산청군', worker,
            createdAt: reg.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }), createdAtISO: reg.toISOString(),
            status: 'open', referrals: [], linkages, notes,
        };
        added++;
    };

    // 기본 4명 — 캡처용 예시를 맡는다
    {
        const old1 = report(9, { text: '오늘 방문했더니 어지럽다고 하시고 식사를 못 하셨습니다.' });
        const new1 = report(0, { reviewed: false, text: '기침이 며칠째 계속되고 가래가 나온다고 하세요.' });
        elder('seed-elder-001', '가상어르신 하나', '010-0000-0001', '가상생활지원사1', 60, [old1, new1], [
            referral(old1, tById('sancheong-visit-health'), { accepted: true, reason: '다음 주 방문 일정 잡음' }),   // 새 연계처 · 접수
            collab(old1, 'accepted'),                                                                              // 산청해민 · 수락
        ]);
        const r2 = report(6, { text: '무릎이 아파 혼자 씻고 드시기가 어렵다고 하세요.' });
        elder('seed-elder-002', '가상어르신 둘', '010-0000-0002', '가상생활지원사1', 60, [r2], [
            referral(r2, tById('gn-ltc'), { accepted: false, reason: '등급 외 판정이 예상돼 신청을 미루기로 함' }),   // 새 연계처 · 미접수
        ]);
        const r3 = report(5, { text: '요즘 말수가 줄고 우울해 보이세요.' });
        elder('seed-elder-003', '가상어르신 셋', '010-0000-0003', '가상생활지원사2', 60, [r3], [
            collab(r3, 'rejected', '담당 인력이 부족해 이번 달은 어렵습니다'),                                       // 산청해민 · 반려(사유)
        ]);
        const r4 = report(3, { text: '병원 예약이 있는데 같이 갈 사람이 없다고 하십니다.' });
        elder('seed-elder-004', '가상어르신 넷', '010-0000-0004', '가상생활지원사2', 60, [r4], [
            collab(r4, 'pending'),                                                                                 // 산청해민 · 수락 대기
        ]);
    }
    const BASE_STATE = { new: 1, unrecorded: 0, linking: 1, stale: 0, closed: 0, none: 0, reviewed: 2 };

    // 240명 — 남은 인원을 섞어서 나눈다
    const plan = [];
    for (const [k, n] of Object.entries(TARGET)) for (let i = 0; i < n - BASE_STATE[k]; i++) plan.push(k);
    if (plan.length !== 240) throw new Error('분포 합계가 244가 아닙니다: ' + (plan.length + 4));
    for (let i = plan.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [plan[i], plan[j]] = [plan[j], plan[i]]; }

    let orphanDone = false;
    for (let i = 1; i <= 240; i++) {
        const no = String(i).padStart(3, '0');
        const kind = plan[i - 1];
        const notes = [], linkages = [];
        let registered = 60;
        if (kind === 'new') {
            if (rng() < 0.5) notes.push(report(int(5, 12)));
            notes.push(report(int(0, 2), { reviewed: false }));
        } else if (kind === 'unrecorded') {
            const r = report(int(2, 10)); notes.push(r); linkages.push(referral(r, fitTarget(r.text), null));
        } else if (kind === 'linking') {
            const r = report(int(2, 8)); notes.push(r); linkages.push(collab(r, 'pending'));
        } else if (kind === 'stale') {
            if (rng() < 0.4) notes.push(report(int(35, 50)));
            notes.push(report(int(25, 34)));
        } else if (kind === 'closed') {
            notes.push(report(int(2, 12), { closure: rng() < 0.5 ? '일시적인 불편으로 확인됨' : '' }));
        } else if (kind === 'none') {
            registered = int(3, 10);
        } else {   // reviewed — 조용한 어르신. 일부는 끝난 연계 이력이 있다
            if (rng() < 0.3) notes.push(report(int(13, 20)));
            const r = report(int(1, 12)); notes.push(r);
            const b = rng();
            if (b < 0.12) linkages.push(referral(r, fitTarget(r.text), { accepted: rng() < 0.8, reason: '' }));
            else if (b < 0.15) linkages.push(collab(r, 'accepted'));
            if (!orphanDone && b > 0.9) { linkages.push(referral(null, tById('gn-emergency-care'), { accepted: true, reason: '' })); orphanDone = true; }   // 보고 없이 만든 연계 1건
        }
        elder(`seed-roster-${no}`, `가상어르신 ${no}`, `010-0000-${String(1000 + i)}`, `가상생활지원사${Math.ceil(i / 15)}`, registered, notes, linkages);
    }

    // 서버와 같은 계산으로 분포를 다시 세어 목표와 맞는지 확인한다
    const got = {};
    for (const c of Object.values(store).filter(c => c.id.startsWith('seed-'))) { const s = elderSummary(c, nowMs).state; got[s] = (got[s] || 0) + 1; }
    const mismatch = Object.keys(TARGET).filter(k => (got[k] || 0) !== TARGET[k]);
    console.log('상태 분포:', JSON.stringify(got));
    if (mismatch.length) { console.error('목표와 다름:', mismatch.join(', '), '— 쓰지 않고 멈춘다'); process.exit(1); }
    console.log('생활지원사 로그인 이름: 가상생활지원사1 ~ 가상생활지원사16');
}

if (added > 0 || removed > 0) {
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8');
    fs.renameSync(tmp, DATA_FILE);
}

console.log(`\n완료: ${added}건 추가, 전체 ${Object.keys(store).length}건`);
if (!args.includes('--roster')) console.log('생활지원사 로그인 이름: 가상생활지원사1 / 가상생활지원사2');
console.log('주의: ENCRYPTION_KEY가 설정된 환경에서는 서버가 다음 쓰기 때 이름·연락처를 암호화합니다.');
