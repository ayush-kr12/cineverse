// Vercel serverless function: keeps the OMDb API key on the server.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");

  const key = process.env.OMDB_API_KEY;
  if (!key) return res.status(500).json({ Response: "False", Error: "Server API key is not configured." });

  const title = String(req.query.t || "").trim().slice(0, 150);
  const type = req.query.type === "series" ? "series" : "movie";
  const plot = req.query.plot === "full" ? "full" : "short";
  if (!title) return res.status(400).json({ Response: "False", Error: "A title is required." });

  try {
    const params = new URLSearchParams({ apikey: key, t: title, type, plot });
    const upstream = await fetch(`https://www.omdbapi.com/?${params.toString()}`);
    const data = await upstream.json();
    return res.status(upstream.ok ? 200 : upstream.status).json(data);
  } catch {
    return res.status(502).json({ Response: "False", Error: "Could not reach OMDb." });
  }
}
