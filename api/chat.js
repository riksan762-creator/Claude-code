export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { message } = req.body;

    const response = await fetch(
      `${process.env.ANTHROPIC_BASE_URL}/v1/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.ANTHROPIC_AUTH_TOKEN}`,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL,
          max_tokens: 1024,
          messages: [
            {
              role: "user",
              content: message
            }
          ]
        })
      }
    );

    const data = await response.json();

    res.status(200).json({
      reply: data.content?.[0]?.text || "Tidak ada respon."
    });

  } catch (e) {
    res.status(500).json({
      error: e.message
    });
  }
}
