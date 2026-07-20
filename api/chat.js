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
    // Tambahkan timeout 25 detik agar tidak melampaui limit Vercel (10-30s)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

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
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Ambil respons mentah sebagai teks terlebih dahulu untuk keamanan
    const rawText = await upstream.text();

    // 1. Tangani jika status HTTP upstream BUKAN 2xx (misal: 401, 404, 500, 502, 503)
    if (!upstream.ok) {
      console.error(`AgentRouter Upstream Error [${upstream.status}]:`, rawText);

      let errorMessage = `Upstream error (${upstream.status})`;

      // Cek apakah balasan berupa JSON atau HTML error dari Cloudflare/Vercel
      if (rawText.startsWith("{") || rawText.startsWith("[")) {
        try {
          const parsedError = JSON.parse(rawText);
          errorMessage = parsedError?.error?.message || parsedError?.message || errorMessage;
        } catch (_) {
          /* Abaikan jika gagal parse */
        }
      } else if (rawText.includes("<!DOCTYPE") || rawText.includes("<html")) {
        errorMessage = "Layanan AgentRouter sedang bermasalah atau mengembalikan halaman error (HTML).";
      }

      return res.status(upstream.status).json({ error: errorMessage });
    }

    // 2. Parse JSON hanya jika HTTP status OK (200)
    let data;
    try {
      data = JSON.parse(rawText);
    } catch (parseErr) {
      console.error("Gagal melakukan parse JSON dari respons AgentRouter:", rawText);
      return res.status(502).json({ error: "Respons dari layanan AI tidak valid." });
    }

    const reply = (data.content || [])
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    return res.status(200).json({ reply: reply || "Maaf, saya tidak dapat memberikan jawaban saat ini." });
  } catch (err) {
    console.error("Riksan AI upstream error:", err);

    if (err.name === "AbortError") {
      return res.status(504).json({ error: "Waktu permintaan ke layanan AI habis (Timeout)." });
    }

    return res.status(502).json({ error: "Tidak dapat menghubungi layanan AI. Coba lagi sebentar lagi." });
  }
};
