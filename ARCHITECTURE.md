# 시스템 개발 원칙 및 페르소나 아키텍처 (ARCHITECTURE)

본 프로젝트 **"AI 맞춤형 복지 내비게이터"**는 Actionable Intelligence Platform을 지향하며, 다음의 4대 핵심 원칙과 2-Track 페르소나 아키텍처를 기반으로 설계 및 고도화됩니다. 모든 신규 파트너 개발자는 아래의 철학을 준수하여 코드를 작성해야 합니다.

---

## Part 1. 핵심 4대 개발 원칙

### 1. 모듈화 및 확장성 (Modularity & Scalability)
*   프론트엔드 UI 컴포넌트(챗봇 위젯, 결과 카드 등)와 백엔드 AI 응답 로직(RAG 시스템)은 철저히 분리되어 동작해야 합니다. (현재 `System → Noma API → Frontend` 구조 지향)
*   지식베이스(KB)는 향후 확장성을 고려해 단순 CSV에서 Vector DB로 이관하기 쉬운 형태로 추상화되어야 합니다.

### 2. 실시간 상호작용성 강화 (Real-time Interactivity)
*   대화는 끊김이 없어야 하며, `localStorage` 기반 단기 메모리와 DB 기반의 `내 서랍` 장기 메모리가 결합되어 브라우저 새로고침이나 세션 만료 후에도 즉시 맥락(Context)을 100% 복원해 내야 합니다.
*   사용자의 입력에 대해 "즉각적인 피드백(Streaming Response)"을 제공하여 기다리는 시간을 최소화합니다.

### 3. AI 기반 의사결정 보조 (AI-Driven Decision Support)
*   AI는 단순한 검색기가 아니라, 사용자의 단편적인 발화에서 숨은 의도를 파악(Slot-Filling)하여 최적의 복지 솔루션을 "제안(Propose)"해야 합니다.
*   반드시 **Strict Grounding** 원칙을 시스템 프롬프트에 강제하여, 외부 지식을 통한 팩트 왜곡(Hallucination)을 원천 차단하고 오직 사서원 공식 DB 정보만을 근거로 삼아야 합니다.

### 4. 개발자 경험 최적화 (Optimized DX)
*   코드베이스는 직관적이어야 하며, 복잡한 기능 추가 시 `workflows` 문서화 체계를 통해 팀 내 지식이 수월하게 재사용되고 상속되어야 합니다.

---

## Part 2. 노마(Noma) 다중 페르소나 관리 아키텍처

우리의 AI 모델(Noma)은 배포 환경과 마주하는 대상(개발 파트너 vs 최종 도민)에 따라 완전히 다른 두 가지 얼굴(Persona)을 가지고 동작해야 합니다. 이를 시스템적으로 관리하기 위한 아키텍처 설계는 다음과 같습니다.

### 페르소나 1: 개발 모드 PM 
*   **타겟**: 개발 파트너 (Internal Developers)
*   **역할**: 코드베이스 분석, 버그 수정 기획, 시스템 고도화 논의, `request_code_task` 도구(Tool)를 활용한 인박스 큐(Queue) 자동 등록.
*   **활성화 환경**: 환경변수 `NODE_ENV=development` 

### 페르소나 2: 대국민 서비스 모드 (복지 상담원)
*   **타겟**: 최종 사용자 (도민, 고령자)
*   **역할**: 쉬운 언어로 복지 정보 안내, 개인 상황에 맞는 혜택 추천, 담당 기관 이메일 상담 예약 연계 플로우 진행.
*   **활성화 환경**: 환경변수 `NODE_ENV=production`

### 동적 페르소나 전환 메커니즘 설계 (Implementation Guide)
백엔드(`server.js` 또는 라우팅 컨트롤러)는 진입 시 환경변수를 확인하여 시스템 프롬프트와 지식베이스(KB) 소스를 완전하게 분리 라우팅합니다.

```javascript
// 페르소나 선택기 (Persona Selector) 예시 구조 제안
function getPersonaEnvirnoment() {
    const isDev = process.env.NODE_ENV === 'development';
    
    return {
        systemPrompt: isDev ? PROMPT_DEV_PM : PROMPT_PUBLIC_CITIZEN,
        tools: isDev ? [requestCodeTaskTool] : [emailAgencyConnectTool], // 가용 Action 다름
        knowledgeBase: isDev ? "SourceCode_and_Architecture_Docs" : "Welfare_Services_VectorDB"
    }
}
```

이러한 **동적 페르소나 전환 메커니즘**을 통해 동일한 챗봇 껍데기(UI) 안에서도 상황과 권한에 따라 전혀 다른 차원의 지능과 권한(Functions)을 부여할 수 있으며, 향후 "관리자 통계 모드(Admin)" 등 제3의 페르소나를 추가할 때에도 매우 유연하게 확장 가능합니다.
