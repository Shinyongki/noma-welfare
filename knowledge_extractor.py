import os
import csv
import time
import requests
from bs4 import BeautifulSoup
import google.generativeai as genai

# ==========================================
# ⚙️ 설정 (Configuration)
# ==========================================
# 1. 이곳에 발급받으신 Gemini API 키를 넣어주세요.
GEMINI_API_KEY = "AIzaSyCLGdaxUntcBOurJMM9CwnN8P2JX3DMPP0"

# 2. 크롤링을 시작할 경상남도사회서비스원 페이지 목록 (예시)
# 이 리스트에 사업 안내 페이지 URL들을 계속 추가하시면 됩니다.
TARGET_URLS = [
    "https://gn.pass.or.kr/sub04/sub01_01.php", # 경상남도장애인종합복지관
    "https://gn.pass.or.kr/sub04/sub02_01.php", # 경상남도보조기기센터
    "https://gn.pass.or.kr/sub04/sub03_01.php", # 경상남도피해장애인쉼터
    "https://gn.pass.or.kr/sub04/sub04_01.php", # 경상남도청어린이집
]

# 결과물이 저장될 분배 파일 이름
OUTPUT_CSV_FILE = "temp_지식베이스.csv"

# ==========================================

# 제미나이 AI 클라이언트 설정
genai.configure(api_key=GEMINI_API_KEY)

# Gemini 모델 설정 (Gemini 1.5 Flash 권장: 빠르고 저렴하며 텍스트 처리에 우수함)
generation_config = {
  "temperature": 0.2, # 일관된 답변을 위해 낮게 설정
  "top_p": 0.95,
  "top_k": 64,
  "max_output_tokens": 8192,
}

model = genai.GenerativeModel(
  model_name="gemini-1.5-flash",
  generation_config=generation_config,
)

def scrape_page_content(url):
    """
    주어진 URL에 접속하여 빵부스러기(메뉴) 카테고리와 본문 텍스트를 긁어옵니다.
    """
    print(f"🌐 접속 중: {url}")
    try:
        # User-Agent를 설정하여 웹서버가 봇 차단을 하지 않도록 방지
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
        response = requests.get(url, headers=headers)
        response.raise_for_status() # 에러 발생 시 예외 처리
        
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # 1. 빵부스러기(Breadcrumb) 추출을 통한 대/중/소분류 파악
        category_nav = soup.find('div', class_='path') # 실제 홈페이지 소스코드에 맞게 수정 필요
        categories = []
        if category_nav:
            # 예: 홈 > 주요사업 > 민간지원 사업 > 대체인력지원
            categories = [item.text.strip() for item in category_nav.find_all('span') if item.text.strip() != '']
        
        # 분류가 제대로 잡히지 않았을 경우 기본값
        large_cat = categories[1] if len(categories) > 1 else '분류없음'
        mid_cat = categories[2] if len(categories) > 2 else '분류없음'
        small_cat = categories[3] if len(categories) > 3 else '분류없음'

        # 2. 본문 텍스트 추출
        # 홈페이지 구조에 따라 본문을 담고 있는 tag(ex: div class="content_box")를 지정
        content_area = soup.find('div', id='sub') 
        raw_text = content_area.get_text(separator='\n', strip=True) if content_area else "본문 없음"
        
        return {
            "large_cat": large_cat,
            "mid_cat": mid_cat,
            "small_cat": small_cat,
            "raw_text": raw_text
        }
        
    except Exception as e:
        print(f"❌ 접속 오류 ({url}): {e}")
        return None

def extract_with_gemini(scraped_data):
    """
    긁어온 원본 텍스트를 제미나이에게 넘겨서 JSON(구조화된 데이터) 형태로 변경합니다.
    """
    print("🤖 제미나이 텍스트 요약 및 구조화 시작...")
    
    prompt = f"""
너는 지금부터 공공기관(경상남도사회서비스원)의 AI 맞춤형 복지 네비게이터에 탑재될 '지식베이스' 구축을 담당하는 전문 데이터 엔지니어이자 AI 학습 데이터 설계자야.

다음은 기관 홈페이지의 특정 사업 페이지에서 긁어온 원문 텍스트야.
이 정제되지 않은 텍스트를 읽고, 아래의 6가지 핵심 항목에 맞게 완벽하게 요약 및 추출해서 **반드시 순수한 JSON 배열 형식**으로만 답변해줘. 마크다운이나 다른 설명은 절대 넣지 마.

[원문 텍스트]
{scraped_data['raw_text']}

[추출해야 할 6가지 핵심 항목 (JSON 키 이름)]
- "Title": 사업명 (복지 사업의 정확한 명칭)
- "Tags": 이 사업을 찾을 법한 대상자나 상황을 일상어 키워드로 3~5개 추출 (예: "#노인, #혼자, #거동불편")
- "Eligibility": 지원 대상 (연령, 기준, 소득 요건 등)
- "Core_Benefits": 지원 내용 (현금, 물품, 방문 서비스 등 핵심만 요약)
- "How_to_Apply": 신청 방법 및 절차 (장소, 필요 서류 등)
- "Contact": 담당 부서 및 문의처 (부서명, 전화번호)

* 주의사항: 
1. 원문에 없는 내용은 절대 지어내지 말고 빈 문자열("")로 남겨둘 것.
2. 결과물은 단 1개의 JSON Object를 담은 배열(`[ {{...}} ]`) 형태로 출력할 것. 예를 들어 원문이 여러 사업을 설명한다면 배열 안에 여러 개의 Object를 만들 것.
    """

    try:
        response = model.generate_content(prompt)
        # 제미나이의 응답에서 JSON부분만 추출 (가끔 마크다운 코드블럭을 씌우는 경우 대비)
        response_text = response.text.strip()
        if response_text.startswith("```json"):
            response_text = response_text[7:]
        if response_text.endswith("```"):
            response_text = response_text[:-3]
            
        return response_text.strip()
        
    except Exception as e:
        print(f"❌ 제미나이 처리 오류: {e}")
        return None

def save_to_csv(structured_data_list, filename):
    """
    리스트에 담긴 데이터들을 CSV 파일로 저장합니다.
    """
    print(f"💾 데이터 저장 중: {filename}")
    
    # 엑셀에서 한글이 깨지지 않도록 'utf-8-sig' 인코딩 사용
    with open(filename, 'w', newline='', encoding='utf-8-sig') as csvfile:
        fieldnames = ['대분류', '중분류', '소분류', '사업명', '키워드 태그', '지원 대상', '지원 내용', '신청 방법', '문의처', '출처 URL']
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)

        writer.writeheader()
        
        # 제미나이가 준 JSON 문자열을 파이썬 배열 리스트로 변환 (eval 혹은 json.loads 사용)
        import json
        
        for item in structured_data_list:
             try:
                 # 제미나이 응답 형태가 리스트 문자열이라고 가정
                 json_objects = json.loads(item['gemini_response'])
                 
                 for obj in json_objects:
                     writer.writerow({
                        '대분류': item['large_cat'],
                        '중분류': item['mid_cat'],
                        '소분류': item['small_cat'],
                        '사업명': obj.get('Title', ''),
                        '키워드 태그': obj.get('Tags', ''),
                        '지원 대상': obj.get('Eligibility', ''),
                        '지원 내용': obj.get('Core_Benefits', ''),
                        '신청 방법': obj.get('How_to_Apply', ''),
                        '문의처': obj.get('Contact', ''),
                        '출처 URL': item['url']
                     })
             except Exception as e:
                 print(f"JSON 파싱 에러 발생, 해당 데이터 스킵: {e}")
                 print(f"에러 원인 텍스트: {item['gemini_response']}")

def main():
    if GEMINI_API_KEY == "여기에_API_키를_입력하세요":
        print("⚠️ 오류: GEMINI_API_KEY를 코드 상단에 입력해주세요!")
        return

    all_structured_data = []

    print("🚀 지식베이스 자동 데이터 추출 스크립트를 시작합니다...")
    
    for url in TARGET_URLS:
        # 1. 웹페이지 긁어오기 (카테고리 + 본문)
        scraped_data = scrape_page_content(url)
        
        if scraped_data and scraped_data['raw_text'] != "본문 없음":
            # 2. 제미나이에게 던져서 A~G열 규격에 맞는 JSON 문자열 뽑아내기
            gemini_response = extract_with_gemini(scraped_data)
            
            if gemini_response:
                all_structured_data.append({
                    "url": url,
                    "large_cat": scraped_data['large_cat'],
                    "mid_cat": scraped_data['mid_cat'],
                    "small_cat": scraped_data['small_cat'],
                    "gemini_response": gemini_response
                })
            
            # 서버 무리를 주지 않기 위해 3초 휴식 (매너 딜레이)
            time.sleep(3) 

    # 3. 완성된 데이터를 CSV 엑셀로 저장하기
    if all_structured_data:
        save_to_csv(all_structured_data, OUTPUT_CSV_FILE)
        print(f"🎉 성공! {OUTPUT_CSV_FILE} 파일이 바탕화면(현재 폴더)에 생성되었습니다.")
    else:
        print("🤷‍♂️ 저장할 데이터가 수집되지 않았습니다.")

if __name__ == "__main__":
    main()
