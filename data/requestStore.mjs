// data/requestStore.mjs — JSON 파일 기반 요청 저장소
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'requests.json');

const BACKUP_FILE = DATA_FILE + '.bak';

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

function writeAll(data) {
    const json = JSON.stringify(data, null, 2);
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

// ── 통합 연계(Linkage) 시스템 ──

/** 통합 연계 요청 생성 (승인 대기 상태) */
export function addLinkage(requestId, data) {
    const store = readAll();
    const req = store[requestId];
    if (!req) return null;
    if (!req.linkages) req.linkages = [];
    const linkage = {
        id: crypto.randomUUID(),
        category: data.category || 'collaboration', // 'referral' | 'collaboration'
        type: data.type || 'consultation', // consultation | joint | transfer | service_referral
        fromDept: data.fromDept || null,
        toDept: data.toDept || null,
        targetService: data.targetService || null,
        reason: data.reason || '',
        approvalStatus: 'pending', // pending | approved | rejected | revision_requested
        approvalHistory: [
            { action: 'submitted', by: data.submittedBy || '담당자', comment: '', at: new Date().toISOString() },
        ],
        executionStatus: null, // null | email_sent | in_progress | completed | declined
        newRequestId: null,
        sequenceOrder: data.sequenceOrder || null,
        sequenceGroupId: data.sequenceGroupId || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        notes: [],
    };
    req.linkages.push(linkage);
    writeAll(store);
    return linkage;
}

// ── 1단계: 부서 조정자 승인/반려/수정요청 (pending → dept_approved / rejected / revision_requested) ──

/** 부서 조정자 승인 (pending → dept_approved) */
export function deptApproveLinkage(requestId, linkageId, comment) {
    const store = readAll();
    const req = store[requestId];
    if (!req || !req.linkages) return null;
    const linkage = req.linkages.find(l => l.id === linkageId);
    if (!linkage || linkage.approvalStatus !== 'pending') return null;
    linkage.approvalStatus = 'dept_approved';
    linkage.approvalHistory.push({
        action: 'dept_approved', by: '부서 조정자', comment: comment || '', at: new Date().toISOString(),
    });
    linkage.updatedAt = new Date().toISOString();
    writeAll(store);
    return linkage;
}

/** 부서 조정자 반려 (pending → rejected) */
export function deptRejectLinkage(requestId, linkageId, comment) {
    const store = readAll();
    const req = store[requestId];
    if (!req || !req.linkages) return null;
    const linkage = req.linkages.find(l => l.id === linkageId);
    if (!linkage || linkage.approvalStatus !== 'pending') return null;
    linkage.approvalStatus = 'rejected';
    linkage.approvalHistory.push({
        action: 'rejected', by: '부서 조정자', comment: comment || '', at: new Date().toISOString(),
    });
    linkage.updatedAt = new Date().toISOString();
    writeAll(store);
    return linkage;
}

/** 부서 조정자 수정 요청 (pending → revision_requested) */
export function deptRequestRevision(requestId, linkageId, comment) {
    const store = readAll();
    const req = store[requestId];
    if (!req || !req.linkages) return null;
    const linkage = req.linkages.find(l => l.id === linkageId);
    if (!linkage || linkage.approvalStatus !== 'pending') return null;
    linkage.approvalStatus = 'revision_requested';
    linkage.approvalHistory.push({
        action: 'revision_requested', by: '부서 조정자', comment: comment || '', at: new Date().toISOString(),
    });
    linkage.updatedAt = new Date().toISOString();
    writeAll(store);
    return linkage;
}

// ── 2단계: 관리자 조정자 최종 승인/반려/수정요청 (dept_approved → approved / admin_rejected / admin_revision_requested) ──

/** 관리자 최종 승인 (dept_approved → approved) */
export function approveLinkage(requestId, linkageId, comment) {
    const store = readAll();
    const req = store[requestId];
    if (!req || !req.linkages) return null;
    const linkage = req.linkages.find(l => l.id === linkageId);
    if (!linkage || linkage.approvalStatus !== 'dept_approved') return null;
    linkage.approvalStatus = 'approved';
    linkage.approvalHistory.push({
        action: 'approved', by: '관리자', comment: comment || '', at: new Date().toISOString(),
    });
    linkage.updatedAt = new Date().toISOString();
    writeAll(store);
    return linkage;
}

/** 관리자 반려 (dept_approved → admin_rejected, 부서 조정자에게 반환) */
export function rejectLinkage(requestId, linkageId, comment) {
    const store = readAll();
    const req = store[requestId];
    if (!req || !req.linkages) return null;
    const linkage = req.linkages.find(l => l.id === linkageId);
    if (!linkage || linkage.approvalStatus !== 'dept_approved') return null;
    linkage.approvalStatus = 'admin_rejected';
    linkage.approvalHistory.push({
        action: 'admin_rejected', by: '관리자', comment: comment || '', at: new Date().toISOString(),
    });
    linkage.updatedAt = new Date().toISOString();
    writeAll(store);
    return linkage;
}

/** 관리자 수정 요청 (dept_approved → admin_revision_requested, 부서 조정자에게 반환) */
export function requestRevision(requestId, linkageId, comment) {
    const store = readAll();
    const req = store[requestId];
    if (!req || !req.linkages) return null;
    const linkage = req.linkages.find(l => l.id === linkageId);
    if (!linkage || linkage.approvalStatus !== 'dept_approved') return null;
    linkage.approvalStatus = 'admin_revision_requested';
    linkage.approvalHistory.push({
        action: 'admin_revision_requested', by: '관리자', comment: comment || '', at: new Date().toISOString(),
    });
    linkage.updatedAt = new Date().toISOString();
    writeAll(store);
    return linkage;
}

/** 부서 조정자 재제출 (admin_rejected / admin_revision_requested → dept_approved) */
export function deptResubmitLinkage(requestId, linkageId, comment) {
    const store = readAll();
    const req = store[requestId];
    if (!req || !req.linkages) return null;
    const linkage = req.linkages.find(l => l.id === linkageId);
    if (!linkage) return null;
    if (linkage.approvalStatus !== 'admin_rejected' && linkage.approvalStatus !== 'admin_revision_requested') return null;
    linkage.approvalStatus = 'dept_approved';
    linkage.approvalHistory.push({
        action: 'dept_resubmitted', by: '부서 조정자', comment: comment || '관리자 반환 건 재검토 후 재제출', at: new Date().toISOString(),
    });
    linkage.updatedAt = new Date().toISOString();
    writeAll(store);
    return linkage;
}

/** 연계 상태 변경 (실행 상태 등) */
export function updateLinkage(requestId, linkageId, updates) {
    const store = readAll();
    const req = store[requestId];
    if (!req || !req.linkages) return null;
    const linkage = req.linkages.find(l => l.id === linkageId);
    if (!linkage) return null;
    if (updates.executionStatus !== undefined) linkage.executionStatus = updates.executionStatus;
    if (updates.newRequestId !== undefined) linkage.newRequestId = updates.newRequestId;
    if (updates.approvalStatus !== undefined) linkage.approvalStatus = updates.approvalStatus;
    if (updates.reason !== undefined) linkage.reason = updates.reason;
    if (updates.fromDept !== undefined) linkage.fromDept = updates.fromDept;
    if (updates.toDept !== undefined) linkage.toDept = updates.toDept;
    if (updates.targetService !== undefined) linkage.targetService = updates.targetService;
    if (updates.type !== undefined) linkage.type = updates.type;
    linkage.updatedAt = new Date().toISOString();
    writeAll(store);
    return linkage;
}

/** 연계 메모 추가 */
export function addLinkageNote(requestId, linkageId, text, author, dept) {
    const store = readAll();
    const req = store[requestId];
    if (!req || !req.linkages) return null;
    const linkage = req.linkages.find(l => l.id === linkageId);
    if (!linkage) return null;
    linkage.notes.push({ text, author, dept, createdAt: new Date().toISOString() });
    linkage.updatedAt = new Date().toISOString();
    writeAll(store);
    return linkage;
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

/** 부서 조정자 승인 대기 건 조회 (pending 상태) */
export function getDeptPendingApprovals() {
    const store = readAll();
    const result = [];
    for (const req of Object.values(store)) {
        if (!req.linkages) continue;
        for (const l of req.linkages) {
            if (l.approvalStatus === 'pending') {
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

/** 관리자 최종 승인 대기 건 조회 (dept_approved 상태) */
export function getPendingApprovals() {
    const store = readAll();
    const result = [];
    for (const req of Object.values(store)) {
        if (!req.linkages) continue;
        for (const l of req.linkages) {
            if (l.approvalStatus === 'dept_approved') {
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

/** 관리자에게 반환된 건 조회 (admin_rejected / admin_revision_requested 상태, 부서 조정자 재검토 필요) */
export function getAdminReturnedItems() {
    const store = readAll();
    const result = [];
    for (const req of Object.values(store)) {
        if (!req.linkages) continue;
        for (const l of req.linkages) {
            if (l.approvalStatus === 'admin_rejected' || l.approvalStatus === 'admin_revision_requested') {
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

/** 서비스 계획 저장 */
export function setServicePlan(requestId, plan) {
    const store = readAll();
    const req = store[requestId];
    if (!req) return null;
    req.servicePlan = {
        id: plan.id || crypto.randomUUID(),
        steps: plan.steps || [],
        createdAt: plan.createdAt || new Date().toISOString(),
    };
    writeAll(store);
    return req.servicePlan;
}

/** 기존 데이터 마이그레이션 (collaborations + referrals → linkages) */
export function migrateToLinkages() {
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
                    approvalStatus: 'approved', // 기존 건은 이미 실행됨
                    approvalHistory: [
                        { action: 'submitted', by: '담당자', comment: '마이그레이션', at: c.createdAt },
                        { action: 'approved', by: '시스템', comment: '기존 데이터 자동 승인', at: c.createdAt },
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
                    approvalStatus: 'approved',
                    approvalHistory: [
                        { action: 'submitted', by: '담당자', comment: '마이그레이션', at: r.sentAt || req.createdAt },
                        { action: 'approved', by: '시스템', comment: '기존 데이터 자동 승인', at: r.sentAt || req.createdAt },
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
        writeAll(store);
    }
    return migrated;
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
