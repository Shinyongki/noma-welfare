# 지시문 — 먼저봄 시연용 인스턴스 (집 PC 클로드코드용)

작성 2026-09-27 23시. 저장소 `C:\Projects\noma-welfare`, 브랜치 `pilot-sancheong` (최신 3cbcdee).
작업 전 `git status`로 미커밋 변경(.env.example, data/requestStore.mjs, data/requests.json, scripts/seed_cases.mjs, capture.cjs)이 있으면 **먼저 알려 주고 멈춘다.** 그 변경은 캡처용 로컬 수정이며 이 작업과 겹치는 파일이 있다.

## 목적

중앙(공모전 주관)이 요청하면 먼저봄을 인터넷 주소로 보여 줄 수 있게 한다. **실사용 배포가 아니다.** 실제 어르신·기관 정보는 하나도 들어가지 않으며, 대장의 먼저봄 상태("구축·가상 데이터 검증")는 바뀌지 않는다.

## 원칙 (지키지 않으면 배포하지 않는다)

1. 시연 모드는 **환경변수 `SHOWCASE=1`로만 켜진다.** 꺼져 있으면 지금 코드와 동작이 완전히 같아야 한다. 파일럿 코드 경로를 바꾸지 않는다.
2. 화면 어디에도 **산청·산청복음·해민, 실제 전화번호**가 나오지 않는다. 산청 수행기관과 협의 전이다.
3. 개인정보 없음: 대상자·생활지원사는 시드 스크립트의 가상 값만. `requests.json`을 시연 서버로 복사하지 않는다(시작 시 새로 생성).
4. 기존 `scripts/insert_demo_data.mjs`, `pre_demo_check.mjs`, `data/*.demo.json`은 노마 시절 파일이다. **건드리지 말고 이름도 쓰지 않는다.** 이 작업의 이름은 전부 `showcase`.
5. AI 관련 키는 넣지 않는다. Gemini·Supabase·Resend 모두 비움.

## 코드 변경 (6건)

### 1. 시연 모드 스위치와 기관명 — `data/requestStore.mjs` 348행 부근

```js
export const SHOWCASE = process.env.SHOWCASE === '1';
export const DEPARTMENTS = SHOWCASE
  ? [
      { id: 'sancheong-1', name: '가상 수행기관 A (군 지역)', type: 'department', services: ['노인맞춤돌봄서비스'] },
      { id: 'virtual-b',   name: '가상 수행기관 B (군 지역)', type: 'department', services: ['노인맞춤돌봄서비스'] },
    ]
  : [ /* 기존 두 줄 그대로 */ ];
```

id는 바꾸지 않는다(시드·화면이 id를 참조). 화면에 보이는 것은 name만이다.

### 2. 연계처 파일 선택 — `server.js` 1155행

`const file = path.join(__dirname, 'data', process.env.SHOWCASE === '1' ? 'linkage_targets_showcase.json' : 'linkage_targets_sancheong.json');`

### 3. 시연용 연계처 데이터 — 새 파일 `data/linkage_targets_showcase.json`

`linkage_targets_sancheong.json` 13건을 복사해 아래 규칙으로 바꾼다. 스크립트로 변환해도 되고 손으로 고쳐도 된다.

| 필드 | 규칙 |
|---|---|
| `id` | `sancheong-` → `showcase-` |
| `sigun` | `'산청군'` → `'가상군'` (scope가 sigun인 항목) |
| `siguns` | 비어 있지 않으면 `['가상군']` |
| `agencyName` | `산청군` → `가상군`, 그 외 실제 기관명(보건소·복지관 등 고유명)은 `가상군 보건소`, `가상군 노인복지관`처럼 일반 명칭으로 |
| `phone` | 전부 `'055-000-0000'` |
| `department` | 실제 부서명이 고유하면 일반 명칭으로. `읍·면 돌봄지원창구` 같은 일반 명칭은 유지 |
| `serviceName`, `eligibility`, `howToApply`, `category`, `sector`, `scope` | 유지 (전국 공통 사업명이므로 실제 시군을 드러내지 않음). 문장 안에 `산청`이 있으면 `가상군`으로 |
| `verified` | 유지(false) |

끝나면 `grep -c "산청" data/linkage_targets_showcase.json` 이 0이어야 한다.

### 4. 시드 스크립트 시연 옵션 — `scripts/seed_cases.mjs`

`--showcase` 플래그를 추가한다. 켜지면
- `TARGETS_FILE` → `linkage_targets_showcase.json`
- `sigun: '산청군'` → `'가상군'` (60행, 177행)
- `DEPT`/`RECEIVER`(98~99행) → `'가상 수행기관 A (군 지역)'`, `'가상 수행기관 B (군 지역)'`
- 연계처 id 매핑(116~119행)의 `sancheong-` 접두를 `showcase-`로 — 상수 `PREFIX`를 두고 문자열을 조립하면 된다
- 그 외 로직은 `--roster`와 동일하게 244명 생성

실행 예: `SHOWCASE=1 node scripts/seed_cases.mjs --roster --showcase` (Windows PowerShell은 `$env:SHOWCASE='1'; node ...`).

### 5. 첫 화면·AI 채팅 숨김 — `server.js` 1198행, `stitch/case.html` 360행 부근

- `/`: 시연 모드에서는 `code.html`(도민 상담 화면) 대신 **`/case`로 302 리다이렉트**. 시연 모드가 아니면 기존 그대로.
  ```js
  app.get('/', (req, res) => process.env.SHOWCASE === '1' ? res.redirect('/case') : res.sendFile(...기존...));
  ```
- `case.html` H 섹션(AI 상담, 360행부터 해당 블록 끝까지)의 최상위 요소에 `hidden` 클래스(또는 `style="display:none"`)를 붙인다. **시연 모드 조건 없이 항상 숨긴다** — 키가 비어 있어 동작하지 않는 기능이고 대장에도 "숨긴다"로 되어 있다. 코드는 지우지 않는다.

### 6. 시연 배너 — `server.js` + `stitch/case.html`, `stitch/report.html`

- 서버: `app.get('/api/showcase', (req, res) => res.json({ showcase: process.env.SHOWCASE === '1' }));` (인증 불필요, 다른 라우트보다 위에)
- 두 페이지 `<body>` 첫 줄에
  ```html
  <div id="showcase-banner" class="hidden w-full bg-amber-100 text-amber-900 text-center text-xs py-1">시연용 화면 · 모든 어르신·기관·연락처는 가상 데이터입니다 · 실제 운영 시스템이 아닙니다</div>
  ```
  와 `fetch('/api/showcase').then(r=>r.json()).then(d=>{ if(d.showcase) document.getElementById('showcase-banner').classList.remove('hidden'); })`.
  시연 모드가 아니면 배너가 보이지 않으므로 파일럿 화면에는 영향이 없다.

### package.json

```json
"start:showcase": "node scripts/seed_cases.mjs --roster --showcase && node server.js"
```
호스팅 서비스가 재시작할 때마다 시드가 다시 만들어지므로 데이터 초기화는 문제가 아니다.

## 로컬 검증 (배포 전, 반드시)

```
SHOWCASE=1 ADMIN_PASSWORD=x WORKER_PASSWORD=y npm run start:showcase
```
1. `http://localhost:5000/` → `/case` 로그인으로 넘어간다. 도민 상담 화면이 뜨지 않는다
2. 2층 로그인 기관 선택에 "가상 수행기관 A/B"만 보인다
3. 배너가 2층·1층 모두에 보인다. AI 상담 영역이 보이지 않는다
4. 연계하기 서랍의 연계처 목록에 산청·실제 전화번호가 없다 — 브라우저에서 페이지 소스와 `/api/...` 응답을 `산청`으로 검색해 0건
5. 명부 244명, 보고함·연계 현황·받은 의뢰(B 로그인)가 캡처 때와 같은 분포로 채워져 있다
6. **시연 모드를 끄고**(`SHOWCASE` 미설정) `npm start` → 첫 화면·기관명·연계처가 기존과 동일한지 확인. 이것이 원칙 1의 검증이다

## 커밋

브랜치 `pilot-sancheong`에 커밋 2개로 나눈다.
- `feat: 시연용 모드(SHOWCASE) — 가상 기관명·가상 연계처·배너·첫 화면 리다이렉트`
- `chore: 2층 AI 상담 영역 숨김(키 미사용)`

`data/requests.json`은 커밋하지 않는다(시드 결과물). `.env.example`에 `SHOWCASE=` 한 줄과 설명을 추가한다. 푸시는 사용자 확인 후.

## 배포 (사용자가 직접 — 클로드코드는 절차만 안내)

Render 무료 Web Service 기준(다른 무료 Node 호스팅도 같다).
- 저장소: `Shinyongki/noma-welfare`, 브랜치 `pilot-sancheong`
- Build: `npm install` / Start: `npm run start:showcase`
- 환경변수: `SHOWCASE=1`, `NODE_ENV=production`, `ADMIN_PASSWORD`(새 값, 파일럿 값 재사용 금지), `WORKER_PASSWORD`(새 값), `SESSION_SECRET`(랜덤), `ENCRYPTION_KEY`(새로 생성한 64자 hex), `BASE_URL`(배포 주소). 나머지는 비움
- 배포 후 위 검증 1~5를 배포 주소에서 반복. 특히 `/`가 도민 상담 화면이 아닌지
- 무료 플랜은 15분 미사용 시 잠들고 첫 접속에 30~60초 걸린다. 시연 직전에 한 번 열어 둔다
- 주소와 비밀번호는 응모서에 쓰지 않고, 중앙이 요청할 때 전달한다

## 보고 형식

완료 후 다음을 보고한다: 커밋 해시 2개, 로컬 검증 1~6 결과(각 ○/×), `grep -c 산청` 결과, 바꾼 연계처 13건 중 agencyName·department를 일반 명칭으로 바꾼 항목 목록.
