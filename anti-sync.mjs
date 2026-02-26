#!/usr/bin/env node

import fs from "fs";
import path from "path";

const API_BASE = "http://localhost:5000/api";

async function run() {
    const command = process.argv[2];

    if (!command || command === 'list') {
        try {
            const res = await fetch(`${API_BASE}/code-tasks`);
            if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
            const tasks = await res.json();
            const pendingTasks = tasks.filter(t => t.status === "pending");

            console.log("\n=============================================");
            console.log(`🤖 [노마(Noma) -> 앤티(Anti) 작업 요청 목록]`);
            console.log("=============================================\n");

            if (pendingTasks.length === 0) {
                console.log("🎉 현재 대기 중인 수정 지시 사항이 없습니다.\n");
                return;
            }

            pendingTasks.forEach((req, i) => {
                console.log(`[Task ID: ${req.id}] - [${req.type.toUpperCase()}]`);
                console.log(`📌 제목: ${req.title}`);
                console.log(`💡 배경 맥락:\n  ${req.context}`);
                console.log(`📝 요청 내용:\n  ${req.description}`);
                console.log("---------------------------------------------");
            });

            console.log(`\n총 ${pendingTasks.length}건의 대기 중인 작업이 있습니다.`);
            console.log(`해결하려면: node anti-sync.mjs resolve <Task_ID> "해결 내용 설명"`);

        } catch (e) {
            console.error("❌ 서버와 통신할 수 없습니다. 로컬 Noma 서버가 켜져 있는지 확인하세요. (node server.js)");
            console.error(e.message);
        }
    } else if (command === 'resolve') {
        const id = process.argv[3];
        const resolution = process.argv[4];

        if (!id || !resolution) {
            console.log("사용법: node anti-sync.mjs resolve <Task_ID> \"해결 완료 설명\"");
            return;
        }

        try {
            const res = await fetch(`${API_BASE}/code-tasks/${id}/resolve`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ resolution })
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || `HTTP Error: ${res.status}`);
            }

            console.log(`✅ [Task ID: ${id}] 작업 완료(Resolved) 처리가 정상적으로 보고되었습니다!`);
            console.log(`   해결 내용: ${resolution}`);

        } catch (e) {
            console.error(`❌ 수락 보고 실패: ${e.message}`);
        }
    } else {
        console.log("사용 불가 명령어입니다. list 또는 resolve 를 사용하세요.");
    }
}

run();
