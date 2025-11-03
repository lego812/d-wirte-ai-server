import admin from 'firebase-admin';

// --- 1. Firebase Admin 초기화 (마스터 키 사용) ---
let db; // DB를 전역 변수로 선언만 함
try {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(
        JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
      ),
    });
  }
  // 2. 초기화 성공 시에만 db 인스턴스 할당
  db = admin.firestore();
} catch (e) {
  console.error('CRITICAL: Firebase Admin Init Error:', e.message);
  // db는 'undefined' 상태로 남음
}

// --- 2. 메인 핸들러 (Flutter의 요청을 받는 곳) ---
export default async function handler(req, res) {
  // 3. 핸들러 시작 시 db가 초기화되었는지 '먼저' 확인
  if (!db) {
    console.error(
      "Handler Error: Firestore DB is not initialized. Check 'CRITICAL' log."
    );
    return res.status(500).json({
      error: 'Server Error: Firebase Admin initialization failed.',
      log_message:
        "Check Vercel logs for 'CRITICAL: Firebase Admin Init Error'",
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // (이하 로직은 동일)
  try {
    const { month } = req.body;
    if (!month) {
      return res.status(400).json({ error: 'Month is required' });
    }

    // --- [1단계: GPT 창작] ---
    console.log(`1/5: GPT에게 ${month} 구문 50개 창작 요청...`);
    // ... (이하 모든 AI 호출 및 DB 저장 로직은 동일) ...

    const gptPrompt = `${month}에 어울리는 실존하는 유명한 책 구문 50개를 JSON 배열(키: "quotes", 각 객체는 "text"와 "source" 필드를 가짐) 형식으로 '창작'해줘.`;
    // ...
    const gptResponse = await fetch(
      'https://api.openai.com/v1/chat/completions',
      {
        /* ... */
      }
    );
    // ...

    // --- [2단계: Gemini 검증 (가정)] ---
    console.log("2/5: Gemini에게 '환상' 검증 요청...");
    // ...
    const geminiResponse = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      {
        /* ... */
      }
    );
    // ...

    // --- [3단계: Firestore DB 중복 검사 (읽기)] ---
    console.log('3/5: Firestore DB와 중복 검사 시작...');
    const existingQuotesSet = new Set();
    const snapshot = await db.collection('quotes').get(); // db 변수 사용
    // ...

    // --- [4단계: 최종 필터링] ---
    console.log(`4/5: 최종 구문 선별 완료.`);
    // ...

    // --- [5단계: Firestore DB 저장 (쓰기)] ---
    if (finalNewQuotes.length > 0) {
      const batch = db.batch(); // db 변수 사용
      // ...
      await batch.commit();
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
    console.error('Vercel Handler Runtime Error:', error);
    res.status(500).json({ error: error.message });
  }
}
