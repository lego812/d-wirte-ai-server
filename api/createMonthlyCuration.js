// /api/createMonthlyCuration.js

// Firebase Admin SDK (Firestore 접근용)
import admin from "firebase-admin";

// --- 1. Firebase Admin 초기화 (마스터 키 사용) ---
// Vercel 환경 변수에서 서비스 계정 키를 읽어옵니다.
try {
  if (!admin.apps.length) { // 초기화가 중복 실행되지 않도록 방지
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON))
    });
  }
} catch (e) { 
  console.error("Firebase Admin Init Error:", e.message); 
}
const db = admin.firestore(); // Firestore DB 인스턴스 생성


// --- 2. 메인 핸들러 (Flutter의 요청을 받는 곳) ---
// 이 파일의 기본 내보내기(export default)로 Vercel이 이 함수를 인식합니다.
export default async function handler(req, res) {
  
  // (보안) POST 요청이 아니면 거부
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // (보안) Flutter에서 보낸 관리자 인증 토큰 검증 (추후 구현 권장)
  // const idToken = req.headers.authorization?.split('Bearer ')[1];
  // try {
  //   const decodedToken = await admin.auth().verifyIdToken(idToken);
  //   if (!decodedToken.admin) { // 'admin' 클레임이 있는 관리자인지 확인
  //     return res.status(403).json({ error: 'Forbidden: Admin access required' });
  //   }
  // } catch (e) {
  //   return res.status(401).json({ error: 'Unauthorized' });
  // }

  try {
    const { month } = req.body; // Flutter가 보낸 "7월"
    if (!month) {
      return res.status(400).json({ error: 'Month is required' });
    }

    // --- [1단계: GPT 창작] (OpenAI API 가이드 준수) ---
    console.log(`1/5: GPT에게 ${month} 구문 50개 창작 요청...`);
    // GPT에게 전달할 프롬프트 (요구사항에 맞게 수정)
    const gptPrompt = `${month}에 어울리는 실존하는 유명한 책 구문 50개를 JSON 배열(키: "quotes", 각 객체는 "text"와 "source" 필드를 가짐) 형식으로 '창작'해줘.`;

    const gptResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Vercel 환경 변수에서 OpenAI API 키를 읽어와 헤더에 삽입
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}` 
      },
      body: JSON.stringify({
        // JSON 응답을 받기 위해 'messages'와 'response_format' 사용
        "model": "gpt-4-turbo", // (JSON 모드를 지원하는 모델)
        "messages": [{ "role": "user", "content": gptPrompt }],
        "response_format": { "type": "json_object" }
      })
    });

    const gptData = await gptResponse.json();
    if (gptData.error) throw new Error(`GPT Error: ${gptData.error.message}`);
    // GPT가 생성한 JSON에서 구문 배열(quotes) 추출
    const gptQuotes = JSON.parse(gptData.choices[0].message.content).quotes; 

    
    // --- [2단계: Gemini 검증 (가정)] (Gemini API 가이드 준수) ---
    console.log("2/5: Gemini에게 '환상' 검증 요청...");
    // Gemini에게 전달할 프롬프트 (GPT가 만든 구문 포함)
    const geminiPrompt = `현재 이 50개의 구문들은 생성형 AI가 실제로 존재한다며 알려준 책 구문들이야. 이중에 실제 존재하지 않는 구문들은 빼고 '실제 존재하는 구문'만 JSON 배열(키: "verified_quotes")로 다시 알려줘. ${JSON.stringify(gptQuotes)}`;

    // Gemini API 엔드포인트 URL
    const geminiUrl = "https://generativelangugage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

    const geminiResponse = await fetch(geminiUrl, {
      method: "POST",
      headers: {
        // Vercel 환경 변수에서 Gemini API 키를 읽어와 헤더에 삽입
        "x-goog-api-key": process.env.GEMINI_API_KEY,
        "Content-Type": "application/json"
      },
      // Gemini API가 요구하는 'contents' 바디 구조
      body: JSON.stringify({
        "contents": [
          { "parts": [{ "text": geminiPrompt }] }
        ]
      })
    });

    const geminiData = await geminiResponse.json();
    if (geminiData.error) throw new Error(`Gemini Error: ${geminiData.error.message}`);
    // Gemini가 검증(했다고 가정한) JSON에서 구문 배열 추출
    const verifiedQuotes = JSON.parse(geminiData.candidates[0].content.parts[0].text).verified_quotes; 

    
    // --- [3단계: Firestore DB 중복 검사 (읽기)] ---
    console.log("3/5: Firestore DB와 중복 검사 시작...");
    const existingQuotesSet = new Set();
    // 'quotes' 컬렉션 전체를 읽어옴 (Spark 플랜의 일일 무료 읽기 한도 내에서 주의)
    const snapshot = await db.collection('quotes').get();
    snapshot.forEach(doc => {
      existingQuotesSet.add(doc.data().text); // DB의 모든 구문 텍스트를 Set에 저장
    });

    // --- [4단계: 최종 필터링] ---
    // Gemini가 검증한 구문 중, 내 DB에 '없는' 구문만 최종 선별
    const finalNewQuotes = verifiedQuotes.filter(quote => 
      !existingQuotesSet.has(quote.text) 
    );
    console.log(`4/5: 최종 ${finalNewQuotes.length}개 구문 선별 완료.`);

    // --- [5단계: Firestore DB 저장 (쓰기)] ---
    if (finalNewQuotes.length > 0) {
      // 여러 문서를 한 번에 쓰기 위해 Batch 사용 (비용 절감)
      const batch = db.batch();
      finalNewQuotes.forEach(quote => {
        const newDocRef = db.collection('quotes').doc(); // 새 문서 생성
        batch.set(newDocRef, {
          text: quote.text,
          source: quote.source || "출처 불명 (AI 생성)",
          month_theme: month, // 이 구문이 생성된 테마
          created_at: admin.firestore.FieldValue.serverTimestamp()
        });
      });
      await batch.commit(); // Batch 실행 (쓰기 작업 1회로 처리)
      console.log("5/5: Firestore에 신규 구문 저장 완료.");
    } else {
      console.log("5/5: 추가할 신규 구문이 없습니다.");
    }

    // --- 6. Flutter에 최종 성공 응답 ---
    res.status(200).json({ 
      message: "큐레이션 성공", 
      new_quotes_added: finalNewQuotes.length 
    });

  } catch (error) {
    // 파이프라인 중간에 에러가 발생한 경우
    console.error("Vercel 함수 에러:", error);
    res.status(500).json({ error: error.message });
  }
}