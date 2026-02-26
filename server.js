// server.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { EdgeTTS } from '@andresaya/edge-tts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
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
        .replace(/(합니다|해요|하는|입니다|이에요|예요|인가요|일까요|인데|해서|하면|해줘|되나요|받고|없어요|있어요|싶어요|필요해요|돌봐줄|사는)$/g, '');
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
app.get('/favicon.ico', (req, res) => res.status(204).end());
app.use('/.well-known', (req, res) => res.status(200).end());

// Noma 챗봇 API (대국민 복지 상담 전용)
app.post('/api/chat', async (req, res) => {
    const { messages, systemPrompt, pageContext } = req.body;
    if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: "messages array required" });
    }
    const lastUserMessage = messages[messages.length - 1]?.content || "";

    // RAG: Search relevant services (한국어 조사 제거 + 복합어 분해 + 관련도 스코어링)
    const searchTerms = lastUserMessage.split(/[\s,?!.]+/)
        .map(w => stripKoreanSuffixes(w))
        .filter(w => w.length > 1);

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

    console.log(`[RAG] 검색어: [${searchTerms.join(', ')}]${subTermsArray.length > 0 ? ' 서브텀: [' + subTermsArray.join(', ') + ']' : ''} → ${filteredServices.length}건 매칭${filteredServices.length > 0 ? ': ' + filteredServices.map(s => `${s.service['사업명']}(${s.score})`).join(', ') : ''}`);

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
2. [Strict Grounding] 반드시 아래 [지식베이스 검색 결과]에 근거해서만 답변하세요. 지식베이스에 없는 내용은 절대 지어내지 마세요.
3. 지식베이스에 관련 정보가 없으면, 경상남도사회서비스원 대표번호 055-230-8200으로 전화 문의를 안내하세요.
4. 사용자가 추가 질문을 할 수 있도록 대화를 이어가세요.
5. 개발, 코딩, 시스템, 버그 등 기술적인 질문에는 절대 답변하지 마세요. "저는 복지 서비스 안내만 도와드릴 수 있어요"라고 안내하세요.

[넓게 추천 → 좁혀가기 원칙 - 매우 중요]
첫 질문부터 지식베이스에서 관련 서비스를 적극적으로 추천하세요. 대화가 진행될수록 좁혀나갑니다.

1단계 - 첫 질문 (넓은 추천):
- 사용자의 첫 질문에서 키워드를 추출하여 관련 서비스를 2~3개 <noma-card>로 바로 추천하세요.
- 모호한 감정 표현이라도(예: "외로워요", "힘들어요") 관련될 수 있는 서비스가 있다면 함께 보여주세요.
- 추천과 동시에 더 정확한 안내를 위한 질문을 1~2개 곁들이세요.
  예: "혹시 연세가 어떻게 되실까요?" / "지금 혼자 살고 계신가요?"

2단계 - 후속 대화 (좁혀가기):
- 사용자의 답변(나이, 가구형태, 건강상태, 거주지역)을 바탕으로 가장 적합한 1~2개 서비스로 좁혀서 다시 안내하세요.
- 이미 파악된 정보는 다시 묻지 마세요.
- 정보가 충분하면 최종 추천을 하고, 신청 방법을 구체적으로 안내하세요.

규칙:
- 첫 질문에서도 지식베이스 검색 결과가 있으면 반드시 서비스를 추천하세요. 질문만 하고 추천을 미루지 마세요.
- 한 번에 질문은 최대 2개까지만 하세요.
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

[중요]
- "담당자 연결" 또는 "상담 신청" 요청 시, 반드시 성함을 먼저 여쭤보세요.
- 한 번에 너무 많은 정보를 주지 말고, 가장 적합한 1~2개 서비스만 추천하세요.`;

        const systemInstructionString = systemPrompt || defaultSystemPrompt;

        // Build conversation contents: RAG context + user messages
        const userPrompt = ragContext + "\n\n" +
            messages.map(m => `${m.role === 'user' ? 'User' : 'Noma'}: ${m.content}`).join("\n");

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
                res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
            }
        }

        res.write(`data: [DONE]\n\n`);
        res.end();

    } catch (e) {
        console.error("Chat Error:", e.message);
        res.write(`data: ${JSON.stringify({ error: "AI 응답 중 오류가 발생했습니다." })}\n\n`);
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

// ── Service Request API (이메일 발송 시뮬레이션) ──
app.post('/api/service-request/connect', (req, res) => {
    const { serviceName, userName, userPhone } = req.body;

    console.log(`\n======================================================`);
    console.log(`[이메일 발송 시뮬레이션]`);
    console.log(`수신: ${serviceName} 담당 기관`);
    console.log(`제목: [신청 접수] 노마 AI 상담 - 신규 상담 요청 건`);
    console.log(`  - 신청자 성함: ${userName}`);
    console.log(`  - 연락처: ${userPhone}`);
    console.log(`  - 유입 경로: Noma AI 복지 내비게이터`);
    console.log(`======================================================\n`);

    res.json({ success: true, message: "이메일 알림 발송 완료" });
});

// ── Edge TTS API (Microsoft Neural Voice) ──
app.post('/api/tts', async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'text required' });

    try {
        const tts = new EdgeTTS();
        await tts.synthesize(text, 'ko-KR-SunHiNeural', { rate: '0%', pitch: '0Hz' });
        const audioBase64 = tts.toBase64();
        res.json({ audioContent: audioBase64 });
    } catch (e) {
        console.error('[TTS] Error:', e.message);
        res.status(500).json({ error: 'TTS request failed' });
    }
});

app.listen(PORT, () => {
    console.log(`Noma API Server running on http://localhost:${PORT}`);
});
