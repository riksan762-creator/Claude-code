/**
 * Riksan AI — /api/chat
 * Vercel Serverless Function (Node.js runtime).
 *
 * This proxies chat requests to AgentRouter's Anthropic-compatible endpoint
 * (https://agentrouter.org/v1/messages) instead of api.anthropic.com directly.
 * AgentRouter is a third-party service, not an official Anthropic product —
 * traffic passes through their servers first.
 *
 * The token is read ONLY here, from the ANTHROPIC_AUTH_TOKEN environment
 * variable set in the Vercel project settings — it is never sent to, or
 * stored in, the browser.
 *
 * GET  /api/chat  -> lightweight health check the frontend uses to show
 *                    the "Terhubung" / "Kunci API belum diatur" status pill.
 * POST /api/chat  -> { messages: [{ role, content }, ...] } -> { reply }
 */

const ANTHROPIC_VERSION = "2023-06-01";
const AGENTROUTER_URL = "https://agentrouter.org/v1/messages";
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

  const cleanMessages = messages
    .filter((m) => m && typeof m.content === "string" && m.content.trim().length > 0)
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content.slice(0, 8000),
    }))
    .slice(-30); // keep payloads bounded

  if (cleanMessages.length === 0) {
    return res.status(400).json({ error: "Tidak ada pesan yang valid untuk dikirim." });
  }

  try {
    const upstream = await fetch(AGENTROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${authToken}`,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: cleanMessages,
      }),
    });

    const data = await upstream.json();

    if (!upstream.ok) {
      const message = data?.error?.message || "Terjadi kesalahan pada layanan AI.";
      return res.status(upstream.status).json({ error: message });
    }

    const reply = (data.content || [])
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    return res.status(200).json({ reply: reply || "Maaf, saya tidak dapat memberikan jawaban saat ini." });
  } catch (err) {
    console.error("Riksan AI upstream error:", err);
    return res.status(502).json({ error: "Tidak dapat menghubungi layanan AI. Coba lagi sebentar lagi." });
  }
};
