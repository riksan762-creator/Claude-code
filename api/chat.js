/**
 * Riksan AI — /api/chat
 * Vercel Serverless Function (Node.js runtime).
 *
 * Menggunakan Jalur OpenAI-Compatible AgentRouter untuk bypass Aliyun WAF Captcha.
 * Endpoint: https://agentrouter.org/v1/chat/completions
 */

const AGENTROUTER_URL = "https://agentrouter.org/v1/chat/completions";
const DEFAULT_MODEL = "claude-opus-4-6";
const MAX_TOKENS = 1024;

const SYSTEM_PROMPT = `Anda adalah Riksan AI, asisten percakapan yang ramah, jelas, dan efisien.
Jawab dalam bahasa yang sama dengan pertanyaan pengguna (utamakan Bahasa Indonesia jika tidak ditentukan).
Berikan jawaban yang ringkas namun lengkap, gunakan poin-poin bila membantu, dan jujur ketika tidak yakin akan sesuatu.`;

module.exports = async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(process.env.ANTHROPIC_AUTH_TOKEN ? 200 : 503).json({
      ok: Boolean(process.env.ANTHROPIC_AUTH_TOKEN),
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Metode tidak diizinkan." });
  }

  const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
  if (!authToken) {
    return res.status(503).json({
      error: "Server belum dikonfigurasi. Atur ANTHROPIC_AUTH_TOKEN di pengaturan Vercel.",
    });
  }

  const { messages } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Field 'messages' wajib diisi dan tidak boleh kosong." });
  }

  // Format pesan disesuaikan dengan struktur OpenAI Chat Completion
  const formattedMessages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...messages
      .filter((m) => m && typeof m.content === "string" && m.content.trim().length > 0)
      .map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content.slice(0, 8000),
      }))
      .slice(-30),
  ];

  if (formattedMessages.length <= 1) {
    return res.status(400).json({ error: "Tidak ada pesan yang valid untuk dikirim." });
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    const upstream = await fetch(AGENTROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${authToken}`,
        // Menyamar sebagai User-Agent browser modern standar untuk menembus WAF
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
        max_tokens: MAX_TOKENS,
        messages: formattedMessages,
        stream: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const rawText = await upstream.text();

    // 1. Cek jika masih kena blokir Aliyun WAF Captcha
    if (rawText.includes("aliyun_waf") || rawText.includes("AliyunCaptcha")) {
      console.error("AgentRouter WAF Error: Terdeteksi Aliyun Captcha.");
      return res.status(503).json({
        error: "Server AI sedang sibuk/dibatasi oleh WAF. Silakan coba beberapa saat lagi.",
      });
    }

    // 2. Cek HTTP status error
    if (!upstream.ok) {
      console.error(`AgentRouter Error [${upstream.status}]:`, rawText.slice(0, 300));
      let errorMessage = `Upstream error (${upstream.status})`;

      try {
        const parsed = JSON.parse(rawText);
        errorMessage = parsed?.error?.message || parsed?.message || errorMessage;
      } catch (_) {}

      return res.status(upstream.status).json({ error: errorMessage });
    }

    // 3. Extract balasan format OpenAI (data.choices[0].message.content)
    let reply = "";
    try {
      const data = JSON.parse(rawText);
      reply = data.choices?.[0]?.message?.content?.trim() || "";
    } catch (parseErr) {
      console.warn("Gagal parse JSON OpenAI:", rawText.slice(0, 200));
      reply = rawText.trim();
    }

    return res.status(200).json({
      reply: reply || "Maaf, tidak ada balasan dari model AI.",
    });

  } catch (err) {
    console.error("Riksan AI upstream error:", err);

    if (err.name === "AbortError") {
      return res.status(504).json({ error: "Waktu permintaan ke layanan AI habis (Timeout)." });
    }

    return res.status(502).json({ error: "Tidak dapat menghubungi layanan AI. Coba lagi sebentar lagi." });
  }
};
