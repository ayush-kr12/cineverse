import { useEffect, useMemo, useState } from "react";
import titles from "./titles.json";
import "./style.css";

const sections = ["All-Time Movies", "Movies Since 2000", "TV Series"];
const categories = ["Greatest", "Popular & Highly Rated", "Underrated Gems"];

function formatRuntime(value) {
  if (!value || value === "N/A") return null;
  const minutes = Number.parseInt(value, 10);
  if (!Number.isFinite(minutes)) return value;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (!hours) return `${remaining} min`;
  return remaining ? `${hours} hr ${remaining} min` : `${hours} hr`;
}

function validValue(value) {
  return value && value !== "N/A" ? value : null;
}

export default function App() {
  const [section, setSection] = useState(sections[0]);
  const [category, setCategory] = useState("Greatest");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [watchlist, setWatchlist] = useState(() => {
    try { return JSON.parse(localStorage.getItem("mr-watchlist") || "[]"); }
    catch { return []; }
  });
  const [selected, setSelected] = useState(null);
  const [showRoulette, setShowRoulette] = useState(false);
  const [winner, setWinner] = useState(null);
  const [statuses, setStatuses] = useState(() => {
    try { return JSON.parse(localStorage.getItem("mr-statuses") || "{}"); }
    catch { return {}; }
  });
  const [wheelItems, setWheelItems] = useState([]);
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  // Keep successful OMDb results between visits so posters/details do not need
  // to be downloaded again after a refresh or browser restart.
  const [metadata, setMetadata] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("cineverse-metadata-cache") || "{}");
      return Object.fromEntries(Object.entries(saved).filter(([, value]) => value && value.Response !== "False" && value.Title));
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      const successful = Object.fromEntries(Object.entries(metadata).filter(([, value]) => value && value.Response !== "False" && value.Title));
      localStorage.setItem("cineverse-metadata-cache", JSON.stringify(successful));
    } catch {
      // If browser storage is full or unavailable, the app still works for this session.
    }
  }, [metadata]);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [detailError, setDetailError] = useState("");

  const filtered = useMemo(() => titles
    .filter(t => (filter === "watchlist" || (t.section === section && t.category === category)) && t.title.toLowerCase().includes(query.toLowerCase()))
    .filter(t => filter === "all" || (filter === "watchlist" ? watchlist.includes(t.id) : (statuses[t.id] || "unmarked") === filter))
    .map(t => ({ ...t, status: statuses[t.id] || "unmarked" })),
    [section, category, query, filter, statuses, watchlist]);

  // Fetch metadata for a small visible batch. Successful results are saved in localStorage.
  useEffect(() => {
    let cancelled = false;
    async function loadVisiblePosters() {
      // Load only a small batch at a time to avoid exhausting the OMDb quota.
      for (const item of filtered.slice(0, 8)) {
        if (cancelled) return;
        if (metadata[item.id]) continue;
        try {
          const type = item.section === "TV Series" ? "series" : "movie";
          const params = new URLSearchParams({ t: item.title, type, plot: "short" });
          const response = await fetch(`/api/omdb?${params.toString()}`);
          const data = await response.json();
          if (cancelled) return;
          setMetadata(previous => ({
            ...previous,
            [item.id]: response.ok && data.Response !== "False"
              ? data
              : { Response: "False", Error: data.Error || "Not found" }
          }));
        } catch {
          // Keep the placeholder if the request fails.
        }
      }
    }
    loadVisiblePosters();
    return () => { cancelled = true; };
  }, [filtered, metadata]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    async function loadDetails() {
      const cached = metadata[selected.id];
      if (cached && cached.Response !== "False" && cached.Title && cached._fullDetails) {
        setDetailError("");
        setLoadingDetails(false);
        return;
      }
      setLoadingDetails(true);
      setDetailError("");
      try {
        const type = selected.section === "TV Series" ? "series" : "movie";
        const params = new URLSearchParams({ t: selected.title, type, plot: "full" });
        const response = await fetch(`/api/omdb?${params.toString()}`);
        const data = await response.json();
        if (!response.ok || data.Response === "False") {
          const message = data.Error || "OMDb could not find this title.";
          if (/limit|quota/i.test(message)) throw new Error("OMDb request limit reached. Details will load again when your API quota resets. Try again later.");
          throw new Error(message);
        }
        if (!cancelled) setMetadata(prev => ({ ...prev, [selected.id]: { ...data, _fullDetails: true } }));
      } catch (error) {
        if (!cancelled) setDetailError(error.message || "Could not load details. Check your internet connection and OMDb key.");
      } finally {
        if (!cancelled) setLoadingDetails(false);
      }
    }
    loadDetails();
    return () => { cancelled = true; };
  }, [selected, metadata]);

  const toggleWatchlist = item => {
    const next = watchlist.includes(item.id) ? watchlist.filter(id => id !== item.id) : [...watchlist, item.id];
    setWatchlist(next);
    localStorage.setItem("mr-watchlist", JSON.stringify(next));
  };

  const changeStatus = (item, status) => {
    const next = { ...statuses, [item.id]: status };
    setStatuses(next);
    localStorage.setItem("mr-statuses", JSON.stringify(next));
  };

  const surprise = (scope = "all") => {
    if (spinning) return;
    // Surprise Me uses all collections; Roulette uses the currently selected section and category.
    const eligible = titles.filter(item => !["watched", "unwanted"].includes(statuses[item.id]));
    const pool = scope === "section"
      ? eligible.filter(item => item.section === section && item.category === category)
      : eligible;
    if (!pool.length) {
      window.alert(scope === "section"
        ? "No eligible titles remain in this section and category. Try another category or reset a title's status."
        : "No eligible titles remain.");
      return;
    }
    const picked = pool[Math.floor(Math.random() * pool.length)];
    const others = pool.filter(t => t.id !== picked.id).sort(() => Math.random() - 0.5).slice(0, 7);
    const items = [picked, ...others].sort(() => Math.random() - 0.5);
    const index = items.findIndex(t => t.id === picked.id);
    const target = (360 - ((index + 0.5) * (360 / items.length)) % 360 + 360) % 360;
    setWheelItems(items);
    setWinner(null);
    setSpinning(true);
    setRotation(r => r + 1800 + target);
    window.setTimeout(() => {
      setSpinning(false);
      setWinner(picked);
      // Laptop/homepage wheel opens the winner details automatically.
      // Dedicated mobile Roulette shows the winner card first.
      if (!showRoulette) setSelected(picked);
    }, 5200);
  };

  const count = s => titles.filter(t => t.section === s).length;
  const details = selected ? metadata[selected.id] : null;
  const runtime = formatRuntime(validValue(details?.Runtime));
  const poster = validValue(details?.Poster);
  const genres = validValue(details?.Genre);
  const plot = validValue(details?.Plot);
  const imdbRating = validValue(details?.imdbRating);
  const imdbVotes = validValue(details?.imdbVotes);

  return <div className="shell">
    <style>{`@media (max-width: 700px) { .mobile-home-surprise { display: none !important; } }`}</style>
    <header><a className="brand" href="#" onClick={e => { e.preventDefault(); setSection(sections[0]); setCategory("Greatest"); }}>CINE<span>VERSE</span></a><span className="tagline">YOUR NEXT GREAT WATCH STARTS HERE</span><span className="star">✦</span></header>
    <main>
      <section className="hero"><div><small>A PERSONAL CINEMA COMPANION</small><h1>Find your next<br/><i>great watch.</i></h1><p>Three curated collections. 350 titles. One spin away.</p><button className="gold mobile-home-surprise" onClick={surprise} disabled={spinning}>✦ &nbsp; {spinning ? "Spinning…" : "Surprise Me"}</button></div>
        <div className="art wheel-area" style={{ height: "auto", minHeight: 0, overflow: "visible", display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}><div className="wheel-pointer">▼</div><div className="wheel" style={{ transform: `rotate(${rotation}deg)`, transition: spinning ? "transform 5.2s cubic-bezier(.12,.72,.08,1)" : "transform .2s" }}><div className="wheel-hub">CV</div></div><button className="wheel-spin" onClick={() => surprise("section")} disabled={spinning} style={{ position: "static", marginTop: "8px", flexShrink: 0 }}>{spinning ? "SPINNING…" : "SPIN THE WHEEL"}</button></div>
      </section>
      <section className="collections">{sections.map((s, i) => <button key={s} onClick={() => { setSection(s); setCategory("Greatest"); setWinner(null); }} className={section === s ? "active" : ""}><small>0{i + 1}</small><b>{s}</b><span>{count(s)} titles</span><i>↗</i></button>)}</section>
      <section className="library"><div className="heading"><div><small>THE COLLECTION</small><h2>{section}</h2></div><span className="pill">{count(section)} titles</span></div>
        <nav className="tabs">{categories.map(c => <button className={category === c ? "on" : ""} key={c} onClick={() => { setCategory(c); setWinner(null); }}>{c}</button>)}</nav>
        <div className="tools"><label className="search">⌕ <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search titles..."/></label><select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All titles</option><option value="unmarked">Not marked</option><option value="watched">Watched</option><option value="unwanted">Unwanted</option><option value="watchlist">Watchlist</option></select><span>{filtered.length} shown</span></div>
        {winner && <div className="winner"><small>✦ YOUR PICK</small><b>{winner.title}</b><button onClick={surprise}>Spin again ↻</button></div>}
        <div className="grid">{filtered.map((t, i) => {
          const cardPoster = validValue(metadata[t.id]?.Poster);
          return <article key={t.id} onClick={() => setSelected(t)}>
            <div className={`poster ${cardPoster ? "poster-with-image" : ""}`}>
              {cardPoster ? <img className="card-poster-image" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} src={cardPoster} alt={`${t.title} poster`} loading="lazy" onError={e => { e.currentTarget.style.display = "none"; }} /> : <><small>{String(i + 1).padStart(2, "0")}</small><strong>{section === "TV Series" ? "▣" : "✦"}</strong><b>{t.title}</b></>}
            </div>
            <div className="title">{t.title}</div>
            <small className="meta">{t.year || "Details pending"} · {t.status}{watchlist.includes(t.id) ? " · ★ Watchlist" : ""}</small>
          </article>;
        })}</div>
        {!filtered.length && <p className="empty">No titles match. Try another search or filter.</p>}
      </section>
    </main>
    <nav className="bottom"><button onClick={() => { setShowRoulette(false); setFilter("all"); setSection(sections[0]); setCategory("Greatest"); }}>⌂<small>Home</small></button><button onClick={() => { setShowRoulette(false); setFilter("all"); window.setTimeout(() => document.querySelector(".search input")?.focus(), 0); }}>⌕<small>Search</small></button><button onClick={() => { setShowRoulette(false); surprise("all"); }}>✦<small>Surprise Me</small></button><button onClick={() => { setShowRoulette(false); setFilter("watched"); }}>✓<small>Watched</small></button><button onClick={() => { setShowRoulette(false); setFilter("unwanted"); }}>⊘<small>Unwanted</small></button><button onClick={() => { setShowRoulette(false); setFilter("watchlist"); }}>★<small>Watchlist</small></button></nav>
    {showRoulette && <div role="dialog" aria-modal="true" aria-label="Roulette" style={{ position: "fixed", inset: 0, zIndex: 1200, background: "#101116", color: "#fff", overflowY: "auto", padding: "20px 16px 100px", display: "flex", flexDirection: "column", alignItems: "center", gap: "18px" }}>
      <div style={{ width: "100%", maxWidth: "520px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div><small style={{ color: "#d8b56d", letterSpacing: "2px" }}>CINEVERSE</small><h2 style={{ margin: "6px 0 0" }}>Roulette</h2></div>
        <button onClick={() => setShowRoulette(false)} aria-label="Close roulette" style={{ fontSize: "28px", padding: "4px 12px", borderRadius: "10px" }}>×</button>
      </div>
      <div className="art wheel-area" style={{ display: "flex", width: "100%", maxWidth: "420px", flexDirection: "column", alignItems: "center" }}>
        <div className="wheel-pointer">▼</div>
        <div className="wheel" style={{ width: "min(78vw, 340px)", height: "min(78vw, 340px)", position: "relative", transform: `rotate(${rotation}deg)`, transition: spinning ? "transform 5.2s cubic-bezier(.12,.72,.08,1)" : "transform .2s" }}>
          
          <div className="wheel-hub">CV</div>
        </div>
        <button className="wheel-spin" onClick={surprise} disabled={spinning} style={{ marginTop: "18px" }}>{spinning ? "SPINNING…" : "SPIN THE WHEEL"}</button>
      </div>
      {winner && <div style={{ width: "100%", maxWidth: "420px", border: "1px solid #55452a", borderRadius: "14px", padding: "16px", textAlign: "center" }}>
        <small style={{ color: "#d8b56d" }}>YOUR PICK</small><h3>{winner.title}</h3><button onClick={() => { const item = winner; setShowRoulette(false); setSelected(item); }}>View details</button>
      </div>}
      <p style={{ color: "#a9a9b2", textAlign: "center", maxWidth: "420px", margin: 0 }}>Titles marked Watched or Unwanted are excluded.</p>
    </div>}
    {selected && <div className="backdrop" onClick={() => setSelected(null)}><section className="modal" onClick={e => e.stopPropagation()}><button className="close" onClick={() => setSelected(null)}>×</button><small>{selected.section} / {selected.category}</small><h2>{details?.Title || selected.title}</h2>
      {loadingDetails && <p>Loading verified details…</p>}
      {detailError && <p className="detail-error">{detailError}</p>}
      {details && <>
        <div className="detail-layout">{poster && <img className="detail-poster" src={poster} alt={`${details.Title} poster`} />}
          <div className="detail-copy"><div className="chips"><span>Year: {validValue(details.Year) || "Not available"}</span><span>IMDb: {imdbRating || "Not available"}</span>{imdbVotes && <span>Votes: {imdbVotes}</span>}</div>
            {plot && <p className="detail-plot">{plot}</p>}
            <div className="row"><span>{selected.section === "TV Series" ? "Seasons" : "Runtime"}</span><b>{selected.section === "TV Series" ? (details.totalSeasons && details.totalSeasons !== "N/A" ? details.totalSeasons : "Not available") : (runtime || "Not available")}</b></div>
            {selected.section === "TV Series" && <div className="row"><span>Status</span><b>{details.totalSeasons ? "Season count listed by OMDb" : "Not available"}</b></div>}
            <div className="row"><span>Genres</span><b>{genres || "Not available"}</b></div>

          </div>
        </div>

      </>}
      {!loadingDetails && !detailError && !details && <p>Movie details will appear here when OMDb responds.</p>}
      <div className="actions"><button className={watchlist.includes(selected.id) ? "chosen" : ""} onClick={() => toggleWatchlist(selected)}>{watchlist.includes(selected.id) ? "★ In Watchlist" : "☆ Add to Watchlist"}</button><button className={statuses[selected.id] === "watched" ? "chosen" : ""} onClick={() => changeStatus(selected, "watched")}>✓ Watched</button><button className={statuses[selected.id] === "unwanted" ? "chosen" : ""} onClick={() => changeStatus(selected, "unwanted")}>⊘ Unwanted</button><button onClick={() => changeStatus(selected, "unmarked")}>Reset</button></div>
    </section></div>}
    <footer>Made for your watchlist · Your choices stay on this device for now</footer>
  </div>;
}
