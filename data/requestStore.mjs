// data/requestStore.mjs — JSON 파일 기반 요청 저장소
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'requests.json');

const BACKUP_FILE = DATA_FILE + '.bak';

// ── PII 암호화 (AES-256-GCM) ──
const PII_FIELDS = ['userName', 'userPhone'];
const ENCRYPTION_ALGO = 'aes-256-gcm';
let _encryptionKey = null;

function getEncryptionKey() {
    if (_encryptionKey !== null) return _encryptionKey;
    const keyHex = process.env.ENCRYPTION_KEY;
    if (!keyHex || keyHex.length !== 64) {
        if (!keyHex) {
            console.warn('[PII] ENCRYPTION_KEY 환경변수 미설정 — 개인정보가 평문으로 저장됩니다.');
        } else {
            console.warn('[PII] ENCRYPTION_KEY는 64자리 hex 문자열이어야 합니다 — 평문 저장.');
        }
        _encryptionKey = false;
        return false;
    }
    _encryptionKey = Buffer.from(keyHex, 'hex');
    return _encryptionKey;
}

function encryptField(value) {
    const key = getEncryptionKey();
    if (!key || typeof value !== 'string') return value;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGO, key, iv);
    let encrypted = cipher.update(value, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    return `enc:${iv.toString('hex')}:${tag}:${encrypted}`;
}

function decryptField(value) {
    const key = getEncryptionKey();
    if (!key || typeof value !== 'string' || !value.startsWith('enc:')) return value;
    try {
        const [, ivHex, tagHex, encrypted] = value.split(':');
        const decipher = crypto.createDecipheriv(ENCRYPTION_ALGO, key, Buffer.from(ivHex, 'hex'));
        decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch {
        return value;
    }
}

function decryptRequest(req) {
    if (!req || !getEncryptionKey()) return req;
    for (const field of PII_FIELDS) {
        if (req[field]) req[field] = decryptField(req[field]);
    }
    return req;
}

function encryptRequestCopy(req) {
    if (!req || !getEncryptionKey()) return req;
    const copy = { ...req };
    for (const field of PII_FIELDS) {
        if (copy[field]) copy[field] = encryptField(copy[field]);
    }
    return copy;
}

function decryptStore(store) {
    for (const id of Object.keys(store)) {
        decryptRequest(store[id]);
    }
    return store;
}

function encryptStoreForWrite(store) {
    const out = {};
    for (const id of Object.keys(store)) {
        out[id] = encryptRequestCopy(store[id]);
    }
    return out;
}

// ── 인메모리 캐시 (mtime 기반) ──
let _cache = null;
let _cacheMtime = 0;

function readAll() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const stat = fs.statSync(DATA_FILE);
            const mtime = stat.mtimeMs;
            if (_cache && mtime === _cacheMtime) {
                return _cache;
            }
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
            decryptStore(data);
            _cache = data;
            _cacheMtime = mtime;
            return data;
        }
    } catch (e) {
        console.error('[DATA CORRUPTION] requests.json 파싱 실패:', e.message);
        // 백업에서 복구 시도
        if (fs.existsSync(BACKUP_FILE)) {
            try {
                const backup = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf-8'));
                console.warn('[DATA RECOVERY] 백업에서 복구 성공');
                fs.writeFileSync(DATA_FILE, JSON.stringify(backup, null, 2), 'utf-8');
                decryptStore(backup);
                _cache = backup;
                _cacheMtime = Date.now();
                return backup;
            } catch { /* 백업도 손상 */ }
        }
        // 손상된 파일 보존 후 빈 상태로 시작
        const corruptFile = DATA_FILE + '.corrupt.' + Date.now();
        try { fs.renameSync(DATA_FILE, corruptFile); } catch {}
        console.error(`[DATA] 손상 파일 보존: ${corruptFile}`);
    }
    _cache = {};
    _cacheMtime = 0;
    return {};
}

// ── read-modify-write 원자화 잠금 ──
let _rwLock = Promise.resolve();
function withLock(fn) {
    _rwLock = _rwLock
        .then(() => fn())
        .catch(err => { console.error('[Store] 잠금 오류:', err); throw err; });
    return _rwLock;
}

// ── 쓰기 직렬화 큐 (동시 요청 시 데이터 유실 방지) ──
let _writeQueue = Promise.resolve();

function writeAll(data) {
    _writeQueue = _writeQueue.then(() => {
        const dataForDisk = encryptStoreForWrite(data);
        const json = JSON.stringify(dataForDisk, null, 2);
        // 1. 기존 파일을 백업
        if (fs.existsSync(DATA_FILE)) {
            try { fs.copyFileSync(DATA_FILE, BACKUP_FILE); } catch {}
        }
        // 2. 임시 파일에 쓰기 → rename (원자적 쓰기)
        const tmpFile = DATA_FILE + '.tmp';
        fs.writeFileSync(tmpFile, json, 'utf-8');
        fs.renameSync(tmpFile, DATA_FILE);
        // 3. 캐시 갱신
        _cache = data;
        try { _cacheMtime = fs.statSync(DATA_FILE).mtimeMs; } catch { _cacheMtime = Date.now(); }
    }).catch(err => {
        console.error('[requestStore] 쓰기 큐 처리 오류:', err);
    });
    return _writeQueue;
}

/** 새 요청 저장 */
export async function save(request) {
    return withLock(async () => {
        const store = readAll();
        store[request.id] = request;
        await writeAll(store);
        return request;
    });
}

/** ID로 요청 조회 */
export function findById(id) {
    return readAll()[id] || null;
}

/** 연계 기록 추가 */
export async function addReferral(id, referral) {
    return withLock(async () => {
        const store = readAll();
        const req = store[id];
        if (!req) return null;
        if (!req.referrals) req.referrals = [];
        req.referrals.push(referral);
        await writeAll(store);
        return req;
    });
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
export async function updateStatus(id, status) {
    return withLock(async () => {
        const store = readAll();
        const req = store[id];
        if (!req) return null;
        req.status = status;
        req.updatedAt = new Date().toISOString();
        await writeAll(store);
        return req;
    });
}

/** 담당자 메모 추가 */
export async function addNote(id, note, author = '관리자') {
    return withLock(async () => {
        const store = readAll();
        const req = store[id];
        if (!req) return null;
        if (!req.notes) req.notes = [];
        req.notes.push({ text: note, author, createdAt: new Date().toISOString() });
        await writeAll(store);
        return req;
    });
}

/** 생활지원사 현장 보고 추가 — 케이스 notes에 type: 'field_report'로 붙는다 */
export async function addFieldReport(id, text, createdBy) {
    return withLock(async () => {
        const store = readAll();
        const req = store[id];
        if (!req) return null;
        if (!req.notes) req.notes = [];
        const note = {
            id: 'fr-' + crypto.randomUUID(),
            type: 'field_report',
            text,
            createdAt: new Date().toISOString(),
            createdBy: createdBy || '',
            // 2층 처리 기록 — 상태는 저장하지 않고 이 값들로 계산한다 (pilotStatus.mjs)
            reviewedAt: null,
            reviewedBy: null,
            closure: null,
        };
        req.notes.push(note);
        req.updatedAt = new Date().toISOString();
        await writeAll(store);
        return note;
    });
}

/** 아직 확인하지 않은 보고를 모두 확인으로 기록. 이번에 기록한 보고 id 배열을 돌려준다 */
export async function markReportsReviewed(id, by) {
    return withLock(async () => {
        const store = readAll();
        const req = store[id];
        if (!req) return null;
        const now = new Date().toISOString();
        const reviewed = [];
        for (const n of req.notes || []) {
            if (n.type === 'field_report' && n.id && !n.reviewedAt) {
                n.reviewedAt = now;
                n.reviewedBy = by || '';
                reviewed.push(n.id);
            }
        }
        if (reviewed.length > 0) await writeAll(store);
        return reviewed;
    });
}

/**
 * 보고를 '조치 불필요'로 닫는다. 사유는 선택 — 비어 있으면 사유 없이 닫는다.
 * 연계가 붙은 보고, 이미 닫힌 보고는 닫지 않는다.
 * @returns {{ note } | { error }}
 */
export async function closeReport(id, reportId, { reason, by }) {
    return withLock(async () => {
        const store = readAll();
        const req = store[id];
        if (!req) return { error: 'not_found' };
        const note = (req.notes || []).find(n => n.type === 'field_report' && n.id === reportId);
        if (!note) return { error: 'report_not_found' };
        if (note.closure) return { error: 'already_closed' };
        if ((req.linkages || []).some(l => l.fromReportId === reportId)) return { error: 'has_linkage' };
        const now = new Date().toISOString();
        note.closure = { reason: (reason || '').trim(), at: now, by: by || '' };
        // 닫았다면 읽은 것이다
        if (!note.reviewedAt) { note.reviewedAt = now; note.reviewedBy = by || ''; }
        await writeAll(store);
        return { note };
    });
}

/**
 * 파일럿 2층 이관 — 여러 번 실행해도 결과가 같다.
 * 보고에 id·확인·종결 필드를, 연계에 fromReportId를 채운다. 기존 값은 건드리지 않는다.
 */
export async function migrateFieldReports() {
    return withLock(async () => {
        const store = readAll();
        let reports = 0, linkages = 0;
        for (const req of Object.values(store)) {
            for (const n of req.notes || []) {
                if (n.type !== 'field_report') continue;
                let changed = false;
                if (!n.id) { n.id = 'fr-' + crypto.randomUUID(); changed = true; }
                for (const k of ['reviewedAt', 'reviewedBy', 'closure']) {
                    if (!(k in n)) { n[k] = null; changed = true; }
                }
                if (changed) reports++;
            }
            for (const l of req.linkages || []) {
                if (!('fromReportId' in l)) { l.fromReportId = null; linkages++; }
            }
        }
        if (reports + linkages > 0) await writeAll(store);
        return { reports, linkages };
    });
}

/** 담당 생활지원사 기준 케이스 조회 */
export function getWorkerCases(workerName) {
    if (!workerName) return [];
    return listAll().filter(r => r.worker === workerName);
}

// ── 조직 정의 (파일럿: 산청 수행기관 1곳) ──
// 기관 id·표시명·담당 서비스 목록의 유일한 원본. 화면(case.html, admin.html)은 /api/departments로 받아 렌더한다.
// 실제 기관명이 확정되면 name만 바꾸면 된다. id는 세션·linkage(fromDept/toDept)에 저장되므로 바꾸지 않는다.
export const DEPARTMENTS = [
    { id: 'sancheong-1', name: '산청 수행기관', type: 'department', services: ['노인맞춤돌봄서비스'] },
    { id: 'virtual-b', name: '가상 수행기관 B', type: 'department', services: ['노인맞춤돌봄서비스'] },
];

/** 협업 요청 추가 */
export async function addCollaboration(requestId, { fromDept, toDept, reason, type }) {
    return withLock(async () => {
        const store = readAll();
        const req = store[requestId];
        if (!req) return null;
        if (!req.collaborations) req.collaborations = [];
        const collab = {
            id: crypto.randomUUID(),
            fromDept,
            toDept,
            reason,
            type: type || 'consultation',
            status: 'requested',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            notes: [],
        };
        req.collaborations.push(collab);
        await writeAll(store);
        return collab;
    });
}

/** 협업 상태 변경 */
export async function updateCollaboration(requestId, collabId, { status }) {
    return withLock(async () => {
        const store = readAll();
        const req = store[requestId];
        if (!req || !req.collaborations) return null;
        const collab = req.collaborations.find(c => c.id === collabId);
        if (!collab) return null;
        collab.status = status;
        collab.updatedAt = new Date().toISOString();
        await writeAll(store);
        return collab;
    });
}

/** 협업 메모 추가 */
export async function addCollaborationNote(requestId, collabId, text, author, dept) {
    return withLock(async () => {
        const store = readAll();
        const req = store[requestId];
        if (!req || !req.collaborations) return null;
        const collab = req.collaborations.find(c => c.id === collabId);
        if (!collab) return null;
        collab.notes.push({ text, author, dept, createdAt: new Date().toISOString() });
        collab.updatedAt = new Date().toISOString();
        await writeAll(store);
        return collab;
    });
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

// ── 통합 연계(Linkage) 시스템 ──

/** 통합 연계 요청 생성 (승인 대기 상태) */
export async function addLinkage(requestId, data) {
    return withLock(async () => {
        const store = readAll();
        const req = store[requestId];
        if (!req) return null;
        if (!req.linkages) req.linkages = [];
        const category = data.category || 'collaboration';
        // 외부 연계(referral)는 기관 밖에서 접수되므로 수락 주체가 없다 → 생성 즉시 accepted
        const isReferral = category === 'referral';
        const now = new Date().toISOString();
        const linkage = {
            id: crypto.randomUUID(),
            category,
            type: data.type || 'consultation',
            fromDept: data.fromDept || null,
            toDept: data.toDept || null,
            // 외부 연계 대상: 연계처 목록에서 고른 항목의 스냅샷
            target: data.target || null,
            // 외부 연계 접수 결과. null이면 미기록 — 기록되지 않으면 데이터에서 사라진다
            result: null,
            // 근거가 된 생활지원사 보고. 보고 없이 만든 연계는 null
            fromReportId: data.fromReportId || null,
            targetService: data.targetService || null,
            reason: data.reason || '',
            approvalStatus: isReferral ? 'accepted' : 'pending',
            approvalHistory: [
                { action: 'submitted', by: data.submittedBy || '담당자', comment: '', at: now },
                ...(isReferral ? [{ action: 'accepted', by: '시스템', comment: '외부 연계 자동 수락', at: now }] : []),
            ],
            executionStatus: null,
            newRequestId: null,
            sequenceOrder: data.sequenceOrder || null,
            sequenceGroupId: data.sequenceGroupId || null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            notes: [],
        };
        req.linkages.push(linkage);
        await writeAll(store);
        return linkage;
    });
}

// ── 연계 수락/반려 (승인 단계 없음: pending → accepted / rejected) ──

/** 대상 기관 수락 (pending → accepted) */
export async function acceptLinkage(requestId, linkageId, by) {
    return withLock(async () => {
        const store = readAll();
        const req = store[requestId];
        if (!req || !req.linkages) return null;
        const linkage = req.linkages.find(l => l.id === linkageId);
        if (!linkage || linkage.approvalStatus !== 'pending') return null;
        linkage.approvalStatus = 'accepted';
        linkage.approvalHistory.push({
            action: 'accepted', by: by || '대상 기관', comment: '', at: new Date().toISOString(),
        });
        linkage.updatedAt = new Date().toISOString();
        await writeAll(store);
        return linkage;
    });
}

/** 대상 기관 반려 (pending → rejected, 사유 필수) */
export async function rejectLinkage(requestId, linkageId, by, reason) {
    return withLock(async () => {
        const store = readAll();
        const req = store[requestId];
        if (!req || !req.linkages) return null;
        const linkage = req.linkages.find(l => l.id === linkageId);
        if (!linkage || linkage.approvalStatus !== 'pending') return null;
        linkage.approvalStatus = 'rejected';
        linkage.approvalHistory.push({
            action: 'rejected', by: by || '대상 기관', comment: reason, at: new Date().toISOString(),
        });
        linkage.updatedAt = new Date().toISOString();
        await writeAll(store);
        return linkage;
    });
}

// 유효한 approvalStatus 전이 맵 (요청 → 수락 또는 반려 2단계)
const APPROVAL_TRANSITIONS = {
    'pending': ['accepted', 'rejected'],
    'accepted': [],
    'rejected': [],
};

/** 연계 상태 변경 (실행 상태 등) */
export async function updateLinkage(requestId, linkageId, updates) {
    return withLock(async () => {
        const store = readAll();
        const req = store[requestId];
        if (!req || !req.linkages) return null;
        const linkage = req.linkages.find(l => l.id === linkageId);
        if (!linkage) return null;
        if (updates.approvalStatus !== undefined && updates.approvalStatus !== linkage.approvalStatus) {
            const allowed = APPROVAL_TRANSITIONS[linkage.approvalStatus] || [];
            if (!allowed.includes(updates.approvalStatus)) return null;
        }
        if (updates.executionStatus !== undefined) linkage.executionStatus = updates.executionStatus;
        if (updates.newRequestId !== undefined) linkage.newRequestId = updates.newRequestId;
        if (updates.approvalStatus !== undefined) linkage.approvalStatus = updates.approvalStatus;
        if (updates.reason !== undefined) linkage.reason = updates.reason;
        if (updates.fromDept !== undefined) linkage.fromDept = updates.fromDept;
        if (updates.toDept !== undefined) linkage.toDept = updates.toDept;
        if (updates.targetService !== undefined) linkage.targetService = updates.targetService;
        if (updates.type !== undefined) linkage.type = updates.type;
        if (updates.followupLinkageId !== undefined) linkage.followupLinkageId = updates.followupLinkageId;
        linkage.updatedAt = new Date().toISOString();
        await writeAll(store);
        return linkage;
    });
}

/** 외부 연계 결과 기록 (referral 전용, 1회만)
 *  접수는 시스템 밖에서 이뤄지므로 결과를 기록하지 않으면 외부 연계는 데이터에서 사라진다. */
export async function recordLinkageResult(requestId, linkageId, { accepted, reason, recordedBy }) {
    return withLock(async () => {
        const store = readAll();
        const req = store[requestId];
        if (!req || !req.linkages) return null;
        const linkage = req.linkages.find(l => l.id === linkageId);
        if (!linkage) return null;
        if (linkage.category !== 'referral') return null;
        if (linkage.result) return null; // 기록 후 수정은 범위 밖
        linkage.result = {
            accepted: !!accepted,
            agencyName: linkage.target?.agencyName || '',
            reason: reason || '',
            recordedAt: new Date().toISOString(),
            recordedBy: recordedBy || '',
        };
        // 결과 기록이 곧 완료다
        linkage.executionStatus = 'completed';
        linkage.updatedAt = new Date().toISOString();
        await writeAll(store);
        return linkage;
    });
}

/** 연계 메모 추가 */
export async function addLinkageNote(requestId, linkageId, text, author, dept) {
    return withLock(async () => {
        const store = readAll();
        const req = store[requestId];
        if (!req || !req.linkages) return null;
        const linkage = req.linkages.find(l => l.id === linkageId);
        if (!linkage) return null;
        linkage.notes.push({ text, author, dept, createdAt: new Date().toISOString() });
        linkage.updatedAt = new Date().toISOString();
        await writeAll(store);
        return linkage;
    });
}

/** 전체 활성 연계 목록 (관리자용) */
export function getActiveLinkages() {
    const store = readAll();
    const result = [];
    for (const req of Object.values(store)) {
        if (!req.linkages) continue;
        for (const l of req.linkages) {
            result.push({
                ...l,
                requestId: req.id,
                userName: req.userName,
                serviceName: req.serviceName,
            });
        }
    }
    return result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/** 수락 대기 중인 내부 연계 조회 (collaboration && pending) */
export function getPendingApprovals() {
    const store = readAll();
    const result = [];
    for (const req of Object.values(store)) {
        if (!req.linkages) continue;
        for (const l of req.linkages) {
            if (l.category === 'collaboration' && l.approvalStatus === 'pending') {
                result.push({
                    ...l,
                    requestId: req.id,
                    userName: req.userName,
                    serviceName: req.serviceName,
                });
            }
        }
    }
    return result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/** 케이스 완료(closed) → 수락된 내부 연계의 executionStatus를 completed로 일괄 변경
 *  외부 연계(referral)는 결과 기록으로만 완료되므로 제외한다. */
export async function completeApprovedLinkages(requestId) {
    return withLock(async () => {
        const store = readAll();
        const req = store[requestId];
        if (!req || !req.linkages) return 0;
        let changed = 0;
        for (const l of req.linkages) {
            if (l.category !== 'collaboration') continue;
            if (l.approvalStatus === 'accepted' && l.executionStatus !== 'completed' && l.executionStatus !== 'declined' && l.executionStatus !== 'cancelled') {
                l.executionStatus = 'completed';
                l.updatedAt = new Date().toISOString();
                changed++;
            }
        }
        if (changed > 0) {
            req.updatedAt = new Date().toISOString();
            await writeAll(store);
        }
        return changed;
    });
}

/** 연계 최종 승인 → 케이스 상태를 connected로 자동 변경 (이미 connected/closed/referred면 무시) */
export async function autoConnectOnApproval(requestId) {
    return withLock(async () => {
        const store = readAll();
        const req = store[requestId];
        if (!req) return false;
        const skip = ['connected', 'closed', 'referred'];
        if (skip.includes(req.status)) return false;
        req.status = 'connected';
        req.updatedAt = new Date().toISOString();
        await writeAll(store);
        return true;
    });
}

/** 서비스 계획 저장 */
export async function setServicePlan(requestId, plan) {
    return withLock(async () => {
        const store = readAll();
        const req = store[requestId];
        if (!req) return null;
        req.servicePlan = {
            id: plan.id || crypto.randomUUID(),
            steps: plan.steps || [],
            createdAt: plan.createdAt || new Date().toISOString(),
        };
        await writeAll(store);
        return req.servicePlan;
    });
}

/** 기존 데이터 마이그레이션 (collaborations + referrals → linkages) */
export async function migrateToLinkages() {
    return withLock(async () => {
    const store = readAll();
    let migrated = 0;

    for (const req of Object.values(store)) {
        if (!req.linkages) req.linkages = [];

        // 기존 collaborations → linkages
        if (req.collaborations && req.collaborations.length > 0) {
            for (const c of req.collaborations) {
                // 이미 마이그레이션된 건인지 확인
                if (req.linkages.some(l => l._migratedFrom === c.id)) continue;
                req.linkages.push({
                    id: c.id,
                    _migratedFrom: c.id,
                    category: 'collaboration',
                    type: c.type || 'consultation',
                    fromDept: c.fromDept,
                    toDept: c.toDept,
                    targetService: null,
                    reason: c.reason,
                    approvalStatus: 'accepted', // 기존 건은 이미 실행됨
                    approvalHistory: [
                        { action: 'submitted', by: '담당자', comment: '마이그레이션', at: c.createdAt },
                        { action: 'accepted', by: '시스템', comment: '기존 데이터 자동 수락', at: c.createdAt },
                    ],
                    executionStatus: c.status === 'completed' ? 'completed' : c.status === 'declined' ? 'declined' : c.status === 'accepted' ? 'in_progress' : 'email_sent',
                    newRequestId: null,
                    sequenceOrder: null,
                    sequenceGroupId: null,
                    createdAt: c.createdAt,
                    updatedAt: c.updatedAt || c.createdAt,
                    notes: c.notes || [],
                });
                migrated++;
            }
        }

        // 기존 referrals → linkages
        if (req.referrals && req.referrals.length > 0) {
            for (const r of req.referrals) {
                const refId = r.newRequestId || crypto.randomUUID();
                if (req.linkages.some(l => l._migratedFrom === refId)) continue;
                req.linkages.push({
                    id: crypto.randomUUID(),
                    _migratedFrom: refId,
                    category: 'referral',
                    type: 'service_referral',
                    fromDept: null,
                    toDept: null,
                    targetService: r.targetService,
                    reason: r.reason,
                    approvalStatus: 'accepted',
                    approvalHistory: [
                        { action: 'submitted', by: '담당자', comment: '마이그레이션', at: r.sentAt || req.createdAt },
                        { action: 'accepted', by: '시스템', comment: '기존 데이터 자동 수락', at: r.sentAt || req.createdAt },
                    ],
                    executionStatus: 'email_sent',
                    newRequestId: r.newRequestId || null,
                    sequenceOrder: null,
                    sequenceGroupId: null,
                    createdAt: r.sentAt || req.createdAt,
                    updatedAt: r.sentAt || req.createdAt,
                    notes: [],
                });
                migrated++;
            }
        }
    }

    if (migrated > 0) {
        await writeAll(store);
    }
    return migrated;
    });
}

/** 서비스명 기준 케이스 조회 (없으면 전체) */
export function getStaffCases(serviceName) {
    if (!serviceName) return listAll();
    return listAll().filter(r => r.serviceName === serviceName);
}

/** 72시간 초과 미처리 건 알림 */
export function getAlertItems() {
    const now = Date.now();
    const threshold = 72 * 60 * 60 * 1000; // 72 hours
    return listAll().filter(r => {
        if (r.status !== 'open') return false;
        const created = r.createdAtISO ? new Date(r.createdAtISO).getTime() : 0;
        return (now - created) > threshold;
    });
}

/** 통계 집계 */
export function getStats() {
    const all = listAll();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    const stats = { total: all.length, open: 0, confirmed: 0, contacted: 0, connected: 0, providing: 0, closed: 0, referred: 0, today: 0 };
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

/** linkageId로 요청+연계 조회 (O(n) 순회 제거용 인덱스) */
export function findByLinkageId(linkageId) {
    const store = readAll();
    for (const req of Object.values(store)) {
        if (!req.linkages) continue;
        const linkage = req.linkages.find(l => l.id === linkageId);
        if (linkage) return { request: req, linkage };
    }
    return null;
}

/** 연계 체인 추적 (순방향 + 역방향, 순환참조 방어) */
export function getReferralChain(id) {
    const store = readAll();
    const chain = [];
    const visited = new Set();

    // 역방향: referredFrom을 따라 원본까지
    const backward = [];
    let cur = store[id];
    visited.add(id);
    while (cur && cur.referredFrom && store[cur.referredFrom] && !visited.has(cur.referredFrom)) {
        visited.add(cur.referredFrom);
        cur = store[cur.referredFrom];
        backward.unshift({ id: cur.id, serviceName: cur.serviceName, createdAt: cur.createdAt, createdAtISO: cur.createdAtISO, status: cur.status });
    }
    chain.push(...backward);

    // 현재 요청
    const self = store[id];
    if (self) {
        chain.push({ id: self.id, serviceName: self.serviceName, createdAt: self.createdAt, createdAtISO: self.createdAtISO, status: self.status, current: true });
    }

    // 순방향: referrals를 따라 연계된 요청 (순환참조 방어)
    function followForward(reqId) {
        const req = store[reqId];
        if (!req || !req.referrals) return;
        req.referrals.forEach(ref => {
            if (!ref.newRequestId || visited.has(ref.newRequestId)) return;
            visited.add(ref.newRequestId);
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
