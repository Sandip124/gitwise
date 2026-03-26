import { ReportData } from "./collect.js";

/**
 * Generate a self-contained HTML report from collected metrics.
 * No external dependencies — inline CSS, SVG charts, zero JS frameworks.
 */
export function generateHtmlReport(data: ReportData): string {
  const repoName = data.repoPath.split("/").pop() ?? data.repoPath;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>wisegit report — ${esc(repoName)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace; background: #0d1117; color: #c9d1d9; padding: 2rem; max-width: 1200px; margin: 0 auto; }
  h1 { color: #58a6ff; margin-bottom: 0.5rem; font-size: 1.8rem; }
  h2 { color: #8b949e; margin: 2rem 0 1rem; font-size: 1.2rem; border-bottom: 1px solid #21262d; padding-bottom: 0.5rem; }
  .subtitle { color: #8b949e; margin-bottom: 2rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
  .card { background: #161b22; border: 1px solid #21262d; border-radius: 8px; padding: 1.2rem; }
  .card-label { color: #8b949e; font-size: 0.85rem; margin-bottom: 0.3rem; }
  .card-value { font-size: 1.8rem; font-weight: 600; color: #f0f6fc; }
  .card-value.green { color: #3fb950; }
  .card-value.yellow { color: #d29922; }
  .card-value.red { color: #f85149; }
  .bar-chart { display: flex; flex-direction: column; gap: 0.4rem; }
  .bar-row { display: flex; align-items: center; gap: 0.5rem; }
  .bar-label { width: 200px; font-size: 0.8rem; color: #8b949e; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar-track { flex: 1; height: 20px; background: #21262d; border-radius: 3px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 3px; min-width: 2px; }
  .bar-value { width: 50px; font-size: 0.8rem; color: #8b949e; text-align: right; }
  .fill-blue { background: #58a6ff; }
  .fill-green { background: #3fb950; }
  .fill-yellow { background: #d29922; }
  .fill-red { background: #f85149; }
  .fill-purple { background: #bc8cff; }
  table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; }
  th, td { text-align: left; padding: 0.5rem 0.8rem; border-bottom: 1px solid #21262d; font-size: 0.85rem; }
  th { color: #8b949e; font-weight: 500; }
  td { color: #c9d1d9; }
  .score { font-weight: 600; }
  .score.high { color: #f85149; }
  .score.mid { color: #d29922; }
  .score.low { color: #3fb950; }
  .badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 12px; font-size: 0.75rem; font-weight: 500; }
  .badge.active { background: #0d4429; color: #3fb950; }
  .badge.inactive { background: #3d1f00; color: #d29922; }
  .badge.critical { background: #3d0000; color: #f85149; }
  .timeline-chart { display: flex; align-items: flex-end; gap: 2px; height: 100px; margin-top: 0.5rem; }
  .timeline-bar { background: #58a6ff; border-radius: 2px 2px 0 0; min-width: 4px; flex: 1; opacity: 0.8; }
  .timeline-labels { display: flex; justify-content: space-between; font-size: 0.7rem; color: #484f58; margin-top: 0.3rem; }
  .donut { position: relative; width: 160px; height: 160px; margin: 0 auto; }
  .donut-center { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center; }
  .donut-center .big { font-size: 1.5rem; font-weight: 600; color: #f0f6fc; }
  .donut-center .small { font-size: 0.75rem; color: #8b949e; }
  .legend { display: flex; gap: 1rem; justify-content: center; margin-top: 0.8rem; font-size: 0.8rem; }
  .legend-item { display: flex; align-items: center; gap: 0.3rem; }
  .legend-dot { width: 10px; height: 10px; border-radius: 50%; }
  footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #21262d; color: #484f58; font-size: 0.8rem; text-align: center; }
</style>
</head>
<body>

<h1>wisegit report</h1>
<p class="subtitle">${esc(repoName)} — generated ${data.generatedAt.slice(0, 10)}</p>

<!-- Overview Cards -->
<div class="grid">
  <div class="card">
    <div class="card-label">Commits Analyzed</div>
    <div class="card-value">${data.totalCommits.toLocaleString()}</div>
  </div>
  <div class="card">
    <div class="card-label">Decision Events</div>
    <div class="card-value">${data.totalEvents.toLocaleString()}</div>
  </div>
  <div class="card">
    <div class="card-label">Functions Tracked</div>
    <div class="card-value">${data.totalFunctions.toLocaleString()}</div>
  </div>
  <div class="card">
    <div class="card-label">Files</div>
    <div class="card-value">${data.totalFiles}</div>
  </div>
</div>

<!-- Freeze Score Distribution -->
<h2>Freeze Score Distribution</h2>
<div class="grid">
  <div class="card">
    <div class="card-label">Frozen (score ≥ 0.80)</div>
    <div class="card-value red">${data.freezeDistribution.frozen}</div>
  </div>
  <div class="card">
    <div class="card-label">Stable (0.50–0.79)</div>
    <div class="card-value yellow">${data.freezeDistribution.stable}</div>
  </div>
  <div class="card">
    <div class="card-label">Open (&lt; 0.50)</div>
    <div class="card-value green">${data.freezeDistribution.open}</div>
  </div>
</div>

${data.topFrozen.length > 0 ? `
<div class="card">
  <div class="card-label">Top Functions by Freeze Score</div>
  <div class="bar-chart" style="margin-top:0.8rem">
    ${data.topFrozen.slice(0, 10).map(f => `
    <div class="bar-row">
      <div class="bar-label" title="${esc(f.file)}::${esc(f.name)}">${esc(f.name)}()</div>
      <div class="bar-track"><div class="bar-fill ${f.score >= 0.8 ? 'fill-red' : f.score >= 0.5 ? 'fill-yellow' : 'fill-green'}" style="width:${(f.score * 100).toFixed(0)}%"></div></div>
      <div class="bar-value">${f.score.toFixed(2)}</div>
    </div>`).join("")}
  </div>
</div>` : ""}

<!-- Theory Health -->
<h2>Theory Health</h2>
<div class="grid">
  <div class="card" style="text-align:center">
    <div class="donut">
      ${renderDonut(data.theoryHealth.healthy, data.theoryHealth.fragile, data.theoryHealth.critical)}
      <div class="donut-center">
        <div class="big">${data.totalFunctions}</div>
        <div class="small">functions</div>
      </div>
    </div>
    <div class="legend">
      <div class="legend-item"><div class="legend-dot" style="background:#3fb950"></div> Healthy</div>
      <div class="legend-item"><div class="legend-dot" style="background:#d29922"></div> Fragile</div>
      <div class="legend-item"><div class="legend-dot" style="background:#f85149"></div> Critical</div>
    </div>
  </div>
  <div class="card">
    <div class="card-label">Theory Distribution</div>
    <table>
      <tr><td>Healthy (2+ active holders)</td><td class="score low">${data.theoryHealth.healthy} (${pct(data.theoryHealth.healthy, data.totalFunctions)})</td></tr>
      <tr><td>Fragile (1 active holder)</td><td class="score mid">${data.theoryHealth.fragile} (${pct(data.theoryHealth.fragile, data.totalFunctions)})</td></tr>
      <tr><td>Critical (0 active holders)</td><td class="score high">${data.theoryHealth.critical} (${pct(data.theoryHealth.critical, data.totalFunctions)})</td></tr>
    </table>
  </div>
</div>

${data.topRisks.length > 0 ? `
<div class="card">
  <div class="card-label">Top Risk — Full Naur Death (no active theory holders)</div>
  <table>
    <tr><th>Function</th><th>File</th><th>Past Contributors</th></tr>
    ${data.topRisks.map(r => `<tr><td>${esc(r.name)}()</td><td style="color:#484f58">${esc(r.file)}</td><td><span class="badge critical">${r.holders} total, 0 active</span></td></tr>`).join("")}
  </table>
</div>` : ""}

<!-- Activity Timeline -->
<h2>Activity Timeline</h2>
<div class="card">
  <div class="card-label">Decision Events per Month</div>
  ${renderTimeline(data.timeline)}
</div>

<!-- Structural Importance -->
${data.topPageRank.length > 0 ? `
<h2>Structural Importance (PageRank)</h2>
<div class="card">
  <div class="card-label">Most Load-Bearing Functions</div>
  <div class="bar-chart" style="margin-top:0.8rem">
    ${data.topPageRank.map(f => `
    <div class="bar-row">
      <div class="bar-label" title="${esc(f.file)}">${esc(f.name)}()</div>
      <div class="bar-track"><div class="bar-fill fill-purple" style="width:${(f.score * 100).toFixed(0)}%"></div></div>
      <div class="bar-value">${f.score.toFixed(3)}</div>
    </div>`).join("")}
  </div>
</div>` : ""}

<!-- AI vs Human -->
${data.originBreakdown.length > 0 ? `
<h2>Decision Origin</h2>
<div class="grid">
  ${data.originBreakdown.map(o => `
  <div class="card">
    <div class="card-label">${o.origin}</div>
    <div class="card-value ${o.origin === 'HUMAN' ? 'green' : o.origin === 'AI_REVIEWED' ? 'yellow' : 'red'}">${o.count.toLocaleString()}</div>
  </div>`).join("")}
</div>` : ""}

<!-- Top Files -->
<h2>Top Files by Decision History</h2>
<div class="card">
  <div class="bar-chart">
    ${data.topFiles.slice(0, 12).map(f => {
      const maxEvents = data.topFiles[0]?.events ?? 1;
      return `
    <div class="bar-row">
      <div class="bar-label" title="${esc(f.file)}">${esc(f.file.split("/").pop() ?? f.file)}</div>
      <div class="bar-track"><div class="bar-fill fill-blue" style="width:${((f.events / maxEvents) * 100).toFixed(0)}%"></div></div>
      <div class="bar-value">${f.events} events</div>
    </div>`;
    }).join("")}
  </div>
</div>

<!-- Contributors -->
<h2>Contributors</h2>
<div class="card">
  <table>
    <tr><th>Author</th><th>Commits</th><th>Last Active</th><th>Status</th></tr>
    ${data.contributors.slice(0, 15).map(c => `
    <tr>
      <td>${esc(c.author)}</td>
      <td>${c.commits}</td>
      <td style="color:#484f58">${c.lastActive?.slice(0, 10) ?? "unknown"}</td>
      <td><span class="badge ${c.isActive ? 'active' : 'inactive'}">${c.isActive ? "active" : "inactive"}</span></td>
    </tr>`).join("")}
  </table>
</div>

${data.languages.length > 0 ? `
<h2>Languages</h2>
<div class="grid">
  ${data.languages.map(l => `
  <div class="card">
    <div class="card-label">${esc(l.language)}</div>
    <div class="card-value">${l.count} functions</div>
  </div>`).join("")}
</div>` : ""}

<footer>
  Generated by <strong>wisegit</strong> — decision protection for code that matters.
  <br>Grounded in 12 published papers. <a href="https://github.com/Sandip124/wisegit" style="color:#58a6ff">github.com/Sandip124/wisegit</a>
</footer>

</body>
</html>`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function pct(n: number, total: number): string {
  if (total === 0) return "0%";
  return `${((n / total) * 100).toFixed(1)}%`;
}

function renderDonut(healthy: number, fragile: number, critical: number): string {
  const total = healthy + fragile + critical;
  if (total === 0) return "";

  const r = 70;
  const cx = 80;
  const cy = 80;
  const circumference = 2 * Math.PI * r;

  const pHealth = healthy / total;
  const pFragile = fragile / total;
  const pCritical = critical / total;

  const offset1 = 0;
  const offset2 = pHealth * circumference;
  const offset3 = (pHealth + pFragile) * circumference;

  return `<svg viewBox="0 0 160 160" width="160" height="160">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#21262d" stroke-width="18"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#3fb950" stroke-width="18"
      stroke-dasharray="${pHealth * circumference} ${circumference}" stroke-dashoffset="-${offset1}"
      transform="rotate(-90 ${cx} ${cy})"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#d29922" stroke-width="18"
      stroke-dasharray="${pFragile * circumference} ${circumference}" stroke-dashoffset="-${offset2}"
      transform="rotate(-90 ${cx} ${cy})"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#f85149" stroke-width="18"
      stroke-dasharray="${pCritical * circumference} ${circumference}" stroke-dashoffset="-${offset3}"
      transform="rotate(-90 ${cx} ${cy})"/>
  </svg>`;
}

function renderTimeline(timeline: { month: string; events: number }[]): string {
  if (timeline.length === 0) return "<p style='color:#484f58'>No timeline data.</p>";

  const maxEvents = Math.max(...timeline.map(t => t.events));
  const firstMonth = timeline[0].month;
  const lastMonth = timeline[timeline.length - 1].month;

  return `
  <div class="timeline-chart">
    ${timeline.map(t => `<div class="timeline-bar" style="height:${Math.max(2, (t.events / maxEvents) * 100)}%" title="${t.month}: ${t.events} events"></div>`).join("")}
  </div>
  <div class="timeline-labels">
    <span>${firstMonth}</span>
    <span>${lastMonth}</span>
  </div>`;
}
