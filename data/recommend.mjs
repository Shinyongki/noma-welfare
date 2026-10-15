// data/recommend.mjs — 보고 원문과 연계처 종류를 단어로 맞춰 목록 순서만 바꾼다 (파일럿 작업 6A)
//
// 연계처를 고르는 것은 사람이다. 여기서는 걸러내지 않고 순서와 표시만 정한다.
// 모델·외부 호출 없음. 순수 함수만 둔다 — 서버와 검증 스크립트가 같이 쓴다.

import { fieldReports } from './pilotStatus.mjs';

/**
 * 점수를 매길 대상 보고
 * - reportId가 이 어르신의 닫히지 않은 보고면 그 보고 (연계하기 서랍을 보고에서 열었을 때)
 * - 아니면 아직 연계로 이어지지 않았고 조치 불필요로 닫히지 않은 보고 중 가장 최근 1건
 * - 없으면 null
 */
export function pickReport(request, reportId = null) {
    const reports = fieldReports(request);
    if (reportId) {
        const r = reports.find(x => x.id === reportId);
        if (r && !r.closure) return r;
    }
    const linked = new Set((request?.linkages || []).map(l => l.fromReportId).filter(Boolean));
    const open = reports.filter(r => !r.closure && !(r.id && linked.has(r.id)));
    open.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return open[0] || null;
}

/**
 * 종류별 걸린 단어 (부분 일치, 같은 단어는 한 번만) — { 식사: ['밥'], ... }
 * exclude의 단어는 먼저 지운다 — "예약"이 "약"으로 걸리지 않게
 */
export function matchRules(text, rules, exclude = []) {
    const out = {};
    if (!text || !rules) return out;
    for (const x of exclude || []) if (x) text = text.split(x).join(' ');
    for (const [category, words] of Object.entries(rules)) {
        const hit = [...new Set((words || []).filter(w => w && text.includes(w)))];
        if (hit.length) out[category] = hit;
    }
    return out;
}

/**
 * 연계처 목록에 recommend를 붙이고 점수 높은 순으로 정렬한다. 점수가 같으면 들어온 순서 그대로.
 * 점수 0인 연계처도 모두 남는다. 기존 필드는 건드리지 않는다(복사본을 돌려준다).
 */
export function rankTargets(targets, text, rules, exclude = []) {
    const matched = matchRules(text, rules, exclude);
    return targets
        .map((t, i) => {
            const words = matched[t.category] || [];
            return { t: { ...t, recommend: words.length ? { score: words.length, matched: words } : null }, i, s: words.length };
        })
        .sort((a, b) => b.s - a.s || a.i - b.i)
        .map(x => x.t);
}

/** 연계 생성 시 남길 기록 — 고른 연계처가 그때 몇 번째(1부터)였고 점수가 얼마였는지 */
export function snapshotOf(ranked, targetId, rulesVersion) {
    const idx = ranked.findIndex(t => t.id === targetId);
    if (idx < 0) return null;
    const rec = ranked[idx].recommend;
    return { rank: idx + 1, score: rec ? rec.score : 0, matched: rec ? rec.matched : [], rulesVersion: rulesVersion ?? null };
}
