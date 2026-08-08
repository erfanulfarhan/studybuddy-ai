// Vercel serverless function — the AI brain for StudyBuddy.
// Keeps the Gemini key server-side (process.env.GEMINI_API_KEY); the browser
// only ever sends note text and gets back a summary / answer / quiz.

const MODEL = "gemini-flash-latest";           // free-tier friendly
const ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

function prompt(mode, text, question) {
  const notes = (text || "").slice(0, 30000);   // keep requests sane
  if (mode === "summary") {
    return `You are a study assistant. Summarise the notes below into clear,
well-organised revision notes: short bullet points grouped under topic headings,
with the key terms in **bold**. Be concise and faithful to the source.

NOTES:
${notes}`;
  }
  if (mode === "ask") {
    return `You are a study assistant. Answer the student's question using the
notes below. If the answer isn't in the notes, say so briefly, then give your
best general answer. Keep it clear and student-friendly.

NOTES:
${notes}

QUESTION: ${question}`;
  }
  // quiz
  return `From the notes below, write ${question || 5} multiple-choice questions
that test real understanding (not trivia). Each has exactly 4 options, one
correct. Return STRICT JSON only:
{"questions":[{"q":"...","options":["..","..","..",".."],"answer":0,"explanation":"..."}]}

NOTES:
${notes}`;
}

async function callGemini(key, body) {
  const TRIES = 3;
  let lastMsg = "the AI is busy";
  for (let attempt = 0; attempt < TRIES; attempt++) {
    const r = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok) return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    lastMsg = data?.error?.message || `HTTP ${r.status}`;
    // 429 = rate limit, 503 = model overloaded — both transient; back off & retry.
    const transient = r.status === 429 || r.status === 503 || /overload|high demand|try again/i.test(lastMsg);
    if (transient && attempt < TRIES - 1) {
      await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
      continue;
    }
    throw new Error(lastMsg);
  }
  throw new Error(lastMsg);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return res.status(500).json({ error: "Server is missing GEMINI_API_KEY." });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const { text = "", mode = "summary", question = "" } = body || {};
  if (!text.trim() && mode !== "ask") {
    return res.status(400).json({ error: "Give me some notes first." });
  }

  const gen = { maxOutputTokens: 2048, temperature: 0.4 };
  if (mode === "quiz") gen.responseMimeType = "application/json";  // force clean JSON

  try {
    const out = await callGemini(key, {
      contents: [{ parts: [{ text: prompt(mode, text, question) }] }],
      generationConfig: gen,
    });

    if (mode === "quiz") {
      let quiz;
      try { quiz = JSON.parse(out); } catch { quiz = null; }
      if (!quiz?.questions?.length) {
        return res.status(502).json({ error: "Couldn't build a quiz from that — try more notes." });
      }
      return res.status(200).json({ quiz });
    }
    return res.status(200).json({ text: out.trim() });
  } catch (e) {
    const rateLimited = /quota|rate|429|exhaust/i.test(String(e.message));
    return res.status(rateLimited ? 429 : 502).json({
      error: rateLimited
        ? "The AI is rate-limited right now (free tier). Give it a few seconds and try again."
        : `AI error: ${e.message}`,
    });
  }
}
