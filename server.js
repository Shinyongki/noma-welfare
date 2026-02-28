// server.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { EdgeTTS } from '@andresaya/edge-tts';
import nodemailer from 'nodemailer';
import * as requestStore from './data/requestStore.mjs';
import * as analyticsStore from './data/analyticsStore.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const BASE_URL = process.env.BASE_URL || 'http://localhost:' + PORT;
const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GEMINI_API_KEY });

// ── Welfare Knowledge Base (RAG) Loading ──
const KB_FILE = path.join(__dirname, '경상남도사회서비스원_지식베이스.csv');
let welfareKB = [];

// CSV 한 줄을 올바르게 파싱 (따옴표 내 쉼표, 공백 포함 필드 처리)
function parseCSVLine(line) {
    const fields = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
            if (inQuotes && line[i + 1] === '"') {
                field += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (c === ',' && !inQuotes) {
            fields.push(field.trim());
            field = '';
        } else if (c !== '\r') {
            field += c;
        }
    }
    fields.push(field.trim());
    return fields;
}

// 한국어 조사/어미 제거 (RAG 검색용)
function stripKoreanSuffixes(word) {
    return word
        .replace(/(이|가|을|를|은|는|에|에서|으로|로|와|과|도|의|하고|에게|한테|께서|부터|까지|만|밖에|처럼|같이|보다|이나|나|이요|요|야)$/g, '')
        .replace(/(합니다|해요|하는|입니다|이에요|예요|인가요|일까요|인데|해서|하면|해줘|되나요|받고|없어요|있어요|싶어요|필요해요|돌봐줄|사는)$/g, '')
        .replace(/(아요|어요|아|어|지|네|네요|군요|구나|잖아|잖아요|거든|거든요|래요|세요|대요|는데|ㄴ데|던데|텐데|겠어|을까)$/g, '');
}

// 유의어/개념 매핑 사전 (일상어 → 지식베이스 키워드 확장)
const synonymMap = {
    // 건강/질병 관련
    '아프': ['질병', '부상', '돌봄', '의료', '긴급돌봄'],
    '아파': ['질병', '부상', '돌봄', '의료', '긴급돌봄'],
    '병': ['질병', '부상', '의료', '돌봄'],
    '몸': ['질병', '돌봄', '의료', '건강'],
    '아프다': ['질병', '부상', '의료'],
    '다쳐': ['부상', '긴급돌봄', '의료'],
    '다치': ['부상', '긴급돌봄', '의료'],
    '수술': ['퇴원후', '긴급돌봄', '의료'],
    '입원': ['퇴원후', '긴급돌봄', '의료'],
    '퇴원': ['퇴원후', '퇴원환자돌봄', '긴급돌봄'],
    '치매': ['노인맞춤돌봄', '돌봄', '독거노인'],
    '건강': ['건강모니터링', '의료', '돌봄', '방문의료'],
    '간호': ['방문의료', '돌봄', '재가'],
    '간병': ['돌봄', '방문요양', '긴급돌봄'],
    '약': ['의료', '건강', '돌봄'],
    '병원': ['의료', '퇴원후', '퇴원환자돌봄'],
    // 정서/생활 관련
    '외롭': ['독거노인', '1인가구', '고독사예방', '안부확인'],
    '외로': ['독거노인', '1인가구', '고독사예방', '안부확인'],
    '혼자': ['독거노인', '1인가구', '고독사예방'],
    '우울': ['돌봄', '상담지원', '안부확인'],
    '힘들': ['돌봄', '긴급돌봄', '상담지원'],
    '무섭': ['긴급보호', '응급', '안전'],
    '걱정': ['안부확인', '돌봄', '안전'],
    // 긴급/안전 관련
    '급해': ['긴급돌봄', '긴급보호', '응급안전안심'],
    '긴급': ['긴급돌봄', '긴급보호', '긴급출동'],
    '위험': ['응급안전안심', '긴급보호', '안전'],
    '사고': ['부상', '긴급돌봄', '응급안전안심'],
    '응급': ['응급안전안심', '긴급출동', '119자동신고'],
    '쓰러': ['응급안전안심', '긴급출동'],
    '넘어': ['응급안전안심', '긴급돌봄', '부상'],
    // 대상자 관련
    '어르신': ['노인맞춤돌봄', '독거노인', '취약노인'],
    '노인': ['노인맞춤돌봄', '독거노인', '취약노인', '방문요양'],
    '할머니': ['노인맞춤돌봄', '독거노인', '돌봄'],
    '할아버지': ['노인맞춤돌봄', '독거노인', '돌봄'],
    '장애': ['장애인복지', '장애인보조기기', '활동지원사교육'],
    '아이': ['어린이집', '보육', '아이중심교육'],
    '아기': ['어린이집', '보육'],
    '어린이': ['어린이집', '보육', '아이중심교육'],
    '육아': ['어린이집', '보육', '더불어돌봄'],
    // 서비스 유형 관련
    '도움': ['돌봄', '지원', '상담지원'],
    '도와': ['돌봄', '지원', '상담지원'],
    '돌봄': ['돌봄', '긴급돌봄', '통합돌봄', '방문요양'],
    '돌봐': ['돌봄', '긴급돌봄', '방문요양'],
    '집': ['재가', '방문요양', '방문의료', '일상돌봄'],
    '방문': ['방문요양', '방문목욕', '방문의료'],
    '요양': ['방문요양', '장기요양기관', '돌봄'],
    '가사': ['가사지원', '일상돌봄'],
    '청소': ['가사지원', '일상돌봄'],
    '밥': ['가사지원', '일상돌봄', '돌봄'],
    '식사': ['가사지원', '일상돌봄'],
    '목욕': ['방문목욕', '돌봄'],
    '씻기': ['방문목욕', '돌봄'],
    '학대': ['피해장애인', '장애인학대보호', '긴급보호'],
    '폭력': ['피해장애인', '장애인학대보호', '긴급보호'],
    '피해': ['피해장애인', '긴급보호', '사회복귀지원'],
    '일자리': ['직업재활', '취업'],
    '직업': ['직업재활'],
    '취업': ['직업재활'],
    // 기술/장비 관련
    '스마트폰': ['스마트폰앱', 'AI돌봄', '스마트케어'],
    '앱': ['스마트폰앱', 'AI돌봄'],
    '기기': ['보조기기', '장애인보조기기', '댁내장비'],
    '보조기기': ['보조기기', '장애인보조기기', '기기대여'],
    '안심': ['응급안전안심', '안부확인', '고독사예방'],
};

// 검색어 유의어 확장
function expandSearchTerms(searchTerms) {
    const expanded = new Set();
    searchTerms.forEach(term => {
        // 정확히 매칭되는 키
        if (synonymMap[term]) {
            synonymMap[term].forEach(syn => expanded.add(syn));
        }
        // 부분 매칭: 검색어가 synonymMap 키를 포함하거나, 키가 검색어를 포함
        for (const [key, synonyms] of Object.entries(synonymMap)) {
            if (key !== term && (term.includes(key) || key.includes(term)) && term.length >= 2) {
                synonyms.forEach(syn => expanded.add(syn));
            }
        }
    });
    // 원래 searchTerms와 중복되는 것은 제외
    searchTerms.forEach(t => expanded.delete(t));
    return [...expanded];
}

function loadWelfareKB() {
    try {
        if (fs.existsSync(KB_FILE)) {
            const content = fs.readFileSync(KB_FILE, 'utf-8').replace(/^\uFEFF/, '');
            const lines = content.split('\n').filter(line => line.trim());
            const headers = parseCSVLine(lines[0]);

            welfareKB = lines.slice(1).map(line => {
                const fields = parseCSVLine(line);
                if (fields.length < headers.length) return null;
                const row = {};
                headers.forEach((header, i) => {
                    row[header] = (fields[i] || '').trim();
                });
                return row;
            }).filter(Boolean);
            console.log(`Loaded ${welfareKB.length} welfare service records.`);
        }
    } catch (e) {
        console.error("Error loading Welfare KB:", e);
    }
}

loadWelfareKB();

// ── API Routes ──

// 정적 파일 서빙 및 메인 화면 라우트
app.use(express.static(path.join(__dirname, 'stitch')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'stitch', 'code.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'stitch', 'admin.html')));
app.get('/favicon.ico', (req, res) => res.status(204).end());
app.use('/.well-known', (req, res) => res.status(200).end());

// Noma 챗봇 API (대국민 복지 상담 전용)
app.post('/api/chat', async (req, res) => {
    const { messages, systemPrompt, pageContext } = req.body;
    if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: "messages array required" });
    }
    const lastUserMessage = messages[messages.length - 1]?.content || "";

    // RAG: Search relevant services (한국어 조사 제거 + 복합어 분해 + 유의어 확장 + 관련도 스코어링)
    const rawWords = lastUserMessage.split(/[\s,?!.]+/).filter(w => w.length > 1);
    const searchTerms = [...new Set([
        ...rawWords.map(w => stripKoreanSuffixes(w)).filter(w => w.length > 1),
        // 어미 제거로 사라진 단어 중 synonymMap에 있는 원형 복구 (예: "아이" → "아"로 잘못 제거 방지)
        ...rawWords.filter(w => synonymMap[w] && !rawWords.map(r => stripKoreanSuffixes(r)).filter(r => r.length > 1).includes(w))
    ])];

    // 유의어/개념 확장: 일상어 → 지식베이스 키워드
    const expandedTerms = expandSearchTerms(searchTerms);

    // 복합어 분해: 4글자 이상 단어를 2글자 서브텀으로 분해 (슬라이딩 윈도우)
    const subTerms = new Set();
    searchTerms.forEach(term => {
        if (term.length >= 4) {
            for (let i = 0; i + 2 <= term.length; i++) {
                subTerms.add(term.substring(i, i + 2));
            }
        }
    });
    searchTerms.forEach(t => subTerms.delete(t));
    expandedTerms.forEach(t => subTerms.delete(t));
    const subTermsArray = [...subTerms].filter(t => t.length >= 2);

    const scoredServices = welfareKB.map(service => {
        let score = 0;
        const name = service['사업명'] || '';
        const keywords = service['키워드 태그'] || '';
        const content = service['지원 내용'] || '';
        const target = service['지원 대상'] || '';
        searchTerms.forEach(term => {
            if (name.includes(term)) score += 3;       // 사업명 일치 가중치 높음
            if (keywords.includes(term)) score += 2;   // 키워드 태그
            if (target.includes(term)) score += 1;     // 지원 대상
            if (content.includes(term)) score += 1;    // 지원 내용
        });
        // 유의어 확장 매칭 (원래 가중치 × 0.7)
        expandedTerms.forEach(term => {
            if (name.includes(term)) score += 3 * 0.7;
            if (keywords.includes(term)) score += 2 * 0.7;
            if (target.includes(term)) score += 1 * 0.7;
            if (content.includes(term)) score += 1 * 0.7;
        });
        // 서브텀 매칭 (복합어 분해 결과, 낮은 가중치)
        subTermsArray.forEach(term => {
            if (name.includes(term)) score += 1.5;
            if (keywords.includes(term)) score += 1;
            if (target.includes(term)) score += 0.5;
            if (content.includes(term)) score += 0.5;
        });
        return { service, score };
    }).filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    // 최고 점수의 30% 미만인 서비스는 제외 (노이즈 필터링)
    const topScore = scoredServices.length > 0 ? scoredServices[0].score : 0;
    const filteredServices = scoredServices.filter(s => s.score >= topScore * 0.3);

    console.log(`[RAG] 검색어: [${searchTerms.join(', ')}]${expandedTerms.length > 0 ? ' 확장: [' + expandedTerms.join(', ') + ']' : ''}${subTermsArray.length > 0 ? ' 서브텀: [' + subTermsArray.join(', ') + ']' : ''} → ${filteredServices.length}건 매칭${filteredServices.length > 0 ? ': ' + filteredServices.map(s => `${s.service['사업명']}(${s.score})`).join(', ') : ''}`);

    // Analytics tracking
    analyticsStore.track('chat_request');
    if (pageContext?.voice) analyticsStore.track('chat_voice');
    if (filteredServices.length > 0) analyticsStore.track('rag_match');
    else analyticsStore.track('rag_no_match');

    let ragContext = "";
    if (filteredServices.length > 0) {
        ragContext = "\n\n[지식베이스 검색 결과 - 관련도 순으로 정렬됨. 관련도가 높은 서비스를 우선 추천하세요.]\n";
        filteredServices.forEach((s, i) => {
            const svc = s.service;
            const stars = s.score >= topScore * 0.8 ? '★★★' : s.score >= topScore * 0.5 ? '★★' : '★';
            ragContext += `${i + 1}. [관련도: ${stars}] 사업명: ${svc['사업명']}\n   - 요약: ${svc['지원 내용'].slice(0, 100)}...\n   - 대상: ${svc['지원 대상']}\n   - 방법: ${svc['신청 방법']}\n   - 혜택: ${svc['지원 내용']}\n   - 담당: ${svc['문의처']}\n\n`;
        });
    }

    try {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Connection': 'keep-alive',
            'Cache-Control': 'no-cache'
        });

        // ── 즉시 공감 응답 (filler): Gemini 호출 전에 먼저 전송 ──
        const lastUserMsg = messages.length > 0 ? messages[messages.length - 1].content : '';
        let fillerText = '네, 말씀 잘 들었어요. 맞춤 서비스를 찾아보고 있어요...';

        const healthKeywords = ['아프', '아파', '병', '아프다', '다쳐', '다치', '수술', '입원', '퇴원', '치매', '건강', '간호', '간병', '약', '병원', '몸'];
        const lonelyKeywords = ['외롭', '외로', '혼자', '우울', '힘들', '걱정', '무섭'];
        const urgentKeywords = ['급해', '긴급', '위험', '사고', '응급', '쓰러', '넘어'];

        if (urgentKeywords.some(k => lastUserMsg.includes(k))) {
            fillerText = '급하신 상황이시군요. 빠르게 확인해 드릴게요...';
        } else if (healthKeywords.some(k => lastUserMsg.includes(k))) {
            fillerText = '아, 많이 불편하시겠어요. 관련 서비스를 찾아보고 있어요...';
        } else if (lonelyKeywords.some(k => lastUserMsg.includes(k))) {
            fillerText = '혼자 계시면 걱정되시죠. 도움될 수 있는 서비스를 찾아볼게요...';
        }

        res.write(`data: ${JSON.stringify({ type: 'filler', text: fillerText })}\n\n`);

        const defaultSystemPrompt = `당신은 경상남도사회서비스원의 AI 맞춤형 복지 내비게이터 '노마(Noma)'입니다.
도민의 어려움을 듣고, 가장 적합한 복지 서비스를 친절하게 안내하는 것이 당신의 유일한 역할입니다.

[페르소나]
- 이름: 노마(Noma)
- 성격: 따뜻하고 친근한 이웃 같은 복지 상담원
- 말투: 존댓말, 쉬운 일상어. 어려운 행정 용어는 절대 사용하지 마세요.
- 대상: 일반 도민, 고령자, 정보 취약계층

[음성 인식 보정]
- 사용자 입력은 음성 인식(STT)으로 들어올 수 있어서 오타나 동음이의어 오류가 있을 수 있습니다.
- 복지 상담 맥락에 맞게 자연스럽게 해석하세요. 예: "축구 외로워" → "춥고 외로워", "퇴원 후 이로워" → "퇴원 후 외로워"
- 명백한 음성 인식 오류는 무시하고, 사용자가 의도한 의미를 파악하여 답변하세요.

[상담 원칙]
1. 사용자의 어려움에 먼저 공감하고, 그 다음에 서비스를 안내하세요.
2. [Strict Grounding] 복지 서비스를 추천할 때는 반드시 아래 [지식베이스 검색 결과]에 근거해서만 답변하세요. 지식베이스에 없는 서비스를 절대 지어내지 마세요.
3. 지식베이스에 관련 서비스가 없으면, 경상남도사회서비스원 대표번호 055-230-8200으로 전화 문의를 안내하세요.
4. 사용자가 추가 질문을 할 수 있도록 대화를 이어가세요.
5. 개발, 코딩, 시스템, 버그 등 기술적인 질문에는 절대 답변하지 마세요. "저는 복지 서비스 안내만 도와드릴 수 있어요"라고 안내하세요.

[인사 및 일상 대화 처리]
- 사용자가 인사("안녕", "안녕하세요", "반가워요", "하이" 등)를 하면, 따뜻하게 인사를 받고 어떤 도움이 필요한지 물어보세요.
  예: "안녕하세요! 경상남도사회서비스원 AI 복지 내비게이터 노마입니다. 어떤 어려움이 있으신지 말씀해 주시면, 맞춤 복지 서비스를 찾아드릴게요!"
- 이모티콘(😊 등)은 절대 사용하지 마세요. 텍스트만으로 따뜻하게 표현하세요.
- 인사에는 서비스를 검색하거나 "관련 서비스를 찾을 수 없다"고 답하지 마세요. 자연스러운 대화로 응대하세요.
- 감사 표현("고마워요", "감사합니다")이나 작별 인사("잘 가요", "다음에 또 올게요")에도 자연스럽게 응대하세요.

[정보 수집 프레임워크]
대화를 통해 아래 정보를 자연스럽게 파악하세요. 설문조사처럼 나열하지 말고, 공감 사이사이에 한 번에 질문 1개씩만 자연스럽게 녹여 넣으세요.

필수 정보 (대화 초반 2~3턴 내 파악):
- 성함 (예: "어떻게 불러드리면 될까요?")
- 연령대 (예: "혹시 연세가 어떻게 되실까요?")
- 거주지 시/군 (예: "경남 어디에 살고 계신가요?")

상황 정보 (대화 중반, 자연스럽게):
- 독거 여부 (예: "지금 혼자 살고 계신가요?")
- 장애/질병 유무
- 수급자 여부

심화 정보 (필요 시):
- 현재 가장 어려운 점
- 현재 이용 중인 서비스
- 긴급도 (일상적 불편 vs 즉각 도움 필요)

규칙:
- 한 번에 질문은 반드시 1개만 하세요. 여러 질문을 한꺼번에 나열하면 안 됩니다.
- 공감 → 질문 → 추천 순서를 지키세요.
- 사용자가 답변을 회피하면 강요하지 말고 자연스럽게 넘어가세요.
- 이미 파악된 정보는 절대 다시 묻지 마세요.

[넓게 추천 → 좁혀가기 원칙 - 매우 중요]
첫 질문부터 지식베이스에서 관련 서비스를 적극적으로 추천하세요. 대화가 진행될수록 좁혀나갑니다.

1단계 - 첫 질문 (넓은 추천):
- 사용자의 첫 질문에서 키워드를 추출하여 관련 서비스를 2~3개 <noma-card>로 바로 추천하세요.
- 모호한 감정 표현이라도(예: "외로워요", "힘들어요") 관련될 수 있는 서비스가 있다면 함께 보여주세요.
- 추천과 동시에 [정보 수집 프레임워크]의 필수 정보 중 아직 모르는 항목 1개를 자연스럽게 여쭤보세요.

2단계 - 후속 대화 (좁혀가기):
- 사용자의 답변을 바탕으로 가장 적합한 1~2개 서비스로 좁혀서 다시 안내하세요.
- [정보 수집 프레임워크]에서 아직 파악되지 않은 정보를 1개씩 자연스럽게 수집하세요.
- 이미 파악된 정보는 다시 묻지 마세요.
- 정보가 충분하면 최종 추천을 하고, 신청 방법을 구체적으로 안내하세요.

규칙:
- 첫 질문에서도 지식베이스 검색 결과가 있으면 반드시 서비스를 추천하세요. 질문만 하고 추천을 미루지 마세요.
- 사용자가 답변할 때마다 공감 표현을 곁들이세요.
- 지식베이스 검색 결과에서 관련도(★)가 높은 서비스를 우선 추천하세요.

[응답 포맷 - 서비스 추천 시 반드시 아래 형식 사용]
<noma-card>
{
  "serviceName": "사업명",
  "summary": "한 줄 요약",
  "target": "지원 대상",
  "method": "신청 방법",
  "benefits": "주요 혜택",
  "agency": "문의처"
}
</noma-card>

[대화형 상담 신청 응답 포맷]
사용자가 대화 중 신청을 완료하면, 아래 형식으로 출력하세요:
<noma-apply>
{
  "serviceName": "신청할 사업명",
  "userName": "사용자 성함",
  "userPhone": "010-0000-0000",
  "userAge": "연령대",
  "userArea": "거주지역",
  "livingCondition": "가구 구성",
  "mainConcern": "주요 상황"
}
</noma-apply>

[대화형 상담 신청 흐름]
사용자가 "신청하고 싶어요", "담당자 연결해 주세요", "상담 신청할게요" 등의 의사를 밝히면 아래 단계를 따르세요.

1단계 - 신청 대상 서비스 확인:
- 직전 대화에서 추천한 서비스가 있으면 자동 선택하고 확인을 구합니다.
- 여러 서비스가 추천된 경우, 어떤 서비스를 신청할지 여쭤보세요.
- 예: "네, 그럼 '노인맞춤돌봄서비스' 상담을 신청해 드릴까요?"

2단계 - 성함 확인 (한 번에 1개만 질문):
- 이전 대화에서 이미 성함을 파악했다면 다시 묻지 마세요.
- 예: "상담 신청을 위해 성함을 알려주시겠어요?"

3단계 - 연령대 확인 (한 번에 1개만 질문):
- 이전 대화에서 이미 파악했다면 스킵하세요.
- 예: "혹시 연세가 어떻게 되시나요?"

4단계 - 거주지역 확인 (한 번에 1개만 질문):
- 이전 대화에서 이미 파악했다면 스킵하세요.
- 예: "어디 지역에 살고 계세요?"

5단계 - 가구 구성 확인 (한 번에 1개만 질문):
- 이전 대화에서 이미 파악했다면 스킵하세요.
- 예: "혼자 살고 계신가요, 아니면 가족과 함께 계신가요?"

6단계 - 전화번호 확인 (한 번에 1개만 질문):
- 예: "연락받으실 전화번호도 알려주시겠어요?"

7단계 - 확인 문구 + 태그 출력:
- 필수 3개 필드(serviceName, userName, userPhone)가 모두 확보되면 확인 문구와 함께 <noma-apply> 태그를 출력합니다.
- 예: "김영희님, '노인맞춤돌봄서비스' 상담을 010-1234-5678로 신청해 드리겠습니다."

규칙:
- serviceName, userName, userPhone 3개 필드가 모두 있어야만 <noma-apply>를 출력하세요. 하나라도 없으면 절대 출력하지 마세요.
- userAge, userArea, livingCondition, mainConcern은 선택 필드입니다. 대화에서 파악되지 않았으면 "미확인"으로 넣으세요.
- 대화 중 이미 파악된 정보는 다시 묻지 마세요. 예: 사용자가 "혼자 살아요"라고 했으면 가구 구성을 다시 묻지 않고 "독거"로 기록하세요.
- mainConcern은 대화 초반에 사용자가 설명한 어려움을 짧게 정리하세요 (예: "퇴원 후 돌봄 필요", "경제적 어려움").
- 응답 1개당 <noma-apply>는 최대 1개만 출력하세요.
- 전화번호는 숫자와 하이픈만 남기고 정리하세요 (예: "공일공 1234 5678" → "010-1234-5678").
- 한국 전화번호 형식(010-XXXX-XXXX, 055-XXX-XXXX 등)이 아니면 다시 여쭤보세요.

[중요]
- 한 번에 너무 많은 정보를 주지 말고, 가장 적합한 1~2개 서비스만 추천하세요.`;

        const systemInstructionString = systemPrompt || defaultSystemPrompt;

        // Build conversation contents: RAG context + user messages
        const userPrompt = ragContext + "\n\n" +
            messages.map(m => `${m.role === 'user' ? 'User' : 'Noma'}: ${m.content}`).join("\n");

        // 429 대비 재시도 (최대 2회, 지수 백오프)
        let lastError = null;
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                const responseStream = await ai.models.generateContentStream({
                    model: "gemini-2.5-flash",
                    contents: userPrompt,
                    config: {
                        systemInstruction: systemInstructionString,
                        temperature: 0.2,
                    }
                });

                for await (const chunk of responseStream) {
                    if (chunk.text) {
                        res.write(`data: ${JSON.stringify({ type: 'stream', text: chunk.text })}\n\n`);
                    }
                }

                res.write(`data: [DONE]\n\n`);
                res.end();
                return; // 성공 시 종료
            } catch (e) {
                lastError = e;
                const is429 = e.message && e.message.includes('429');
                if (is429 && attempt < 2) {
                    console.warn(`[Chat] 429 rate limit, retrying in ${attempt * 3}s... (attempt ${attempt})`);
                    await new Promise(r => setTimeout(r, attempt * 3000));
                    continue;
                }
                break;
            }
        }

        // 모든 시도 실패
        const errMsg = lastError?.message || '';
        console.error("Chat Error:", errMsg);
        const is429 = errMsg.includes('429');
        const userMsg = is429
            ? "요청이 너무 많아 잠시 제한되었습니다. 10초 후 다시 시도해 주세요."
            : "AI 응답 중 오류가 발생했습니다.";
        res.write(`data: ${JSON.stringify({ type: 'error', error: userMsg })}\n\n`);
        res.write(`data: [DONE]\n\n`);
        res.end();
    } catch (e) {
        console.error("Chat Fatal Error:", e.message);
        res.write(`data: ${JSON.stringify({ type: 'error', error: "AI 응답 중 오류가 발생했습니다." })}\n\n`);
        res.write(`data: [DONE]\n\n`);
        res.end();
    }
});

// ── Browse All Services API ──
app.get('/api/services', (req, res) => {
    const grouped = {};
    const categoryMeta = {
        '공공돌봄': { icon: 'favorite', color: '#E91E63', desc: '돌봄이 필요한 분들을 위한 공공 지원 서비스' },
        '민간지원': { icon: 'handshake', color: '#1565C0', desc: '민간 기관 역량 강화 및 품질 관리 지원' },
        '국공립시설': { icon: 'account_balance', color: '#2E7D32', desc: '도립 복지시설 운영 서비스' },
    };

    welfareKB.forEach(service => {
        const cat = service['대분류'] || '기타';
        if (!grouped[cat]) {
            const meta = categoryMeta[cat] || { icon: 'category', color: '#666', desc: '' };
            grouped[cat] = { category: cat, ...meta, services: [] };
        }
        grouped[cat].services.push({
            name: service['사업명'],
            summary: (service['지원 내용'] || '').slice(0, 80) + '...',
            target: service['지원 대상'],
            method: service['신청 방법'],
            benefits: service['지원 내용'],
            agency: service['문의처'],
            keywords: service['키워드 태그'],
        });
    });

    res.json(Object.values(grouped));
});

// ── Service Request API (실제 이메일 발송) ──
const emailTransporter = nodemailer.createTransport({
    host: 'smtp.naver.com',
    port: 465,
    secure: true,
    auth: {
        user: process.env.SMTP_USER,       // vusky@naver.com
        pass: process.env.SMTP_PASSWORD,    // 네이버 비밀번호
    },
});

// 개발 단계: 받는 주소 하드코딩 (운영 시 기관별 매핑으로 교체)
const DEV_RECIPIENT = 'shinyongki71@gmail.com';

// ── 대화 요약 생성 (Gemini 비스트리밍 호출) ──
async function summarizeChatHistory(chatHistory) {
    if (!chatHistory || chatHistory.length < 2) return null;

    const conversationText = chatHistory
        .map(m => `${m.role === 'user' ? '이용자' : '노마'}: ${m.content}`)
        .join('\n');

    const summaryPrompt = `아래는 복지 상담 AI '노마'와 이용자의 대화 내용입니다.
담당자가 빠르게 파악할 수 있도록 아래 형식으로 요약해주세요.
파악되지 않은 항목은 "미확인"으로 표시하세요.

[요약 형식]
- 이용자 기본정보: (성함, 연령대, 거주지, 성별)
- 생활상황: (독거 여부, 가족 구성 등)
- 주요 어려움: (이용자가 호소한 문제)
- 이용 중 서비스: (현재 받고 있는 서비스)
- 긴급도: (일상적 불편 / 빠른 도움 필요 / 긴급)
- 추천된 서비스: (대화에서 추천된 서비스명)

[대화 내용]
${conversationText}`;

    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const result = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: summaryPrompt,
                config: {
                    systemInstruction: "복지 상담 대화를 간결하게 요약하는 전문가입니다. 요약만 출력하세요.",
                    temperature: 0.1,
                }
            });
            return result.text || null;
        } catch (e) {
            const is429 = e.message && e.message.includes('429');
            if (is429 && attempt < 2) {
                console.warn(`[요약] 429 rate limit, 3초 후 재시도...`);
                await new Promise(r => setTimeout(r, 3000));
                continue;
            }
            console.error('[요약 생성 실패]', e.message);
            return null;
        }
    }
    return null;
}

app.post('/api/service-request/connect', async (req, res) => {
    const { serviceName, userName, userPhone, chatHistory } = req.body;

    // 디버그: 수신 데이터 확인
    console.log('[수신 데이터]', JSON.stringify({ serviceName, userName, userPhone, chatHistoryLength: chatHistory?.length || 0 }));

    // 대화 요약 생성 (실패해도 이메일은 정상 발송)
    let conversationSummary = null;
    if (chatHistory && chatHistory.length >= 2) {
        conversationSummary = await summarizeChatHistory(chatHistory);
        if (conversationSummary) {
            console.log('[대화 요약 생성 완료]');
        }
    }

    // 요청 ID 생성 및 저장
    analyticsStore.track('service_apply');
    const requestId = crypto.randomUUID();
    const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    requestStore.save({
        id: requestId,
        serviceName,
        userName,
        userPhone,
        createdAt: now,
        createdAtISO: new Date().toISOString(),
        status: 'open',
        referrals: [],
        conversationSummary,
    });

    const subject = `[상담 신청] ${serviceName} - 노마 AI 복지 내비게이터`;
    const caseUrl = `${BASE_URL}/case/${requestId}`;
    const referralUrl = `${BASE_URL}/referral/${requestId}`;
    const htmlContent = buildServiceRequestEmailHTML({ serviceName, userName, userPhone, now, caseUrl, referralUrl, conversationSummary });

    try {
        await emailTransporter.sendMail({
            from: { name: '노마 AI', address: process.env.SMTP_USER },
            to: DEV_RECIPIENT,
            subject,
            html: { content: Buffer.from(htmlContent, 'utf-8'), contentType: 'text/html; charset=utf-8' },
        });
        console.log(`[이메일 발송 완료] ${serviceName} → ${DEV_RECIPIENT} (ID: ${requestId})`);
        res.json({ success: true, message: "이메일 알림 발송 완료" });
    } catch (err) {
        console.error('[이메일 발송 실패]', err.message);
        res.status(500).json({ success: false, message: "이메일 발송에 실패했습니다." });
    }
});

// 상담 신청 이메일 HTML 빌더
function buildServiceRequestEmailHTML({ serviceName, userName, userPhone, now, caseUrl, referralUrl, conversationSummary }) {
    // HTML 이스케이프
    const esc = (str) => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const summarySection = conversationSummary ? [
        '<div style="margin-top:24px;padding:20px;background:#F3E5F5;border-left:4px solid #7B1FA2;border-radius:4px;">',
        '<p style="margin:0 0 10px;font-size:14px;color:#7B1FA2;font-weight:bold;">AI 대화 요약</p>',
        '<p style="margin:0;font-size:14px;color:#333;white-space:pre-line;line-height:1.7;">' + esc(conversationSummary) + '</p>',
        '</div>',
    ].join('\n') : '';

    return [
        '<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head><body>',
        '<div style="font-family:Malgun Gothic,Apple SD Gothic Neo,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e5e5e5;border-radius:12px;overflow:hidden;">',
        '<div style="background:linear-gradient(135deg,#98002E,#4A1942);padding:24px 28px;color:white;">',
        '<h2 style="margin:0;font-size:20px;">노마 AI 복지 내비게이터</h2>',
        '<p style="margin:8px 0 0;opacity:0.85;font-size:14px;">신규 상담 요청이 접수되었습니다</p>',
        '</div>',
        '<div style="padding:28px;">',
        '<table style="width:100%;border-collapse:collapse;font-size:15px;">',
        '<tr><td style="padding:10px 0;color:#666;width:110px;">신청 서비스</td><td style="padding:10px 0;font-weight:bold;">' + esc(serviceName) + '</td></tr>',
        '<tr style="border-top:1px solid #f0f0f0;"><td style="padding:10px 0;color:#666;">신청자 성함</td><td style="padding:10px 0;font-weight:bold;">' + esc(userName) + '</td></tr>',
        '<tr style="border-top:1px solid #f0f0f0;"><td style="padding:10px 0;color:#666;">연락처</td><td style="padding:10px 0;font-weight:bold;">' + esc(userPhone) + '</td></tr>',
        '<tr style="border-top:1px solid #f0f0f0;"><td style="padding:10px 0;color:#666;">유입 경로</td><td style="padding:10px 0;">Noma AI 복지 내비게이터</td></tr>',
        '<tr style="border-top:1px solid #f0f0f0;"><td style="padding:10px 0;color:#666;">접수 일시</td><td style="padding:10px 0;">' + now + '</td></tr>',
        '</table>',
        summarySection,
        // 상담 처리 버튼 (메인 CTA)
        '<div style="margin-top:28px;text-align:center;">',
        '<a href="' + caseUrl + '" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#2E7D32,#1B5E20);color:white;text-decoration:none;border-radius:8px;font-size:15px;font-weight:bold;">상담 처리하기</a>',
        '<p style="margin-top:10px;font-size:12px;color:#999;">대상자에게 연락하고 처리 상태를 업데이트해 주세요.</p>',
        '</div>',
        // 연계 요청 버튼 (보조)
        '<div style="margin-top:12px;text-align:center;">',
        '<a href="' + referralUrl + '" style="display:inline-block;padding:12px 28px;border:2px solid #1565C0;color:#1565C0;text-decoration:none;border-radius:8px;font-size:14px;font-weight:bold;">타 서비스 연계 요청</a>',
        '</div>',
        '<div style="margin-top:24px;padding:16px;background:#f8f5f2;border-radius:8px;font-size:13px;color:#666;">',
        '2~3일 내로 위 연락처로 회신 부탁드립니다.',
        '</div></div></div></body></html>',
    ].join('\n');
}

// ── 서비스 연계 요청 시스템 ──

// 담당자 처리 페이지 서빙
app.get('/case/:requestId', (req, res) => {
    res.sendFile(path.join(__dirname, 'stitch', 'case.html'));
});

// 연계 폼 페이지 서빙
app.get('/referral/:requestId', (req, res) => {
    res.sendFile(path.join(__dirname, 'stitch', 'referral.html'));
});

// 연계 폼에서 사용할 요청 데이터 + 서비스 목록 반환
app.get('/api/referral/:requestId', (req, res) => {
    const request = requestStore.findById(req.params.requestId);
    if (!request) return res.status(404).json({ error: '요청을 찾을 수 없습니다.' });

    // 서비스 목록 (대분류별 그룹화)
    const grouped = {};
    welfareKB.forEach(svc => {
        const cat = svc['대분류'] || '기타';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push({
            name: svc['사업명'],
            agency: svc['문의처'],
        });
    });

    res.json({ request, services: grouped });
});

// 연계 이메일 발송
app.post('/api/referral/:requestId/send', async (req, res) => {
    const { targetService, reason } = req.body;
    const request = requestStore.findById(req.params.requestId);
    if (!request) return res.status(404).json({ error: '요청을 찾을 수 없습니다.' });

    // 새 요청 ID (연쇄 연계용)
    analyticsStore.track('referral_sent');
    const newRequestId = crypto.randomUUID();
    const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

    // 새 요청으로 저장 (연쇄 연계 가능하도록)
    requestStore.save({
        id: newRequestId,
        serviceName: targetService,
        userName: request.userName,
        userPhone: request.userPhone,
        createdAt: now,
        createdAtISO: new Date().toISOString(),
        status: 'referred',
        referredFrom: request.id,
        referrals: [],
    });

    // 원래 요청에 연계 기록 추가
    requestStore.addReferral(req.params.requestId, {
        targetService,
        reason,
        newRequestId,
        sentAt: now,
    });

    const subject = `[서비스 연계] ${targetService} ← ${request.serviceName} - 노마 AI`;
    const html = buildReferralEmailHTML({ request, targetService, reason, newRequestId });

    try {
        await emailTransporter.sendMail({
            from: { name: '노마 AI', address: process.env.SMTP_USER },
            to: DEV_RECIPIENT,
            subject,
            html: { content: Buffer.from(html, 'utf-8'), contentType: 'text/html; charset=utf-8' },
        });
        console.log(`[연계 발송 완료] ${request.serviceName} → ${targetService} (${DEV_RECIPIENT})`);
        res.json({ success: true, message: '연계 이메일 발송 완료' });
    } catch (err) {
        console.error('[연계 발송 실패]', err.message);
        res.status(500).json({ success: false, message: '연계 이메일 발송에 실패했습니다.' });
    }
});

// 연계 이메일 HTML 빌더
function buildReferralEmailHTML({ request, targetService, reason, newRequestId }) {
    const caseUrl = `${BASE_URL}/case/${newRequestId}`;
    const referralUrl = `${BASE_URL}/referral/${newRequestId}`;
    return [
        '<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head><body>',
        '<div style="font-family:Malgun Gothic,Apple SD Gothic Neo,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e5e5e5;border-radius:12px;overflow:hidden;">',
        // 파란색 헤더 (상담 메일의 빨강과 구분)
        '<div style="background:linear-gradient(135deg,#1565C0,#0D47A1);padding:24px 28px;color:white;">',
        '<h2 style="margin:0;font-size:20px;">노마 AI 복지 내비게이터</h2>',
        '<p style="margin:8px 0 0;opacity:0.85;font-size:14px;">타 서비스 연계 요청이 접수되었습니다</p>',
        '</div>',
        '<div style="padding:28px;">',
        // 연계 사유 배너 (주황색)
        '<div style="margin-bottom:24px;padding:16px;background:#FFF3E0;border-left:4px solid #FF9800;border-radius:4px;">',
        '<p style="margin:0 0 4px;font-size:13px;color:#E65100;font-weight:bold;">연계 사유</p>',
        '<p style="margin:0;font-size:14px;color:#333;">' + reason + '</p>',
        '</div>',
        // 연계 대상 서비스
        '<div style="margin-bottom:20px;padding:14px;background:#E3F2FD;border-radius:8px;">',
        '<p style="margin:0;font-size:13px;color:#1565C0;">연계 대상 서비스</p>',
        '<p style="margin:6px 0 0;font-size:17px;font-weight:bold;color:#0D47A1;">' + targetService + '</p>',
        '</div>',
        // 원래 요청 정보
        '<p style="font-size:13px;color:#666;margin-bottom:8px;">원래 상담 요청 정보</p>',
        '<table style="width:100%;border-collapse:collapse;font-size:14px;">',
        '<tr><td style="padding:8px 0;color:#666;width:110px;">원래 서비스</td><td style="padding:8px 0;font-weight:bold;">' + request.serviceName + '</td></tr>',
        '<tr style="border-top:1px solid #f0f0f0;"><td style="padding:8px 0;color:#666;">신청자 성함</td><td style="padding:8px 0;font-weight:bold;">' + request.userName + '</td></tr>',
        '<tr style="border-top:1px solid #f0f0f0;"><td style="padding:8px 0;color:#666;">연락처</td><td style="padding:8px 0;font-weight:bold;">' + request.userPhone + '</td></tr>',
        '<tr style="border-top:1px solid #f0f0f0;"><td style="padding:8px 0;color:#666;">최초 접수 일시</td><td style="padding:8px 0;">' + request.createdAt + '</td></tr>',
        '</table>',
        // 상담 처리 버튼 (메인 CTA)
        '<div style="margin-top:28px;text-align:center;">',
        '<a href="' + caseUrl + '" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#2E7D32,#1B5E20);color:white;text-decoration:none;border-radius:8px;font-size:15px;font-weight:bold;">상담 처리하기</a>',
        '<p style="margin-top:10px;font-size:12px;color:#999;">대상자에게 연락하고 처리 상태를 업데이트해 주세요.</p>',
        '</div>',
        // 연쇄 연계 버튼 (보조)
        '<div style="margin-top:12px;text-align:center;">',
        '<a href="' + referralUrl + '" style="display:inline-block;padding:12px 28px;border:2px solid #1565C0;color:#1565C0;text-decoration:none;border-radius:8px;font-size:14px;font-weight:bold;">타 서비스 연계 요청</a>',
        '</div>',
        '<div style="margin-top:24px;padding:16px;background:#f8f5f2;border-radius:8px;font-size:13px;color:#666;">',
        '2~3일 내로 위 연락처로 회신 부탁드립니다.',
        '</div></div></div></body></html>',
    ].join('\n');
}

// ── Edge TTS API (Microsoft Neural Voice) ──
async function synthesizeTTS(text, retries = 2) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const tts = new EdgeTTS();
            await tts.synthesize(text, 'ko-KR-SunHiNeural', { rate: '+0%', pitch: '+0Hz' });
            const audioBase64 = tts.toBase64();
            if (audioBase64 && audioBase64.length > 100) return audioBase64;
            console.warn(`[TTS] Attempt ${attempt}: empty audio, retrying...`);
        } catch (e) {
            console.warn(`[TTS] Attempt ${attempt} error: ${e.message}`);
        }
    }
    return null;
}

app.post('/api/tts', async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'text required' });
    analyticsStore.track('tts_request');

    try {
        const audioBase64 = await synthesizeTTS(text);
        if (audioBase64) {
            res.json({ audioContent: audioBase64 });
        } else {
            res.status(500).json({ error: 'TTS synthesis failed after retries' });
        }
    } catch (e) {
        console.error('[TTS] Error:', e.message);
        res.status(500).json({ error: 'TTS request failed' });
    }
});

// ── Case API Routes (담당자 처리 페이지용) ──

// 상세 조회 + 연계 체인
app.get('/api/case/:requestId', (req, res) => {
    const request = requestStore.findById(req.params.requestId);
    if (!request) return res.status(404).json({ error: '요청을 찾을 수 없습니다.' });
    const chain = requestStore.getReferralChain(req.params.requestId);
    res.json({ ...request, chain });
});

// 상태 변경 (전진만 허용)
app.patch('/api/case/:requestId/status', (req, res) => {
    const { status } = req.body;
    const STEPS = ['open', 'confirmed', 'contacted', 'connected', 'closed'];
    const request = requestStore.findById(req.params.requestId);
    if (!request) return res.status(404).json({ error: '요청을 찾을 수 없습니다.' });

    const currentIdx = STEPS.indexOf(request.status);
    const targetIdx = STEPS.indexOf(status);
    if (targetIdx === -1) return res.status(400).json({ error: '유효하지 않은 상태입니다.' });
    if (targetIdx <= currentIdx) return res.status(400).json({ error: '이전 단계로 되돌릴 수 없습니다.' });

    const updated = requestStore.updateStatus(req.params.requestId, status);
    res.json(updated);
});

// 메모 추가 (author: '담당자')
app.post('/api/case/:requestId/notes', (req, res) => {
    const { note } = req.body;
    if (!note || !note.trim()) return res.status(400).json({ error: '메모 내용을 입력하세요.' });
    const updated = requestStore.addNote(req.params.requestId, note.trim(), '담당자');
    if (!updated) return res.status(404).json({ error: '요청을 찾을 수 없습니다.' });
    res.json(updated);
});

// ── 부서간 협업 API ──

// 부서 이름 조회 헬퍼
function getDeptName(id) {
    const dept = requestStore.DEPARTMENTS.find(d => d.id === id);
    return dept ? dept.name : id;
}

// 협업 이메일 HTML 빌더
function buildCollaborationEmailHTML({ request, collab, fromDeptName, toDeptName, typeName, caseUrl }) {
    const esc = (str) => String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const typeColors = { consultation: '#FF9800', joint: '#1565C0', transfer: '#7B1FA2' };
    const typeColor = typeColors[collab.type] || '#666';

    return [
        '<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head><body>',
        '<div style="font-family:Malgun Gothic,Apple SD Gothic Neo,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e5e5e5;border-radius:12px;overflow:hidden;">',
        // 인디고 헤더 (협업 전용)
        '<div style="background:linear-gradient(135deg,#3949AB,#1A237E);padding:24px 28px;color:white;">',
        '<h2 style="margin:0;font-size:20px;">부서간 협업 요청</h2>',
        '<p style="margin:8px 0 0;opacity:0.85;font-size:14px;">경상남도사회서비스원 노마 AI</p>',
        '</div>',
        '<div style="padding:28px;">',
        // 협업 유형 + 방향 배너
        '<div style="margin-bottom:20px;padding:16px;background:#E8EAF6;border-left:4px solid ' + typeColor + ';border-radius:4px;">',
        '<p style="margin:0 0 8px;font-size:13px;color:' + typeColor + ';font-weight:bold;">' + esc(typeName) + '</p>',
        '<p style="margin:0;font-size:18px;font-weight:bold;color:#1A237E;">' + esc(fromDeptName) + ' → ' + esc(toDeptName) + '</p>',
        '</div>',
        // 협업 사유
        '<div style="margin-bottom:20px;padding:14px;background:#FFF3E0;border-radius:8px;">',
        '<p style="margin:0 0 4px;font-size:13px;color:#E65100;font-weight:bold;">협업 사유</p>',
        '<p style="margin:0;font-size:14px;color:#333;">' + esc(collab.reason) + '</p>',
        '</div>',
        // 원래 상담 정보
        '<p style="font-size:13px;color:#666;margin-bottom:8px;">관련 상담 요청 정보</p>',
        '<table style="width:100%;border-collapse:collapse;font-size:14px;">',
        '<tr><td style="padding:8px 0;color:#666;width:110px;">서비스명</td><td style="padding:8px 0;font-weight:bold;">' + esc(request.serviceName) + '</td></tr>',
        '<tr style="border-top:1px solid #f0f0f0;"><td style="padding:8px 0;color:#666;">신청자 성함</td><td style="padding:8px 0;font-weight:bold;">' + esc(request.userName) + '</td></tr>',
        '<tr style="border-top:1px solid #f0f0f0;"><td style="padding:8px 0;color:#666;">연락처</td><td style="padding:8px 0;font-weight:bold;">' + esc(request.userPhone) + '</td></tr>',
        '</table>',
        // CTA 버튼
        '<div style="margin-top:28px;text-align:center;">',
        '<a href="' + caseUrl + '" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#3949AB,#1A237E);color:white;text-decoration:none;border-radius:8px;font-size:15px;font-weight:bold;">상담 처리 페이지에서 확인</a>',
        '</div>',
        '<div style="margin-top:20px;padding:14px;background:#f8f5f2;border-radius:8px;font-size:13px;color:#666;">',
        '상담 처리 페이지에서 협업 요청을 수락하거나 반려할 수 있습니다.',
        '</div></div></div></body></html>',
    ].join('\n');
}

const COLLAB_TYPE_NAMES = { consultation: '자문 요청', joint: '공동 처리', transfer: '이관 요청' };

// 부서 목록
app.get('/api/departments', (req, res) => {
    res.json(requestStore.DEPARTMENTS);
});

// 협업 요청 생성 (+ 이메일 알림)
app.post('/api/case/:requestId/collaboration', async (req, res) => {
    const { fromDept, toDept, reason, type } = req.body;
    if (!fromDept || !toDept || !reason) {
        return res.status(400).json({ error: '요청 부서, 대상 부서, 사유를 모두 입력하세요.' });
    }
    if (fromDept === toDept) {
        return res.status(400).json({ error: '같은 부서에는 협업 요청할 수 없습니다.' });
    }
    const collab = requestStore.addCollaboration(req.params.requestId, { fromDept, toDept, reason, type });
    if (!collab) return res.status(404).json({ error: '요청을 찾을 수 없습니다.' });

    const fromDeptName = getDeptName(fromDept);
    const toDeptName = getDeptName(toDept);
    const typeName = COLLAB_TYPE_NAMES[type] || '자문 요청';
    console.log(`[협업 요청] ${fromDeptName} → ${toDeptName}: ${reason}`);

    // 이메일 알림 (비동기, 실패해도 응답에 영향 없음)
    const request = requestStore.findById(req.params.requestId);
    if (request) {
        const caseUrl = `${BASE_URL}/case/${req.params.requestId}`;
        const subject = `[협업 요청] ${typeName} - ${fromDeptName} → ${toDeptName}`;
        const html = buildCollaborationEmailHTML({ request, collab, fromDeptName, toDeptName, typeName, caseUrl });
        emailTransporter.sendMail({
            from: { name: '노마 AI', address: process.env.SMTP_USER },
            to: DEV_RECIPIENT,
            subject,
            html: { content: Buffer.from(html, 'utf-8'), contentType: 'text/html; charset=utf-8' },
        }).then(() => {
            console.log(`[협업 이메일 발송 완료] ${fromDeptName} → ${toDeptName}`);
        }).catch(err => {
            console.error('[협업 이메일 발송 실패]', err.message);
        });
    }

    res.json(collab);
});

// 협업 상태 변경 (+ 이메일 알림)
app.patch('/api/case/:requestId/collaboration/:collabId', (req, res) => {
    const { status } = req.body;
    const validStatuses = ['accepted', 'completed', 'declined'];
    if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: '유효하지 않은 상태입니다.' });
    }
    const collab = requestStore.updateCollaboration(req.params.requestId, req.params.collabId, { status });
    if (!collab) return res.status(404).json({ error: '협업 요청을 찾을 수 없습니다.' });

    // 상태 변경 이메일 알림 (비동기, 실패해도 응답에 영향 없음)
    const statusLabels = { accepted: '수락됨', completed: '완료됨', declined: '반려됨' };
    const fromDeptName = getDeptName(collab.fromDept);
    const toDeptName = getDeptName(collab.toDept);
    const statusLabel = statusLabels[status] || status;
    const caseUrl = `${BASE_URL}/case/${req.params.requestId}`;
    const subject = `[협업 ${statusLabel}] ${toDeptName} → ${fromDeptName}`;

    try { emailTransporter.sendMail({
        from: { name: '노마 AI', address: process.env.SMTP_USER },
        to: DEV_RECIPIENT,
        subject,
        html: { content: Buffer.from(
            `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>` +
            `<div style="font-family:Malgun Gothic,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e5e5e5;border-radius:12px;overflow:hidden;">` +
            `<div style="background:linear-gradient(135deg,#3949AB,#1A237E);padding:24px 28px;color:white;">` +
            `<h2 style="margin:0;font-size:20px;">협업 상태 변경 알림</h2>` +
            `<p style="margin:8px 0 0;opacity:0.85;font-size:14px;">경상남도사회서비스원 노마 AI</p></div>` +
            `<div style="padding:28px;">` +
            `<div style="text-align:center;margin-bottom:24px;">` +
            `<span style="display:inline-block;padding:8px 20px;border-radius:9999px;font-size:16px;font-weight:bold;` +
            `${status === 'accepted' ? 'background:#E3F2FD;color:#1565C0' : status === 'completed' ? 'background:#E8F5E9;color:#2E7D32' : 'background:#FFEBEE;color:#C62828'}">` +
            `${statusLabel}</span></div>` +
            `<table style="width:100%;border-collapse:collapse;font-size:14px;">` +
            `<tr><td style="padding:8px 0;color:#666;width:110px;">요청 부서</td><td style="padding:8px 0;font-weight:bold;">${fromDeptName}</td></tr>` +
            `<tr style="border-top:1px solid #f0f0f0;"><td style="padding:8px 0;color:#666;">대상 부서</td><td style="padding:8px 0;font-weight:bold;">${toDeptName}</td></tr>` +
            `<tr style="border-top:1px solid #f0f0f0;"><td style="padding:8px 0;color:#666;">협업 사유</td><td style="padding:8px 0;">${collab.reason}</td></tr>` +
            `</table>` +
            `<div style="margin-top:24px;text-align:center;">` +
            `<a href="${caseUrl}" style="display:inline-block;padding:12px 28px;background:#3949AB;color:white;text-decoration:none;border-radius:8px;font-size:14px;font-weight:bold;">상담 처리 페이지 열기</a>` +
            `</div></div></div></body></html>`
        , 'utf-8'), contentType: 'text/html; charset=utf-8' },
    }).then(() => {
        console.log(`[협업 상태 변경 알림] ${statusLabel}: ${fromDeptName} ↔ ${toDeptName}`);
    }).catch(err => {
        console.error('[협업 상태 알림 실패]', err.message);
    }); } catch (e) { console.error('[협업 상태 알림 오류]', e.message); }

    res.json(collab);
});

// 협업 메모 추가
app.post('/api/case/:requestId/collaboration/:collabId/notes', (req, res) => {
    const { text, author, dept } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: '메모 내용을 입력하세요.' });
    const collab = requestStore.addCollaborationNote(
        req.params.requestId, req.params.collabId,
        text.trim(), author || '담당자', dept || ''
    );
    if (!collab) return res.status(404).json({ error: '협업 요청을 찾을 수 없습니다.' });
    res.json(collab);
});

// ── Admin API Routes ──

// A-07: 현황판 통계 + A-08 기간별 + A-11 처리시간
app.get('/api/admin/stats', (req, res) => {
    const stats = requestStore.getStats();
    const all = requestStore.listAll();

    // A-08: 기간별 접수 추이 (최근 14일)
    const daily = {};
    const now = new Date();
    for (let i = 13; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        daily[d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })] = 0;
    }
    all.forEach(r => {
        const ts = r.createdAtISO ? new Date(r.createdAtISO) : new Date(requestStore.parseKoDate(r.createdAt));
        const key = ts.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
        if (daily[key] !== undefined) daily[key]++;
    });

    // A-11: 평균 처리 시간
    let totalTime = 0, closedCount = 0;
    let openToConfirm = 0, ocCount = 0;
    let confirmToClose = 0, ccCount = 0;
    all.forEach(r => {
        const created = r.createdAtISO ? new Date(r.createdAtISO).getTime() : requestStore.parseKoDate(r.createdAt);
        if (r.status === 'closed' && r.updatedAt) {
            const elapsed = new Date(r.updatedAt).getTime() - created;
            if (elapsed > 0) { totalTime += elapsed; closedCount++; }
        }
    });
    const avgDays = closedCount > 0 ? (totalTime / closedCount / 86400000).toFixed(1) : null;

    // A-06: 미처리 요청 (3일 이상 open)
    const threeDaysAgo = now.getTime() - 3 * 86400000;
    const overdue = all.filter(r => {
        if (r.status !== 'open') return false;
        const created = r.createdAtISO ? new Date(r.createdAtISO).getTime() : requestStore.parseKoDate(r.createdAt);
        return created > 0 && created < threeDaysAgo;
    });

    res.json({ ...stats, daily, avgDays, overdue });
});

// A-01: 상담 요청 목록 (필터/검색/정렬/페이지네이션)
app.get('/api/admin/requests', (req, res) => {
    let all = requestStore.listAll();
    const { status, search, page = 1, limit = 20, sort = 'newest' } = req.query;

    if (status && status !== 'all') {
        all = all.filter(r => r.status === status);
    }
    if (search) {
        const q = search.toLowerCase();
        all = all.filter(r =>
            (r.userName || '').toLowerCase().includes(q) ||
            (r.userPhone || '').includes(q) ||
            (r.serviceName || '').toLowerCase().includes(q)
        );
    }
    if (sort === 'oldest') all.reverse();

    const total = all.length;
    const pageNum = Math.max(1, parseInt(page));
    const lim = Math.max(1, Math.min(100, parseInt(limit)));
    const totalPages = Math.ceil(total / lim);
    const items = all.slice((pageNum - 1) * lim, pageNum * lim);

    res.json({ items, total, page: pageNum, totalPages });
});

// A-02: 상담 요청 상세 + A-05 연계 체인
app.get('/api/admin/requests/:id', (req, res) => {
    const request = requestStore.findById(req.params.id);
    if (!request) return res.status(404).json({ error: '요청을 찾을 수 없습니다.' });
    const chain = requestStore.getReferralChain(req.params.id);
    res.json({ ...request, chain });
});

// A-03: 상태 변경
app.patch('/api/admin/requests/:id/status', (req, res) => {
    const { status } = req.body;
    const valid = ['open', 'confirmed', 'contacted', 'connected', 'closed', 'referred'];
    if (!valid.includes(status)) return res.status(400).json({ error: '유효하지 않은 상태입니다.' });
    const updated = requestStore.updateStatus(req.params.id, status);
    if (!updated) return res.status(404).json({ error: '요청을 찾을 수 없습니다.' });
    res.json(updated);
});

// A-04: 메모 추가
app.post('/api/admin/requests/:id/notes', (req, res) => {
    const { note } = req.body;
    if (!note || !note.trim()) return res.status(400).json({ error: '메모 내용을 입력하세요.' });
    const updated = requestStore.addNote(req.params.id, note.trim());
    if (!updated) return res.status(404).json({ error: '요청을 찾을 수 없습니다.' });
    res.json(updated);
});

// 전체 활성 협업 목록
app.get('/api/admin/collaborations', (req, res) => {
    res.json(requestStore.getActiveCollaborations());
});

// A-09 + A-10: 서비스 인기도 + 카테고리 분포
app.get('/api/admin/analytics', (req, res) => {
    const all = requestStore.listAll();
    const serviceCount = {};
    all.forEach(r => {
        const svc = r.serviceName || '기타';
        serviceCount[svc] = (serviceCount[svc] || 0) + 1;
    });

    // 카테고리 매핑 (지식베이스 기반)
    const categoryCount = {};
    all.forEach(r => {
        const svcName = r.serviceName || '';
        const kbEntry = welfareKB.find(k => k['사업명'] === svcName);
        const cat = kbEntry ? (kbEntry['대분류'] || '기타') : '기타';
        categoryCount[cat] = (categoryCount[cat] || 0) + 1;
    });

    const serviceRanking = Object.entries(serviceCount)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);

    res.json({ serviceRanking, categoryCount });
});

// KPI 통계
app.get('/api/admin/kpi', (req, res) => {
    const days = parseInt(req.query.days) || 7;
    res.json(analyticsStore.getKPI(days));
});

// 일별 이벤트 추이
app.get('/api/admin/trends', (req, res) => {
    const days = parseInt(req.query.days) || 7;
    res.json(analyticsStore.getRange(days));
});

app.listen(PORT, () => {
    console.log(`Noma API Server running on http://localhost:${PORT}`);
});
