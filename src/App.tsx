import React, { useMemo, useState, useEffect } from "react";

// --------------------------------------------------
// Utils
// --------------------------------------------------
function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pairKey = (a, b) => (a < b ? a + '-' + b : b + '-' + a);

// --------------------------------------------------
// Schedule generator — 15 rounds, courts 7/8/9
// Rules:
// - Daniel & Macho always together.
// - Each of the other 10 players faces D&M exactly 3 times across 15 rounds.
// - Every round all 12 players appear exactly once; no duplicates in a match.
// --------------------------------------------------
function generateSchedule(players, seed) {
  if (players.length !== 12) throw new Error("Requires exactly 12 players");
  const rng = mulberry32(seed);

  const lower = (s) => s.trim().toLowerCase();
  const dmIds = players.filter((p) => /^(daniel|macho)$/.test(lower(p.name))).map((p) => p.id);
  if (dmIds.length !== 2) throw new Error("Two players must be named Daniel and Macho");
  const [D, M] = dmIds;
  const others = players.filter((p) => p.id !== D && p.id !== M).map((p) => p.id);
  if (others.length !== 10) throw new Error("Exactly 10 players besides Daniel & Macho are required");

  // Build 15 opponent pairs for D&M so each of the 10 appears exactly 3 times
  function buildBalancedDmOpponents(ids) {
    const NEED = 3; // each non-DM should face D&M three times
    const counts = new Map(ids.map((id) => [id, 0]));
    const usedPair = new Set(); // try to avoid repeating the same opponent pair vs D&M
    const res = new Array(15);

    function backtrack(k) {
      if (k === 15) return true;
      const pool = ids.slice().sort((a, b) => (counts.get(a) - counts.get(b)) || a.localeCompare(b));
      for (let i = 0; i < pool.length; i++) {
        const a = pool[i];
        if (counts.get(a) >= NEED) continue;
        for (let j = i + 1; j < pool.length; j++) {
          const b = pool[j];
          if (counts.get(b) >= NEED) continue;
          const key = pairKey(a, b);
          if (usedPair.has(key)) continue;

          // choose
          counts.set(a, counts.get(a) + 1);
          counts.set(b, counts.get(b) + 1);
          usedPair.add(key);
          res[k] = [a, b];

          // feasibility quick check
          const remainingSlots = (15 - (k + 1)) * 2;
          const needTotal = ids.reduce((acc, id) => acc + Math.max(0, NEED - counts.get(id)), 0);
          const feasible = needTotal <= remainingSlots;

          if (feasible && backtrack(k + 1)) return true;

          // undo
          res[k] = null;
          usedPair.delete(key);
          counts.set(a, counts.get(a) - 1);
          counts.set(b, counts.get(b) - 1);
        }
      }
      return false;
    }

    if (!backtrack(0)) throw new Error("Could not balance Daniel & Macho opponents. Try another seed.");
    return res;
  }

  const dmOppPairs = buildBalancedDmOpponents(others);

  // Pair remaining 8 randomly into 4 pairs
  function pairRemaining(eight) {
    const arr = shuffle(eight, rng);
    const out = [];
    for (let i = 0; i < arr.length; i += 2) out.push([arr[i], arr[i + 1]]);
    return out;
  }

  const rounds = [];
  for (let r = 0; r < 15; r++) {
    const dmOpp = dmOppPairs[r];
    const used = new Set([D, M, dmOpp[0], dmOpp[1]]);
    const rem = others.filter((id) => !used.has(id)); // 8 players
    const pairs = pairRemaining(rem); // 4 pairs
    const pp = shuffle(pairs, rng);

    const matches = [
      { court: 7, team1: { a: D, b: M }, team2: { a: dmOpp[0], b: dmOpp[1] } },
      { court: 8, team1: { a: pp[0][0], b: pp[0][1] }, team2: { a: pp[1][0], b: pp[1][1] } },
      { court: 9, team1: { a: pp[2][0], b: pp[2][1] }, team2: { a: pp[3][0], b: pp[3][1] } },
    ];

    // Validate no duplicates in the round
    const seen = new Set();
    let ok = true;
    for (const m of matches) {
      const ids = [m.team1.a, m.team1.b, m.team2.a, m.team2.b];
      if (new Set(ids).size !== 4) { ok = false; break; }
      for (const id of ids) { if (seen.has(id)) { ok = false; break; } seen.add(id); }
      if (!ok) break;
    }
    if (!ok || seen.size !== 12) throw new Error(`Internal round construction error at round ${r + 1}`);

    rounds.push({ round: r + 1, matches });
  }

  return rounds;
}

// --------------------------------------------------
// Stats helpers
// --------------------------------------------------
function computeStats(schedule, players) {
  const idToName = new Map(players.map((p) => [p.id, p.name]));
  const rows = new Map();
  const ensure = (id) => {
    if (!rows.has(id)) rows.set(id, { player: id, name: idToName.get(id) || id, played: 0, won: 0, tied: 0, lost: 0, pointsFor: 0, pointsAgainst: 0, diff: 0 });
    return rows.get(id);
  };
  for (const r of schedule) {
    for (const m of r.matches) {
      if (!m.score) continue;
      const s1 = m.score.team1, s2 = m.score.team2;
      if (s1 + s2 !== 24) continue; // only count valid results
      const t1 = [m.team1.a, m.team1.b];
      const t2 = [m.team2.a, m.team2.b];
      t1.forEach((id) => { const row = ensure(id); row.played++; row.pointsFor += s1; row.pointsAgainst += s2; });
      t2.forEach((id) => { const row = ensure(id); row.played++; row.pointsFor += s2; row.pointsAgainst += s1; });
      if (s1 > s2) { t1.forEach((id) => ensure(id).won++); t2.forEach((id) => ensure(id).lost++); }
      else if (s2 > s1) { t2.forEach((id) => ensure(id).won++); t1.forEach((id) => ensure(id).lost++); }
      else { t1.concat(t2).forEach((id) => ensure(id).tied++); }
    }
  }
  const list = Array.from(rows.values()).map((r) => ({ ...r, diff: r.pointsFor - r.pointsAgainst }));
  list.sort((a, b) => b.pointsFor - a.pointsFor || b.won - a.won || b.diff - a.diff || a.name.localeCompare(b.name));
  return list;
}
function dmStats(schedule, danielId, machoId, players) {
  const games = [];
  for (const r of schedule) {
    for (const m of r.matches) {
      const t1 = [m.team1.a, m.team1.b];
      const t2 = [m.team2.a, m.team2.b];
      const hasDM = (t) => t.includes(danielId) && t.includes(machoId);
      if (hasDM(t1) || hasDM(t2)) {
        const opp = hasDM(t1) ? t2 : t1;
        const oppNames = opp.map((id) => players.find((p) => p.id === id)?.name || id).join(" & ");
        let score, result;
        if (m.score) {
          const s1 = m.score.team1, s2 = m.score.team2;
          score = `${s1}-${s2}`;
          const dmOnTeam1 = hasDM(t1);
          const dmScore = dmOnTeam1 ? s1 : s2;
          const oppScore = dmOnTeam1 ? s2 : s1;
          result = dmScore > oppScore ? "W" : dmScore < oppScore ? "L" : "T";
        }
        games.push({ round: r.round, oppNames, score, result });
      }
    }
  }
  return games;
}
function dmSummary(schedule, danielId, machoId) {
  let played = 0, won = 0, tied = 0, lost = 0, pointsFor = 0;
  for (const r of schedule) {
    for (const m of r.matches) {
      const t1 = [m.team1.a, m.team1.b];
      const t2 = [m.team2.a, m.team2.b];
      const hasDM = (t) => t.includes(danielId) && t.includes(machoId);
      if (hasDM(t1) || hasDM(t2)) {
        if (!m.score) continue;
        const s1 = m.score.team1, s2 = m.score.team2;
        if (s1 + s2 !== 24) continue;
        const dmOnTeam1 = hasDM(t1);
        const dmScore = dmOnTeam1 ? s1 : s2;
        const oppScore = dmOnTeam1 ? s2 : s1;
        played++; pointsFor += dmScore;
        if (dmScore > oppScore) won++; else if (dmScore < oppScore) lost++; else tied++;
      }
    }
  }
  const avg = played ? pointsFor / played : 0;
  return { played, won, tied, lost, avg };
}

// --------------------------------------------------
// App
// --------------------------------------------------
export default function App() {
  const [players, setPlayers] = useState([
    { id: "p1", name: "Daniel" },
    { id: "p2", name: "Macho" },
    { id: "p3", name: "Player 3" },
    { id: "p4", name: "Player 4" },
    { id: "p5", name: "Player 5" },
    { id: "p6", name: "Player 6" },
    { id: "p7", name: "Player 7" },
    { id: "p8", name: "Player 8" },
    { id: "p9", name: "Player 9" },
    { id: "p10", name: "Player 10" },
    { id: "p11", name: "Player 11" },
    { id: "p12", name: "Player 12" },
  ]);
  const [seed, setSeed] = useState(20251016);
  const [schedule, setSchedule] = useState([]);
  const [error, setError] = useState(null);

  const idToName = useMemo(() => new Map(players.map((p) => [p.id, p.name])), [players]);
  const dmIds = useMemo(() => {
    const lower = (s) => s.trim().toLowerCase();
    const ids = players.filter((p) => /^(daniel|macho)$/.test(lower(p.name))).map((p) => p.id);
    return ids.length === 2 ? ids : null;
  }, [players]);

  useEffect(() => {
    try {
      const s = generateSchedule(players, seed);
      setSchedule(s);
    } catch (e) {
      setError(e?.message || String(e));
    }
  }, []);

  const rankings = useMemo(() => (schedule.length ? computeStats(schedule, players) : []), [schedule, players]);
  const dmGames = useMemo(() => {
    if (!schedule.length || !dmIds) return [];
    return dmStats(schedule, dmIds[0], dmIds[1], players);
  }, [schedule, players, dmIds]);
  const dmSum = useMemo(() => {
    if (!schedule.length || !dmIds) return null;
    return dmSummary(schedule, dmIds[0], dmIds[1]);
  }, [schedule, dmIds]);

  function updateName(id, name) {
    setPlayers((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)));
  }

  function setScoreAuto(roundIdx, matchIdx, value, side) {
    setSchedule((prev) => {
      const copy = prev.map((r) => ({ ...r, matches: r.matches.map((m) => ({ ...m })) }));
      const m = copy[roundIdx].matches[matchIdx];
      let a = 0, b = 0;
      if (m.score) { a = m.score.team1 || 0; b = m.score.team2 || 0; }
      if (side === 1) { a = value; b = Math.max(0, Math.min(24, 24 - (Number.isFinite(value) ? value : 0))); }
      else { b = value; a = Math.max(0, Math.min(24, 24 - (Number.isFinite(value) ? value : 0))); }
      a = Math.max(0, Math.min(24, a));
      b = Math.max(0, Math.min(24, b));
      m.score = { team1: a, team2: b };
      return copy;
    });
  }

  function onGenerate() {
    setError(null);
    try {
      const s = generateSchedule(players, seed);
      setSchedule(s);
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
    }
  }

  function exportCSV() {
    const rows = [["Round", "Court", "Team1", "Team2", "Score"]];
    schedule.forEach((r) => {
      r.matches.forEach((m) => {
        rows.push([
          r.round,
          m.court,
          `${idToName.get(m.team1.a)} & ${idToName.get(m.team1.b)}`,
          `${idToName.get(m.team2.a)} & ${idToName.get(m.team2.b)}`,
          m.score ? `${m.score.team1}-${m.score.team2}` : "",
        ]);
      });
    });
    const csv = rows.map((r) => r.map((x) => `"${String(x).replaceAll('"', '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "padel_schedule_scores.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  function printPDF() {
    try {
      const htmlEscape = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      const roundsHtml = schedule.map((r) => `
        <section class="round">
          <h3>Round ${r.round} — Courts 7–9</h3>
          <table>
            <thead><tr><th>Court</th><th>Team 1</th><th>Team 2</th><th>Score</th></tr></thead>
            <tbody>
              ${r.matches.map((m) => {
                const t1 = `${htmlEscape(idToName.get(m.team1.a))} & ${htmlEscape(idToName.get(m.team1.b))}`;
                const t2 = `${htmlEscape(idToName.get(m.team2.a))} & ${htmlEscape(idToName.get(m.team2.b))}`;
                const sc = m.score ? `${m.score.team1}-${m.score.team2}` : '';
                return `<tr><td>${m.court}</td><td>${t1}</td><td>${t2}</td><td>${sc}</td></tr>`;
              }).join('')}
            </tbody>
          </table>
        </section>`).join('');

      const rankingRows = (schedule.length ? computeStats(schedule, players) : []).map((r, idx) => `
        <tr>
          <td>${idx + 1}</td>
          <td>${htmlEscape(r.name)}</td>
          <td>${r.played}</td>
          <td>${r.won}</td>
          <td>${r.tied}</td>
          <td>${r.lost}</td>
          <td>${r.pointsFor}</td>
          <td>${r.pointsAgainst}</td>
          <td>${r.diff}</td>
          <td>${r.played ? (r.pointsFor / r.played).toFixed(2) : '0.00'}</td>
        </tr>`).join('');

      const dmIdsLocal = players.filter(p => /^(daniel|macho)$/i.test(p.name)).map(p => p.id);
      const dmSumLocal = dmIdsLocal.length === 2 ? dmSummary(schedule, dmIdsLocal[0], dmIdsLocal[1]) : null;
      const dmGamesLocal = dmIdsLocal.length === 2 ? dmStats(schedule, dmIdsLocal[0], dmIdsLocal[1], players) : [];

      const dmSummaryHtml = dmSumLocal ? `
        <section>
          <h2>Daniel & Macho — Summary</h2>
          <table>
            <tbody>
              <tr><td>Matches</td><td class="tr">${dmSumLocal.played}</td></tr>
              <tr><td>Won</td><td class="tr">${dmSumLocal.won}</td></tr>
              <tr><td>Tied</td><td class="tr">${dmSumLocal.tied}</td></tr>
              <tr><td>Lost</td><td class="tr">${dmSumLocal.lost}</td></tr>
              <tr><td>Avg pts/match</td><td class="tr">${dmSumLocal.avg.toFixed(2)}</td></tr>
            </tbody>
          </table>
        </section>` : '';

      const dmGamesHtml = dmGamesLocal.length ? `
        <section>
          <h2>Daniel & Macho — Game Log</h2>
          <table>
            <thead><tr><th>Round</th><th>Opponents</th><th>Score</th><th>Result</th></tr></thead>
            <tbody>
              ${dmGamesLocal.map(g => `<tr><td>${g.round}</td><td>${htmlEscape(g.oppNames)}</td><td>${g.score || ''}</td><td>${g.result || ''}</td></tr>`).join('')}
            </tbody>
          </table>
        </section>` : '';

      const docHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Macho y Daniel contra El Resto del Mundo — PDF</title>
  <style>
    body { font: 12px/1.4 -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Arial, sans-serif; color: #111; margin: 24px; }
    h1 { font-size: 20px; margin: 0 0 12px; }
    h2 { font-size: 16px; margin: 24px 0 8px; }
    h3 { font-size: 14px; margin: 16px 0 6px; }
    section { page-break-inside: avoid; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #ddd; padding: 6px 8px; }
    thead th { background: #f3f4f6; text-align: left; }
    .tr { text-align: right; }
    @page { size: A4 portrait; margin: 12mm; }
  </style>
</head>
<body>
  <h1>Macho y Daniel contra El Resto del Mundo</h1>
  <section>
    <h2>Individual Ranking</h2>
    <table>
      <thead><tr><th>#</th><th>Player</th><th>GP</th><th>W</th><th>T</th><th>L</th><th>Pts For</th><th>Pts Ag</th><th>Diff</th><th>Avg Pts/G</th></tr></thead>
      <tbody>${rankingRows}</tbody>
    </table>
  </section>
  ${dmSummaryHtml}
  ${dmGamesHtml}
  <section>
    <h2>Schedule & Scores</h2>
    ${roundsHtml}
  </section>
</body>
</html>`;

      const w = window.open('', '_blank');
      if (!w || !w.document) { alert('Pop-up blocked. Allow pop-ups and try again.'); return; }
      w.document.open(); w.document.write(docHtml); w.document.close();
      setTimeout(() => { try { w.focus(); w.print(); } catch {} }, 300);
    } catch (e) {
      alert('Could not generate printable view: ' + (e?.message || e));
    }
  }

  // Helper: count how many times each player faces D&M (diagnostic panel)
  const dmOppCounts = useMemo(() => {
    const map = new Map(players.map((p) => [p.id, 0]));
    for (const r of schedule) {
      for (const m of r.matches) {
        const t1 = [m.team1.a, m.team1.b];
        const t2 = [m.team2.a, m.team2.b];
        const hasDM = (t) => t.includes(players[0]?.id) && t.includes(players[1]?.id); // may not be accurate if names changed, so better compute by name
      }
    }
    // More robust: identify D&M by name each time
    const lower = (s) => s.trim().toLowerCase();
    const dId = players.find(p => lower(p.name) === 'daniel')?.id;
    const mId = players.find(p => lower(p.name) === 'macho')?.id;
    if (!dId || !mId) return map;
    for (const r of schedule) {
      for (const m of r.matches) {
        const t1 = [m.team1.a, m.team1.b];
        const t2 = [m.team2.a, m.team2.b];
        const hasDM = (t) => t.includes(dId) && t.includes(mId);
        if (hasDM(t1)) { map.set(t2[0], (map.get(t2[0])||0)+1); map.set(t2[1], (map.get(t2[1])||0)+1); }
        if (hasDM(t2)) { map.set(t1[0], (map.get(t1[0])||0)+1); map.set(t1[1], (map.get(t1[1])||0)+1); }
      }
    }
    return map;
  }, [schedule, players]);

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl md:text-3xl font-bold">Macho y Daniel contra El Resto del Mundo</h1>
          <div className="flex gap-2">
            <button onClick={() => exportCSV()} className="px-3 py-2 rounded-2xl shadow bg-white hover:bg-neutral-100">Export CSV</button>
            <button onClick={() => printPDF()} className="px-3 py-2 rounded-2xl shadow bg-white hover:bg-neutral-100">Print / PDF</button>
          </div>
        </header>

        {/* Controls */}
        <div className="grid md:grid-cols-3 gap-4 mb-6">
          <div className="p-4 bg-white rounded-2xl shadow">
            <h2 className="font-semibold mb-3">Players (12)</h2>
            <p className="text-sm text-neutral-500 mb-2">Two must be named <b>Daniel</b> and <b>Macho</b>.</p>
            <div className="grid grid-cols-1 gap-2">
              {players.map((p) => (
                <div key={p.id} className="flex items-center gap-2">
                  <span className="text-xs w-6 text-neutral-400">{p.id.toUpperCase()}</span>
                  <input value={p.name} onChange={(e) => updateName(p.id, e.target.value)} className="w-full px-3 py-2 border rounded-xl" />
                </div>
              ))}
            </div>
          </div>

          <div className="p-4 bg-white rounded-2xl shadow">
            <h2 className="font-semibold mb-3">Settings</h2>
            <label className="block text-sm mb-1">Random Seed</label>
            <div className="flex gap-2 mb-4">
              <input
                type="number"
                value={seed}
                onChange={(e) => {
                  const newSeed = Number(e.target.value || 0);
                  setSeed(newSeed);
                  try {
                    const s = generateSchedule(players, newSeed);
                    setSchedule(s);
                    setError(null);
                  } catch (err) {
                    setError(err?.message || String(err));
                  }
                }}
                className="w-full px-3 py-2 border rounded-xl"
              />
              <button
                onClick={() => {
                  const newSeed = Math.floor(Math.random() * 1000000);
                  setSeed(newSeed);
                  try { const s = generateSchedule(players, newSeed); setSchedule(s); setError(null); }
                  catch (err) { setError(err?.message || String(err)); }
                }}
                className="px-3 py-2 bg-neutral-200 hover:bg-neutral-300 rounded-xl"
                title="Randomize seed"
              >
                🎲
              </button>
            </div>
            <button onClick={() => onGenerate()} className="w-full px-4 py-2 rounded-2xl bg-black text-white hover:opacity-90">Generate 15 Rounds × Courts 7–9</button>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          </div>

          <div className="p-4 bg-white rounded-2xl shadow">
            <h2 className="font-semibold mb-3">How scoring works</h2>
            <ul className="list-disc ml-5 text-sm leading-6 text-neutral-700">
              <li>Courts are <b>7, 8, 9</b>.</li>
              <li>Each match is to <b>24 total points</b>. Change either side; the other auto-fills to sum 24.</li>
              <li>Rankings are <b>individual</b>: total points won, then wins, ties, losses, point diff.</li>
              <li>Daniel & Macho face each of the 10 players <b>exactly 3×</b> across 15 rounds.</li>
            </ul>
          </div>
        </div>

        {/* Schedule */}
        {schedule.length > 0 && (
          <div className="mb-10">
            <h2 className="text-xl font-semibold mb-4">Schedule & Scores</h2>
            <div className="grid gap-4">
              {schedule.map((r, ri) => (
                <div key={r.round} className="bg-white rounded-2xl shadow p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold">Round {r.round}</h3>
                    <span className="text-xs text-neutral-500">Courts 7–9</span>
                  </div>
                  <div className="grid md:grid-cols-3 gap-3">
                    {r.matches.map((m, mi) => (
                      <div key={mi} className="border rounded-xl p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium">Court {m.court}</span>
                        </div>
                        <div className="text-sm mb-2">
                          <div className="flex items-center justify-between">
                            <span>{idToName.get(m.team1.a)} & {idToName.get(m.team1.b)}</span>
                            <input type="number" placeholder="0" className="w-16 px-2 py-1 border rounded-lg text-right" value={m.score?.team1 ?? ""} onChange={(e) => setScoreAuto(ri, mi, Number(e.target.value || 0), 1)} />
                          </div>
                          <div className="flex items-center justify-between mt-1">
                            <span>{idToName.get(m.team2.a)} & {idToName.get(m.team2.b)}</span>
                            <input type="number" placeholder="0" className="w-16 px-2 py-1 border rounded-lg text-right" value={m.score?.team2 ?? ""} onChange={(e) => setScoreAuto(ri, mi, Number(e.target.value || 0), 2)} />
                          </div>
                        </div>
                        <div className="text-xs text-neutral-500">Scores auto-sum to 24.</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Rankings */}
        {schedule.length > 0 && (
          <div className="mb-10">
            <h2 className="text-xl font-semibold mb-3">Individual Ranking</h2>
            <div className="overflow-x-auto bg-white rounded-2xl shadow">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-neutral-100 text-neutral-700">
                    <th className="p-2 text-left">#</th>
                    <th className="p-2 text-left">Player</th>
                    <th className="p-2">GP</th>
                    <th className="p-2">W</th>
                    <th className="p-2">T</th>
                    <th className="p-2">L</th>
                    <th className="p-2">Pts For</th>
                    <th className="p-2">Pts Ag</th>
                    <th className="p-2">Diff</th>
                    <th className="p-2">Avg Pts/G</th>
                  </tr>
                </thead>
                <tbody>
                  {rankings.map((r, idx) => (
                    <tr key={r.player} className="border-t">
                      <td className="p-2">{idx + 1}</td>
                      <td className="p-2">{r.name}</td>
                      <td className="p-2 text-center">{r.played}</td>
                      <td className="p-2 text-center">{r.won}</td>
                      <td className="p-2 text-center">{r.tied}</td>
                      <td className="p-2 text-center">{r.lost}</td>
                      <td className="p-2 text-center">{r.pointsFor}</td>
                      <td className="p-2 text-center">{r.pointsAgainst}</td>
                      <td className="p-2 text-center">{r.diff}</td>
                      <td className="p-2 text-center">{(r.played ? (r.pointsFor / r.played).toFixed(2) : "0.00")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Daniel & Macho Stats */}
        {schedule.length > 0 && (
          dmIds ? (
            <div className="mb-16">
              <h2 className="text-xl font-semibold mb-3">Daniel & Macho — Game Log</h2>
              {dmSum && (
                <div className="grid md:grid-cols-3 gap-3 mb-3">
                  <div className="bg-white rounded-2xl shadow p-4">
                    <h3 className="font-semibold mb-2">D&M Summary</h3>
                    <table className="min-w-full text-sm">
                      <tbody>
                        <tr><td className="p-1">Matches</td><td className="p-1 text-right">{dmSum.played}</td></tr>
                        <tr><td className="p-1">Won</td><td className="p-1 text-right">{dmSum.won}</td></tr>
                        <tr><td className="p-1">Tied</td><td className="p-1 text-right">{dmSum.tied}</td></tr>
                        <tr><td className="p-1">Lost</td><td className="p-1 text-right">{dmSum.lost}</td></tr>
                        <tr><td className="p-1">Avg pts/match</td><td className="p-1 text-right">{dmSum.avg.toFixed(2)}</td></tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              <div className="bg-white rounded-2xl shadow overflow-hidden">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-neutral-100 text-neutral-700">
                      <th className="p-2 text-left">Round</th>
                      <th className="p-2 text-left">Opponents</th>
                      <th className="p-2 text-left">Score</th>
                      <th className="p-2 text-left">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dmGames.map((g, i) => (
                      <tr key={i} className="border-t">
                        <td className="p-2">{g.round}</td>
                        <td className="p-2">{g.oppNames}</td>
                        <td className="p-2">{g.score || "—"}</td>
                        <td className="p-2">{g.result || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="mb-16">
              <h2 className="text-xl font-semibold mb-3">Daniel & Macho — Game Log</h2>
              <div className="p-4 bg-white rounded-2xl shadow">
                <p className="text-sm text-neutral-700">Rename two players to <b>Daniel</b> and <b>Macho</b> to see this log.</p>
              </div>
            </div>
          )
        )}

        {/* Diagnostic: DM Opponent Balance Check (lightweight test) */}
        {schedule.length > 0 && (
          <div className="mb-10">
            <h2 className="text-xl font-semibold mb-3">DM Opponent Balance Check</h2>
            <div className="overflow-x-auto bg-white rounded-2xl shadow">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-neutral-100 text-neutral-700">
                    <th className="p-2 text-left">Player</th>
                    <th className="p-2 text-left">Times vs D&M (should be 3)</th>
                  </tr>
                </thead>
                <tbody>
                  {players.filter(p => !/^daniel|macho$/i.test(p.name)).map((p) => (
                    <tr key={p.id} className="border-t">
                      <td className="p-2">{p.name}</td>
                      <td className="p-2">{dmOppCounts.get(p.id) || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <footer className="text-xs text-neutral-500 pb-8">
          <p>Tip: change the <b>Random Seed</b> or click the <b>🎲</b> to regenerate. Now scheduling <b>15 rounds</b> across courts 7–9.</p>
        </footer>
      </div>
    </div>
  );
}
