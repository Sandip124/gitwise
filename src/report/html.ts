import { ReportData } from "./collect.js";

/**
 * Generate a self-contained HTML report with rich visualizations.
 * Inline CSS + SVG + minimal vanilla JS for interactivity.
 * No external dependencies.
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
${CSS}
</style>
</head>
<body>

<nav class="nav">
  <span class="nav-brand">wisegit report</span>
  <div class="nav-links">
    <a href="#overview">Overview</a>
    <a href="#freeze">Freeze Scores</a>
    <a href="#theory">Theory Health</a>
    <a href="#graph">Dependencies</a>
    <a href="#timeline">Timeline</a>
    <a href="#files">Files</a>
    <a href="#contributors">Contributors</a>
  </div>
</nav>

<header>
  <h1>${esc(repoName)}</h1>
  <p class="subtitle">Decision health report — ${data.generatedAt.slice(0, 10)}</p>
</header>

<!-- Overview -->
<section id="overview">
  <h2>Overview</h2>
  <div class="grid grid-4">
    <div class="card"><div class="card-label">Commits</div><div class="card-value">${fmt(data.totalCommits)}</div></div>
    <div class="card"><div class="card-label">Decision Events</div><div class="card-value">${fmt(data.totalEvents)}</div></div>
    <div class="card"><div class="card-label">Functions</div><div class="card-value">${fmt(data.totalFunctions)}</div></div>
    <div class="card"><div class="card-label">Files</div><div class="card-value">${fmt(data.totalFiles)}</div></div>
  </div>
  ${data.languages.length > 0 ? `<div class="card"><div class="card-label">Languages</div><div class="pill-row">${data.languages.map(l => `<span class="pill">${esc(l.language)} <b>${l.count}</b></span>`).join("")}</div></div>` : ""}
  ${data.classificationBreakdown.length > 0 ? `<div class="card" style="margin-top:1rem"><div class="card-label">Commit Classification</div><div class="pill-row">${data.classificationBreakdown.map(c => `<span class="pill pill-${c.classification.toLowerCase()}">${c.classification} <b>${fmt(c.count)}</b></span>`).join("")}</div></div>` : ""}
</section>

<!-- Freeze Scores -->
<section id="freeze">
  <h2>Freeze Score Distribution</h2>
  <div class="grid grid-3">
    <div class="card card-accent-red"><div class="card-label">Frozen (&ge; 0.80)</div><div class="card-value red">${data.freezeDistribution.frozen}</div></div>
    <div class="card card-accent-yellow"><div class="card-label">Stable (0.50–0.79)</div><div class="card-value yellow">${data.freezeDistribution.stable}</div></div>
    <div class="card card-accent-green"><div class="card-label">Open (&lt; 0.50)</div><div class="card-value green">${data.freezeDistribution.open}</div></div>
  </div>
  ${renderHistogram(data.scoreHistogram)}
  ${data.topFrozen.length > 0 ? `<div class="card" style="margin-top:1rem"><div class="card-label">Top Functions by Freeze Score</div><div class="bar-chart">${data.topFrozen.slice(0, 12).map(f => `<div class="bar-row" title="${esc(f.file)}::${esc(f.name)}"><div class="bar-label">${esc(f.name)}()</div><div class="bar-track"><div class="bar-fill ${scoreColor(f.score)}" style="width:${Math.max(2, f.score * 100).toFixed(0)}%"></div></div><div class="bar-value">${f.score.toFixed(2)}</div></div>`).join("")}</div></div>` : ""}
</section>

<!-- Theory Health -->
<section id="theory">
  <h2>Theory Health</h2>
  <div class="grid grid-2">
    <div class="card" style="text-align:center">
      ${renderDonut(data.theoryHealth.healthy, data.theoryHealth.fragile, data.theoryHealth.critical, data.totalFunctions)}
      <div class="legend">
        <div class="legend-item"><div class="legend-dot bg-green"></div> Healthy (2+)</div>
        <div class="legend-item"><div class="legend-dot bg-yellow"></div> Fragile (1)</div>
        <div class="legend-item"><div class="legend-dot bg-red"></div> Critical (0)</div>
      </div>
    </div>
    <div class="card">
      <div class="card-label">Theory Distribution</div>
      <div class="stat-list">
        <div class="stat-row"><span>Healthy (2+ active holders)</span><span class="score low">${data.theoryHealth.healthy} (${pct(data.theoryHealth.healthy, data.totalFunctions)})</span></div>
        <div class="stat-row"><span>Fragile (1 active holder)</span><span class="score mid">${data.theoryHealth.fragile} (${pct(data.theoryHealth.fragile, data.totalFunctions)})</span></div>
        <div class="stat-row"><span>Critical (0 active holders)</span><span class="score high">${data.theoryHealth.critical} (${pct(data.theoryHealth.critical, data.totalFunctions)})</span></div>
      </div>
      ${data.originBreakdown.length > 0 ? `<div class="card-label" style="margin-top:1.5rem">Decision Origin</div><div class="stat-list">${data.originBreakdown.map(o => `<div class="stat-row"><span>${o.origin}</span><span class="score ${o.origin === 'HUMAN' ? 'low' : o.origin === 'AI_REVIEWED' ? 'mid' : 'high'}">${fmt(o.count)}</span></div>`).join("")}</div>` : ""}
    </div>
  </div>
  ${data.topRisks.length > 0 ? `<div class="card" style="margin-top:1rem"><div class="card-label">Top Risk — Full Naur Death</div><table><tr><th>Function</th><th>File</th><th>Status</th></tr>${data.topRisks.map(r => `<tr><td>${esc(r.name)}()</td><td class="muted">${esc(shortFile(r.file))}</td><td><span class="badge critical">${r.holders} contributors, 0 active</span></td></tr>`).join("")}</table></div>` : ""}
</section>

<!-- Dependency Graph -->
<section id="graph">
  <h2>Dependency Graph</h2>
  ${data.dependencyEdges.length > 0 ? `<div class="card"><div class="card-label">Co-change relationships (functions modified in the same commits)</div><div id="graph-container" style="height:500px;position:relative;overflow:hidden"><svg id="force-graph" width="100%" height="100%" viewBox="0 0 800 500"></svg></div></div>` : '<div class="card"><div class="card-label muted">No dependency edges found. Run <code>wisegit recompute</code> to build the call graph.</div></div>'}
  ${data.topPageRank.length > 0 ? `<div class="card" style="margin-top:1rem"><div class="card-label">Structural Importance (PageRank)</div><div class="bar-chart">${data.topPageRank.map(f => `<div class="bar-row" title="${esc(f.file)}"><div class="bar-label">${esc(f.name)}()</div><div class="bar-track"><div class="bar-fill fill-purple" style="width:${(f.score * 100).toFixed(0)}%"></div></div><div class="bar-value">${f.score.toFixed(3)}</div></div>`).join("")}</div></div>` : ""}
</section>

<!-- Timeline -->
<section id="timeline">
  <h2>Activity Timeline</h2>
  <div class="card"><div class="card-label">Decision events per month</div>${renderTimeline(data.timeline)}</div>
</section>

<!-- Files -->
<section id="files">
  <h2>File Overview</h2>
  ${data.fileScores.length > 0 ? `<div class="card"><div class="card-label">Files by decision density (size = events, color = avg freeze score)</div>${renderTreemap(data.fileScores)}</div>` : ""}
  <div class="card" style="margin-top:1rem"><div class="card-label">Top Files by Decision History</div><div class="bar-chart">${data.topFiles.slice(0, 12).map(f => { const max = data.topFiles[0]?.events ?? 1; return `<div class="bar-row" title="${esc(f.file)}"><div class="bar-label">${esc(shortFile(f.file))}</div><div class="bar-track"><div class="bar-fill fill-blue" style="width:${((f.events / max) * 100).toFixed(0)}%"></div></div><div class="bar-value">${f.events}</div></div>`; }).join("")}</div></div>
</section>

<!-- Contributors -->
<section id="contributors">
  <h2>Contributors</h2>
  <div class="card"><table><tr><th>Author</th><th>Commits</th><th>Last Active</th><th>Status</th></tr>${data.contributors.slice(0, 15).map(c => `<tr><td>${esc(c.author)}</td><td>${c.commits}</td><td class="muted">${c.lastActive?.slice(0, 10) ?? "unknown"}</td><td><span class="badge ${c.isActive ? 'active' : 'inactive'}">${c.isActive ? "active" : "inactive"}</span></td></tr>`).join("")}</table></div>
  ${data.contributorFiles.length > 0 ? `<div class="card" style="margin-top:1rem"><div class="card-label">Who Knows What (contributor-file pairs)</div><table><tr><th>Contributor</th><th>File</th><th>Commits</th></tr>${data.contributorFiles.slice(0, 15).map(cf => `<tr><td>${esc(cf.author)}</td><td class="muted">${esc(shortFile(cf.file))}</td><td>${cf.commits}</td></tr>`).join("")}</table></div>` : ""}
</section>

<footer>Generated by <strong>wisegit</strong> — decision protection for code that matters.<br>Grounded in 12 published papers. <a href="https://github.com/Sandip124/wisegit">github.com/Sandip124/wisegit</a></footer>

<script>
${SCRIPT}
// Init force graph if data exists
(function(){
  const nodes=${JSON.stringify(getGraphNodes(data))};
  const edges=${JSON.stringify(getGraphEdges(data))};
  if(nodes.length>0) initForceGraph(nodes,edges);
})();
</script>
</body></html>`;
}

// ── Helpers ──

function esc(s: string): string { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function fmt(n: number): string { return n.toLocaleString(); }
function pct(n: number, total: number): string { return total === 0 ? "0%" : `${((n / total) * 100).toFixed(1)}%`; }
function shortFile(f: string): string { const p = f.split("/"); return p.length > 2 ? `.../${p.slice(-2).join("/")}` : f; }
function scoreColor(s: number): string { return s >= 0.8 ? "fill-red" : s >= 0.5 ? "fill-yellow" : "fill-green"; }

function getGraphNodes(data: ReportData) {
  const nodeSet = new Set<string>();
  data.dependencyEdges.forEach(e => { nodeSet.add(e.source); nodeSet.add(e.target); });
  const prMap = new Map(data.topPageRank.map(p => [p.name, p.score]));
  return [...nodeSet].slice(0, 60).map(n => ({ id: n, r: 4 + (prMap.get(n) ?? 0) * 16, pr: prMap.get(n) ?? 0 }));
}

function getGraphEdges(data: ReportData) {
  const nodeSet = new Set<string>();
  data.dependencyEdges.forEach(e => { nodeSet.add(e.source); nodeSet.add(e.target); });
  const nodes = [...nodeSet].slice(0, 60);
  return data.dependencyEdges.filter(e => nodes.includes(e.source) && nodes.includes(e.target)).slice(0, 100);
}

function renderDonut(healthy: number, fragile: number, critical: number, total: number): string {
  if (total === 0) return "";
  const r = 70, cx = 80, cy = 80, circ = 2 * Math.PI * r;
  const pH = healthy / total, pF = fragile / total, pC = critical / total;
  return `<svg viewBox="0 0 160 160" width="180" height="180">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#21262d" stroke-width="20"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#3fb950" stroke-width="20" stroke-dasharray="${pH * circ} ${circ}" stroke-dashoffset="0" transform="rotate(-90 ${cx} ${cy})"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#d29922" stroke-width="20" stroke-dasharray="${pF * circ} ${circ}" stroke-dashoffset="-${pH * circ}" transform="rotate(-90 ${cx} ${cy})"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#f85149" stroke-width="20" stroke-dasharray="${pC * circ} ${circ}" stroke-dashoffset="-${(pH + pF) * circ}" transform="rotate(-90 ${cx} ${cy})"/>
    <text x="${cx}" y="${cy - 8}" text-anchor="middle" fill="#f0f6fc" font-size="24" font-weight="600">${total}</text>
    <text x="${cx}" y="${cy + 12}" text-anchor="middle" fill="#8b949e" font-size="11">functions</text>
  </svg>`;
}

function renderHistogram(buckets: { bucket: string; count: number }[]): string {
  const max = Math.max(...buckets.map(b => b.count), 1);
  return `<div class="card" style="margin-top:1rem"><div class="card-label">Score Distribution</div><div class="histogram">${buckets.map(b => {
    const h = Math.max(2, (b.count / max) * 120);
    const color = parseFloat(b.bucket) >= 0.8 ? "#f85149" : parseFloat(b.bucket) >= 0.5 ? "#d29922" : "#3fb950";
    return `<div class="hist-col" title="${b.bucket}: ${b.count}"><div class="hist-bar" style="height:${h}px;background:${color}"></div><div class="hist-label">${b.bucket.split("\u2013")[0]}</div><div class="hist-count">${b.count}</div></div>`;
  }).join("")}</div></div>`;
}

function renderTimeline(timeline: { month: string; events: number }[]): string {
  if (timeline.length === 0) return "<p class='muted'>No timeline data.</p>";
  const max = Math.max(...timeline.map(t => t.events));
  return `<div class="timeline">${timeline.map(t => `<div class="tl-col" title="${t.month}: ${t.events} events"><div class="tl-bar" style="height:${Math.max(3, (t.events / max) * 140)}px"></div></div>`).join("")}</div><div class="tl-labels"><span>${timeline[0].month}</span><span>${timeline[timeline.length - 1].month}</span></div>`;
}

function renderTreemap(files: { file: string; avgScore: number; functions: number; events: number; theoryRisk: string }[]): string {
  const total = files.reduce((s, f) => s + f.events, 0) || 1;
  return `<div class="treemap">${files.slice(0, 30).map(f => {
    const pct = Math.max(3, (f.events / total) * 100);
    const color = f.avgScore >= 0.8 ? "#f8514930" : f.avgScore >= 0.5 ? "#d2992230" : "#3fb95018";
    const border = f.avgScore >= 0.8 ? "#f85149" : f.avgScore >= 0.5 ? "#d29922" : "#3fb950";
    return `<div class="tm-cell" style="flex-basis:${pct}%;background:${color};border-color:${border}" title="${esc(f.file)}\\nScore: ${f.avgScore.toFixed(2)}\\nFunctions: ${f.functions}\\nEvents: ${f.events}"><div class="tm-name">${esc(f.file.split("/").pop() ?? f.file)}</div><div class="tm-score">${f.avgScore.toFixed(2)}</div></div>`;
  }).join("")}</div>`;
}

// ── CSS ──
const CSS = `
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,monospace;background:#0d1117;color:#c9d1d9;padding:0 2rem 3rem;max-width:1200px;margin:0 auto}
.nav{position:sticky;top:0;background:#0d1117ee;backdrop-filter:blur(8px);padding:.8rem 0;margin-bottom:1rem;border-bottom:1px solid #21262d;z-index:10;display:flex;align-items:center;justify-content:space-between}
.nav-brand{color:#58a6ff;font-weight:700;font-size:.95rem}
.nav-links{display:flex;gap:1.2rem}
.nav-links a{color:#8b949e;text-decoration:none;font-size:.8rem;transition:color .2s}
.nav-links a:hover{color:#f0f6fc}
header{margin:2rem 0}
h1{color:#f0f6fc;font-size:2rem;margin-bottom:.3rem}
h2{color:#8b949e;margin:2.5rem 0 1rem;font-size:1.1rem;text-transform:uppercase;letter-spacing:.05em}
.subtitle{color:#484f58}
section{scroll-margin-top:3.5rem}
.grid{display:grid;gap:1rem;margin-bottom:1rem}
.grid-2{grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}
.grid-3{grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
.grid-4{grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}
.card{background:#161b22;border:1px solid #21262d;border-radius:10px;padding:1.3rem;transition:border-color .2s}
.card:hover{border-color:#30363d}
.card-accent-red{border-left:3px solid #f85149}
.card-accent-yellow{border-left:3px solid #d29922}
.card-accent-green{border-left:3px solid #3fb950}
.card-label{color:#8b949e;font-size:.8rem;margin-bottom:.4rem}
.card-value{font-size:2rem;font-weight:700;color:#f0f6fc}
.card-value.green{color:#3fb950}.card-value.yellow{color:#d29922}.card-value.red{color:#f85149}
.pill-row{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.5rem}
.pill{background:#21262d;padding:.3rem .8rem;border-radius:16px;font-size:.8rem;color:#8b949e}
.pill b{color:#c9d1d9;margin-left:.3rem}
.pill-structured{border:1px solid #3fb950}.pill-descriptive{border:1px solid #58a6ff}.pill-noise{border:1px solid #484f58}
.bar-chart{display:flex;flex-direction:column;gap:.5rem;margin-top:.8rem}
.bar-row{display:flex;align-items:center;gap:.5rem}
.bar-label{width:180px;font-size:.78rem;color:#8b949e;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar-track{flex:1;height:22px;background:#21262d;border-radius:4px;overflow:hidden}
.bar-fill{height:100%;border-radius:4px;min-width:2px;transition:width .3s}
.bar-value{width:50px;font-size:.78rem;color:#8b949e;text-align:right}
.fill-blue{background:linear-gradient(90deg,#1f6feb,#58a6ff)}
.fill-green{background:linear-gradient(90deg,#238636,#3fb950)}
.fill-yellow{background:linear-gradient(90deg,#9e6a03,#d29922)}
.fill-red{background:linear-gradient(90deg,#b62324,#f85149)}
.fill-purple{background:linear-gradient(90deg,#8957e5,#bc8cff)}
.stat-list{display:flex;flex-direction:column;gap:.6rem;margin-top:.5rem}
.stat-row{display:flex;justify-content:space-between;align-items:center;padding:.4rem 0;border-bottom:1px solid #21262d;font-size:.85rem}
.score{font-weight:600}.score.high{color:#f85149}.score.mid{color:#d29922}.score.low{color:#3fb950}
table{width:100%;border-collapse:collapse;margin-top:.5rem}
th,td{text-align:left;padding:.5rem .8rem;border-bottom:1px solid #21262d;font-size:.82rem}
th{color:#484f58;font-weight:500;text-transform:uppercase;font-size:.7rem;letter-spacing:.05em}
.muted{color:#484f58}
.badge{display:inline-block;padding:.15rem .6rem;border-radius:12px;font-size:.72rem;font-weight:500}
.badge.active{background:#0d4429;color:#3fb950}.badge.inactive{background:#3d1f00;color:#d29922}.badge.critical{background:#3d0000;color:#f85149}
.legend{display:flex;gap:1rem;justify-content:center;margin-top:1rem;font-size:.8rem}
.legend-item{display:flex;align-items:center;gap:.3rem}
.legend-dot{width:10px;height:10px;border-radius:50%}
.bg-green{background:#3fb950}.bg-yellow{background:#d29922}.bg-red{background:#f85149}
.histogram{display:flex;align-items:flex-end;gap:4px;height:160px;margin-top:.8rem;padding-bottom:2rem;position:relative}
.hist-col{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;position:relative}
.hist-bar{width:100%;border-radius:3px 3px 0 0;min-height:2px;transition:height .3s;opacity:.85}
.hist-bar:hover{opacity:1}
.hist-label{font-size:.65rem;color:#484f58;margin-top:.3rem}
.hist-count{font-size:.65rem;color:#8b949e;position:absolute;top:-16px}
.timeline{display:flex;align-items:flex-end;gap:2px;height:150px;margin-top:.8rem}
.tl-col{flex:1;display:flex;align-items:flex-end}
.tl-bar{width:100%;background:linear-gradient(0deg,#1f6feb,#58a6ff);border-radius:2px 2px 0 0;min-height:3px;opacity:.7;transition:opacity .2s}
.tl-bar:hover{opacity:1}
.tl-labels{display:flex;justify-content:space-between;font-size:.7rem;color:#484f58;margin-top:.3rem}
.treemap{display:flex;flex-wrap:wrap;gap:3px;margin-top:.8rem;min-height:100px}
.tm-cell{border:1px solid;border-radius:4px;padding:.4rem;min-width:60px;min-height:50px;display:flex;flex-direction:column;justify-content:center;align-items:center;cursor:default;transition:transform .1s}
.tm-cell:hover{transform:scale(1.03);z-index:1}
.tm-name{font-size:.68rem;color:#c9d1d9;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.tm-score{font-size:.6rem;color:#8b949e}
#force-graph text{font-size:9px;fill:#8b949e;pointer-events:none}
#force-graph circle{cursor:pointer;transition:r .2s}
#force-graph circle:hover{r:10}
#force-graph line{stroke:#21262d;stroke-width:.5}
footer{margin-top:4rem;padding:1.5rem 0;border-top:1px solid #21262d;color:#484f58;font-size:.8rem;text-align:center}
footer a{color:#58a6ff;text-decoration:none}
@media(max-width:768px){.nav-links{display:none}.grid-4{grid-template-columns:1fr 1fr}.bar-label{width:120px}}
`;

// ── JavaScript ──
const SCRIPT = `
function initForceGraph(nodes,edges){
  var svg=document.getElementById('force-graph');
  if(!svg||nodes.length===0)return;
  var W=800,H=500;
  nodes.forEach(function(n){n.x=W/2+(Math.random()-.5)*W*.6;n.y=H/2+(Math.random()-.5)*H*.6;n.vx=0;n.vy=0});
  var nodeMap={};nodes.forEach(function(n){nodeMap[n.id]=n});
  for(var iter=0;iter<50;iter++){
    for(var i=0;i<nodes.length;i++){for(var j=i+1;j<nodes.length;j++){
      var dx=nodes[j].x-nodes[i].x,dy=nodes[j].y-nodes[i].y,d=Math.sqrt(dx*dx+dy*dy)||1,f=800/(d*d);
      nodes[i].vx-=dx/d*f;nodes[i].vy-=dy/d*f;nodes[j].vx+=dx/d*f;nodes[j].vy+=dy/d*f;
    }}
    edges.forEach(function(e){var s=nodeMap[e.source],t=nodeMap[e.target];if(!s||!t)return;
      var dx=t.x-s.x,dy=t.y-s.y,d=Math.sqrt(dx*dx+dy*dy)||1,f=d*.005;
      s.vx+=dx/d*f;s.vy+=dy/d*f;t.vx-=dx/d*f;t.vy-=dy/d*f;
    });
    nodes.forEach(function(n){n.vx+=(W/2-n.x)*.001;n.vy+=(H/2-n.y)*.001;
      n.vx*=.85;n.vy*=.85;n.x+=n.vx;n.y+=n.vy;
      n.x=Math.max(20,Math.min(W-20,n.x));n.y=Math.max(20,Math.min(H-20,n.y));
    });
  }
  var html='';
  edges.forEach(function(e){var s=nodeMap[e.source],t=nodeMap[e.target];
    if(s&&t)html+='<line x1="'+s.x+'" y1="'+s.y+'" x2="'+t.x+'" y2="'+t.y+'"/>';
  });
  nodes.forEach(function(n){var c=n.pr>.5?'#bc8cff':n.pr>.1?'#58a6ff':'#30363d';
    html+='<circle cx="'+n.x+'" cy="'+n.y+'" r="'+n.r+'" fill="'+c+'" opacity="0.8"><title>'+n.id+' (PR: '+n.pr.toFixed(3)+')</title></circle>';
    if(n.pr>.3)html+='<text x="'+(n.x+n.r+3)+'" y="'+(n.y+3)+'">'+n.id+'</text>';
  });
  svg.innerHTML=html;
}
document.querySelectorAll('.nav-links a').forEach(function(a){
  a.addEventListener('click',function(e){e.preventDefault();
    var t=document.querySelector(a.getAttribute('href'));
    if(t)t.scrollIntoView({behavior:'smooth'});
  });
});
`;
