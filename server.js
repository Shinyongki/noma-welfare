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
import session from 'express-session';
import crypto from 'crypto';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import * as requestStore from './data/requestStore.mjs';
import * as analyticsStore from './data/analyticsStore.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config();

const app = express();

// ── 보안 HTTP 헤더 (helmet) ──
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net"],
            imgSrc: ["'self'", "data:", "blob:"],
            connectSrc: ["'self'"],
            mediaSrc: ["'self'", "blob:"],
            workerSrc: ["'self'", "blob:"],
        },
    },
    crossOriginEmbedderPolicy: false,
}));

app.use(cors({
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : true,
    credentials: true,
}));
app.use(express.json({ limit: '1mb' }));

// ── Rate Limiting ──
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' },
});
const chatLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: '채팅 요청이 너무 빈번합니다. 1분 후 다시 시도해 주세요.' },
});
const ttsLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'TTS 요청이 너무 빈번합니다. 잠시 후 다시 시도해 주세요.' },
});
app.use('/api/', apiLimiter);

// ── 세션 및 인증 ──
app.use(session({
    secret: process.env.SESSION_SECRET || crypto.randomUUID(),
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 8 * 60 * 60 * 1000, // 8시간
    },
}));

// ── 일회성 토큰 저장소 (case.html 이메일 링크용) ──
const caseTokens = new Map(); // token → { requestId, createdAt }
const CASE_TOKEN_TTL = 72 * 60 * 60 * 1000; // 72시간

function generateCaseToken(requestId) {
    const token = crypto.randomBytes(32).toString('hex');
    caseTokens.set(token, { requestId, createdAt: Date.now() });
    return token;
}

function validateCaseToken(token, requestId) {
    const entry = caseTokens.get(token);
    if (!entry) return false;
    if (Date.now() - entry.createdAt > CASE_TOKEN_TTL) {
        caseTokens.delete(token);
        return false;
    }
    return entry.requestId === requestId;
}

// 만료 토큰 정리 (1시간 간격)
setInterval(() => {
    const now = Date.now();
    for (const [token, entry] of caseTokens) {
        if (now - entry.createdAt > CASE_TOKEN_TTL) caseTokens.delete(token);
    }
}, 60 * 60 * 1000);

// 인증 미들웨어
function requireAuth(req, res, next) {
    if (req.session?.authenticated) return next();
    res.status(401).json({ error: '인증이 필요합니다. /api/auth/login으로 로그인하세요.' });
}

// case API 전용 인증: 세션 또는 토큰
function requireCaseAuth(req, res, next) {
    if (req.session?.authenticated) return next();
    const token = req.query.token || req.headers['x-case-token'];
    const requestId = req.params.requestId || req.params.id;
    if (token && requestId && validateCaseToken(token, requestId)) {
        return next();
    }
    res.status(401).json({ error: '인증이 필요합니다. 이메일 링크를 통해 접근하거나 로그인하세요.' });
}

// 로그인 API
app.post('/api/auth/login', (req, res) => {
    const { password } = req.body;
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword) {
        console.error('[Auth] ADMIN_PASSWORD 환경변수가 설정되지 않았습니다.');
        return res.status(500).json({ error: '서버 설정 오류가 발생했습니다. 관리자에게 문의하세요.' });
    }
    if (password === adminPassword) {
        req.session.authenticated = true;
        req.session.loginAt = new Date().toISOString();
        return res.json({ success: true, message: '로그인 성공' });
    }
    res.status(403).json({ error: '비밀번호가 올바르지 않습니다.' });
});

// 로그아웃 API
app.post('/api/auth/logout', (req, res) => {
    req.session.destroy(() => {
        res.json({ success: true, message: '로그아웃 완료' });
    });
});

// 인증 상태 확인
app.get('/api/auth/status', (req, res) => {
    res.json({ authenticated: !!req.session?.authenticated });
});

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
    // Phase 2 보강: 누락 키워드
    '먹': ['가사지원', '일상돌봄', '식사'],
    '돈': ['긴급생활지원', '생활지원', '경제적지원'],
    '가난': ['긴급생활지원', '생활지원', '수급자'],
    '재활': ['직업재활', '재활서비스', '장애인복지'],
    '상담': ['상담지원', '돌봄', '복지상담'],
    '컨설팅': ['상담지원', '사례관리', '복지상담'],
    '이동': ['이동지원', '활동지원', '장애인복지'],
};

// ── 부서별 사업 프로파일 및 배정 근거 ──
const deptServiceMap = {
    '긴급돌봄지원사업': {
        dept: '통합돌봄사업부',
        deptId: 'care',
        phone: '055-230-8216',
        responsibility: '갑작스러운 질병·사고로 인한 돌봄 공백 시 단기(30일) 긴급 돌봄 파견을 전담',
        basis: '「사회서비스 이용 및 이용권 관리에 관한 법률」에 따른 긴급돌봄 지원. 경상남도사회서비스원 설립 목적(돌봄 사각지대 해소)에 의한 직접 서비스.',
        keyEligibility: ['갑작스러운 돌봄 공백 발생(보호자 입원·사고 등)', '수급자·차상위·중위소득 160% 이하 우선', '독거노인·장애인·아동 돌봄 공백 가구'],
        keyQuestions: ['돌봄이 갑자기 필요해진 상황인가요? (보호자 입원, 사고 등)', '기존에 이용하던 돌봄 서비스가 있었나요?', '수급자 또는 차상위 계층에 해당하시나요?'],
    },
    '창원종합재가센터 통합재가서비스': {
        dept: '창원종합재가센터',
        deptId: 'care',
        phone: '055-230-8530',
        responsibility: '장기요양 등급자 대상 방문요양·방문목욕·방문간호 전문 재가서비스 직접 제공',
        basis: '「노인장기요양보험법」에 따른 재가급여 제공기관. 경상남도사회서비스원 직영 재가센터로서 공공성 확보.',
        keyEligibility: ['장기요양 1~5등급 또는 인지지원등급 인정자', '거동 불편 어르신·장애인', '창원시 거주자 우선'],
        keyQuestions: ['장기요양등급(1~5등급 또는 인지지원등급)을 받으셨나요?', '창원시에 거주하시나요?', '필요한 서비스가 요양, 목욕, 간호 중 어떤 것인가요?'],
    },
    '김해종합재가센터 통합재가서비스': {
        dept: '김해종합재가센터',
        deptId: 'care',
        phone: '055-330-8751',
        responsibility: '장기요양 등급자 대상 방문요양·방문목욕·방문간호 전문 재가서비스 직접 제공',
        basis: '「노인장기요양보험법」에 따른 재가급여 제공기관. 경상남도사회서비스원 직영 재가센터로서 공공성 확보.',
        keyEligibility: ['장기요양 1~5등급 또는 인지지원등급 인정자', '거동 불편 어르신·장애인', '김해시 거주자 우선'],
        keyQuestions: ['장기요양등급(1~5등급 또는 인지지원등급)을 받으셨나요?', '김해시에 거주하시나요?', '필요한 서비스가 요양, 목욕, 간호 중 어떤 것인가요?'],
    },
    '경상남도 통합돌봄지원센터(경남형 희망나눔)': {
        dept: '통합돌봄지원센터',
        deptId: 'care',
        phone: '055-230-8320',
        responsibility: '퇴원 후 또는 만성적 돌봄 필요 시 케어매니저가 종합적 돌봄계획을 수립하고 맞춤 서비스 연계',
        basis: '「지역사회 통합돌봄 선도사업」 및 경상남도 자체 통합돌봄 정책. 케어매니저 기반 Care Plan 수립·이행 총괄.',
        keyEligibility: ['돌봄 필요 도민(소득·연령 무관, 필요도 기준)', '장기요양 재가등급자', '퇴원 환자', '고위험 독거 어르신'],
        keyQuestions: ['병원에서 퇴원하셨거나 퇴원 예정이신가요?', '식사, 이동, 주거환경 중 어떤 부분이 가장 어려우신가요?', '현재 이용 중인 복지 서비스가 있나요?'],
    },
    '노인맞춤돌봄서비스 광역지원': {
        dept: '노인맞춤돌봄 광역지원기관',
        deptId: 'care',
        phone: '055-230-8230',
        responsibility: '만 65세 이상 독거·취약 어르신 대상 안전확인, 생활지원, 사회참여 프로그램 총괄',
        basis: '「노인복지법」 제27조의2에 따른 노인맞춤돌봄서비스. 보건복지부 광역지원기관 지정.',
        keyEligibility: ['만 65세 이상', '독거노인·취약노인(기초수급·차상위·기초연금수급자 우선)', '일상생활 어려움'],
        keyQuestions: ['만 65세 이상이신가요?', '혼자 살고 계신가요?', '기초생활수급자, 차상위, 기초연금수급자이신가요?'],
    },
    '응급안전안심서비스': {
        dept: '응급안전안심서비스 광역지원기관',
        deptId: 'care',
        phone: '055-230-8240',
        responsibility: '독거노인·독거장애인 댁내 안전장비 설치 및 24시간 활동 모니터링 총괄',
        basis: '「노인복지법」 제27조의2 및 「응급안전안심서비스 운영지침」. 보건복지부 광역지원기관 지정.',
        keyEligibility: ['65세 이상 독거노인 또는 독거 장애인', '기초수급·차상위 우선'],
        keyQuestions: ['혼자 살고 계신가요?', '갑자기 쓰러지거나 응급 상황이 걱정되시나요?', '기초수급자 또는 차상위에 해당하시나요?'],
    },
    'AI 온하나케어 스마트 돌봄': {
        dept: '통합돌봄지원센터',
        deptId: 'care',
        phone: '055-230-8320',
        responsibility: 'AI 스피커 기반 24시간 말벗·정서케어·응급연계 서비스',
        basis: '경상남도 ICT 돌봄 정책. 통합돌봄지원센터의 비대면 돌봄 확대 사업.',
        keyEligibility: ['독거노인·고령자·장애인 가구', '디지털 소외 어르신 포함'],
        keyQuestions: ['혼자 살고 계신가요?', '말벗이나 정서적 지원이 필요하신가요?', '현재 안전 관련 장비가 설치되어 있나요?'],
    },
    '경남발달장애인긴급돌봄센터': {
        dept: '통합돌봄사업부',
        deptId: 'emergency',
        phone: '055-230-8216',
        responsibility: '발달장애인(지적·자폐) 보호자 긴급 상황 시 최대 7일 24시간 돌봄 제공',
        basis: '「발달장애인 권리보장 및 지원에 관한 법률」에 따른 긴급돌봄. 보건복지부 긴급돌봄센터 지정.',
        keyEligibility: ['발달장애인(지적·자폐) 당사자', '주 보호자 입원·경조사 등 긴급 상황'],
        keyQuestions: ['발달장애(지적장애 또는 자폐)를 가지고 계신 분이신가요?', '보호자분께 갑작스러운 상황(입원, 경조사 등)이 생기셨나요?', '긴급 돌봄이 며칠 정도 필요하신가요?'],
    },
    '일상돌봄 병원동행서비스(바우처)': {
        dept: '경남지역사회서비스지원단',
        deptId: 'care',
        phone: '055-260-0900',
        responsibility: '혼자 병원 방문이 어려운 중장년 1인 가구 대상 동행 바우처 지원',
        basis: '경남지역사회서비스지원단 운영 바우처 사업. 1인 가구 의료 접근성 강화 정책.',
        keyEligibility: ['만 40세 이상 중장년 1인 가구', '혼자 병원 방문 어려운 도민', '창원·김해·거제 등 일부 시군 거주자'],
        keyQuestions: ['만 40세 이상이시고 혼자 살고 계신가요?', '병원에 혼자 가시기 어려운 상황인가요?', '어느 시·군에 거주하시나요? (창원, 김해, 거제 등)'],
    },
    '퇴원환자 지역사회 연계서비스': {
        dept: '통합돌봄지원센터',
        deptId: 'care',
        phone: '055-230-8320',
        responsibility: '병원 퇴원 후 가정 복귀 환자의 돌봄 공백 방지를 위한 집중 모니터링 및 서비스 연계',
        basis: '지역사회 통합돌봄 퇴원연계 시범사업. 「공공보건의료에 관한 법률」에 따른 퇴원환자 지역연계.',
        keyEligibility: ['병원 퇴원 후 가정 복귀 도민', '돌봄 공백 우려 환자', '독거 또는 돌봄 제공자 부재'],
        keyQuestions: ['최근에 병원에서 퇴원하셨나요, 또는 퇴원 예정이신가요?', '퇴원 후 돌봐줄 분이 계신가요?', '퇴원 후 가장 어려운 점이 무엇인가요? (식사, 이동, 약 복용 등)'],
    },
    '사회복지시설 종사자 대체인력 지원사업': {
        dept: '민간지원협력부',
        deptId: 'private',
        phone: '055-230-8270',
        responsibility: '사회복지시설 직원 연차·교육·병가 시 대체 인력 파견 지원',
        basis: '「사회복지사업법」 제2조에 따른 사회복지시설 운영 지원. 종사자 처우개선 및 서비스 연속성 확보.',
        keyEligibility: ['「사회복지사업법」 제2조 해당 도내 사회복지시설', '어린이집·노인장기요양기관 등 일부 제외', '직원 연차·교육·경조사·병가·출산 시'],
        keyQuestions: ['어떤 유형의 사회복지시설을 운영하고 계신가요?', '대체 인력이 필요한 사유와 기간은?', '시설 소재지가 경상남도 내인가요?'],
    },
    '민간 사회복지시설 경영컨설팅': {
        dept: '민간지원협력부',
        deptId: 'private',
        phone: '055-230-8270',
        responsibility: '사회복지법인·시설 대상 노무·경영·재무·법무 전문 컨설팅 제공',
        basis: '경상남도사회서비스원 설립 목적 중 민간 사회복지시설 역량 강화. 운영 투명성 및 법적 준수 지원.',
        keyEligibility: ['경상남도 내 사회복지법인 및 시설', '신규 설립 예정 사회서비스 제공기관'],
        keyQuestions: ['사회복지시설 또는 법인을 운영하고 계신가요?', '노무, 경영, 재무, 법무 중 어떤 분야의 컨설팅이 필요하신가요?'],
    },
    '사회복지시설 안전점검 지원사업': {
        dept: '민간지원협력부',
        deptId: 'private',
        phone: '055-230-8270',
        responsibility: '복지시설 화재·전기·가스·자연재난 전문가 점검단 파견 및 개선 권고',
        basis: '「사회복지사업법」 시설 안전기준. 보건복지부 안전점검 지침에 따른 전문 진단 지원.',
        keyEligibility: ['경상남도 내 18개 시군 사회서비스 제공기관', '소규모 복지시설 우선'],
        keyQuestions: ['시설의 안전점검을 받으신 적이 있나요?', '화재, 전기, 가스 중 특히 점검이 필요한 분야가 있나요?'],
    },
    '장기요양기관 평가지원 및 컨설팅': {
        dept: '민간지원협력부',
        deptId: 'private',
        phone: '055-230-8270',
        responsibility: '장기요양기관 평가 지표 교육 및 서비스 품질 상향 컨설팅',
        basis: '「노인장기요양보험법」에 따른 기관 평가 의무. 경상남도 장기요양서비스 품질관리 정책.',
        keyEligibility: ['경상남도 내 민간 장기요양기관(요양원·재가기관 등)'],
        keyQuestions: ['장기요양기관 평가가 예정되어 있나요?', '어떤 유형의 장기요양기관인가요? (요양원, 재가기관 등)'],
    },
    '경상남도청 어린이집': {
        dept: '경상남도청 어린이집',
        deptId: 'facility',
        phone: '055-210-9500',
        responsibility: '영유아(만 0~5세) 표준보육과정 운영 및 특화 프로그램 제공',
        basis: '「영유아보육법」에 따른 국공립 어린이집 운영. 경상남도 직영 시설.',
        keyEligibility: ['영유아(만 0~5세)', '도청 직원 자녀 우선, 지역 주민도 가능'],
        keyQuestions: ['자녀의 연령이 어떻게 되나요? (만 0~5세)', '장애아 통합보육이 필요하신가요?'],
    },
    '경상남도 보조기기센터': {
        dept: '경상남도 보조기기센터',
        deptId: 'facility',
        phone: '055-715-9199',
        responsibility: '장애인·노인 대상 보조기기 상담·평가·대여·수리·맞춤제작(3D프린팅) 서비스',
        basis: '「장애인복지법」 및 「장애인·노인 등을 위한 보조기기 지원 및 활용촉진에 관한 법률」에 따른 보조기기센터 운영.',
        keyEligibility: ['장애인 및 65세 이상 노인', '보조기기 필요한 누구나(소득 무관 상담 가능)'],
        keyQuestions: ['어떤 보조기기가 필요하신가요? (휠체어, 보행보조기, 의사소통기기 등)', '장애 유형과 등급이 어떻게 되시나요?', '대여와 구매 중 어떤 것을 원하시나요?'],
    },
    '경상남도 피해장애인쉼터': {
        dept: '경상남도 피해장애인쉼터',
        deptId: 'facility',
        phone: '055-230-8580',
        responsibility: '학대·폭력 피해 장애인 일시보호, 심리치료, 사회복귀 자립 지원',
        basis: '「장애인복지법」 제59조의11(피해장애인 쉼터) 및 「장애인학대 방지 및 피해장애인 보호 등에 관한 법률」.',
        keyEligibility: ['학대·폭력 피해 장애인(지적·신체 등 전체)'],
        keyQuestions: ['안전한 곳이 필요하신 상황인가요?', '현재 위험한 상황에 처해 계신가요?'],
    },
    '경상남도장애인종합복지관': {
        dept: '경상남도장애인종합복지관',
        deptId: 'facility',
        phone: '055-230-8460',
        responsibility: '장애인 상담·사례관리, 직업훈련, 재활, 사회참여 지원 프로그램 종합 제공',
        basis: '「장애인복지법」 제58조(장애인복지시설). 경상남도 직영 종합복지관.',
        keyEligibility: ['경상남도 거주 장애인(전체 유형)'],
        keyQuestions: ['어떤 유형의 장애를 가지고 계신가요?', '상담, 직업훈련, 재활 중 어떤 지원이 필요하신가요?', '현재 다른 복지 서비스를 이용 중이신가요?'],
    },
};

// 부서별 프로파일 (시스템 프롬프트 및 라우팅용)
const deptProfiles = `
[부서별 사업 프로파일 및 판별 기준]
아래는 경상남도사회서비스원의 부서별 사업 특성입니다. 사용자의 상황을 분석하여 가장 적합한 부서/서비스를 판별하고, 부서별 핵심 질문을 활용하여 정보를 수집하세요.

■ 통합돌봄사업부 (긴급돌봄 전담)
  담당: 긴급돌봄지원사업, 경남발달장애인긴급돌봄센터
  핵심 특징: 갑작스러운 돌봄 공백 발생 시 단기(30일 이내) 긴급 파견
  판별 키워드: 갑자기, 급하게, 당장, 쓰러짐, 보호자 부재, 돌봄 공백, 입원
  수집 정보: 돌봄 공백 원인, 기존 돌봄 서비스 이용 여부, 수급자/차상위 여부, 장애 유형(발달장애 해당 시)

■ 통합돌봄지원센터 (종합돌봄 연계)
  담당: 경상남도 통합돌봄지원센터, 퇴원환자 지역사회 연계서비스, AI 온하나케어
  핵심 특징: 퇴원 후 또는 만성적 돌봄 필요 시 케어매니저가 Care Plan 수립, 종합적·장기적 서비스 연계
  판별 키워드: 퇴원, 집에서, 계속 살고 싶어, 밥, 청소, 이동, 방문간호, 외롭
  수집 정보: 퇴원 여부/시점, 필요 서비스(식사·이동·주거·간호), 장기요양등급, 현재 이용 서비스, 독거 여부

■ 종합재가센터 (전문 재가서비스)
  담당: 창원종합재가센터, 김해종합재가센터
  핵심 특징: 장기요양등급자 대상 방문요양·방문목욕·방문간호 전문 서비스 직접 제공
  판별 키워드: 방문요양, 목욕, 간호사, 장기요양, 거동불편, 요양보호사
  수집 정보: 장기요양등급(1~5등급/인지지원등급), 거주지(창원/김해), 필요 서비스 유형(요양/목욕/간호)

■ 노인맞춤돌봄 광역지원기관
  담당: 노인맞춤돌봄서비스 광역지원
  핵심 특징: 만 65세 이상 독거/취약 어르신 안전확인, 생활지원, 사회참여
  판별 키워드: 안부, 말벗, 어르신, 독거, 안전확인, 정기방문
  수집 정보: 만 65세 이상 여부, 독거 여부, 기초수급/차상위/기초연금 여부

■ 응급안전안심서비스 광역지원기관
  담당: 응급안전안심서비스
  핵심 특징: 독거노인/장애인 댁내 안전장비(센서·호출기) 설치 + 24시간 모니터링
  판별 키워드: 응급, 쓰러지면, 혼자 살아, 독거, 화재, 안전장치, 모니터링
  수집 정보: 독거 여부, 연령(65세 이상), 기초수급/차상위, 기존 안전장비 설치 여부

■ 민간지원협력부 (기관 대상 서비스)
  담당: 대체인력 지원, 경영컨설팅, 안전점검, 장기요양기관 평가지원
  핵심 특징: 일반 도민이 아닌 사회복지시설/기관 운영자 대상 지원
  판별 키워드: 시설, 기관, 종사자, 직원, 컨설팅, 평가, 안전점검, 요양원
  수집 정보: 시설 유형, 직원 규모, 필요 지원 분야(인력/컨설팅/안전점검/평가), 시설 소재지

■ 국공립시설 (도립시설 직영)
  담당: 어린이집, 보조기기센터, 피해장애인쉼터, 장애인종합복지관
  핵심 특징: 각 시설별 전문 서비스 직접 제공
  판별 키워드:
  - 어린이집: 보육, 아이, 아기, 영유아
  - 보조기기: 휠체어, 보행보조기, 보조기기, 대여
  - 피해장애인: 학대, 폭력, 피해, 안전한곳
  - 종합복지관: 장애인상담, 직업훈련, 재활, 사회참여
  수집 정보: 시설별 상이 (위 각 서비스의 keyQuestions 참조)

[부서 판별 및 라우팅 규칙]
1. 사용자의 첫 질문에서 키워드와 상황을 분석하여 가장 관련 높은 부서 1~2개를 식별하세요.
2. 식별된 부서의 "수집 정보"를 기존 [정보 수집 프레임워크]의 필수 정보와 함께 자연스럽게 수집하세요.
3. 유사한 서비스 간 차이를 정확히 구분하세요:
   - "갑작스러운 돌봄 공백" → 긴급돌봄(통합돌봄사업부)
   - "퇴원 후 장기적 돌봄 필요" → 통합돌봄지원센터(Care Plan)
   - "장기요양등급이 있고 방문서비스 필요" → 재가센터(창원/김해)
   - "독거 어르신 안부 확인" → 노인맞춤돌봄(광역지원)
   - "혼자 살며 응급상황 걱정" → 응급안전안심서비스
   - "복지시설 운영 관련" → 민간지원협력부
4. 판별이 애매한 경우, 추가 질문을 통해 좁혀가되 한 번에 1개만 질문하세요.`;

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

// ── Linkage Migration (서버 시작 시 1회) ──
const migratedCount = requestStore.migrateToLinkages();
if (migratedCount > 0) {
    console.log(`[마이그레이션] 기존 데이터 ${migratedCount}건을 linkages로 변환 완료`);
}

// ── API Routes ──

// 정적 파일 서빙 및 메인 화면 라우트
app.use(express.static(path.join(__dirname, 'stitch')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'stitch', 'code.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'stitch', 'admin.html')));
app.get('/favicon.ico', (req, res) => res.status(204).end());
app.use('/.well-known', (req, res) => res.status(200).end());

// Noma 챗봇 API (대국민 복지 상담 전용)
app.post('/api/chat', chatLimiter, async (req, res) => {
    const { messages, systemPrompt, pageContext } = req.body;
    if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: "messages array required" });
    }
    const lastUserMessage = messages[messages.length - 1]?.content || "";

    // RAG: Search relevant services (한국어 조사 제거 + 복합어 분해 + 유의어 확장 + 관련도 스코어링)
    const rawWords = lastUserMessage.split(/[\s,?!.]+/).filter(w => w.length > 0);
    const strippedWords = rawWords.map(w => stripKoreanSuffixes(w));
    const searchTerms = [...new Set([
        ...strippedWords.filter(w => w.length > 1 || synonymMap[w]),
        // 어미 제거로 사라진 단어 중 synonymMap에 있는 원형 복구 (예: "아이" → "아"로 잘못 제거 방지)
        ...rawWords.filter(w => synonymMap[w] && !strippedWords.filter(r => r.length > 1 || synonymMap[r]).includes(w))
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
            const deptInfo = deptServiceMap[svc['사업명']];
            ragContext += `${i + 1}. [관련도: ${stars}] 사업명: ${svc['사업명']}\n`;
            if (deptInfo) {
                ragContext += `   - 담당부서: ${deptInfo.dept} (${deptInfo.phone})\n`;
                ragContext += `   - 부서 책임: ${deptInfo.responsibility}\n`;
                ragContext += `   - 핵심 자격: ${deptInfo.keyEligibility.join(', ')}\n`;
            }
            ragContext += `   - 대상: ${svc['지원 대상']}\n   - 방법: ${svc['신청 방법']}\n   - 혜택: ${svc['지원 내용']}\n   - 연락처: ${svc['문의처']}\n\n`;
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
- 한 번에 너무 많은 정보를 주지 말고, 가장 적합한 1~2개 서비스만 추천하세요.

${deptProfiles}`;

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
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
    },
});

// 수신자 주소 — .env의 EMAIL_RECIPIENT 환경변수로 관리
const DEV_RECIPIENT = process.env.EMAIL_RECIPIENT || 'admin@example.com';

// 이메일 헤더 인젝션 방어 (줄바꿈 제거)
function sanitizeEmailHeader(str) {
    return String(str).replace(/[\r\n]/g, ' ').trim();
}

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

// ── 배정 근거 생성 (Gemini 비스트리밍 호출) ──
async function generateAssignmentRationale(serviceName, chatHistory, conversationSummary) {
    const deptInfo = deptServiceMap[serviceName];
    if (!deptInfo) return null;

    const conversationText = chatHistory
        ? chatHistory.map(m => `${m.role === 'user' ? '이용자' : '노마'}: ${m.content}`).join('\n')
        : '';

    const kbEntry = welfareKB.find(s => s['사업명'] === serviceName);
    const serviceDetail = kbEntry
        ? `사업명: ${serviceName}\n지원 대상: ${kbEntry['지원 대상']}\n지원 내용: ${kbEntry['지원 내용']}\n신청 방법: ${kbEntry['신청 방법']}`
        : `사업명: ${serviceName}`;

    const prompt = `아래 정보를 바탕으로, 이 서비스를 해당 부서에서 처리해야 하는 근거를 작성하세요.
담당자가 상급자(조정자)에게 보고할 때 활용할 수 있도록 논리적이고 구체적으로 작성하세요.

[서비스 정보]
${serviceDetail}

[담당 부서]
부서: ${deptInfo.dept}
부서 책임: ${deptInfo.responsibility}
법적/제도적 근거: ${deptInfo.basis}
핵심 자격 요건: ${deptInfo.keyEligibility.join(', ')}

[이용자 대화 요약]
${conversationSummary || '요약 없음'}

[대화 내용]
${conversationText.slice(0, 2000)}

[출력 형식]
1. 배정 근거 (이 부서가 담당해야 하는 이유 2~3문장)
2. 이용자 상황 매칭 (이용자의 상황이 서비스 자격요건에 부합하는 구체적 근거)
3. 법적/제도적 근거 (관련 법률 또는 정책 근거 1~2문장)
4. 우선 확인 사항 (담당자가 이용자에게 확인해야 할 핵심 사항 2~3개)`;

    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const result = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: prompt,
                config: {
                    systemInstruction: "경상남도사회서비스원 내부 업무 지원 AI입니다. 서비스 배정 근거를 논리적이고 객관적으로 작성합니다. 불필요한 수식어 없이 사실 기반으로 작성하세요.",
                    temperature: 0.15,
                }
            });
            return result.text || null;
        } catch (e) {
            if (e.message?.includes('429') && attempt < 2) {
                await new Promise(r => setTimeout(r, 3000));
                continue;
            }
            console.error('[배정 근거 생성 실패]', e.message);
            return null;
        }
    }
    return null;
}

app.post('/api/service-request/connect', async (req, res) => {
    const { serviceName, userName, userPhone, chatHistory } = req.body;

    // 입력 검증
    if (!serviceName || !String(serviceName).trim()) {
        return res.status(400).json({ error: '서비스명은 필수입니다.' });
    }
    if (!userName || !String(userName).trim()) {
        return res.status(400).json({ error: '성함은 필수입니다.' });
    }
    if (!userPhone || !String(userPhone).trim()) {
        return res.status(400).json({ error: '전화번호는 필수입니다.' });
    }
    const phoneRegex = /^0\d{1,2}-?\d{3,4}-?\d{4}$/;
    if (!phoneRegex.test(String(userPhone).trim())) {
        return res.status(400).json({ error: '올바른 전화번호 형식이 아닙니다. (예: 010-1234-5678)' });
    }

    // 디버그: 수신 데이터 확인
    console.log('[수신 데이터]', JSON.stringify({ serviceName, userName, userPhone, chatHistoryLength: chatHistory?.length || 0 }));

    // 중복 신청 방지: 같은 이름+전화번호+서비스로 24시간 내 중복 신청 차단
    const recentRequests = requestStore.listAll();
    const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
    const normalizedPhone = String(userPhone).trim().replace(/-/g, '');
    const duplicate = recentRequests.find(r => {
        const rPhone = String(r.userPhone || '').trim().replace(/-/g, '');
        const rTime = r.createdAtISO ? new Date(r.createdAtISO).getTime() : 0;
        return r.userName === String(userName).trim()
            && rPhone === normalizedPhone
            && r.serviceName === String(serviceName).trim()
            && rTime > twentyFourHoursAgo;
    });
    if (duplicate) {
        return res.status(409).json({ error: '동일한 서비스에 대해 최근 24시간 내 이미 신청하셨습니다. 잠시 후 다시 시도해 주세요.' });
    }

    // 대화 요약 + 배정 근거 동시 생성 (실패해도 이메일은 정상 발송)
    let conversationSummary = null;
    let assignmentRationale = null;
    if (chatHistory && chatHistory.length >= 2) {
        conversationSummary = await summarizeChatHistory(chatHistory);
        if (conversationSummary) {
            console.log('[대화 요약 생성 완료]');
        }
        // 배정 근거 생성 (요약 완료 후)
        assignmentRationale = await generateAssignmentRationale(serviceName, chatHistory, conversationSummary);
        if (assignmentRationale) {
            console.log('[배정 근거 생성 완료]');
        }
    }

    // 요청 ID 생성 및 저장
    analyticsStore.track('service_apply');
    const requestId = crypto.randomUUID();
    const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    const deptInfo = deptServiceMap[serviceName] || null;
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
        assignmentRationale,
        assignedDept: deptInfo ? { name: deptInfo.dept, id: deptInfo.deptId, phone: deptInfo.phone } : null,
    });

    const subject = sanitizeEmailHeader(`[상담 신청] ${serviceName} - 노마 AI 복지 내비게이터`);
    const caseToken = generateCaseToken(requestId);
    const caseUrl = `${BASE_URL}/case/${requestId}?token=${caseToken}`;
    const referralUrl = `${BASE_URL}/referral/${requestId}?token=${caseToken}`;
    const htmlContent = buildServiceRequestEmailHTML({ serviceName, userName, userPhone, now, caseUrl, referralUrl, conversationSummary, assignmentRationale, deptInfo });

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
function buildServiceRequestEmailHTML({ serviceName, userName, userPhone, now, caseUrl, referralUrl, conversationSummary, assignmentRationale, deptInfo }) {
    // HTML 이스케이프
    const esc = (str) => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const summarySection = conversationSummary ? [
        '<div style="margin-top:24px;padding:20px;background:#F3E5F5;border-left:4px solid #7B1FA2;border-radius:4px;">',
        '<p style="margin:0 0 10px;font-size:14px;color:#7B1FA2;font-weight:bold;">AI 대화 요약</p>',
        '<p style="margin:0;font-size:14px;color:#333;white-space:pre-line;line-height:1.7;">' + esc(conversationSummary) + '</p>',
        '</div>',
    ].join('\n') : '';

    // 배정 근거 섹션
    const rationaleSection = assignmentRationale ? [
        '<div style="margin-top:20px;padding:20px;background:#E3F2FD;border-left:4px solid #1565C0;border-radius:4px;">',
        '<p style="margin:0 0 10px;font-size:14px;color:#1565C0;font-weight:bold;">배정 근거 (AI 분석)</p>',
        '<p style="margin:0;font-size:14px;color:#333;white-space:pre-line;line-height:1.7;">' + esc(assignmentRationale) + '</p>',
        '</div>',
    ].join('\n') : '';

    // 담당 부서 정보 섹션
    const deptSection = deptInfo ? [
        '<div style="margin-top:20px;padding:14px;background:#E8F5E9;border-radius:8px;">',
        '<p style="margin:0 0 4px;font-size:12px;color:#2E7D32;font-weight:bold;">담당 부서</p>',
        '<p style="margin:0;font-size:16px;font-weight:bold;color:#1B5E20;">' + esc(deptInfo.dept) + '</p>',
        '<p style="margin:4px 0 0;font-size:13px;color:#333;">' + esc(deptInfo.responsibility) + '</p>',
        '<p style="margin:4px 0 0;font-size:13px;color:#666;">연락처: ' + esc(deptInfo.phone) + '</p>',
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
        deptSection,
        '<table style="width:100%;border-collapse:collapse;font-size:15px;margin-top:16px;">',
        '<tr><td style="padding:10px 0;color:#666;width:110px;">신청 서비스</td><td style="padding:10px 0;font-weight:bold;">' + esc(serviceName) + '</td></tr>',
        '<tr style="border-top:1px solid #f0f0f0;"><td style="padding:10px 0;color:#666;">신청자 성함</td><td style="padding:10px 0;font-weight:bold;">' + esc(userName) + '</td></tr>',
        '<tr style="border-top:1px solid #f0f0f0;"><td style="padding:10px 0;color:#666;">연락처</td><td style="padding:10px 0;font-weight:bold;">' + esc(userPhone) + '</td></tr>',
        '<tr style="border-top:1px solid #f0f0f0;"><td style="padding:10px 0;color:#666;">유입 경로</td><td style="padding:10px 0;">Noma AI 복지 내비게이터</td></tr>',
        '<tr style="border-top:1px solid #f0f0f0;"><td style="padding:10px 0;color:#666;">접수 일시</td><td style="padding:10px 0;">' + now + '</td></tr>',
        '</table>',
        summarySection,
        rationaleSection,
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

// 연계 요청 → 통합 linkage로 생성 (승인 대기, 이메일 발송 안 함)
app.post('/api/referral/:requestId/send', async (req, res) => {
    const { targetService, reason } = req.body;
    const request = requestStore.findById(req.params.requestId);
    if (!request) return res.status(404).json({ error: '요청을 찾을 수 없습니다.' });

    // 통합 linkage로 생성 (pending 상태, 이메일 발송 없음)
    const linkage = requestStore.addLinkage(req.params.requestId, {
        category: 'referral',
        type: 'service_referral',
        targetService,
        reason,
        submittedBy: '담당자',
    });
    if (!linkage) return res.status(404).json({ error: '요청을 찾을 수 없습니다.' });

    console.log(`[연계 요청 생성] 서비스연계: ${request.serviceName} → ${targetService} (승인 대기)`);

    res.json({ success: true, message: '연계 요청이 생성되었습니다. 관리자 승인 후 이메일이 발송됩니다.', linkage });
});

// 연계 이메일 HTML 빌더
function buildReferralEmailHTML({ request, targetService, reason, newRequestId, chain, caseToken }) {
    const esc = (str) => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const tokenQuery = caseToken ? `?token=${caseToken}` : '';
    const caseUrl = `${BASE_URL}/case/${newRequestId}${tokenQuery}`;
    const referralUrl = `${BASE_URL}/referral/${newRequestId}${tokenQuery}`;

    // 연계 경로 HTML 생성 (chain이 2건 이상이면 거쳐간 기관 표시)
    let chainHTML = '';
    if (chain && chain.length >= 2) {
        const steps = chain.map((c, i) => {
            const isCurrent = c.current;
            const bg = isCurrent ? '#E3F2FD' : '#F5F5F5';
            const border = isCurrent ? '2px solid #1565C0' : '1px solid #E0E0E0';
            const color = isCurrent ? '#0D47A1' : '#555';
            const statusLabel = c.status === 'closed' ? '완료' : c.status === 'referred' ? '연계' : c.status === 'open' ? '접수' : c.status;
            const statusColor = c.status === 'closed' ? '#2E7D32' : c.status === 'referred' ? '#1565C0' : '#E65100';
            return '<div style="display:flex;align-items:center;gap:8px;">' +
                (i > 0 ? '<div style="color:#999;font-size:18px;margin:0 4px;">&#8594;</div>' : '') +
                '<div style="padding:8px 14px;background:' + bg + ';border:' + border + ';border-radius:8px;font-size:13px;color:' + color + ';font-weight:' + (isCurrent ? 'bold' : 'normal') + ';">' +
                esc(c.serviceName) +
                '<span style="margin-left:6px;font-size:11px;color:' + statusColor + ';">(' + statusLabel + ')</span>' +
                '</div></div>';
        }).join('');

        // 마지막에 현재 연계 대상 추가
        const targetStep = '<div style="display:flex;align-items:center;gap:8px;">' +
            '<div style="color:#999;font-size:18px;margin:0 4px;">&#8594;</div>' +
            '<div style="padding:8px 14px;background:#E8F5E9;border:2px solid #2E7D32;border-radius:8px;font-size:13px;color:#1B5E20;font-weight:bold;">' +
            esc(targetService) +
            '<span style="margin-left:6px;font-size:11px;color:#2E7D32;">(현재)</span>' +
            '</div></div>';

        chainHTML = [
            '<div style="margin-bottom:24px;padding:16px;background:#FAFAFA;border:1px solid #E0E0E0;border-radius:8px;">',
            '<p style="margin:0 0 12px;font-size:13px;color:#666;font-weight:bold;">연계 경로 (' + (chain.length + 1) + '단계)</p>',
            '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:4px;">',
            steps,
            targetStep,
            '</div></div>',
        ].join('');
    }

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
        '<p style="margin:0;font-size:14px;color:#333;">' + esc(reason) + '</p>',
        '</div>',
        // 연계 대상 서비스
        '<div style="margin-bottom:20px;padding:14px;background:#E3F2FD;border-radius:8px;">',
        '<p style="margin:0;font-size:13px;color:#1565C0;">연계 대상 서비스</p>',
        '<p style="margin:6px 0 0;font-size:17px;font-weight:bold;color:#0D47A1;">' + esc(targetService) + '</p>',
        '</div>',
        // 연계 경로 (거쳐간 모든 기관)
        chainHTML,
        // 원래 요청 정보
        '<p style="font-size:13px;color:#666;margin-bottom:8px;">신청자 정보</p>',
        '<table style="width:100%;border-collapse:collapse;font-size:14px;">',
        '<tr><td style="padding:8px 0;color:#666;width:110px;">최초 신청 서비스</td><td style="padding:8px 0;font-weight:bold;">' + esc(chain && chain.length > 0 ? chain[0].serviceName : request.serviceName) + '</td></tr>',
        '<tr style="border-top:1px solid #f0f0f0;"><td style="padding:8px 0;color:#666;">직전 연계 서비스</td><td style="padding:8px 0;font-weight:bold;">' + esc(request.serviceName) + '</td></tr>',
        '<tr style="border-top:1px solid #f0f0f0;"><td style="padding:8px 0;color:#666;">신청자 성함</td><td style="padding:8px 0;font-weight:bold;">' + esc(request.userName) + '</td></tr>',
        '<tr style="border-top:1px solid #f0f0f0;"><td style="padding:8px 0;color:#666;">연락처</td><td style="padding:8px 0;font-weight:bold;">' + esc(request.userPhone) + '</td></tr>',
        '<tr style="border-top:1px solid #f0f0f0;"><td style="padding:8px 0;color:#666;">최초 접수 일시</td><td style="padding:8px 0;">' + esc(chain && chain.length > 0 ? (chain[0].createdAt || request.createdAt) : request.createdAt) + '</td></tr>',
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

app.post('/api/tts', ttsLimiter, async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'text required' });
    const MAX_TTS_LENGTH = 2000;
    if (String(text).length > MAX_TTS_LENGTH) {
        return res.status(400).json({ error: `텍스트가 너무 깁니다. 최대 ${MAX_TTS_LENGTH}자까지 허용됩니다.` });
    }
    const ttsText = String(text).slice(0, MAX_TTS_LENGTH);
    analyticsStore.track('tts_request');

    try {
        const audioBase64 = await synthesizeTTS(ttsText);
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

// ── 보호된 API 인증 적용 ──
// case 페이지: 이메일 링크에서 접근하므로 토큰 기반 또는 세션 인증
app.use('/api/case', requireCaseAuth);
app.use('/api/dept', requireAuth);
app.use('/api/admin', requireAuth);
app.use('/api/staff', requireAuth);

// ── Case API Routes (담당자 처리 페이지용) ──

const MAX_REFERRAL_CHAIN_DEPTH = 10;
function getSafeReferralChain(requestId) {
    const chain = requestStore.getReferralChain(requestId);
    return chain.slice(0, MAX_REFERRAL_CHAIN_DEPTH);
}

// 상세 조회 + 연계 체인 + linkages
app.get('/api/case/:requestId', (req, res) => {
    const request = requestStore.findById(req.params.requestId);
    if (!request) return res.status(404).json({ error: '요청을 찾을 수 없습니다.' });
    const chain = getSafeReferralChain(req.params.requestId);
    res.json({ ...request, linkages: request.linkages || [], chain });
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

// ── 담당자/조정자용 AI 상담 API ──
app.post('/api/staff/chat', async (req, res) => {
    const { messages, requestId, role } = req.body;
    if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: 'messages array required' });
    }

    // 사건 데이터 로드 (requestId 제공 시)
    let caseContext = '';
    if (requestId) {
        const request = requestStore.findById(requestId);
        if (request) {
            const deptInfo = deptServiceMap[request.serviceName];
            const kbEntry = welfareKB.find(s => s['사업명'] === request.serviceName);
            caseContext = `\n[현재 사건 정보]
사건 ID: ${request.id}
신청 서비스: ${request.serviceName}
신청자: ${request.userName} (${request.userPhone})
접수일: ${request.createdAt}
현재 상태: ${request.status}
${request.conversationSummary ? '대화 요약:\n' + request.conversationSummary : ''}
${request.assignmentRationale ? '\nAI 배정 근거:\n' + request.assignmentRationale : ''}
${deptInfo ? `\n[담당 부서 정보]\n부서: ${deptInfo.dept}\n책임: ${deptInfo.responsibility}\n법적 근거: ${deptInfo.basis}\n자격 요건: ${deptInfo.keyEligibility.join(', ')}` : ''}
${kbEntry ? `\n[서비스 상세]\n지원 대상: ${kbEntry['지원 대상']}\n지원 내용: ${kbEntry['지원 내용']}\n신청 방법: ${kbEntry['신청 방법']}\n문의처: ${kbEntry['문의처']}` : ''}
${request.notes?.length ? '\n[처리 메모]\n' + request.notes.map(n => `[${n.author}] ${n.text}`).join('\n') : ''}`;

            // 연계/협업 기록 포함
            if (request.linkages?.length) {
                caseContext += '\n\n[연계/협업 이력]';
                request.linkages.forEach(l => {
                    if (l.category === 'referral') {
                        caseContext += `\n- 서비스연계: ${request.serviceName} → ${l.targetService} (사유: ${l.reason}, 상태: ${l.approvalStatus})`;
                    } else {
                        const fromName = getDeptNameById(l.fromDept);
                        const toName = getDeptNameById(l.toDept);
                        caseContext += `\n- 협업(${COLLAB_TYPE_NAMES[l.type] || l.type}): ${fromName} → ${toName} (사유: ${l.reason}, 상태: ${l.approvalStatus})`;
                    }
                });
            }
        }
    }

    // 전체 지식베이스 요약 (부서별 서비스 목록)
    const kbSummary = Object.entries(deptServiceMap).map(([name, info]) =>
        `- ${name}: ${info.dept} (${info.responsibility})`
    ).join('\n');

    const staffSystemPrompt = `당신은 경상남도사회서비스원의 내부 업무 지원 AI입니다.
담당자, 조정자, 관리자가 사건 처리와 관련하여 질문하면 논리적 근거와 함께 답변합니다.

[역할]
- 질의자 역할: ${role || '담당자'}
- 서비스 배정, 연계, 협업의 근거를 법적·제도적·실무적 관점에서 제시합니다.
- 이용자 상황과 서비스 자격요건 간의 매칭 논리를 설명합니다.

[핵심 원칙 - 비판적·객관적 의견 교환]
1. 일방적 답변 금지: 단순히 정보를 전달하는 것이 아니라, 논리적 근거와 함께 의견을 제시하세요.
2. 비판적 검토: 질의자의 의견에 논리와 근거가 있다면, 무조건 수긍하지 말고 그 논리의 타당성을 객관적으로 평가하세요.
   - 타당한 부분은 인정하되, 보완이 필요한 점도 지적하세요.
   - 반론이 있다면 구체적 근거(법적 근거, 실무 사례, 자격요건 등)와 함께 제시하세요.
3. 합리적 결론 도출: 서로 의견을 교환하면서 가장 합리적인 결론에 도달하도록 안내하세요.
   - "귀하의 의견에는 ~한 타당성이 있습니다. 다만, ~측면에서는 ~를 고려할 필요가 있습니다."
   - "이 점은 동의하지만, 반면에 ~라는 점도 검토해 보셔야 합니다."
4. 근거 제시 필수: 모든 주장에는 반드시 근거를 포함하세요.
   - 법적 근거: 관련 법률, 조례, 지침명
   - 제도적 근거: 부서 업무분장, 사업 운영 지침
   - 실무적 근거: 자격요건 매칭, 서비스 특성 분석
5. 의견 대립 시: 양측 논리를 정리하고, 각각의 장단점을 비교 분석한 뒤, 가장 합리적인 방안을 제안하세요.

[답변 구조]
질문 유형에 따라 적절한 구조로 답변하세요:

"이 서비스를 왜 우리 부서에서 해야 하나요?" 형태:
1. 배정 근거 요약 (핵심 2~3문장)
2. 법적/제도적 근거 (조문, 지침 등)
3. 이용자 상황과 자격요건 매칭 분석
4. 타 부서가 아닌 이유 (비교 분석)

"다른 부서에서 하는 게 맞지 않나요?" 형태:
1. 질의자의 논리 검토 (타당한 점 인정)
2. 반론 및 근거 제시
3. 비교 분석 (해당 부서 vs 제안된 부서)
4. 최종 권고안

"이 사건을 어떻게 처리해야 하나요?" 형태:
1. 사건 상황 분석
2. 권고 처리 방안
3. 확인 사항 및 주의점
4. 필요 시 연계/협업 제안

[전체 서비스 목록]
${kbSummary}

${deptProfiles}
${caseContext}`;

    try {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Connection': 'keep-alive',
            'Cache-Control': 'no-cache'
        });

        const userPrompt = messages.map(m => `${m.role === 'user' ? '질의자' : 'AI'}: ${m.content}`).join('\n');

        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                const responseStream = await ai.models.generateContentStream({
                    model: "gemini-2.5-flash",
                    contents: userPrompt,
                    config: {
                        systemInstruction: staffSystemPrompt,
                        temperature: 0.3,
                    }
                });

                for await (const chunk of responseStream) {
                    if (chunk.text) {
                        res.write(`data: ${JSON.stringify({ type: 'stream', text: chunk.text })}\n\n`);
                    }
                }
                res.write(`data: [DONE]\n\n`);
                res.end();
                return;
            } catch (e) {
                if (e.message?.includes('429') && attempt < 2) {
                    await new Promise(r => setTimeout(r, 3000));
                    continue;
                }
                throw e;
            }
        }
    } catch (e) {
        console.error('[Staff Chat Error]', e.message);
        res.write(`data: ${JSON.stringify({ type: 'error', error: 'AI 응답 중 오류가 발생했습니다.' })}\n\n`);
        res.write(`data: [DONE]\n\n`);
        res.end();
    }
});

// 부서 이름 조회 헬퍼 (ID 기반)
function getDeptNameById(id) {
    const dept = requestStore.DEPARTMENTS.find(d => d.id === id);
    return dept ? dept.name : id;
}

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

// 협업 요청 생성 → 통합 linkage로 생성 (승인 대기, 이메일 발송 안 함)
app.post('/api/case/:requestId/collaboration', async (req, res) => {
    const { fromDept, toDept, reason, type } = req.body;
    if (!fromDept || !toDept || !reason) {
        return res.status(400).json({ error: '요청 부서, 대상 부서, 사유를 모두 입력하세요.' });
    }
    if (fromDept === toDept) {
        return res.status(400).json({ error: '같은 부서에는 협업 요청할 수 없습니다.' });
    }

    // 통합 linkage로 생성 (pending 상태, 이메일 발송 없음)
    const linkage = requestStore.addLinkage(req.params.requestId, {
        category: 'collaboration',
        type: type || 'consultation',
        fromDept,
        toDept,
        reason,
        submittedBy: '담당자',
    });
    if (!linkage) return res.status(404).json({ error: '요청을 찾을 수 없습니다.' });

    const fromDeptName = getDeptName(fromDept);
    const toDeptName = getDeptName(toDept);
    console.log(`[연계 요청 생성] 협업: ${fromDeptName} → ${toDeptName} (승인 대기)`);

    res.json(linkage);
});

// 연계 실행 상태 변경
app.patch('/api/case/:requestId/collaboration/:collabId', (req, res) => {
    const { status } = req.body;
    const validStatuses = ['in_progress', 'completed', 'declined'];
    if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: '유효하지 않은 상태입니다.' });
    }
    const linkage = requestStore.updateLinkage(req.params.requestId, req.params.collabId, { executionStatus: status });
    if (!linkage) return res.status(404).json({ error: '연계 요청을 찾을 수 없습니다.' });
    res.json(linkage);
});

// 연계 메모 추가
app.post('/api/case/:requestId/collaboration/:collabId/notes', (req, res) => {
    const { text, author, dept } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: '메모 내용을 입력하세요.' });
    const linkage = requestStore.addLinkageNote(
        req.params.requestId, req.params.collabId,
        text.trim(), author || '담당자', dept || ''
    );
    if (!linkage) return res.status(404).json({ error: '연계 요청을 찾을 수 없습니다.' });
    res.json(linkage);
});

// ── 통합 연계(Linkage) API ──

// 통합 연계 생성 (이메일 안 보냄)
app.post('/api/case/:id/linkage', (req, res) => {
    const { category, type, fromDept, toDept, targetService, reason } = req.body;
    if (!reason) return res.status(400).json({ error: '사유를 입력하세요.' });
    if (category === 'collaboration' && (!fromDept || !toDept)) {
        return res.status(400).json({ error: '요청 부서와 대상 부서를 선택하세요.' });
    }
    if (category === 'referral' && !targetService) {
        return res.status(400).json({ error: '연계 대상 서비스를 선택하세요.' });
    }

    const linkage = requestStore.addLinkage(req.params.id, {
        category, type, fromDept, toDept, targetService, reason, submittedBy: '담당자',
    });
    if (!linkage) return res.status(404).json({ error: '요청을 찾을 수 없습니다.' });

    console.log(`[연계 요청 생성] ${category}: ${reason.slice(0, 30)}... (승인 대기)`);
    res.json(linkage);
});

// 연계 실행 상태 변경
app.patch('/api/case/:id/linkage/:lid', (req, res) => {
    const { executionStatus, reason, fromDept, toDept, targetService, type } = req.body;
    const updates = {};
    if (executionStatus !== undefined) updates.executionStatus = executionStatus;
    if (reason !== undefined) updates.reason = reason;
    if (fromDept !== undefined) updates.fromDept = fromDept;
    if (toDept !== undefined) updates.toDept = toDept;
    if (targetService !== undefined) updates.targetService = targetService;
    if (type !== undefined) updates.type = type;
    // 담당자 재제출 로직: 부서 조정자 반려/수정요청 → pending, 관리자 반려/수정요청 → dept_approved
    if (req.body.resubmit) {
        const currentReq = requestStore.findById(req.params.id);
        const currentLinkage = currentReq?.linkages?.find(l => l.id === req.params.lid);
        if (currentLinkage) {
            if (currentLinkage.approvalStatus === 'admin_rejected' || currentLinkage.approvalStatus === 'admin_revision_requested') {
                updates.approvalStatus = 'dept_approved'; // 관리자 반환 → 부서 조정자에게
            } else {
                updates.approvalStatus = 'pending'; // 부서 조정자 반려 → 처음부터
            }
        }
    }

    const linkage = requestStore.updateLinkage(req.params.id, req.params.lid, updates);
    if (!linkage) return res.status(404).json({ error: '연계 요청을 찾을 수 없습니다.' });
    res.json(linkage);
});

// 연계 메모 추가
app.post('/api/case/:id/linkage/:lid/notes', (req, res) => {
    const { text, author, dept } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: '메모 내용을 입력하세요.' });
    const linkage = requestStore.addLinkageNote(
        req.params.id, req.params.lid,
        text.trim(), author || '담당자', dept || ''
    );
    if (!linkage) return res.status(404).json({ error: '연계 요청을 찾을 수 없습니다.' });
    res.json(linkage);
});

// ── 부서 조정자 승인 API (1단계: pending → dept_approved / rejected / revision_requested) ──

// 부서 조정자 승인 대기 목록
app.get('/api/dept/pending-approvals', (req, res) => {
    const pending = requestStore.getDeptPendingApprovals();
    res.json({ count: pending.length, items: pending });
});

// 관리자에게 반환된 건 목록 (부서 조정자 재검토 필요)
app.get('/api/dept/returned-items', (req, res) => {
    const items = requestStore.getAdminReturnedItems();
    res.json({ count: items.length, items });
});

// 부서 조정자 승인 (pending → dept_approved)
app.post('/api/dept/linkage/:lid/approve', (req, res) => {
    const { comment } = req.body;
    const all = requestStore.listAll();
    let targetReq = null;
    for (const r of all) {
        if (!r.linkages) continue;
        if (r.linkages.find(l => l.id === req.params.lid)) { targetReq = r; break; }
    }
    if (!targetReq) return res.status(404).json({ error: '연계 요청을 찾을 수 없습니다.' });

    const linkage = requestStore.deptApproveLinkage(targetReq.id, req.params.lid, comment || '');
    if (!linkage) return res.status(400).json({ error: '부서 조정자 승인 처리 실패 (pending 상태가 아닙니다)' });

    console.log(`[부서 조정자 승인] ${req.params.lid}: ${comment || ''}`);
    res.json({ success: true, linkage });
});

// 부서 조정자 반려 (pending → rejected)
app.post('/api/dept/linkage/:lid/reject', (req, res) => {
    const { comment } = req.body;
    const all = requestStore.listAll();
    let targetReq = null;
    for (const r of all) {
        if (!r.linkages) continue;
        if (r.linkages.find(l => l.id === req.params.lid)) { targetReq = r; break; }
    }
    if (!targetReq) return res.status(404).json({ error: '연계 요청을 찾을 수 없습니다.' });

    const linkage = requestStore.deptRejectLinkage(targetReq.id, req.params.lid, comment || '');
    if (!linkage) return res.status(400).json({ error: '부서 조정자 반려 처리 실패 (pending 상태가 아닙니다)' });

    console.log(`[부서 조정자 반려] ${req.params.lid}: ${comment || '사유 없음'}`);
    res.json({ success: true, linkage });
});

// 부서 조정자 수정 요청 (pending → revision_requested)
app.post('/api/dept/linkage/:lid/revision', (req, res) => {
    const { comment } = req.body;
    const all = requestStore.listAll();
    let targetReq = null;
    for (const r of all) {
        if (!r.linkages) continue;
        if (r.linkages.find(l => l.id === req.params.lid)) { targetReq = r; break; }
    }
    if (!targetReq) return res.status(404).json({ error: '연계 요청을 찾을 수 없습니다.' });

    const linkage = requestStore.deptRequestRevision(targetReq.id, req.params.lid, comment || '');
    if (!linkage) return res.status(400).json({ error: '부서 조정자 수정 요청 처리 실패 (pending 상태가 아닙니다)' });

    console.log(`[부서 조정자 수정 요청] ${req.params.lid}: ${comment || ''}`);
    res.json({ success: true, linkage });
});

// 부서 조정자가 관리자 반환 건을 재검토 후 재제출 (admin_rejected/admin_revision_requested → dept_approved)
app.post('/api/dept/linkage/:lid/resubmit', (req, res) => {
    const { comment } = req.body;
    const all = requestStore.listAll();
    let targetReq = null;
    for (const r of all) {
        if (!r.linkages) continue;
        if (r.linkages.find(l => l.id === req.params.lid)) { targetReq = r; break; }
    }
    if (!targetReq) return res.status(404).json({ error: '연계 요청을 찾을 수 없습니다.' });

    const linkage = requestStore.deptResubmitLinkage(targetReq.id, req.params.lid, comment || '');
    if (!linkage) return res.status(400).json({ error: '재제출 처리 실패 (관리자 반환 상태가 아닙니다)' });

    console.log(`[부서 조정자 재제출] ${req.params.lid}: ${comment || ''}`);
    res.json({ success: true, linkage });
});

// ── 관리자 조정자 최종 승인 API (2단계: dept_approved → approved / admin_rejected / admin_revision_requested) ──

// 관리자 최종 승인 → 이메일 발송
app.post('/api/admin/linkage/:lid/approve', async (req, res) => {
    const { comment } = req.body;

    // linkageId로 해당 요청 찾기
    const all = requestStore.listAll();
    let targetReq = null;
    let targetLinkage = null;
    for (const r of all) {
        if (!r.linkages) continue;
        const found = r.linkages.find(l => l.id === req.params.lid);
        if (found) { targetReq = r; targetLinkage = found; break; }
    }
    if (!targetReq || !targetLinkage) return res.status(404).json({ error: '연계 요청을 찾을 수 없습니다.' });

    // 1. 승인 처리
    const linkage = requestStore.approveLinkage(targetReq.id, req.params.lid, comment || '');
    if (!linkage) return res.status(500).json({ error: '승인 처리 실패' });

    // 2. referral인 경우 새 요청 레코드 생성
    if (targetLinkage.category === 'referral' && targetLinkage.targetService) {
        analyticsStore.track('referral_sent');
        const newRequestId = crypto.randomUUID();
        const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

        requestStore.save({
            id: newRequestId,
            serviceName: targetLinkage.targetService,
            userName: targetReq.userName,
            userPhone: targetReq.userPhone,
            createdAt: now,
            createdAtISO: new Date().toISOString(),
            status: 'referred',
            referredFrom: targetReq.id,
            referrals: [],
        });

        // 원래 요청에 연계 기록 추가 (기존 호환)
        requestStore.addReferral(targetReq.id, {
            targetService: targetLinkage.targetService,
            reason: targetLinkage.reason,
            newRequestId,
            sentAt: now,
        });

        requestStore.updateLinkage(targetReq.id, req.params.lid, { newRequestId });
    }

    // 3. 이메일 발송
    const emailCaseToken = generateCaseToken(targetReq.id);
    const caseUrl = `${BASE_URL}/case/${targetReq.id}?token=${emailCaseToken}`;
    let subject, html;

    if (targetLinkage.category === 'referral') {
        const chain = getSafeReferralChain(targetReq.id);
        const refreshedLinkage = requestStore.findById(targetReq.id)?.linkages?.find(l => l.id === req.params.lid);
        const newRequestId = refreshedLinkage?.newRequestId;
        const refToken = newRequestId ? generateCaseToken(newRequestId) : emailCaseToken;
        subject = sanitizeEmailHeader(`[서비스 연계] ${targetLinkage.targetService} ← ${targetReq.serviceName} - 노마 AI`);
        html = buildReferralEmailHTML({
            request: targetReq,
            targetService: targetLinkage.targetService,
            reason: targetLinkage.reason,
            newRequestId: newRequestId || null,
            chain,
            caseToken: refToken,
        });
    } else {
        const fromDeptName = getDeptName(targetLinkage.fromDept);
        const toDeptName = getDeptName(targetLinkage.toDept);
        const typeName = COLLAB_TYPE_NAMES[targetLinkage.type] || '자문 요청';
        subject = sanitizeEmailHeader(`[협업 요청] ${typeName} - ${fromDeptName} → ${toDeptName}`);
        html = buildCollaborationEmailHTML({
            request: targetReq, collab: targetLinkage,
            fromDeptName, toDeptName, typeName, caseUrl,
        });
    }

    try {
        await emailTransporter.sendMail({
            from: { name: '노마 AI', address: process.env.SMTP_USER },
            to: DEV_RECIPIENT,
            subject,
            html: { content: Buffer.from(html, 'utf-8'), contentType: 'text/html; charset=utf-8' },
        });
        console.log(`[승인 후 이메일 발송 완료] ${subject}`);

        // 4. executionStatus = 'email_sent'
        requestStore.updateLinkage(targetReq.id, req.params.lid, { executionStatus: 'email_sent' });

        res.json({ success: true, linkage: requestStore.findById(targetReq.id)?.linkages?.find(l => l.id === req.params.lid) });
    } catch (err) {
        console.error('[승인 후 이메일 발송 실패]', err.message);
        // 승인은 됐지만 이메일 실패
        requestStore.updateLinkage(targetReq.id, req.params.lid, { executionStatus: 'email_failed' });
        res.json({ success: true, emailError: true, linkage });
    }
});

// 반려
app.post('/api/admin/linkage/:lid/reject', (req, res) => {
    const { comment } = req.body;
    const all = requestStore.listAll();
    let targetReq = null;
    for (const r of all) {
        if (!r.linkages) continue;
        if (r.linkages.find(l => l.id === req.params.lid)) { targetReq = r; break; }
    }
    if (!targetReq) return res.status(404).json({ error: '연계 요청을 찾을 수 없습니다.' });

    const linkage = requestStore.rejectLinkage(targetReq.id, req.params.lid, comment || '');
    if (!linkage) return res.status(500).json({ error: '반려 처리 실패' });

    console.log(`[연계 반려] ${req.params.lid}: ${comment || '사유 없음'}`);
    res.json({ success: true, linkage });
});

// 수정 요청
app.post('/api/admin/linkage/:lid/revision', (req, res) => {
    const { comment } = req.body;
    const all = requestStore.listAll();
    let targetReq = null;
    for (const r of all) {
        if (!r.linkages) continue;
        if (r.linkages.find(l => l.id === req.params.lid)) { targetReq = r; break; }
    }
    if (!targetReq) return res.status(404).json({ error: '연계 요청을 찾을 수 없습니다.' });

    const linkage = requestStore.requestRevision(targetReq.id, req.params.lid, comment || '');
    if (!linkage) return res.status(500).json({ error: '수정 요청 처리 실패' });

    console.log(`[수정 요청] ${req.params.lid}: ${comment || ''}`);
    res.json({ success: true, linkage });
});

// 전체 연계 목록
app.get('/api/admin/linkages', (req, res) => {
    res.json(requestStore.getActiveLinkages());
});

// 승인 대기 건수
app.get('/api/admin/pending-approvals', (req, res) => {
    const pending = requestStore.getPendingApprovals();
    res.json({ count: pending.length, items: pending });
});

// 서비스 계획 저장
app.post('/api/case/:id/service-plan', (req, res) => {
    const { steps } = req.body;
    if (!steps || !Array.isArray(steps)) {
        return res.status(400).json({ error: '서비스 계획 단계가 필요합니다.' });
    }
    const plan = requestStore.setServicePlan(req.params.id, { steps });
    if (!plan) return res.status(404).json({ error: '요청을 찾을 수 없습니다.' });
    res.json(plan);
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

// A-02: 상담 요청 상세 + A-05 연계 체인 + linkages
app.get('/api/admin/requests/:id', (req, res) => {
    const request = requestStore.findById(req.params.id);
    if (!request) return res.status(404).json({ error: '요청을 찾을 수 없습니다.' });
    const chain = getSafeReferralChain(req.params.id);
    res.json({ ...request, linkages: request.linkages || [], chain });
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

// 전체 활성 협업 목록 (linkages 기반으로 변환)
app.get('/api/admin/collaborations', (req, res) => {
    const linkages = requestStore.getActiveLinkages();
    // 기존 admin.html 호환을 위해 collaboration 형식으로 변환
    const mapped = linkages.map(l => ({
        ...l,
        status: l.executionStatus === 'completed' ? 'completed'
            : l.executionStatus === 'declined' ? 'declined'
            : l.executionStatus === 'in_progress' ? 'accepted'
            : l.approvalStatus === 'pending' ? 'requested'
            : l.approvalStatus === 'dept_approved' ? 'requested'
            : l.approvalStatus === 'approved' ? 'accepted'
            : l.approvalStatus === 'rejected' ? 'declined'
            : l.approvalStatus === 'admin_rejected' ? 'declined'
            : l.approvalStatus === 'admin_revision_requested' ? 'requested'
            : 'requested',
    }));
    res.json(mapped);
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

// ── 글로벌 에러 핸들러 ──

// Express 글로벌 에러 핸들러 (라우트 핸들러에서 잡히지 않은 에러)
app.use((err, req, res, _next) => {
    console.error('[Express Error]', err.stack || err.message);
    if (!res.headersSent) {
        res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
});

// 프로세스 레벨 에러 핸들러
process.on('unhandledRejection', (reason, promise) => {
    console.error('[Unhandled Rejection]', reason);
});

process.on('uncaughtException', (err) => {
    console.error('[Uncaught Exception]', err);
    // 안전한 종료를 위해 로그 기록 후 프로세스 유지 (PM2 등에서 재시작)
});

app.listen(PORT, () => {
    console.log(`Noma API Server running on http://localhost:${PORT}`);

    // SMTP 연결 검증
    if (process.env.SMTP_USER && process.env.SMTP_PASSWORD) {
        emailTransporter.verify()
            .then(() => console.log('[SMTP] 메일 서버 연결 확인 완료'))
            .catch(err => console.error('[SMTP] 메일 서버 연결 실패:', err.message));
    } else {
        console.warn('[SMTP] SMTP_USER 또는 SMTP_PASSWORD 환경변수가 설정되지 않았습니다.');
    }
});
