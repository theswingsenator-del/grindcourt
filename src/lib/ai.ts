// Thin, pluggable LLM wrapper. One function in, one string out.
//
// AI_PROVIDER=groq      → Groq free tier (default — Gemini's free tier grants
//                          0 quota on this account, confirmed via direct API
//                          test from two different keys/networks, so Groq is
//                          the actual working free option)
// AI_PROVIDER=gemini    → Gemini free tier (kept for later — currently 0 quota)
// AI_PROVIDER=anthropic → Claude (claude-sonnet-5)
//
// Every caller in this app (goal breakdown, judge, police nag copy) only
// ever calls askAI(systemPrompt, userPrompt) — switching providers is a
// single env var change, zero code changes anywhere else.

const ANTHROPIC_MODEL = "claude-sonnet-5";
const GEMINI_MODEL = "gemini-2.0-flash";
const GROQ_MODEL = "llama-3.3-70b-versatile";

async function callAnthropic(systemPrompt: string, userPrompt: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Anthropic API error ${res.status}: ${text}`);
  }
  const data = await res.json();
  const text = data?.content?.[0]?.text;
  if (typeof text !== "string") throw new Error("Anthropic API: unexpected response shape");
  return text;
}

async function callGemini(systemPrompt: string, userPrompt: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      }),
      signal: AbortSignal.timeout(30000),
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gemini API error ${res.status}: ${text}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string") throw new Error("Gemini API: unexpected response shape");
  return text;
}

async function callGroq(systemPrompt: string, userPrompt: string): Promise<string> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY not set");

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Groq API error ${res.status}: ${text}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new Error("Groq API: unexpected response shape");
  return text;
}

/**
 * Calls the configured LLM provider and returns its raw text response.
 * Throws on failure — callers that need structured output (JSON) should
 * catch and retry/validate; see lib/goalBreakdown.ts for that pattern.
 */
export async function askAI(systemPrompt: string, userPrompt: string): Promise<string> {
  const provider = (process.env.AI_PROVIDER || "groq").toLowerCase();
  if (provider === "anthropic") return callAnthropic(systemPrompt, userPrompt);
  if (provider === "gemini") return callGemini(systemPrompt, userPrompt);
  if (provider === "groq") return callGroq(systemPrompt, userPrompt);
  throw new Error(`Unknown AI_PROVIDER "${provider}" — expected "groq", "gemini", or "anthropic"`);
}
