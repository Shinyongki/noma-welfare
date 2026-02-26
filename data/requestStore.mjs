// data/requestStore.mjs — JSON 파일 기반 요청 저장소
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'requests.json');

function readAll() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
        }
    } catch { /* corrupted file — start fresh */ }
    return {};
}

function writeAll(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

/** 새 요청 저장 */
export function save(request) {
    const store = readAll();
    store[request.id] = request;
    writeAll(store);
    return request;
}

/** ID로 요청 조회 */
export function findById(id) {
    return readAll()[id] || null;
}

/** 연계 기록 추가 */
export function addReferral(id, referral) {
    const store = readAll();
    const req = store[id];
    if (!req) return null;
    if (!req.referrals) req.referrals = [];
    req.referrals.push(referral);
    writeAll(store);
    return req;
}
