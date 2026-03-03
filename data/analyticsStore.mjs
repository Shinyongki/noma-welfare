// data/analyticsStore.mjs — 시스템 이용 통계 이벤트 트래킹
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'analytics.json');

const BACKUP_FILE = DATA_FILE + '.bak';

function readAll() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
        }
    } catch (e) {
        console.error('[ANALYTICS CORRUPTION] analytics.json 파싱 실패:', e.message);
        if (fs.existsSync(BACKUP_FILE)) {
            try {
                const backup = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf-8'));
                console.warn('[ANALYTICS RECOVERY] 백업에서 복구 성공');
                fs.writeFileSync(DATA_FILE, JSON.stringify(backup, null, 2), 'utf-8');
                return backup;
            } catch { /* 백업도 손상 */ }
        }
        const corruptFile = DATA_FILE + '.corrupt.' + Date.now();
        try { fs.renameSync(DATA_FILE, corruptFile); } catch {}
        console.error(`[ANALYTICS] 손상 파일 보존: ${corruptFile}`);
    }
    return {};
}

function writeAll(data) {
    const json = JSON.stringify(data, null, 2);
    if (fs.existsSync(DATA_FILE)) {
        try { fs.copyFileSync(DATA_FILE, BACKUP_FILE); } catch {}
    }
    const tmpFile = DATA_FILE + '.tmp';
    fs.writeFileSync(tmpFile, json, 'utf-8');
    fs.renameSync(tmpFile, DATA_FILE);
}

function todayKey() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }); // YYYY-MM-DD
}

/** 이벤트 1건 기록 */
export function track(event) {
    const store = readAll();
    const day = todayKey();
    if (!store[day]) store[day] = {};
    store[day][event] = (store[day][event] || 0) + 1;
    writeAll(store);
}

/** 최근 N일 이벤트 데이터 반환 */
export function getRange(days = 7) {
    const store = readAll();
    const result = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const key = d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
        result.push({ date: key, ...(store[key] || {}) });
    }
    return result;
}

/** KPI 계산 (최근 N일 집계) */
export function getKPI(days = 7) {
    const range = getRange(days);

    let chatRequest = 0, chatVoice = 0, ragMatch = 0, ragNoMatch = 0;
    let serviceApply = 0, ttsRequest = 0, referralSent = 0;

    range.forEach(d => {
        chatRequest += d.chat_request || 0;
        chatVoice += d.chat_voice || 0;
        ragMatch += d.rag_match || 0;
        ragNoMatch += d.rag_no_match || 0;
        serviceApply += d.service_apply || 0;
        ttsRequest += d.tts_request || 0;
        referralSent += d.referral_sent || 0;
    });

    const totalRag = ragMatch + ragNoMatch;
    const ragMatchRate = totalRag > 0 ? Math.round((ragMatch / totalRag) * 100) : 0;
    const conversionRate = chatRequest > 0 ? Math.round((serviceApply / chatRequest) * 100) : 0;
    const voiceRate = chatRequest > 0 ? Math.round((chatVoice / chatRequest) * 100) : 0;
    const bounceRate = totalRag > 0 ? Math.round((ragNoMatch / totalRag) * 100) : 0;
    const ttsRate = chatRequest > 0 ? Math.round((ttsRequest / chatRequest) * 100) : 0;

    return {
        chatRequest, chatVoice, ragMatch, ragNoMatch,
        serviceApply, ttsRequest, referralSent,
        ragMatchRate, conversionRate, voiceRate, bounceRate, ttsRate,
    };
}
