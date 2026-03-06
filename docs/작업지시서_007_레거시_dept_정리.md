# 작업지시서_007_레거시_dept_정리

**목표:** 레거시 파일 dept.html과 관련 서버 API를 제거하고 코드베이스를 정리한다.

---

## 배경

dept.html은 admin.html에 역할 통합(unified-auth)이 도입되기 이전에 만들어진
부서장 전용 독립 페이지다. admin.html의 dept 역할이 동일 기능을 모두 포함하고 있어
현재는 불필요한 중복 파일이다.

제거 대상:
- stitch/dept.html (1,443줄)
- server.js의 /api/dept-auth/* 라우트 3개
- server.js의 /api/dept-coord/* 라우트

---

## 작업 전 확인

```bash
# dept-auth, dept-coord 라우트 전체 목록
grep -n "dept-auth\|dept-coord" server.js

# dept.html을 참조하는 곳이 있는지 확인
grep -rn "dept.html" stitch/ server.js
```

확인 후 진행.

---

## 작업 항목

### 1. dept.html 삭제

```bash
rm stitch/dept.html
```

### 2. server.js에서 레거시 라우트 제거

제거 대상 (grep 결과 기준으로 정확한 줄 번호 확인 후 삭제):
- `POST /api/dept-auth/login` (line ~185)
- `POST /api/dept-auth/logout` (line ~206)
- `GET /api/dept-auth/status` (line ~212)
- `/api/dept-coord/linkages` 라우트

**주의:** 라우트 핸들러 전체 블록을 삭제할 것. 라우트 선언 1줄만 삭제하면 안 됨.

### 3. CLAUDE.md 업데이트

CLAUDE.md의 프로젝트 구조 섹션에서 dept.html 관련 내용 제거.

---

## 검증

```bash
# 삭제 확인
ls stitch/dept.html  # → No such file or directory 가 정상

# 레거시 라우트 제거 확인
grep -n "dept-auth\|dept-coord" server.js  # → 결과 없어야 정상

# 서버 정상 기동 확인
node server.js &
curl http://localhost:5000/  # → 정상 응답

# admin.html 정상 동작 확인 (dept-auth 제거 후 unified-auth 영향 없는지)
curl http://localhost:5000/api/unified-auth/status  # → {"authenticated":false} 정상
```

---

## 주의사항

- unified-auth 관련 코드는 절대 건드리지 말 것
- /api/dept/* 라우트(부서 조정자 승인 API)는 제거 대상 아님
  - 제거 대상: `/api/dept-auth/*`, `/api/dept-coord/*`
  - 유지 대상: `/api/dept/pending-approvals`, `/api/dept/linkage/:id/approve` 등
- server.js 수정 후 반드시 서버 재시작 + 동작 확인

---

## 보고 형식

```
[작업 완료 보고]
작업지시서: 작업지시서_007_레거시_dept_정리

완료 항목:
- dept.html 삭제 ✅
- dept-auth 라우트 제거 ✅ (제거된 줄 번호: )
- dept-coord 라우트 제거 ✅ (제거된 줄 번호: )
- CLAUDE.md 업데이트 ✅

변경 파일:
- stitch/dept.html (삭제)
- server.js (N줄 → N줄, -N줄)
- CLAUDE.md

서버 동작 확인: ✅/❌
unified-auth 영향 없음 확인: ✅/❌
```
