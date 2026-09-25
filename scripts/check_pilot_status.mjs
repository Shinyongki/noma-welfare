// scripts/check_pilot_status.mjs — 보고·어르신 상태 계산 검증 (데이터 파일을 건드리지 않는다)
//
// 실행: node scripts/check_pilot_status.mjs
import assert from 'assert/strict';
import { reportState, elderSummary, linkageCounts, ELDER_STATE_ORDER, STALE_DAYS } from '../data/pilotStatus.mjs';

const NOW = Date.parse('2026-09-25T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const iso = daysAgo => new Date(NOW - daysAgo * DAY).toISOString();
const rep = (id, daysAgo, extra = {}) => ({ id, type: 'field_report', text: `보고 ${id}\n둘째 줄`, createdAt: iso(daysAgo), createdBy: 'w', reviewedAt: null, reviewedBy: null, closure: null, ...extra });
const reviewed = { reviewedAt: iso(0), reviewedBy: '기관' };
const referral = (fromReportId, result = null) => ({ id: 'l-' + Math.random(), category: 'referral', approvalStatus: 'accepted', fromReportId, result });
const collab = (fromReportId, approvalStatus = 'pending') => ({ id: 'l-' + Math.random(), category: 'collaboration', approvalStatus, fromReportId });
const elder = (notes, linkages = [], registeredDaysAgo = 60) => ({ id: 'e', notes, linkages, createdAtISO: iso(registeredDaysAgo) });

let n = 0;
const check = (name, fn) => { fn(); n++; console.log('ok', name); };

// ── 보고 상태 ──
check('새 보고: reviewedAt 없음', () => assert.equal(reportState(rep('a', 1)), 'new'));
check('확인: reviewedAt 있음, 연계 없음', () => assert.equal(reportState(rep('a', 1, reviewed)), 'reviewed'));
check('연계 진행: 결과 미기록 외부 연계', () => assert.equal(reportState(rep('a', 1, reviewed), [referral('a')]), 'linking'));
check('연계 진행: 대기 중 내부 연계', () => assert.equal(reportState(rep('a', 1, reviewed), [collab('a')]), 'linking'));
check('연계 진행: 하나라도 안 끝나면', () => assert.equal(reportState(rep('a', 1), [referral('a', { accepted: true }), collab('a')]), 'linking'));
check('연계 완료: 결과 기록', () => assert.equal(reportState(rep('a', 1), [referral('a', { accepted: false })]), 'linked'));
check('연계 완료: 내부 연계 수락', () => assert.equal(reportState(rep('a', 1), [collab('a', 'accepted')]), 'linked'));
check('연계 완료: 내부 연계 반려도 끝난 것', () => assert.equal(reportState(rep('a', 1), [collab('a', 'rejected')]), 'linked'));
check('알 수 없는 상태값은 끝났다고 보지 않는다', () => assert.equal(reportState(rep('a', 1), [collab('a', 'weird')]), 'linking'));
check('조치 불필요: closure (사유 없어도)', () => assert.equal(reportState(rep('a', 1, { closure: { reason: '', at: iso(0), by: 'x' } })), 'closed'));
check('다른 보고의 연계는 영향 없음', () => assert.equal(reportState(rep('a', 1), [referral('b')]), 'new'));
check('보고 없이 만든 연계는 어느 보고에도 붙지 않음', () => assert.equal(reportState(rep('a', 1, reviewed), [referral(null)]), 'reviewed'));

// ── 어르신 상태 ──
const S = (...a) => elderSummary(elder(...a), NOW).state;
check('새 보고가 가장 앞', () => assert.equal(S([rep('a', 1), rep('b', 2, reviewed)], [referral('b')]), 'new'));
check('결과 미기록 (보고 없는 연계 포함)', () => assert.equal(S([rep('a', 1, reviewed)], [referral(null)]), 'unrecorded'));
check('결과 미기록이 연계 진행보다 앞', () => assert.equal(S([rep('a', 1, reviewed)], [collab('a'), referral('a')]), 'unrecorded'));
check('연계 진행', () => assert.equal(S([rep('a', 1, reviewed)], [collab('a')]), 'linking'));
check('3주 경계: 21일째는 3주 이상', () => assert.equal(S([rep('a', STALE_DAYS, reviewed)]), 'stale'));
check('3주 경계: 20일째는 아님', () => assert.equal(S([rep('a', STALE_DAYS - 1, reviewed)]), 'reviewed'));
check('3주는 마지막 보고 기준', () => assert.equal(S([rep('a', 40, reviewed), rep('b', 5, reviewed)]), 'reviewed'));
check('3주 이상이어도 새 보고가 앞', () => assert.equal(S([rep('a', 30)]), 'new'));
check('3주 이상이 확인·조치 불필요보다 앞', () => assert.equal(S([rep('a', 30, { ...reviewed, closure: { reason: '', at: iso(0), by: 'x' } })]), 'stale'));
check('보고 없음: 등록 3주 전', () => assert.equal(S([], [], 10), 'none'));
check('보고 없음: 등록 3주 이상이면 3주 이상 보고 없음', () => assert.equal(S([], [], 21), 'stale'));
check('조치 불필요: 모든 보고가 닫힘', () => assert.equal(S([rep('a', 3, { ...reviewed, closure: { reason: '', at: iso(0), by: 'x' } })]), 'closed'));
check('일부만 닫혔으면 확인', () => assert.equal(S([rep('a', 3, { ...reviewed, closure: { reason: '', at: iso(0), by: 'x' } }), rep('b', 2, reviewed)]), 'reviewed'));
check('연계 완료만 있으면 확인', () => assert.equal(S([rep('a', 3, reviewed)], [referral('a', { accepted: true })]), 'reviewed'));

// ── 명부 칸 ──
check('연계 건수', () => assert.deepEqual(linkageCounts([referral('a'), referral('a', { accepted: true }), collab('a'), collab('a', 'rejected')]), { progress: 1, unrecorded: 1, done: 2 }));
check('최근 보고: 날짜 + 첫 줄', () => {
    const s = elderSummary(elder([rep('a', 5, reviewed), rep('b', 2, reviewed)]), NOW);
    assert.equal(s.lastReport.firstLine, '보고 b');
    assert.equal(s.lastReport.at, iso(2));
});
check('새 보고 건수', () => assert.equal(elderSummary(elder([rep('a', 1), rep('b', 2), rep('c', 3, reviewed)]), NOW).newReportCount, 2));
check('정렬 순서', () => assert.deepEqual(ELDER_STATE_ORDER, ['new', 'unrecorded', 'linking', 'stale', 'reviewed', 'none', 'closed']));

console.log(`\n${n}건 통과`);
