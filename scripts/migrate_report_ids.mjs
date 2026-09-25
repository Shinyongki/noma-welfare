// scripts/migrate_report_ids.mjs — 파일럿 2층 이관을 수동으로 실행
//
// 실행: node scripts/migrate_report_ids.mjs   (서버를 끈 상태에서)
//
// 서버도 시작할 때 같은 이관(requestStore.migrateFieldReports)을 한 번 실행한다.
// 이 스크립트는 서버를 띄우지 않고 데이터만 맞출 때 쓴다.
// 서버와 이 스크립트는 다른 프로세스라 잠금(withLock)을 공유하지 않는다 — 서버가 켜져 있으면 쓰기가 엇갈릴 수 있다.
// 여러 번 실행해도 결과가 같다. 암호화된 이름·연락처는 requestStore를 거쳐 그대로 유지된다.
import 'dotenv/config';
import * as requestStore from '../data/requestStore.mjs';

const { reports, linkages } = await requestStore.migrateFieldReports();
console.log(`완료: 보고 ${reports}건, 연계 ${linkages}건 필드 보강`);
if (reports + linkages === 0) console.log('이미 이관된 상태입니다.');
