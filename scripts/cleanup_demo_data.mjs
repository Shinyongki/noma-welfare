/**
 * 시연 후 데모 데이터 삭제 스크립트
 * 실행: node scripts/cleanup_demo_data.mjs
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const DATA_FILE = path.join(__dirname, '..', 'data', 'requests.json');
const BACKUP_FILE = DATA_FILE + '.bak';

// requestStore의 withLock을 직접 사용하면 캐시 충돌 가능성이 있으므로
// 독립적으로 파일 read-modify-write를 원자적으로 수행
function isDemoPhone(phone) {
    if (!phone) return false;
    // 암호화되지 않은 평문 검사
    if (phone.startsWith('010-0000-000') || phone.startsWith('055-0000-000')) return true;
    // 암호화된 경우는 복호화 필요 — enc: 접두어 확인
    return false;
}

async function main() {
    if (!fs.existsSync(DATA_FILE)) {
        console.log('requests.json 파일이 존재하지 않습니다.');
        process.exit(1);
    }

    // 백업 생성
    fs.copyFileSync(DATA_FILE, BACKUP_FILE);
    console.log('[백업] requests.json.bak 생성 완료');

    const store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    const ids = Object.keys(store);
    let deleted = 0;

    for (const id of ids) {
        const req = store[id];
        if (isDemoPhone(req.userPhone)) {
            delete store[id];
            deleted++;
            console.log(`  [삭제] ${req.userName || '(암호화됨)'} / ${req.serviceName}`);
        }
    }

    if (deleted === 0) {
        console.log('\n삭제 대상 데모 데이터가 없습니다.');
        return;
    }

    // 원자적 쓰기 (tmp → rename)
    const tmpFile = DATA_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(store, null, 2), 'utf-8');
    fs.renameSync(tmpFile, DATA_FILE);

    console.log(`\n데모 데이터 ${deleted}건 삭제 완료`);
    console.log(`잔여 건수: ${Object.keys(store).length}건`);
}

main().catch(err => {
    console.error('[오류]', err);
    process.exit(1);
});
