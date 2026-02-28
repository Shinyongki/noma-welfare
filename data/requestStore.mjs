// data/requestStore.mjs — JSON 파일 기반 요청 저장소
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
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

/** 한국어 날짜 "2026. 2. 26. 오후 10:20:05" → timestamp */
export function parseKoDate(str) {
    if (!str) return 0;
    const m = str.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(오전|오후)\s+(\d{1,2}):(\d{2}):(\d{2})/);
    if (!m) return 0;
    let [, y, mo, d, ampm, h, mi, s] = m;
    h = parseInt(h, 10);
    if (ampm === '오후' && h !== 12) h += 12;
    if (ampm === '오전' && h === 12) h = 0;
    return new Date(+y, +mo - 1, +d, h, +mi, +s).getTime();
}

/** 요청의 정렬용 타임스탬프 (createdAtISO 우선, 폴백으로 parseKoDate) */
function getTimestamp(req) {
    if (req.createdAtISO) return new Date(req.createdAtISO).getTime();
    return parseKoDate(req.createdAt);
}

/** 전체 요청 배열 (최신순) */
export function listAll() {
    const store = readAll();
    return Object.values(store).sort((a, b) => getTimestamp(b) - getTimestamp(a));
}

/** 상태 변경 */
export function updateStatus(id, status) {
    const store = readAll();
    const req = store[id];
    if (!req) return null;
    req.status = status;
    req.updatedAt = new Date().toISOString();
    writeAll(store);
    return req;
}

/** 담당자 메모 추가 */
export function addNote(id, note, author = '관리자') {
    const store = readAll();
    const req = store[id];
    if (!req) return null;
    if (!req.notes) req.notes = [];
    req.notes.push({ text: note, author, createdAt: new Date().toISOString() });
    writeAll(store);
    return req;
}

// ── 부서 정의 ──
export const DEPARTMENTS = [
    { id: 'care', name: '통합돌봄팀', icon: 'favorite', desc: '돌봄 서비스 총괄' },
    { id: 'emergency', name: '긴급지원팀', icon: 'emergency', desc: '긴급돌봄 및 위기개입' },
    { id: 'facility', name: '시설운영팀', icon: 'account_balance', desc: '국공립시설 운영' },
    { id: 'casemanage', name: '사례관리팀', icon: 'folder_shared', desc: '통합 사례관리' },
    { id: 'private', name: '민간협력팀', icon: 'handshake', desc: '민간기관 지원·협력' },
];

/** 협업 요청 추가 */
export function addCollaboration(requestId, { fromDept, toDept, reason, type }) {
    const store = readAll();
    const req = store[requestId];
    if (!req) return null;
    if (!req.collaborations) req.collaborations = [];
    const collab = {
        id: crypto.randomUUID(),
        fromDept,
        toDept,
        reason,
        type: type || 'consultation', // consultation | joint | transfer
        status: 'requested', // requested → accepted → completed | declined
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        notes: [],
    };
    req.collaborations.push(collab);
    writeAll(store);
    return collab;
}

/** 협업 상태 변경 */
export function updateCollaboration(requestId, collabId, { status }) {
    const store = readAll();
    const req = store[requestId];
    if (!req || !req.collaborations) return null;
    const collab = req.collaborations.find(c => c.id === collabId);
    if (!collab) return null;
    collab.status = status;
    collab.updatedAt = new Date().toISOString();
    writeAll(store);
    return collab;
}

/** 협업 메모 추가 */
export function addCollaborationNote(requestId, collabId, text, author, dept) {
    const store = readAll();
    const req = store[requestId];
    if (!req || !req.collaborations) return null;
    const collab = req.collaborations.find(c => c.id === collabId);
    if (!collab) return null;
    collab.notes.push({ text, author, dept, createdAt: new Date().toISOString() });
    collab.updatedAt = new Date().toISOString();
    writeAll(store);
    return collab;
}

/** 전체 활성 협업 목록 (관리자 대시보드용) */
export function getActiveCollaborations() {
    const store = readAll();
    const result = [];
    for (const req of Object.values(store)) {
        if (!req.collaborations) continue;
        for (const c of req.collaborations) {
            if (c.status === 'requested' || c.status === 'accepted') {
                result.push({
                    ...c,
                    requestId: req.id,
                    userName: req.userName,
                    serviceName: req.serviceName,
                });
            }
        }
    }
    return result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/** 통계 집계 */
export function getStats() {
    const all = listAll();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    const stats = { total: all.length, open: 0, confirmed: 0, contacted: 0, connected: 0, closed: 0, referred: 0, today: 0 };
    const serviceCount = {};
    const categoryCount = {};

    all.forEach(r => {
        if (stats[r.status] !== undefined) stats[r.status]++;
        if (getTimestamp(r) >= todayStart) stats.today++;
        const svc = r.serviceName || '기타';
        serviceCount[svc] = (serviceCount[svc] || 0) + 1;
    });

    return { ...stats, serviceCount, categoryCount };
}

/** 연계 체인 추적 (순방향 + 역방향) */
export function getReferralChain(id) {
    const store = readAll();
    const chain = [];

    // 역방향: referredFrom을 따라 원본까지
    const backward = [];
    let cur = store[id];
    while (cur && cur.referredFrom && store[cur.referredFrom]) {
        cur = store[cur.referredFrom];
        backward.unshift({ id: cur.id, serviceName: cur.serviceName, createdAt: cur.createdAt, createdAtISO: cur.createdAtISO, status: cur.status });
    }
    chain.push(...backward);

    // 현재 요청
    const self = store[id];
    if (self) {
        chain.push({ id: self.id, serviceName: self.serviceName, createdAt: self.createdAt, createdAtISO: self.createdAtISO, status: self.status, current: true });
    }

    // 순방향: referrals를 따라 연계된 요청
    function followForward(reqId) {
        const req = store[reqId];
        if (!req || !req.referrals) return;
        req.referrals.forEach(ref => {
            const next = store[ref.newRequestId];
            if (next) {
                chain.push({ id: next.id, serviceName: next.serviceName, createdAt: next.createdAt, createdAtISO: next.createdAtISO, status: next.status, reason: ref.reason });
                followForward(next.id);
            }
        });
    }
    followForward(id);

    return chain;
}
