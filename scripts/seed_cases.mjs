// scripts/seed_cases.mjs — 파일럿 검증용 가상 대상자 등록
//
// 실행: node scripts/seed_cases.mjs
//
// 가상 데이터만 넣는다. 실제 명단 CSV는 저장소에 두지 않는다.
// 기존 requests.json의 케이스는 유지하고, 같은 id가 있으면 건너뛴다.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, '..', 'data', 'requests.json');

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

for (const s of SEED) {
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

if (added > 0) {
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8');
    fs.renameSync(tmp, DATA_FILE);
}

console.log(`\n완료: ${added}건 추가, 전체 ${Object.keys(store).length}건`);
console.log('생활지원사 로그인 이름: 가상생활지원사1 / 가상생활지원사2');
console.log('주의: ENCRYPTION_KEY가 설정된 환경에서는 서버가 다음 쓰기 때 이름·연락처를 암호화합니다.');
