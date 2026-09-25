// data/pilotStatus.mjs — 생활지원사 보고·어르신 상태 계산 (파일럿 2층)
//
// 상태는 저장하지 않고 매번 계산한다. 저장하면 보고·연계가 바뀔 때마다
// 상태를 같이 고쳐야 하고, 한 곳이라도 빠지면 화면과 데이터가 어긋난다.
// 순수 함수만 둔다 — 서버와 검증 스크립트가 같이 쓴다.

export const STALE_DAYS = 21;
const DAY_MS = 24 * 60 * 60 * 1000;

// 보고 상태
export const REPORT_STATE = {
    new: '새 보고',
    reviewed: '확인',
    linking: '연계 진행',
    linked: '연계 완료',
    closed: '조치 불필요',
};

// 어르신 상태 — 배열 순서가 명부 정렬 순서다 (앞일수록 먼저 봐야 한다)
export const ELDER_STATE_ORDER = ['new', 'unrecorded', 'linking', 'stale', 'reviewed', 'none', 'closed'];
export const ELDER_STATE = {
    new: '새 보고',
    unrecorded: '결과 미기록',
    linking: '연계 진행',
    stale: '3주 이상 보고 없음',
    reviewed: '확인',
    none: '보고 없음',   // 보고가 한 번도 없고 등록 후 3주가 안 됨. 정렬은 '확인'과 같은 자리
    closed: '조치 불필요',
};
const ELDER_RANK = { new: 0, unrecorded: 1, linking: 2, stale: 3, reviewed: 4, none: 4, closed: 5 };

export function isFieldReport(note) {
    return !!note && note.type === 'field_report';
}

export function fieldReports(request) {
    return (request?.notes || []).filter(isFieldReport);
}

/**
 * 연계 한 건의 진행 구분
 * - unrecorded: 외부 연계인데 결과가 없다
 * - waiting:    내부 연계가 수락·반려를 기다린다 (알 수 없는 상태값도 여기 — 끝났다고 단정하지 않는다)
 * - done:       외부 연계 결과 기록 / 내부 연계 수락·반려
 */
export function linkageProgress(linkage) {
    if (linkage.category === 'referral') return linkage.result ? 'done' : 'unrecorded';
    if (linkage.approvalStatus === 'accepted' || linkage.approvalStatus === 'rejected') return 'done';
    return 'waiting';
}

/** 보고 한 건의 상태 */
export function reportState(report, linkages = []) {
    if (report.closure) return 'closed';
    const linked = linkages.filter(l => report.id && l.fromReportId === report.id);
    if (linked.length > 0) {
        return linked.every(l => linkageProgress(l) === 'done') ? 'linked' : 'linking';
    }
    return report.reviewedAt ? 'reviewed' : 'new';
}

function toTime(v) {
    const t = v ? new Date(v).getTime() : NaN;
    return Number.isFinite(t) ? t : null;
}

/** 등록 시각 — createdAtISO가 없으면 알 수 없음(null) */
function registeredAt(request) {
    return toTime(request.createdAtISO);
}

/** 연계 건수 (명부의 연계 칸) */
export function linkageCounts(linkages = []) {
    const c = { progress: 0, unrecorded: 0, done: 0 };
    for (const l of linkages) {
        const p = linkageProgress(l);
        if (p === 'done') c.done++;
        else if (p === 'unrecorded') c.unrecorded++;
        else c.progress++;
    }
    return c;
}

/**
 * 어르신 한 명의 상태 요약
 * @param {object} request 케이스(어르신 1명)
 * @param {number} now 기준 시각(ms) — 검증에서 날짜 경계를 고정하려고 받는다
 */
export function elderSummary(request, now = Date.now()) {
    const linkages = request.linkages || [];
    const reports = fieldReports(request);
    const states = reports.map(r => reportState(r, linkages));
    const counts = linkageCounts(linkages);

    const last = reports.reduce((acc, r) => {
        const t = toTime(r.createdAt);
        return t !== null && (acc === null || t > acc.t) ? { t, r } : acc;
    }, null);

    // 3주는 마지막 보고부터, 보고가 없으면 등록일부터 센다
    const base = last ? last.t : registeredAt(request);
    const stale = base !== null && now - base >= STALE_DAYS * DAY_MS;

    let state;
    if (states.includes('new')) state = 'new';
    else if (counts.unrecorded > 0) state = 'unrecorded';
    else if (counts.progress > 0) state = 'linking';
    else if (stale) state = 'stale';
    else if (reports.length === 0) state = 'none';
    else if (states.every(s => s === 'closed')) state = 'closed';
    else state = 'reviewed';

    return {
        state,
        stateLabel: ELDER_STATE[state],
        rank: ELDER_RANK[state],
        newReportCount: states.filter(s => s === 'new').length,
        lastReport: last ? { at: last.r.createdAt, firstLine: firstLine(last.r.text) } : null,
        linkageCounts: counts,
    };
}

export function firstLine(text) {
    return String(text || '').split(/\r?\n/).find(l => l.trim())?.trim() || '';
}

/** 케이스 상세 응답에 붙일 보고별 상태 */
export function reportStates(request) {
    const linkages = request.linkages || [];
    const out = {};
    for (const r of fieldReports(request)) {
        if (r.id) out[r.id] = reportState(r, linkages);
    }
    return out;
}
