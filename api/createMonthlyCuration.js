// /api/createMonthlyCuration.js

// Firebase Admin SDK (Firestore 접근용)
import admin from 'firebase-admin';

// --- 1. Firebase Admin 초기화 (마스터 키 사용) ---
let db; // DB를 전역 변수로 선언만 함
try {
  if (!admin.apps.length) {
    // 초기화가 중복 실행되지 않도록 방지
    admin.initializeApp({
      credential: admin.credential.cert(
        JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
      ),
    });
  }
  // 2. 초기화 성공 시에만 db 인스턴스 할당
  db = admin.firestore();
} catch (e) {
  // ★★★
  // 이 에러가 Vercel 로그에 뜬다면, 100% 환경 변수(FIREBASE_SERVICE_ACCOUNT_JSON) 문제입니다.
  // ★★★
  console.error('CRITICAL: Firebase Admin Init Error:', e.message);
  // db는 'undefined' 상태로 남음
}

// --- 3. 메인 핸들러 (Flutter의 요청을 받는 곳) ---
export default async function handler(req, res) {
  // 4. 핸들러 시작 시 db가 초기화되었는지 '먼저' 확인
  if (!db) {
    console.error(
      "Handler Error: Firestore DB is not initialized. Check 'CRITICAL' log."
    );
    // "It does not have HTTP ok status" 에러의 원인이 되는 500 응답
    return res.status(500).json({
      error: 'Server Error: Firebase Admin initialization failed.',
      log_message:
        "Check Vercel logs for 'CRITICAL: Firebase Admin Init Error'",
    });
  }

  // (보안) POST 요청이 아니면 거부
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // --- [테스트용: 인증 제거됨] ---
  // Vercel이 '누가' 요청했는지 확인하지 않습니다.
  // --- [테스트용: 인증 제거됨] ---

  try {
    const { month } = req.body; // Flutter가 보낸 "7월"
    if (!month) {
      return res.status(400).json({ error: 'Month is required' });
    }

    // --- [1단계: GPT 창작] (OpenAI API 가이드 준수) ---
    console.log(`1/5: GPT에게 ${month} 구문 50개 창작 요청...`);
    const gptPrompt = `${month}에 어울리는 실존하는 유명한 책 구문 50개를 JSON 배열(키: "quotes", 각 객체는 "text"와 "source" 필드를 가짐) 형식으로 '창작'해줘.`;

    const gptResponse = await fetch(
      'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Vercel 환경 변수에서 OpenAI API 키를 읽어옴
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4-turbo', // (JSON 모드를 지원하는 모델)
          messages: [{ role: 'user', content: gptPrompt }],
          response_format: { type: 'json_object' },
        }),
      }
    );

    const gptData = await gptResponse.json();
    if (gptData.error) throw new Error(`GPT Error: ${gptData.error.message}`);
    // GPT가 생성한 JSON에서 구문 배열(quotes) 추출
    const gptQuotes = JSON.parse(gptData.choices[0].message.content).quotes;

    // --- [2단계: Gemini 검증 (가정)] (Gemini API 가이드 준수) ---
    console.log("2/5: Gemini에게 '환상' 검증 요청...");
    const geminiPrompt = `현재 이 50개의 구문들은 생성형 AI가 실제로 존재한다며 알려준 책 구문들이야. 이중에 실제 존재하지 않는 구문들은 빼고 '실제 존재하는 구문'만 JSON 배열(키: "verified_quotes")로 다시 알려줘. ${JSON.stringify(
      gptQuotes
    )}`;
    const geminiUrl =
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

    const geminiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: {
        // Vercel 환경 변수에서 Gemini API 키를 읽어옴
        'x-goog-api-key': process.env.GEMINI_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: geminiPrompt }] }],
      }),
    });

    const geminiData = await geminiResponse.json();
    if (geminiData.error)
      throw new Error(`Gemini Error: ${geminiData.error.message}`);
    // Gemini가 검증(했다고 가정한) JSON에서 구문 배열 추출
    const verifiedQuotes = JSON.parse(
      geminiData.candidates[0].content.parts[0].text
    ).verified_quotes;

    // --- [3단계: Firestore DB 중복 검사 (읽기)] ---
    console.log('3/5: Firestore DB와 중복 검사 시작...');
    const existingQuotesSet = new Set();
    const snapshot = await db.collection('quotes').get(); // db 변수 사용
    snapshot.forEach((doc) => {
      // (Flutter 'quote_model.dart'의 'sentence' 필드)
      existingQuotesSet.add(doc.data().sentence);
    });

    // --- [4단계: 최종 필터링] ---
    // Gemini가 검증한 구문 중, 내 DB에 '없는' 구문만 최종 선별
    const finalNewQuotes = verifiedQuotes.filter(
      (quote) => !existingQuotesSet.has(quote.text)
    );
    console.log(`4/5: 최종 ${finalNewQuotes.length}개 구문 선별 완료.`);

    // --- [5단계: Firestore DB 저장 (쓰기)] ---
    if (finalNewQuotes.length > 0) {
      const batch = db.batch(); // db 변수 사용
      finalNewQuotes.forEach((quote) => {
        const newDocRef = db.collection('quotes').doc();
        batch.set(newDocRef, {
          sentence: quote.text, // (Flutter 'quote_model.dart'의 'sentence')
          author: quote.source || '출처 불명 (AI 생성)', // (Flutter 'quote_model.dart'의 'author')
          month_theme: month,
          createdAt: admin.firestore.FieldValue.serverTimestamp(), // (Flutter 'quote_model.dart'의 'createdAt')
        });
      });
      await batch.commit(); // Batch 실행 (쓰기 작업 1회로 처리)
      console.log('5/5: Firestore에 신규 구문 저장 완료.');
    } else {
      console.log('5/5: 추가할 신규 구문이 없습니다.');
    }

    // --- 6. Flutter에 최종 성공 응답 ---
    res.status(200).json({
      message: '큐레이션 성공',
      new_quotes_added: finalNewQuotes.length,
    });
  } catch (error) {
    // 핸들러 실행 중(AI 호출, DB 접근 등) 에러 발생 시
    console.error('Vercel Handler Runtime Error:', error);
    res.status(500).json({ error: error.message });
  }
}
