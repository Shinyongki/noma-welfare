# 작업지시서_021_보충_용량관리_PhaseF
# 작성일: 2026-03-07
# 상위 작업: 작업지시서_021_질의_분석_시스템
# 목적: Supabase 무료 용량(500MB) 소진 방지 — 자동 감지 → 로깅 중단 → 집계 → 관리자 승인 → 삭제

---

## 1. 개요

Supabase 무료 플랜 DB 용량은 500MB.
현재 welfare_kb(~1.5MB) + welfare_faq(~8MB) + query_log(증가) + query_stats(미미).

query_log가 빠르게 쌓이면 용량 초과 위험.
90일 자동 정리와 별개로, **용량 기반 비상 관리** 프로세스가 필요하다.

### 프로세스 흐름

```
[정상]                    [경고]                     [승인 대기]              [복구]
  │                         │                          │                      │
  │ 매시간 용량 체크         │ 80% 도달                  │ 관리자가 확인          │ 삭제 완료
  │─────────────────────→   │                          │                      │
  │                         ├── 로깅 자동 중단           │                      │
  │                         ├── 미집계 데이터 강제 집계   │                      │
  │                         ├── 관리자 알림 (배지+배너)   │                      │
  │                         └── 삭제 승인 요청 ──────→   │                      │
  │                                                     ├── 승인 클릭 ────────→ │
  │                                                     │                      ├── 오래된 로그 삭제
  │  ←──────────────────────────────────────────────────────────────────────────├── 로깅 재개
  │                                                     │                      │
  │                                                     └── 반려 시             │
  │                                                         로깅 중단 유지      │
  │                                                         수동 조치 필요      │
```

---

## 2. 임계값 설정

| 레벨 | DB 사용량 | 동작 |
|------|----------|------|
| **정상** | < 70% (350MB) | 정상 로깅 |
| **주의** | 70~80% (350~400MB) | 관리자 대시보드에 노란 배지 표시 |
| **경고** | ≥ 80% (400MB) | 로깅 중단 + 강제 집계 + 삭제 승인 요청 |
| **위험** | ≥ 90% (450MB) | 로깅 중단 유지 + 빨간 긴급 배너 |

---

## 3. 작업 항목

### F-1. DB 용량 확인 함수

파일: `server.js`

```javascript
/**
 * Supabase DB 전체 용량 확인
 * pg_database_size()를 RPC로 호출
 */
async function checkDBSize() {
  if (!supabase) return null;
  
  try {
    // Supabase에서 직접 SQL 실행은 anon key로 불가할 수 있음
    // 대안: query_log 건수 × 평균 크기로 추정
    const { count, error } = await supabase
      .from('query_log')
      .select('*', { count: 'exact', head: true });
    
    if (error) return null;
    
    // 추정 크기 계산 (건당 ~200바이트)
    const estimatedLogSizeMB = (count * 200) / (1024 * 1024);
    const baseUsageMB = 10;  // welfare_kb + welfare_faq 기본 사용량
    const estimatedTotalMB = baseUsageMB + estimatedLogSizeMB;
    const usagePercent = (estimatedTotalMB / 500) * 100;
    
    return {
      totalMB: 500,
      usedMB: +estimatedTotalMB.toFixed(1),
      logCount: count,
      logSizeMB: +estimatedLogSizeMB.toFixed(1),
      usagePercent: +usagePercent.toFixed(1),
      level: usagePercent >= 90 ? 'critical' 
           : usagePercent >= 80 ? 'warning'
           : usagePercent >= 70 ? 'caution'
           : 'normal',
    };
  } catch (err) {
    console.error('[용량 확인 오류]', err.message);
    return null;
  }
}
```

⚠️ pg_database_size()를 직접 호출할 수 있으면 더 정확함.
   Supabase SQL Editor에서 아래 함수를 만들어 RPC로 호출하는 방법:

```sql
-- (선택) 정확한 DB 크기 RPC 함수
CREATE OR REPLACE FUNCTION get_db_size()
RETURNS TABLE (
  total_size_mb float,
  query_log_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pg_database_size(current_database())::float / (1024*1024) AS total_size_mb,
    (SELECT count(*) FROM query_log) AS query_log_count;
END;
$$;
```

이 함수가 있으면:
```javascript
const { data } = await supabase.rpc('get_db_size');
const actualMB = data?.[0]?.total_size_mb || 0;
```

### F-2. 로깅 상태 관리 (메모리 플래그)

파일: `server.js`

```javascript
// 전역 상태
let queryLoggingEnabled = true;
let storageStatus = {
  level: 'normal',       // normal | caution | warning | critical
  usagePercent: 0,
  logCount: 0,
  lastChecked: null,
  pendingDeletion: false, // 삭제 승인 대기 중
  aggregatedBeforeDelete: false,  // 삭제 전 집계 완료 여부
};
```

### F-3. 매시간 용량 체크 + 자동 대응

```javascript
/**
 * 매시간 실행: 용량 체크 → 레벨별 자동 대응
 */
async function checkStorageHealth() {
  const size = await checkDBSize();
  if (!size) return;
  
  storageStatus = {
    ...storageStatus,
    level: size.level,
    usagePercent: size.usagePercent,
    logCount: size.logCount,
    usedMB: size.usedMB,
    lastChecked: new Date().toISOString(),
  };
  
  switch (size.level) {
    case 'normal':
      // 이전에 중단됐었으면 재개
      if (!queryLoggingEnabled && !storageStatus.pendingDeletion) {
        queryLoggingEnabled = true;
        console.log('[용량] 정상 — 로깅 재개');
      }
      break;
      
    case 'caution':
      console.log(`[용량] 주의 — ${size.usagePercent}% (${size.usedMB}MB / 500MB)`);
      // 로깅은 유지, 관리자 대시보드에 노란 배지만 표시
      break;
      
    case 'warning':
    case 'critical':
      console.log(`[용량] ${size.level} — ${size.usagePercent}% 로깅 중단`);
      queryLoggingEnabled = false;
      
      // 미집계 데이터 강제 집계
      if (!storageStatus.aggregatedBeforeDelete) {
        console.log('[용량] 강제 집계 시작...');
        await forceAggregateAll();
        storageStatus.aggregatedBeforeDelete = true;
        console.log('[용량] 강제 집계 완료 — 관리자 승인 대기');
      }
      
      storageStatus.pendingDeletion = true;
      break;
  }
}

// 매시간 체크
setInterval(checkStorageHealth, 60 * 60 * 1000);
// 서버 시작 시 즉시 1회
checkStorageHealth();
```

### F-4. 미집계 데이터 강제 집계

```javascript
/**
 * 아직 집계되지 않은 모든 날짜의 query_log를 집계
 * 용량 경고 시 삭제 전에 반드시 실행
 */
async function forceAggregateAll() {
  if (!supabase) return;
  
  try {
    // 집계되지 않은 날짜 목록 조회
    const { data: dates, error } = await supabase
      .from('query_log')
      .select('created_at')
      .order('created_at', { ascending: true });
    
    if (error || !dates || dates.length === 0) return;
    
    // 날짜별로 그룹핑
    const dateSet = new Set();
    dates.forEach(d => {
      const dateStr = new Date(d.created_at).toISOString().split('T')[0];
      dateSet.add(dateStr);
    });
    
    // 이미 집계된 날짜 확인
    const { data: existingStats } = await supabase
      .from('query_stats')
      .select('stat_date');
    
    const existingDates = new Set((existingStats || []).map(s => s.stat_date));
    
    // 미집계 날짜만 집계
    for (const dateStr of dateSet) {
      if (!existingDates.has(dateStr)) {
        await aggregateForDate(dateStr);
      }
    }
    
    console.log(`[강제 집계] ${dateSet.size}일분 처리 완료`);
  } catch (err) {
    console.error('[강제 집계 오류]', err.message);
  }
}

/**
 * 특정 날짜의 집계 (기존 aggregateDailyStats를 날짜 파라미터 받도록 분리)
 */
async function aggregateForDate(dateStr) {
  // 기존 aggregateDailyStats()의 로직을 dateStr 파라미터로 실행
  // (기존 함수를 리팩터링하거나 별도 함수로 분리)
  const startOfDay = `${dateStr}T00:00:00+09:00`;
  const endOfDay = `${dateStr}T23:59:59+09:00`;
  
  const { data: logs, error } = await supabase
    .from('query_log')
    .select('*')
    .gte('created_at', startOfDay)
    .lte('created_at', endOfDay);
  
  if (error || !logs || logs.length === 0) return;
  
  // ... 기존 집계 로직 동일 (작업지시서_021 Phase C 참조)
  // stats 객체 구성 후 upsert
}
```

### F-5. /api/chat 로깅에 플래그 체크 추가

기존 Phase B의 로깅 코드에 플래그 체크 추가:

```javascript
// /api/chat 핸들러 내부

(async () => {
  // ★ 로깅 중단 상태이면 스킵
  if (!queryLoggingEnabled) return;
  if (!supabase) return;
  
  try {
    await supabase.from('query_log').insert({
      // ... 기존 로깅 내용 동일
    });
  } catch (err) {
    console.error('[쿼리 로깅 오류]', err.message);
  }
})();
```

### F-6. 관리자 용량 상태 API

```javascript
// 용량 상태 조회
// GET /api/admin/storage-status
app.get('/api/admin/storage-status', requireAuth, async (req, res) => {
  res.json({
    ...storageStatus,
    loggingEnabled: queryLoggingEnabled,
  });
});

// 삭제 승인 처리
// POST /api/admin/approve-log-cleanup
app.post('/api/admin/approve-log-cleanup', requireAuth, async (req, res) => {
  try {
    const { retentionDays } = req.body;  // 관리자가 보관 기간 선택 (기본 30일)
    const days = Math.max(7, Math.min(retentionDays || 30, 90));
    
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    
    // 삭제 전 최종 집계 확인
    if (!storageStatus.aggregatedBeforeDelete) {
      await forceAggregateAll();
      storageStatus.aggregatedBeforeDelete = true;
    }
    
    // 삭제 실행
    const { error, count } = await supabase
      .from('query_log')
      .delete()
      .lt('created_at', cutoff.toISOString());
    
    if (error) throw error;
    
    // 상태 리셋
    storageStatus.pendingDeletion = false;
    storageStatus.aggregatedBeforeDelete = false;
    queryLoggingEnabled = true;
    
    // 용량 재확인
    await checkStorageHealth();
    
    console.log(`[용량] 관리자 승인 → ${count || 0}건 삭제, ${days}일 보관, 로깅 재개`);
    
    res.json({
      success: true,
      deletedCount: count || 0,
      retentionDays: days,
      newStatus: storageStatus,
    });
  } catch (err) {
    console.error('[삭제 승인 오류]', err.message);
    res.status(500).json({ error: '삭제 처리 실패' });
  }
});

// 삭제 반려 (로깅 중단 유지, 수동 조치 필요)
// POST /api/admin/reject-log-cleanup
app.post('/api/admin/reject-log-cleanup', requireAuth, async (req, res) => {
  storageStatus.pendingDeletion = false;
  // 로깅은 중단 유지 — 관리자가 수동으로 조치
  res.json({
    success: true,
    message: '삭제 반려. 로깅은 중단 상태 유지. 수동 조치 필요.',
    loggingEnabled: queryLoggingEnabled,
  });
});
```

### F-7. admin.html — 용량 경고 UI

파일: `stitch/admin.html`

#### 대시보드 상단 경고 배너

```html
<!-- 용량 경고 배너 (동적 표시) -->
<div id="storage-warning-banner" class="hidden">
  <!-- caution: 노란색 -->
  <!-- warning/critical: 빨간색 -->
</div>
```

```javascript
// 페이지 로드 시 + 주기적(5분) 용량 상태 확인
async function checkStorageStatus() {
  const res = await fetch('/api/admin/storage-status');
  const status = await res.json();
  
  const banner = document.getElementById('storage-warning-banner');
  
  if (status.level === 'normal') {
    banner.classList.add('hidden');
    return;
  }
  
  banner.classList.remove('hidden');
  
  if (status.level === 'caution') {
    banner.className = 'bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-4';
    banner.innerHTML = `
      <div class="flex items-center">
        <span class="material-icons text-yellow-600 mr-2">warning</span>
        <div>
          <p class="text-yellow-800 font-medium">저장 용량 주의</p>
          <p class="text-yellow-700 text-sm">
            현재 ${status.usagePercent}% 사용 중 (${status.usedMB}MB / 500MB).
            쿼리 로그 ${status.logCount?.toLocaleString()}건 저장 중.
          </p>
        </div>
      </div>
    `;
  }
  
  if (status.level === 'warning' || status.level === 'critical') {
    const isCritical = status.level === 'critical';
    banner.className = `bg-red-50 border-l-4 border-red-500 p-4 mb-4`;
    banner.innerHTML = `
      <div class="flex items-center justify-between">
        <div class="flex items-center">
          <span class="material-icons text-red-600 mr-2">${isCritical ? 'error' : 'warning'}</span>
          <div>
            <p class="text-red-800 font-medium">
              ${isCritical ? '긴급: 저장 용량 부족' : '저장 용량 경고'} — 쿼리 로깅 중단됨
            </p>
            <p class="text-red-700 text-sm">
              현재 ${status.usagePercent}% 사용 중 (${status.usedMB}MB / 500MB).
              로그 ${status.logCount?.toLocaleString()}건.
              ${status.pendingDeletion ? '집계 완료 — 삭제 승인 필요.' : '강제 집계 진행 중...'}
            </p>
          </div>
        </div>
        ${status.pendingDeletion ? `
        <div class="flex gap-2 ml-4">
          <select id="retention-days" class="border rounded px-2 py-1 text-sm">
            <option value="7">7일 보관</option>
            <option value="14">14일 보관</option>
            <option value="30" selected>30일 보관</option>
            <option value="60">60일 보관</option>
          </select>
          <button onclick="approveLogCleanup()" 
                  class="bg-red-600 text-white px-3 py-1 rounded text-sm hover:bg-red-700">
            삭제 승인
          </button>
          <button onclick="rejectLogCleanup()"
                  class="bg-gray-200 text-gray-700 px-3 py-1 rounded text-sm hover:bg-gray-300">
            반려
          </button>
        </div>
        ` : ''}
      </div>
    `;
  }
}

async function approveLogCleanup() {
  const days = document.getElementById('retention-days').value;
  
  if (!confirm(`${days}일 이전 쿼리 로그를 삭제합니다. 집계 데이터는 유지됩니다. 진행하시겠습니까?`)) {
    return;
  }
  
  const res = await fetch('/api/admin/approve-log-cleanup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ retentionDays: parseInt(days) }),
  });
  
  const result = await res.json();
  
  if (result.success) {
    showToast(`${result.deletedCount}건 삭제 완료. 로깅이 재개됩니다.`, 'success');
    checkStorageStatus();  // 배너 갱신
  } else {
    showToast('삭제 처리 실패', 'error');
  }
}

async function rejectLogCleanup() {
  await fetch('/api/admin/reject-log-cleanup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  showToast('삭제 반려. 로깅은 중단 상태를 유지합니다. 수동 조치가 필요합니다.', 'warning');
  checkStorageStatus();
}

// 5분마다 상태 체크
setInterval(checkStorageStatus, 5 * 60 * 1000);
checkStorageStatus();  // 초기 로드
```

#### 분석 탭 내 용량 인디케이터

분석 탭 하단에 작은 용량 표시:

```html
<div id="storage-indicator" class="mt-6 p-3 bg-gray-50 rounded-lg text-sm text-gray-600">
  <!-- 동적: "DB 사용량: 45.2MB / 500MB (9.0%) | 쿼리 로그: 12,345건 | 로깅: 활성" -->
</div>
```

---

## 4. 사이드바 배지 (연계 조정 배지 패턴 재활용)

기존 admin.html 사이드바에서 "연계 조정" 탭에 승인 대기 건수 배지가 있는 것과 동일한 패턴으로,
분석 탭에 용량 경고 배지를 추가:

```javascript
// 사이드바 "분석" 메뉴에 배지 표시
function updateAnalyticsBadge(status) {
  const badge = document.getElementById('analytics-warning-badge');
  if (status.level === 'warning' || status.level === 'critical') {
    badge.textContent = '!';
    badge.className = 'bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5';
    badge.classList.remove('hidden');
  } else if (status.level === 'caution') {
    badge.textContent = '!';
    badge.className = 'bg-yellow-500 text-white text-xs rounded-full px-1.5 py-0.5';
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}
```

---

## 5. 주의사항

### 삭제 안전장치
- 삭제는 반드시 **집계 완료 후**에만 실행 (aggregatedBeforeDelete 플래그)
- 관리자가 보관 기간을 선택 가능 (7/14/30/60일)
- confirm() 한 번 더 확인 (이건 삭제 행위이므로 confirm 유지)
- query_stats는 절대 삭제하지 않음 (영구 보관)

### 용량 추정의 한계
- query_log 건수 × 200B는 추정치 — 실제 PostgreSQL은 인덱스, WAL 등 추가 공간 사용
- get_db_size() RPC 함수를 만들면 더 정확하지만, anon key SECURITY DEFINER 필요
- 추정치로 시작하되 실제 운영 후 보정 가능

### 로깅 중단 시 영향
- 로깅 중단 중에도 /api/chat 검색 자체는 정상 동작 (로깅만 스킵)
- 로깅 중단 기간의 질의는 집계에 포함되지 않음 — 이 기간은 통계 공백
- 관리자가 신속하게 승인하도록 배너로 시각적 알림

### 기존 Phase C (90일 자동 정리)와의 관계
- 90일 자동 정리는 평상시 유지보수 용도 (매일 자정 실행)
- Phase F 용량 관리는 비상 상황 대응 용도 (80% 도달 시)
- 두 개가 충돌하지 않음 — 90일 정리가 잘 동작하면 Phase F는 거의 작동 안 함
- Phase F는 "많은 사용자가 급격히 질의" 같은 예외 상황을 위한 안전망

---

## 6. 보고 양식 (Phase F 추가분)

```
### Phase F 완료 보고

**F-1 용량 확인:**
- checkDBSize 함수: [추가 완료]
- get_db_size RPC: [생성 완료 / 추정치 방식 사용]

**F-2~F-3 로깅 상태 관리:**
- queryLoggingEnabled 플래그: [추가 완료]
- 매시간 체크: [설정 완료]
- forceAggregateAll: [추가 완료]

**F-5 로깅 플래그 체크:**
- /api/chat 스킵 로직: [추가 완료]

**F-6 관리자 API:**
- /api/admin/storage-status: [추가 완료]
- /api/admin/approve-log-cleanup: [추가 완료]
- /api/admin/reject-log-cleanup: [추가 완료]

**F-7 UI:**
- 경고 배너: [렌더링 확인]
- 승인/반려 버튼: [동작 확인]
- 사이드바 배지: [표시 확인]

**테스트:**
- 정상 상태 → 배너 숨김: [확인]
- 경고 시뮬레이션 → 배너 표시 + 승인 버튼: [확인]
- 승인 → 삭제 + 로깅 재개: [확인]
```
