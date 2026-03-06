# 작업지시서_009_alert_토스트_교체

**목표:** admin.html의 남은 alert() 34개를 showToast()로 교체한다.

---

## 배경

작업지시서_006에서 승인 대기 관련 5개 함수의 alert를 showToast로 교체했다.
나머지 34개가 아직 브라우저 기본 alert() 상태다.

showToast() 함수는 이미 admin.html에 존재한다 (006에서 추가됨).

개선 범위: **stitch/admin.html 만 수정** (server.js 변경 없음)

---

## 작업 전 준비

```bash
cp stitch/admin.html stitch/admin.html.bak
```

---

## 교체 규칙

| 용도 | 교체 방식 | 색상 |
|------|---------|------|
| 처리 완료 (성공) | `showToast('메시지')` | 초록 (기본) |
| 에러/실패 | `showToast('메시지', 'error')` | 빨강 |
| 입력 검증 실패 | `showToast('메시지', 'error')` | 빨강 |
| 권한 안내 | `showToast('메시지', 'warning')` | 주황 |
| 상태 전이 안내 | `showToast('메시지', 'warning')` | 주황 |

**showToast warning 색상 추가 필요:**
현재 showToast는 success(초록)/error(빨강) 2종만 있음.
warning(주황) 추가:
```javascript
// 기존
${type === 'success' ? 'bg-green-500' : 'bg-red-500'}

// 수정 후
${type === 'success' ? 'bg-green-500' : type === 'warning' ? 'bg-orange-500' : 'bg-red-500'}
```

---

## 교체 목록 (34개)

### A. 처리 완료 (성공) — 1개
| 줄 | 현재 | 교체 후 |
|----|------|---------|
| 4264 | `alert('최종 승인 완료. 이메일이 발송되었습니다.')` | `showToast('최종 승인 완료. 이메일이 발송되었습니다.')` |

### B. 에러/실패 — 22개
| 줄 | 현재 메시지 | 교체 후 |
|----|------------|---------|
| 2555 | '상태 변경 실패' | `showToast('상태 변경 실패', 'error')` |
| 2574 | '메모 추가 실패' | `showToast('메모 추가 실패', 'error')` |
| 2596 | '서비스 계획 저장 실패' | `showToast('서비스 계획 저장 실패', 'error')` |
| 3115 | `e.message \|\| '처리 실패'` | `showToast(e.message \|\| '처리 실패', 'error')` |
| 3401 | '메모 추가 실패' | `showToast('메모 추가 실패', 'error')` |
| 3424 | '부서 조정자 승인 실패' | `showToast('부서 조정자 승인 실패', 'error')` |
| 3442 | '부서 조정자 반려 실패' | `showToast('부서 조정자 반려 실패', 'error')` |
| 3460 | '부서 조정자 수정 요청 실패' | `showToast('부서 조정자 수정 요청 실패', 'error')` |
| 3477 | '부서 조정자 재제출 실패' | `showToast('부서 조정자 재제출 실패', 'error')` |
| 3495 | '대상부서 수락 실패' | `showToast('대상부서 수락 실패', 'error')` |
| 3513 | '대상부서 반려 실패' | `showToast('대상부서 반려 실패', 'error')` |
| 3531 | '대상부서 수정요청 실패' | `showToast('대상부서 수정요청 실패', 'error')` |
| 3549 | '대상부서 재제출 실패' | `showToast('대상부서 재제출 실패', 'error')` |
| 3898 | '상태 변경 실패' | `showToast('상태 변경 실패', 'error')` |
| 3962 | `` `${failCount}건 처리 실패` `` | `showToast(\`${failCount}건 처리 실패\`, 'error')` |
| 4232 | '상태 변경 실패' | `showToast('상태 변경 실패', 'error')` |
| 4248 | '메모 추가 실패' | `showToast('메모 추가 실패', 'error')` |
| 4268 | '승인 처리 실패' | `showToast('승인 처리 실패', 'error')` |
| 4286 | '반려 처리 실패' | `showToast('반려 처리 실패', 'error')` |
| 4304 | '수정 요청 실패' | `showToast('수정 요청 실패', 'error')` |
| 4321 | '메모 추가 실패' | `showToast('메모 추가 실패', 'error')` |
| 4345 | '서비스 계획 저장 실패' | `showToast('서비스 계획 저장 실패', 'error')` |
| 4856 | '메모 추가 실패' | `showToast('메모 추가 실패', 'error')` |

### C. 입력 검증 실패 — 8개
| 줄 | 현재 메시지 | 교체 후 |
|----|------------|---------|
| 3067 | '사유를 입력하세요.' | `showToast('사유를 입력하세요.', 'error')` |
| 3070 | '수정요청 사항을 입력하세요.' | `showToast('수정요청 사항을 입력하세요.', 'error')` |
| 3073 | '대상 부서를 선택하세요.' | `showToast('대상 부서를 선택하세요.', 'error')` |
| 3076 | '사유를 입력하세요.' | `showToast('사유를 입력하세요.', 'error')` |
| 3430 | '반려 사유를 입력하세요.' | `showToast('반려 사유를 입력하세요.', 'error')` |
| 3448 | '수정 요청 사항을 입력하세요.' | `showToast('수정 요청 사항을 입력하세요.', 'error')` |
| 3501 | '반려 사유를 입력하세요.' | `showToast('반려 사유를 입력하세요.', 'error')` |
| 3519 | '수정요청 사항을 입력하세요.' | `showToast('수정요청 사항을 입력하세요.', 'error')` |
| 3937 | '변경할 상태를 선택하세요.' | `showToast('변경할 상태를 선택하세요.', 'error')` |

### D. 권한 안내 — 3개
| 줄 | 현재 메시지 | 교체 후 |
|----|------------|---------|
| 3406 | '관리자는 승인 권한이 없습니다...' | `showToast('관리자는 승인 권한이 없습니다.', 'warning')` |
| 3407 | '관리자는 반려 권한이 없습니다...' | `showToast('관리자는 반려 권한이 없습니다.', 'warning')` |
| 3408 | '관리자는 수정요청 권한이 없습니다...' | `showToast('관리자는 수정요청 권한이 없습니다.', 'warning')` |

### E. 상태 전이 안내 — 1개
| 줄 | 현재 메시지 | 교체 후 |
|----|------------|---------|
| 2539 | `` `${approvalLabel} 완료 후 "${status}" 단계로 변경할 수 있습니다.` `` | `showToast(\`${approvalLabel} 완료 후 "${status}" 단계로 변경할 수 있습니다.\`, 'warning')` |

---

## 작업 순서

1. 백업
2. showToast에 warning 색상 추가 (1줄 수정)
3. A~E 순서대로 alert → showToast 교체 (줄 번호 기준)
4. 교체 후 남은 alert() 확인:
   ```bash
   grep -n "alert(" stitch/admin.html | grep -v "//.*alert\|showToast\|alerting"
   ```
   → 0개 나와야 정상
5. `npm run build:css`
6. 브라우저에서 동작 확인

---

## 검증

```bash
# 교체 완료 확인 — 0개여야 정상
grep -n "alert(" stitch/admin.html | grep -v "//.*alert"

# showToast 총 개수 확인 (006의 15개 + 이번 34개 = 49개)
grep -c "showToast(" stitch/admin.html
```

---

## 주의사항

- 줄 번호는 교체 진행하면서 밀릴 수 있음 → grep으로 실제 위치 재확인하며 작업
- `alert(` 검색 시 주석 처리된 것(`//alert`)은 건드리지 말 것
- 3406~3408 권한 안내 alert는 `kanbanApproveFromModal` 등 함수 — 내용 변경 없이 alert만 교체
- server.js 변경 없음

---

## 보고 형식

```
[작업 완료 보고]
작업지시서: 작업지시서_009_alert_토스트_교체

완료 항목:
- showToast warning 색상 추가 ✅
- A 처리완료 (1개) ✅
- B 에러/실패 (22개) ✅
- C 입력검증 (9개) ✅
- D 권한안내 (3개) ✅
- E 상태전이 (1개) ✅

잔여 alert() 개수: 0개 ✅

변경 파일:
- stitch/admin.html (N줄 → N줄)

우려사항:
```
