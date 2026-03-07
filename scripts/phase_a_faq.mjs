/**
 * Phase A: FAQ 구조화 스크립트
 * 1. 기존 68건 FAQ에 category 태그 추가
 * 2. 통합돌봄 8개 서비스 FAQ 추가
 * 3. 보충분 FAQ를 data/faq_kb.json으로 생성
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const jsonPath = path.join(__dirname, '..', 'welfare_kb_detail_v3.json');

// category 자동 분류
function classifyCategory(q) {
  if (/비용|돈|얼마|무료|요금|가격|본인부담|부담금/.test(q)) return 'cost';
  if (/자격|대상|해당|조건|등급|나이|받을\s*수|이용.*가능|못\s*받/.test(q)) return 'eligibility';
  if (/신청|방법|어디서|어떻게|서류|절차|접수|등록/.test(q)) return 'howto';
  if (/기간|얼마나.*오래|몇\s*번|횟수|언제까지|며칠|몇\s*시간|자주/.test(q)) return 'duration';
  if (/무엇|어떤|내용|서비스|뭐|해주|해줘|이루어|기능/.test(q)) return 'content';
  if (/대신|대리|가족|위임|다른\s*사람/.test(q)) return 'proxy';
  return 'general';
}

// 통합돌봄 8개 서비스 FAQ 데이터
const dolbomFaqs = {
  '통합돌봄 신청·연계 안내': [
    { category: 'howto', q: '통합돌봄은 어디서 신청하나요?', a: '가까운 읍면동 주민센터(행정복지센터)에 방문하시면 됩니다. 전화 상담도 가능합니다.' },
    { category: 'eligibility', q: '누구나 신청할 수 있나요?', a: '65세 이상 어르신, 장애인, 퇴원 환자 등 돌봄이 필요한 분이 대상입니다. 필요도 조사를 통해 서비스가 결정됩니다.' },
    { category: 'general', q: '통합돌봄이 정확히 뭔가요?', a: '병원·시설이 아닌 집에서 건강하게 살 수 있도록 보건의료·돌봄·주거 서비스를 한 번에 연결해 드리는 제도입니다. 2026년 3월 27일부터 전면 시행됩니다.' },
    { category: 'cost', q: '비용이 드나요?', a: '소득 수준에 따라 다릅니다. 기초생활수급자·차상위계층은 무료이며, 그 외에는 소득 기준에 따라 본인부담이 있을 수 있습니다. 정확한 금액은 주민센터에서 확인해 주세요.' },
    { category: 'content', q: '어떤 서비스를 받을 수 있나요?', a: '방문 건강관리, 가사·돌봄 지원, AI·IoT 안전확인, 주거 개선, 보조기기 지원 등 필요에 맞는 서비스를 연결해 드립니다.' },
  ],
  '재택 보건의료 서비스': [
    { category: 'content', q: '재택 보건의료 서비스는 어떤 건가요?', a: '의사·간호사가 집으로 방문하여 건강관리, 만성질환 관리, 재활 등 의료서비스를 제공합니다. 병원에 가기 어려운 분들을 위한 서비스입니다.' },
    { category: 'cost', q: '비용이 따로 드나요?', a: '건강보험이 적용되며, 소득에 따라 본인부담금이 다릅니다. 기초생활수급자는 무료이며, 정확한 비용은 보건소에 문의하세요.' },
    { category: 'eligibility', q: '누가 받을 수 있나요?', a: '거동이 불편하여 의료기관 방문이 어려운 분, 퇴원 후 재택 관리가 필요한 분이 대상입니다. 통합돌봄 신청 시 보건의료 필요도 조사를 통해 연계됩니다.' },
    { category: 'howto', q: '어떻게 신청하나요?', a: '읍면동 주민센터에서 통합돌봄 신청 시 함께 신청하거나, 보건소에 직접 문의하셔도 됩니다.' },
  ],
  '일상생활 돌봄 지원': [
    { category: 'content', q: '일상생활 돌봄은 어떤 도움을 주나요?', a: '가사지원(청소·세탁·식사 준비), 이동지원, 보조기기 지원, 주야간보호, AI·IoT 안전확인, 주거지원 등 8가지 서비스를 필요에 맞게 연결해 드립니다.' },
    { category: 'duration', q: '얼마나 오래 받을 수 있나요?', a: '필요도 조사 결과에 따라 서비스 기간이 결정됩니다. 정기적으로 재평가를 통해 계속 이용 여부가 결정됩니다.' },
    { category: 'cost', q: '비용은 어떻게 되나요?', a: '소득 수준에 따라 본인부담이 다릅니다. 기초생활수급자·차상위계층은 무료이며, 그 외에는 소득 기준에 따라 일부 본인부담이 있습니다.' },
    { category: 'howto', q: '신청은 어떻게 하나요?', a: '읍면동 주민센터(행정복지센터)에 방문하여 통합돌봄을 신청하시면 필요도 조사를 거쳐 맞춤형 서비스가 연계됩니다.' },
  ],
  '퇴원 복귀 지원': [
    { category: 'howto', q: '퇴원 복귀 지원은 어떻게 신청하나요?', a: '입원 중인 병원에서 퇴원 예정 시 의료사회복지사에게 요청하거나, 읍면동 주민센터에서 통합돌봄 신청 시 퇴원 복귀 서비스를 함께 신청할 수 있습니다.' },
    { category: 'duration', q: '퇴원 후 얼마나 지원을 받을 수 있나요?', a: '퇴원 후 초기 집중 지원 기간과 이후 정기 모니터링 기간이 있습니다. 개인 상황에 따라 다르며, 필요 시 다른 돌봄 서비스로 연계해 드립니다.' },
    { category: 'content', q: '퇴원 후 어떤 도움을 받을 수 있나요?', a: '가정 복귀 후 돌봄 계획 수립, 가사·돌봄 인력 연결, 재활 서비스 연계, 정기 건강 모니터링 등을 지원합니다.' },
    { category: 'eligibility', q: '모든 퇴원 환자가 받을 수 있나요?', a: '퇴원 후 혼자서 일상생활이 어려운 분, 돌봄 공백이 예상되는 분이 주 대상입니다. 퇴원 전 미리 신청하시면 퇴원 당일부터 지원이 가능합니다.' },
  ],
  'AI·IoT 안전확인 서비스': [
    { category: 'content', q: 'AI·IoT 안전확인 서비스는 뭔가요?', a: 'AI 스피커·IoT 센서를 집에 설치하여 어르신의 활동을 감지하고, 이상 징후 발생 시 신속하게 대응하는 서비스입니다. 고독사 예방과 응급상황 조기 발견에 도움이 됩니다.' },
    { category: 'cost', q: '설치 비용이 드나요?', a: '통합돌봄 대상자로 선정되면 무상으로 설치됩니다. 정확한 조건은 읍면동 주민센터에 문의하세요.' },
    { category: 'howto', q: '어떻게 신청하나요?', a: '읍면동 주민센터에서 통합돌봄 신청 시 안전확인 서비스 필요도 조사를 통해 연계됩니다. 전화로 먼저 상담받으실 수도 있습니다.' },
  ],
  '장기요양 서비스 연계': [
    { category: 'eligibility', q: '장기요양등급이 있어야 하나요?', a: '네, 장기요양 1~5등급 또는 인지지원등급을 받으셔야 합니다. 등급이 없으시면 국민건강보험공단(1577-1000)에 신청하실 수 있습니다.' },
    { category: 'howto', q: '장기요양 서비스는 어떻게 신청하나요?', a: '국민건강보험공단에 장기요양인정 신청 후 등급을 받으시면, 통합돌봄 체계 안에서 재가서비스(방문요양·방문간호·방문목욕 등)를 연계받으실 수 있습니다.' },
    { category: 'content', q: '어떤 장기요양 서비스를 받을 수 있나요?', a: '방문요양(가정방문 신체활동·가사지원), 방문간호, 방문목욕, 주야간보호(낮 시간 보호), 단기보호 등이 있습니다. 등급에 따라 이용 가능한 서비스가 다릅니다.' },
    { category: 'cost', q: '비용은 얼마나 드나요?', a: '장기요양보험이 적용되어 본인부담 15%입니다. 기초생활수급자는 면제, 차상위계층은 7.5%입니다. 등급과 서비스에 따라 다르니 자세한 내용은 공단에 문의하세요.' },
  ],
  '장애인 통합돌봄 지원': [
    { category: 'eligibility', q: '어떤 장애인이 이용할 수 있나요?', a: '장애인복지법에 따른 등록 장애인으로, 돌봄이 필요한 분이 대상입니다. 장애 유형과 정도에 따라 맞춤형 서비스가 연계됩니다.' },
    { category: 'content', q: '장애인 통합돌봄은 어떤 서비스인가요?', a: '활동지원, 보조기기 지원, 주거 개선, 건강관리 등 장애인 특성에 맞는 돌봄 서비스를 통합적으로 연결해 드립니다.' },
    { category: 'howto', q: '어떻게 신청하나요?', a: '읍면동 주민센터에서 통합돌봄을 신청하시면 장애인 특성에 맞는 필요도 조사를 거쳐 서비스가 연계됩니다. 국민건강보험공단 지사에서도 신청 가능합니다.' },
    { category: 'proxy', q: '보호자가 대리 신청할 수 있나요?', a: '네, 가족이나 보호자가 대리 신청할 수 있습니다. 장애인 본인의 기본 정보와 장애 유형을 알려주시면 됩니다.' },
  ],
  '통합돌봄 전문교육 (경남사회서비스원)': [
    { category: 'eligibility', q: '누가 교육을 받을 수 있나요?', a: '통합돌봄 담당 공무원, 사회복지시설 종사자, 돌봄 인력 등이 대상입니다. 교육 과정에 따라 신청 자격이 다를 수 있습니다.' },
    { category: 'content', q: '어떤 교육을 하나요?', a: '통합돌봄 제도 이해, 필요도 조사 방법, 서비스 연계 실무, 사례관리 기법 등 통합돌봄 전문성 향상을 위한 교육을 제공합니다.' },
    { category: 'howto', q: '교육 신청은 어떻게 하나요?', a: '경상남도사회서비스원 홈페이지 또는 055-230-8200으로 교육 일정과 신청 방법을 확인하실 수 있습니다.' },
  ],
};

// 1. 기존 JSON 읽기
const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

let categorized = 0;
let dolbomAdded = 0;

// 2. 기존 FAQ에 category 추가 + 통합돌봄 FAQ 추가
data.services.forEach(svc => {
  const name = svc['사업명'];

  // 기존 FAQ에 category 태그 추가
  if (svc.faq && svc.faq.length > 0) {
    svc.faq.forEach(f => {
      if (!f.category) {
        f.category = classifyCategory(f.q);
        categorized++;
      }
    });
  }

  // 통합돌봄 서비스 FAQ 추가
  if (dolbomFaqs[name]) {
    svc.faq = dolbomFaqs[name];
    dolbomAdded += dolbomFaqs[name].length;
  }
});

// 3. 저장
fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf-8');

// 4. 보충분 FAQ → data/faq_kb.json 생성
const supplementFaqs = [
  // 축 1: 발화 변형 - 비용
  { category: "공통", faq_type: "cost", persona: "elderly", question: "돈을 내야 하나요?", answer: "경상남도사회서비스원의 공공돌봄 서비스는 대부분 무료이거나 소득에 따라 본인부담금이 달라집니다. 055-230-8200으로 전화하시면 정확한 비용을 안내해 드립니다.", related_service: null, keywords: "돈 내야 비용 유료 무료 공짜 돈없어", phone_number: "055-230-8200", priority: 1 },
  { category: "공통", faq_type: "cost", persona: "elderly", question: "공짜예요? 돈 안 내도 되나요?", answer: "많은 돌봄 서비스가 무료로 제공됩니다. 소득 수준에 따라 일부 본인부담이 있을 수 있으니, 정확한 내용은 055-230-8200으로 문의하세요.", related_service: null, keywords: "공짜 무료 안내도 돈안내 비용없이", phone_number: "055-230-8200", priority: 2 },
  { category: "공통", faq_type: "cost", persona: "proxy_child", question: "어머니 서비스 비용을 제가 대신 낼 수 있나요?", answer: "네, 가족이 대신 납부할 수 있습니다. 본인부담금이 발생하는 서비스의 경우 담당자에게 말씀하시면 납부 방법을 안내해 드립니다. 055-230-8200으로 문의하세요.", related_service: null, keywords: "대신 납부 자녀 가족 부담 비용 어머니 아버지", phone_number: "055-230-8200", priority: 3 },
  { category: "공통", faq_type: "cost", persona: "proxy_child", question: "매달 얼마씩 나가요? 정기적으로 비용이 드나요?", answer: "서비스에 따라 다릅니다. 긴급돌봄은 일시적이라 1회 비용이고, 노인맞춤돌봄은 월정액 형태입니다. 정확한 금액은 서비스별로 다르니 055-230-8200에서 확인하세요.", related_service: null, keywords: "매달 월 정기 비용 요금 얼마씩 납부", phone_number: "055-230-8200", priority: 3 },
  // 축 1: 발화 변형 - 신청 방법
  { category: "공통", faq_type: "howto", persona: "elderly", question: "어떻게 신청해요? 뭘 어떻게 하면 돼요?", answer: "가장 쉬운 방법은 055-230-8200으로 전화하시는 겁니다. 이름과 전화번호만 알려주시면 담당자가 나머지를 안내해 드립니다.", related_service: null, keywords: "어떻게 신청 방법 절차 하면돼 뭘해야", phone_number: "055-230-8200", priority: 1 },
  { category: "공통", faq_type: "howto", persona: "elderly", question: "인터넷으로도 신청할 수 있어요?", answer: "이 노마 챗봇에서 바로 상담 신청할 수 있습니다. '상담 신청하고 싶어요'라고 말씀하시면 이름과 전화번호만 입력하면 됩니다. 전화가 편하시면 055-230-8200으로 전화하셔도 됩니다.", related_service: null, keywords: "인터넷 온라인 웹 홈페이지 폰으로 핸드폰", phone_number: "055-230-8200", priority: 2 },
  { category: "공통", faq_type: "howto", persona: "proxy_child", question: "자녀가 대신 신청해도 되나요?", answer: "네, 가족이 대리 신청할 수 있습니다. 이용 대상자(어르신)의 이름, 전화번호, 주소를 알고 계시면 됩니다. 055-230-8200으로 전화하시거나 이 챗봇에서 바로 신청하세요.", related_service: null, keywords: "대리 대신 자녀 가족 신청 아들 딸 며느리", phone_number: "055-230-8200", priority: 1 },
  { category: "공통", faq_type: "howto", persona: "welfare_worker", question: "타 시군에서 경남으로 전입한 대상자 서비스 연계는 어떻게 하나요?", answer: "전입 대상자의 기존 서비스 이력을 확인하신 후, 경상남도사회서비스원 055-230-8200으로 연계 요청하시면 됩니다. 돌봄통합지원법 시행으로 시군 간 연계가 간소화되었습니다.", related_service: "통합돌봄 신청·연계 안내", keywords: "전입 이관 타시군 연계 전출 이전 옮겨", phone_number: "055-230-8200", priority: 3 },
  // 축 1: 발화 변형 - 자격/대상
  { category: "공통", faq_type: "eligibility", persona: "elderly", question: "내가 받을 수 있는 거야? 나도 해당돼?", answer: "대부분의 돌봄 서비스는 65세 이상이면 이용 가능합니다. 긴급돌봄은 나이와 관계없이 긴급한 상황이면 누구나 받을 수 있습니다. 정확한 자격은 055-230-8200에서 확인하세요.", related_service: null, keywords: "내가 받을수있어 해당 자격 대상 나도", phone_number: "055-230-8200", priority: 1 },
  { category: "공통", faq_type: "eligibility", persona: "proxy_child", question: "소득 기준이 있나요? 재산이 있으면 못 받나요?", answer: "서비스에 따라 소득 기준이 다릅니다. 일부 서비스는 소득과 관계없이 이용 가능하고, 일부는 기초생활수급자·차상위 우선입니다. 구체적인 소득 기준은 055-230-8200에 문의하세요.", related_service: null, keywords: "소득 기준 재산 돈 많으면 수입 소득기준 자산", phone_number: "055-230-8200", priority: 2 },
  { category: "공통", faq_type: "eligibility", persona: "proxy_child", question: "부부가 같이 사는데도 서비스 받을 수 있어요?", answer: "네, 독거가 아니어도 이용 가능한 서비스가 있습니다. 부부 모두 돌봄이 필요하시면 각각 신청할 수도 있습니다. 상황에 맞는 서비스를 055-230-8200에서 안내받으세요.", related_service: null, keywords: "부부 같이 함께 독거아닌 둘이 배우자 노부부", phone_number: "055-230-8200", priority: 3 },
  { category: "공통", faq_type: "eligibility", persona: "general", question: "경남에 살지 않아도 받을 수 있나요?", answer: "경상남도사회서비스원의 서비스는 경남 거주자를 대상으로 합니다. 다른 지역에 거주하시면 해당 지역의 사회서비스원이나 읍면동 주민센터에 문의하세요.", related_service: null, keywords: "경남 거주 주소 살지않아 다른지역 타지역", phone_number: "055-230-8200", priority: 3 },
  // 축 2: 상황 시나리오
  { category: "신체건강", faq_type: "general", persona: "elderly", question: "겨울에 보일러가 고장났어요. 집이 너무 추워요.", answer: "긴급한 주거 문제는 읍면동 주민센터에 긴급복지지원을 요청하세요. 돌봄이 필요하시면 055-230-8200으로 전화하시면 임시 돌봄 인력을 연결해 드립니다.", related_service: null, keywords: "보일러 추워 난방 겨울 동파 고장 난방비", phone_number: "055-230-8200", priority: 2 },
  { category: "신체건강", faq_type: "general", persona: "elderly", question: "여름에 너무 더워서 힘들어요. 에어컨이 없어요.", answer: "폭염 시 냉방이 어려우시면 읍면동 주민센터의 무더위쉼터를 이용하실 수 있습니다. 건강이 걱정되시면 055-230-8200으로 전화하시면 돌봄 인력 방문도 가능합니다.", related_service: null, keywords: "더워 폭염 에어컨 냉방 여름 열사병 무더위", phone_number: "055-230-8200", priority: 2 },
  { category: "절차궁금", faq_type: "general", persona: "elderly", question: "주말인데 전화해도 되나요? 토요일에도 되나요?", answer: "경상남도사회서비스원 일반 상담은 평일 운영됩니다. 긴급한 상황이면 119에 전화하시고, 평일에 055-230-8200으로 전화하시면 빠르게 처리됩니다. 이 챗봇은 24시간 이용 가능합니다.", related_service: null, keywords: "주말 토요일 일요일 휴일 공휴일 밤 야간 운영시간", phone_number: "055-230-8200", priority: 2 },
  { category: "절차궁금", faq_type: "duration", persona: "elderly", question: "밤에 갑자기 아프면 어디 전화해요?", answer: "밤에 응급 상황이면 119에 전화하세요. 응급안전안심서비스에 가입하시면 집에 있는 응급 버튼 하나로 119가 바로 출동합니다. 신청은 055-230-8200으로 하세요.", related_service: "응급안전안심서비스", keywords: "밤 야간 새벽 응급 갑자기 아파 119", phone_number: "055-230-8200", priority: 1 },
  // 축 2: 복합 상황
  { category: "가족대리", faq_type: "general", persona: "proxy_child", question: "치매 어머니가 넘어지셨는데 혼자 사세요. 어떻게 해야 하나요?", answer: "우선 119로 응급 처치를 받으세요. 이후 긴급돌봄지원사업(055-230-8216)으로 퇴원 후 돌봄을 신청하시고, 치매안심센터(1899-9988)에서 치매 관련 지원도 함께 받으실 수 있습니다.", related_service: "긴급돌봄지원사업", keywords: "치매 넘어짐 낙상 혼자 독거 복합 응급 골절", phone_number: "055-230-8216", priority: 1 },
  { category: "가족대리", faq_type: "general", persona: "proxy_child", question: "아버지가 치매인데 어머니가 돌보시다가 어머니도 쓰러지셨어요", answer: "두 분 다 돌봄이 필요한 상황이시네요. 긴급돌봄(055-230-8216)으로 먼저 임시 돌봄을 요청하시고, 이후 두 분 각각에 맞는 서비스를 연계해 드립니다. 055-230-8200으로 전체 상담받으세요.", related_service: "긴급돌봄지원사업", keywords: "치매 간병 부부 둘다 쓰러져 돌보다 지쳐 간병부담", phone_number: "055-230-8200", priority: 1 },
  // 축 2: 생애 전환
  { category: "생활곤란", faq_type: "general", persona: "general", question: "배우자가 돌아가시고 혼자 됐어요. 어떤 도움을 받을 수 있나요?", answer: "갑자기 혼자 되셨다면 노인맞춤돌봄서비스로 정기 방문과 안부 확인을 받으실 수 있고, 응급안전안심서비스로 긴급 상황에 대비할 수 있습니다. 055-230-8200으로 전화하시면 상황에 맞는 서비스를 함께 찾아드립니다.", related_service: "노인맞춤돌봄서비스 광역지원", keywords: "사별 배우자 돌아가셨 혼자됐어 독거 시작", phone_number: "055-230-8200", priority: 1 },
  { category: "가족대리", faq_type: "general", persona: "proxy_child", question: "부모님 중 한 분이 돌아가시고 남은 분이 걱정돼요", answer: "홀로 남으신 부모님을 위해 노인맞춤돌봄(정기 방문), 응급안전안심서비스(긴급 호출), AI스마트돌봄(원격 모니터링)을 이용하실 수 있습니다. 055-230-8200으로 상담받으세요.", related_service: "응급안전안심서비스", keywords: "사별 혼자 독거 시작 남은분 걱정", phone_number: "055-230-8200", priority: 1 },
  // 축 3: 서비스 심화 - 긴급돌봄
  { category: "긴급돌봄지원사업", faq_type: "duration", persona: "proxy_child", question: "긴급돌봄은 며칠까지 받을 수 있어요?", answer: "긴급돌봄지원사업은 최대 30일간 지원됩니다. 기본돌봄 최대 72시간과 방문목욕 4회가 포함됩니다. 상황에 따라 연장이 가능할 수 있으니 055-230-8216으로 문의하세요.", related_service: "긴급돌봄지원사업", keywords: "기간 며칠 얼마나 오래 연장 단기 일시적", phone_number: "055-230-8216", priority: 2 },
  { category: "긴급돌봄지원사업", faq_type: "content", persona: "proxy_child", question: "긴급돌봄에서 어떤 서비스를 받을 수 있어요? 뭘 해주나요?", answer: "긴급돌봄 인력이 가정을 방문하여 식사 준비, 청소, 세탁 등 가사 지원과 병원 동행, 약 수령 등 일상생활 지원을 해드립니다. 의료 행위는 불포함입니다. 055-230-8216으로 문의하세요.", related_service: "긴급돌봄지원사업", keywords: "뭘해줘 서비스내용 가사 식사 청소 병원동행 돌봄내용", phone_number: "055-230-8216", priority: 2 },
  { category: "긴급돌봄지원사업", faq_type: "eligibility", persona: "general", question: "65세 미만인데도 긴급돌봄 받을 수 있나요?", answer: "긴급돌봄지원사업은 긴급한 상황이면 나이와 관계없이 지원될 수 있습니다. 퇴원 후 돌봄이 필요하거나 갑작스러운 상황이면 055-230-8216으로 전화하세요.", related_service: "긴급돌봄지원사업", keywords: "65세미만 젊은 나이 연령제한 누구나", phone_number: "055-230-8216", priority: 2 },
  // 축 3: 노인맞춤돌봄
  { category: "노인맞춤돌봄서비스 광역지원", faq_type: "content", persona: "proxy_child", question: "노인맞춤돌봄은 얼마나 자주 와요?", answer: "대상자 상황에 따라 주 1~3회 생활지원사가 방문합니다. 안부 확인, 가사 지원, 말벗 등을 제공합니다. 방문 횟수는 담당자와 협의하여 정합니다. 055-230-8200으로 문의하세요.", related_service: "노인맞춤돌봄서비스 광역지원", keywords: "자주 몇번 주몇회 방문횟수 얼마나", phone_number: "055-230-8200", priority: 2 },
  { category: "노인맞춤돌봄서비스 광역지원", faq_type: "content", persona: "elderly", question: "방문하는 사람이 매번 같은 사람이에요?", answer: "가능한 한 같은 생활지원사가 방문합니다. 담당자가 바뀌는 경우 미리 알려드립니다. 불편하시면 055-230-8200으로 말씀해 주세요.", related_service: "노인맞춤돌봄서비스 광역지원", keywords: "같은사람 담당자 바뀌 교체 돌봄인력 생활지원사", phone_number: "055-230-8200", priority: 3 },
  // 축 3: 응급안전안심
  { category: "응급안전안심서비스", faq_type: "content", persona: "proxy_child", question: "응급 버튼 말고 다른 기능도 있나요?", answer: "응급안전안심서비스는 응급 호출 외에도 화재 감지, 가스 감지, 활동 감지 센서가 설치됩니다. 일정 시간 활동이 감지되지 않으면 자동으로 확인 연락이 갑니다. 055-230-8200으로 신청하세요.", related_service: "응급안전안심서비스", keywords: "센서 감지 화재 가스 기능 장비 활동감지", phone_number: "055-230-8200", priority: 2 },
  { category: "응급안전안심서비스", faq_type: "howto", persona: "elderly", question: "응급 버튼은 어떻게 누르는 거예요?", answer: "목에 걸거나 손목에 착용하는 작은 버튼입니다. 위급할 때 버튼을 꾹 누르시면 119가 바로 출동합니다. 설치할 때 사용법을 자세히 알려드립니다.", related_service: "응급안전안심서비스", keywords: "버튼 어떻게 사용법 누르면 목걸이 손목", phone_number: "055-230-8200", priority: 2 },
  // 축 3: AI 스마트돌봄
  { category: "AI 온하나케어 스마트 돌봄", faq_type: "content", persona: "proxy_child", question: "스마트돌봄 센서가 어르신 사생활을 침해하지 않나요?", answer: "AI 스마트돌봄은 카메라가 아닌 IoT 센서(활동감지, 온도, 습도)를 사용하므로 사생활 침해가 없습니다. 활동 패턴만 감지하여 이상 시 알림을 보냅니다. 055-230-8200에서 자세히 안내받으세요.", related_service: "AI 온하나케어 스마트 돌봄", keywords: "사생활 카메라 감시 프라이버시 센서 침해", phone_number: "055-230-8200", priority: 2 },
  { category: "AI 온하나케어 스마트 돌봄", faq_type: "howto", persona: "proxy_child", question: "스마트돌봄 앱으로 부모님 상태를 확인할 수 있나요?", answer: "네, 보호자 앱을 통해 어르신의 활동 패턴, 실내 환경을 확인할 수 있고, 이상 감지 시 즉시 알림을 받습니다. 055-230-8200으로 신청하시면 앱 설정까지 도와드립니다.", related_service: "AI 온하나케어 스마트 돌봄", keywords: "앱 어플 확인 모니터링 알림 상태 원격", phone_number: "055-230-8200", priority: 2 },
  // 축 3: 종합재가센터
  { category: "창원종합재가센터 통합재가서비스", faq_type: "content", persona: "proxy_child", question: "종합재가서비스에서 목욕 도움도 가능한가요?", answer: "네, 종합재가센터에서 방문 목욕 서비스를 제공합니다. 전문 인력이 집에 방문하여 목욕을 도와드립니다. 창원센터 055-230-8530으로 신청하세요.", related_service: "창원종합재가센터 통합재가서비스", keywords: "목욕 씻기 방문목욕 위생 샤워", phone_number: "055-230-8530", priority: 2 },
  { category: "창원종합재가센터 통합재가서비스", faq_type: "eligibility", persona: "general", question: "창원이나 김해가 아닌 다른 시군에서도 종합재가서비스를 받을 수 있나요?", answer: "현재 경상남도사회서비스원 직영 종합재가센터는 창원시와 김해시에 운영 중입니다. 다른 시군에서는 해당 지역 종합재가센터나 읍면동 주민센터에 문의하세요.", related_service: "창원종합재가센터 통합재가서비스", keywords: "다른시군 진주 사천 통영 거제 양산 창원아닌", phone_number: "055-230-8530", priority: 3 },
  // 축 3: 보조기기센터
  { category: "경상남도 보조기기센터", faq_type: "content", persona: "young_parent", question: "어떤 보조기기를 지원받을 수 있나요?", answer: "경상남도보조기기센터에서 휠체어, 보행기, 전동스쿠터, 의사소통보조기기, 시각/청각 보조기기 등을 대여하거나 지원받을 수 있습니다. 장애 유형에 따라 맞춤 상담을 해드립니다. 055-230-8200으로 문의하세요.", related_service: "경상남도 보조기기센터", keywords: "보조기기 종류 휠체어 보행기 전동 의사소통 시각 청각", phone_number: "055-230-8200", priority: 2 },
  { category: "경상남도 보조기기센터", faq_type: "howto", persona: "young_parent", question: "보조기기를 빌릴 수 있나요? 대여 기간은 얼마나 되나요?", answer: "네, 보조기기센터에서 대여 서비스를 제공합니다. 대여 기간과 조건은 기기 종류에 따라 다르니, 055-230-8200으로 문의하시면 자세히 안내해 드립니다.", related_service: "경상남도 보조기기센터", keywords: "대여 빌려 렌탈 기간 반납 빌릴수있나", phone_number: "055-230-8200", priority: 2 },
  // 축 3: 어린이집
  { category: "경상남도청 어린이집", faq_type: "eligibility", persona: "young_parent", question: "경상남도청 어린이집은 누가 다닐 수 있나요?", answer: "경상남도청어린이집은 경상남도청 직원 자녀를 우선으로 하되, 정원 여유가 있으면 지역 주민 자녀도 입소할 수 있습니다. 정확한 모집 기준은 어린이집에 직접 문의하세요.", related_service: "경상남도청 어린이집", keywords: "어린이집 자격 누가 입소 입학 아이 자녀", phone_number: "055-230-8200", priority: 2 },
  { category: "경상남도청 어린이집", faq_type: "howto", persona: "young_parent", question: "어린이집 입소 신청은 어떻게 하나요?", answer: "입소 신청은 모집 시기에 맞춰 접수합니다. 임신육아종합포털 아이사랑에서 대기 신청을 하시거나, 어린이집에 직접 문의하세요.", related_service: "경상남도청 어린이집", keywords: "입소 신청 어린이집 등록 대기 모집 아이사랑", phone_number: "055-230-8200", priority: 2 },
  // 축 4: 경남 전입 주민
  { category: "공통", faq_type: "general", persona: "newcomer", question: "경남에 이사왔는데 복지 서비스가 뭐가 있어요?", answer: "경상남도사회서비스원에서 긴급돌봄, 노인맞춤돌봄, 종합재가서비스, AI스마트돌봄, 보조기기 지원 등 다양한 복지 서비스를 제공합니다. '어떤 서비스가 있어요?'라고 물어보시거나 055-230-8200으로 전화하세요.", related_service: null, keywords: "이사 전입 경남 새로 처음 어떤서비스 뭐가있어", phone_number: "055-230-8200", priority: 1 },
  { category: "공통", faq_type: "general", persona: "newcomer", question: "우리 동네에서 받을 수 있는 서비스가 따로 있나요?", answer: "경남 어디에 사시느냐에 따라 이용 가능한 서비스가 조금 다릅니다. 창원시·김해시는 종합재가센터 직영 서비스가 있고, 다른 시군은 노인맞춤돌봄이나 긴급돌봄을 주로 이용합니다. 055-230-8200에서 지역별 안내를 받으세요.", related_service: null, keywords: "우리동네 지역 시군 창원 김해 진주 통영 거제", phone_number: "055-230-8200", priority: 2 },
  // 축 4: 복지 실무자
  { category: "공통", faq_type: "general", persona: "welfare_worker", question: "긴급돌봄과 노인맞춤돌봄 대상자 차이가 뭐예요?", answer: "긴급돌봄은 퇴원, 부상, 주돌봄자 부재 등 '일시적 긴급 상황'의 대상자를 위한 단기 서비스이고, 노인맞춤돌봄은 65세 이상 독거·고령 부부 등 '일상적 돌봄이 필요한' 대상자를 위한 정기 서비스입니다.", related_service: null, keywords: "차이 비교 긴급돌봄 노인맞춤돌봄 대상 구분 다른점", phone_number: "055-230-8200", priority: 2 },
  { category: "공통", faq_type: "general", persona: "welfare_worker", question: "돌봄통합지원법 시행 후 절차가 어떻게 바뀌었나요?", answer: "2026년 3월 시행된 돌봄통합지원법으로 읍면동 주민센터에서 통합 접수가 가능해졌고, 돌봄서비스 간 연계가 간소화되었습니다. 세부 변경사항은 경상남도통합돌봄지원센터 055-230-8282에서 안내받으실 수 있습니다.", related_service: "통합돌봄 신청·연계 안내", keywords: "돌봄통합지원법 변경 바뀐 새법 시행 절차변경", phone_number: "055-230-8282", priority: 2 },
  // 축 4: 돌봄 종사자
  { category: "민간지원", faq_type: "howto", persona: "caregiver", question: "활동지원사 교육은 어디서 받나요?", answer: "경상남도사회서비스원에서 장애인활동지원사 보수교육을 실시합니다. 교육 일정과 신청 방법은 055-230-8200으로 문의하시거나 경상남도사회서비스원 홈페이지를 확인하세요.", related_service: null, keywords: "활동지원사 교육 보수교육 자격 연수 일정", phone_number: "055-230-8200", priority: 2 },
  { category: "민간지원", faq_type: "howto", persona: "caregiver", question: "사회복지시설에서 대체인력을 요청하려면 어떻게 하나요?", answer: "사회복지시설 대체인력 지원사업을 통해 직원 휴가·교육 시 대체인력을 지원받을 수 있습니다. 055-230-8200으로 신청하시면 됩니다.", related_service: "사회복지시설 종사자 대체인력 지원사업", keywords: "대체인력 시설 직원 휴가 교육 대신 파견", phone_number: "055-230-8200", priority: 3 },
  { category: "민간지원", faq_type: "content", persona: "caregiver", question: "장기요양기관 컨설팅은 어떤 내용인가요?", answer: "장기요양기관 컨설팅은 기관 운영 개선, 서비스 품질 향상, 인력 관리 등에 대한 전문 컨설팅을 제공합니다. 055-230-8200으로 신청하시면 됩니다.", related_service: "장기요양기관 평가지원 및 컨설팅", keywords: "컨설팅 장기요양 기관 운영 품질 개선", phone_number: "055-230-8200", priority: 3 },
  // 서비스 비교 / 공통
  { category: "공통", faq_type: "general", persona: "proxy_child", question: "여러 서비스를 동시에 받을 수 있나요?", answer: "네, 대상자 상황에 따라 복수의 서비스를 동시에 이용할 수 있습니다. 예를 들어 노인맞춤돌봄(정기방문)과 응급안전안심서비스(응급장비)를 함께 이용하는 것이 가능합니다. 055-230-8200에서 맞춤 조합을 안내받으세요.", related_service: null, keywords: "동시 여러개 같이 중복 함께 복수 두가지", phone_number: "055-230-8200", priority: 2 },
  { category: "공통", faq_type: "general", persona: "proxy_child", question: "노인장기요양등급이 있어야만 서비스를 받을 수 있나요?", answer: "아닙니다. 경상남도사회서비스원의 서비스는 장기요양등급이 없어도 이용할 수 있는 것이 많습니다. 긴급돌봄, 노인맞춤돌봄, 응급안전안심서비스 등은 등급과 무관하게 신청 가능합니다.", related_service: null, keywords: "장기요양 등급 없어도 등급외 인정등급 장기요양등급", phone_number: "055-230-8200", priority: 1 },
  { category: "공통", faq_type: "general", persona: "general", question: "경상남도사회서비스원이 뭐하는 곳이에요?", answer: "경상남도사회서비스원은 경남도민에게 돌봄, 복지, 사회서비스를 제공하는 공공기관입니다. 긴급돌봄, 노인맞춤돌봄, 종합재가서비스, AI스마트돌봄, 보조기기 지원 등을 운영하고 있습니다. 055-230-8200으로 무엇이든 물어보세요.", related_service: null, keywords: "사회서비스원 뭐하는곳 기관 소개 역할 하는일", phone_number: "055-230-8200", priority: 1 },
  { category: "공통", faq_type: "general", persona: "general", question: "이 챗봇은 뭐예요? 어떻게 사용해요?", answer: "노마(Noma)는 경상남도사회서비스원의 AI 복지 내비게이터입니다. 궁금한 것을 말씀하시거나 입력하시면 맞춤 복지 서비스를 찾아드립니다. 마이크 버튼을 누르면 음성으로도 질문할 수 있습니다.", related_service: null, keywords: "챗봇 노마 AI 사용법 뭐야 어떻게 로봇", phone_number: null, priority: 1 },
];

const faqKbPath = path.join(__dirname, '..', 'data', 'faq_kb.json');
fs.writeFileSync(faqKbPath, JSON.stringify(supplementFaqs, null, 2), 'utf-8');

// 5. 통계 출력
let totalFaq = 0;
const categoryStats = {};
const serviceStats = [];
data.services.forEach(svc => {
  const count = svc.faq?.length || 0;
  totalFaq += count;
  serviceStats.push({ name: svc['사업명'], count });
  if (svc.faq) {
    svc.faq.forEach(f => {
      categoryStats[f.category] = (categoryStats[f.category] || 0) + 1;
    });
  }
});

console.log('=== Phase A 완료 보고 ===\n');
console.log(`기존 FAQ category 태깅: ${categorized}건`);
console.log(`통합돌봄 FAQ 추가: ${dolbomAdded}건`);
console.log(`welfare_kb_detail_v3.json 총 FAQ: ${totalFaq}건`);
console.log(`보충분 faq_kb.json: ${supplementFaqs.length}건`);
console.log(`전체 FAQ: ${totalFaq + supplementFaqs.length}건\n`);

console.log('카테고리별 분포 (v3.json):');
Object.entries(categoryStats).sort((a,b) => b[1]-a[1]).forEach(([k,v]) => {
  console.log(`  ${k}: ${v}건`);
});

console.log('\n서비스별 FAQ:');
serviceStats.forEach(s => {
  console.log(`  ${s.name}: ${s.count}건`);
});

console.log('\n보충분 페르소나별 분포:');
const personaStats = {};
supplementFaqs.forEach(f => {
  personaStats[f.persona] = (personaStats[f.persona] || 0) + 1;
});
Object.entries(personaStats).sort((a,b) => b[1]-a[1]).forEach(([k,v]) => {
  console.log(`  ${k}: ${v}건`);
});
