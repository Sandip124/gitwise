import { ReportData } from "./collect.js";

export function generateHtmlReport(data: ReportData): string {
  const repoName = data.repoPath.split("/").pop() ?? data.repoPath;
  const dataJson = JSON.stringify({
    commits: data.commits,
    allFunctions: data.allFunctions,
    folderTree: data.folderTree,
    dependencyEdges: data.dependencyEdges,
    topPageRank: data.topPageRank,
    fileEvents: data.fileEvents,
    contributorFiles: data.contributorFiles,
  });

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>wisegit — ${esc(repoName)}</title>
<style>${CSS}</style>
</head><body>

<nav class="nav">
  <span class="brand">wisegit</span>
  <div class="tabs" id="main-tabs">
    <button class="tab active" data-tab="overview">Overview</button>
    <button class="tab" data-tab="freeze">Freeze Scores</button>
    <button class="tab" data-tab="theory">Theory Health</button>
    <button class="tab" data-tab="commits">Commits</button>
    <button class="tab" data-tab="files">Files</button>
    <button class="tab" data-tab="contributors">Contributors</button>
    <button class="tab" data-tab="search">Search</button>
  </div>
</nav>

<header>
  <h1>${esc(repoName)} <span class="branch-badge">${esc(data.branch)}</span></h1>
  <p class="sub">${data.generatedAt.slice(0, 10)} &mdash; ${fmt(data.totalCommits)} commits, ${fmt(data.totalEvents)} events, ${fmt(data.totalFunctions)} functions</p>
  <p class="sub dim" style="font-size:.7rem">This report reflects the state of the <b>${esc(data.branch)}</b> branch. Results may differ on other branches.</p>
  <details class="guide">
    <summary>What do these metrics mean?</summary>
    <div class="guide-grid">
      <div class="gc"><b class="green">Open</b> (score &lt; 0.50) — safe to modify, little decision history.</div>
      <div class="gc"><b class="yellow">Stable</b> (0.50–0.79) — has intentional decisions. Review before changing.</div>
      <div class="gc"><b class="red">Frozen</b> (&ge; 0.80) — verified decisions backed by git history and issue trackers. Override required.</div>
      <div class="gc"><b class="blue">Freeze score</b> measures <em>intentionality and risk</em>, not code quality. High score = "understand before changing."</div>
      <div class="gc"><b class="purple">Theory health</b> tracks who understands each function. When original authors leave, knowledge is lost — wisegit detects this from contributor patterns.</div>
      <div class="gc"><b class="dim">Decisions</b> are extracted from commits — the message, classification, and inferred intent behind each change.</div>
    </div>
  </details>
</header>

<!-- ═══ OVERVIEW TAB ═══ -->
<div class="panel active" id="panel-overview">
  <div class="g4">
    <div class="card"><div class="cl">Commits</div><div class="cv">${fmt(data.totalCommits)}</div></div>
    <div class="card"><div class="cl">Events</div><div class="cv">${fmt(data.totalEvents)}</div><div class="cd">Function-level changes tracked</div></div>
    <div class="card"><div class="cl">Functions</div><div class="cv">${fmt(data.totalFunctions)}</div></div>
    <div class="card"><div class="cl">Files</div><div class="cv">${fmt(data.totalFiles)}</div></div>
  </div>

  ${data.languages.length > 0 ? `<div class="card mt"><div class="cl">Languages</div><div class="pills">${data.languages.map(l => `<span class="pill">${esc(l.language)} <b>${l.count}</b></span>`).join("")}</div></div>` : ""}

  <div class="g2 mt">
    ${data.classificationBreakdown.length > 0 ? `
    <div class="card">
      <div class="cl">Commit Classification</div>
      <div class="cd">How well commits communicate intent</div>
      <div class="cls-chart">${renderClassificationBars(data.classificationBreakdown)}</div>
      <div class="cls-legend">${data.classificationBreakdown.map(c => {
        const total = data.classificationBreakdown.reduce((s, x) => s + x.count, 0);
        return `<span class="cls-leg-item cls-${c.classification.toLowerCase()}">${c.classification}: ${c.count} (${(c.count / total * 100).toFixed(0)}%)</span>`;
      }).join("")}</div>
    </div>` : ""}

    <div class="card">
      <div class="cl">Protection Status</div>
      <div class="cd">How many functions are protected</div>
      <div class="dist-bars">
        <div class="dist-row"><span class="dist-label red">Frozen</span><div class="dist-track"><div class="dist-fill bg-red" style="width:${pctN(data.freezeDistribution.frozen, data.totalFunctions)}%"></div></div><span class="dist-val">${data.freezeDistribution.frozen}</span></div>
        <div class="dist-row"><span class="dist-label yellow">Stable</span><div class="dist-track"><div class="dist-fill bg-yellow" style="width:${pctN(data.freezeDistribution.stable, data.totalFunctions)}%"></div></div><span class="dist-val">${data.freezeDistribution.stable}</span></div>
        <div class="dist-row"><span class="dist-label green">Open</span><div class="dist-track"><div class="dist-fill bg-green" style="width:${pctN(data.freezeDistribution.open, data.totalFunctions)}%"></div></div><span class="dist-val">${data.freezeDistribution.open}</span></div>
      </div>
    </div>
  </div>

  <div class="card mt">
    <div class="cl">Activity Timeline</div>
    <div class="cd">Decision events per month — gaps indicate unmaintained periods</div>
    ${renderTimeline(data.timeline)}
  </div>

  ${data.originBreakdown.length > 0 ? `
  <div class="card mt">
    <div class="cl">Decision Origins</div>
    <div class="cd">How decisions were made: by humans, by AI with review, or by AI alone</div>
    <div class="stat-list">${data.originBreakdown.map(o => `<div class="sr"><span>${o.origin.replace(/_/g, " ")}</span><span class="sc ${o.origin === 'HUMAN' ? 'green' : o.origin === 'AI_REVIEWED' ? 'yellow' : 'red'}">${fmt(o.count)}</span></div>`).join("")}</div>
  </div>` : ""}
</div>

<!-- ═══ FREEZE SCORES TAB ═══ -->
<div class="panel" id="panel-freeze">
  <div class="g3">
    <div class="card ac-red"><div class="cl">Frozen (&ge; 0.80)</div><div class="cv red">${data.freezeDistribution.frozen}</div><div class="cd">Override required to modify</div></div>
    <div class="card ac-yellow"><div class="cl">Stable (0.50–0.79)</div><div class="cv yellow">${data.freezeDistribution.stable}</div><div class="cd">Review intent before changing</div></div>
    <div class="card ac-green"><div class="cl">Open (&lt; 0.50)</div><div class="cv green">${data.freezeDistribution.open}</div><div class="cd">Safe to modify freely</div></div>
  </div>

  <div class="card" style="margin-top:1.5rem">
    <div class="cl">Score Distribution</div>
    <div class="cd" style="margin-bottom:0">How functions are distributed across score ranges</div>
    <div class="histogram">
      ${data.scoreHistogram.map((b, i) => {
        const max = Math.max(...data.scoreHistogram.map(x => x.count), 1);
        const h = Math.max(2, (b.count / max) * 140);
        const color = i >= 8 ? "#f85149" : i >= 5 ? "#d29922" : "#3fb950";
        return `<div class="hc"><div class="hcount">${b.count > 0 ? b.count : ""}</div><div class="hbar" style="height:${h}px;background:${color}" title="${b.bucket}: ${b.count}"></div><div class="hlabel">${(i / 10).toFixed(1)}</div></div>`;
      }).join("")}
    </div>
    <div class="hscale"><span class="green">Open</span><span class="yellow">Stable</span><span class="red">Frozen</span></div>
  </div>

  ${data.topFrozen.length > 0 ? `
  <div class="card mt">
    <div class="cl">Top Functions by Score</div>
    <div class="cd">Functions carrying the most verified decisions — the load-bearing parts of your codebase</div>
    <div class="bars">
      ${data.topFrozen.slice(0, 15).map(f => `
      <div class="br" title="${esc(f.file)}::${esc(f.name)}()">
        <div class="bl">${esc(f.name)}()</div>
        <div class="bt"><div class="bf ${scColor(f.score)}" style="width:${Math.max(2, f.score * 100).toFixed(0)}%"></div></div>
        <div class="bv">${f.score.toFixed(2)}</div>
      </div>`).join("")}
    </div>
  </div>` : ""}
</div>

<!-- ═══ THEORY HEALTH TAB ═══ -->
<div class="panel" id="panel-theory">
  <div class="g2">
    <div class="card" style="text-align:center">
      ${renderDonut(data.theoryHealth.healthy, data.theoryHealth.fragile, data.theoryHealth.critical, data.totalFunctions)}
      <div class="legend">
        <span><span class="dot bg-green"></span> Healthy (2+ active)</span>
        <span><span class="dot bg-yellow"></span> Fragile (1 active)</span>
        <span><span class="dot bg-red"></span> No active contributors</span>
      </div>
    </div>
    <div class="card">
      <div class="cl">Distribution</div>
      <div class="stat-list">
        <div class="sr"><span><b>Healthy</b> — 2+ people actively work on these</span><span class="sc green">${data.theoryHealth.healthy} (${pct(data.theoryHealth.healthy, data.totalFunctions)})</span></div>
        <div class="sr"><span><b>Fragile</b> — only 1 person knows this code</span><span class="sc yellow">${data.theoryHealth.fragile} (${pct(data.theoryHealth.fragile, data.totalFunctions)})</span></div>
        <div class="sr"><span><b>No active contributors</b> — original authors inactive 6+ months. Knowledge may be partially or fully lost.</span><span class="sc red">${data.theoryHealth.critical} (${pct(data.theoryHealth.critical, data.totalFunctions)})</span></div>
      </div>
    </div>
  </div>

  ${data.topRisks.length > 0 ? `
  <div class="card mt">
    <div class="cl">Highest Risk — No Active Contributors</div>
    <div class="cd">These functions were written by people who haven't committed in 6+ months. The knowledge of <em>why</em> they work this way may be lost. Treat all logic as intentional until manually reviewed.</div>
    <table><tr><th>Function</th><th>File</th><th>Contributors</th></tr>
    ${data.topRisks.map(r => `<tr><td>${esc(r.name)}()</td><td class="dim">${esc(shortFile(r.file))}</td><td><span class="badge critical">${r.holders} total, 0 active</span></td></tr>`).join("")}
    </table>
  </div>` : ""}

  <div class="card mt">
    <div class="cl">Browse Functions</div>
    <div class="sub-tabs">
      <button class="stab active" onclick="showSubTab('fn-all',this)">All (${data.allFunctions.length})</button>
      <button class="stab" onclick="showSubTab('fn-stable',this)">Stable</button>
      <button class="stab" onclick="showSubTab('fn-critical',this)">No Active Contributors</button>
    </div>
    <div id="fn-all" class="stab-content active">
      <div class="scroll-table"><table><tr><th>Function</th><th>File</th><th>Score</th></tr>
      ${data.allFunctions.slice(0, 50).map(f => `<tr><td>${esc(f.name)}()</td><td class="dim">${esc(shortFile(f.file))}</td><td><span class="sc ${f.score >= 0.8 ? 'red' : f.score >= 0.5 ? 'yellow' : 'green'}">${f.score.toFixed(2)}</span></td></tr>`).join("")}
      </table></div>
      ${data.allFunctions.length > 50 ? `<div class="more">${data.allFunctions.length - 50} more not shown</div>` : ""}
    </div>
    <div id="fn-stable" class="stab-content">
      <div class="scroll-table"><table><tr><th>Function</th><th>File</th><th>Score</th></tr>
      ${data.allFunctions.filter(f => f.score >= 0.5 && f.score < 0.8).slice(0, 50).map(f => `<tr><td>${esc(f.name)}()</td><td class="dim">${esc(shortFile(f.file))}</td><td><span class="sc yellow">${f.score.toFixed(2)}</span></td></tr>`).join("")}
      </table></div>
    </div>
    <div id="fn-critical" class="stab-content">
      <div class="scroll-table"><table><tr><th>Function</th><th>File</th><th>Score</th></tr>
      ${data.allFunctions.filter(f => f.theoryRisk === "critical").slice(0, 50).map(f => `<tr><td>${esc(f.name)}()</td><td class="dim">${esc(shortFile(f.file))}</td><td><span class="sc red">${f.score.toFixed(2)}</span></td></tr>`).join("")}
      </table></div>
    </div>
  </div>
</div>

<!-- ═══ COMMITS TAB ═══ -->
<div class="panel" id="panel-commits">
  <div class="card">
    <div class="commit-controls">
      <input type="text" id="commit-search" placeholder="Search commits..." class="sinput" oninput="filterCommits()">
      <div class="pills">
        <button class="pbtn active" onclick="filterCls('all',this)">All</button>
        <button class="pbtn cls-str" onclick="filterCls('STRUCTURED',this)">Structured</button>
        <button class="pbtn cls-desc" onclick="filterCls('DESCRIPTIVE',this)">Descriptive</button>
        <button class="pbtn cls-noise" onclick="filterCls('NOISE',this)">Noise</button>
      </div>
    </div>
    <div id="commit-list"></div>
    <div class="paging">
      <button id="prev-btn" onclick="commitPage(-1)" disabled>&larr; Prev</button>
      <span id="page-info"></span>
      <button id="next-btn" onclick="commitPage(1)">Next &rarr;</button>
    </div>
  </div>
</div>

<!-- ═══ FILES TAB ═══ -->
<div class="panel" id="panel-files">
  <div class="card">
    <div class="cl">Folder Structure</div>
    <div class="cd">Click folders to expand. Score shows average freeze score for functions in each folder.</div>
    <div id="folder-tree"></div>
  </div>

  <div class="card mt">
    <div class="cl">Top Files by Decision History</div>
    <div class="cd">Files with the most recorded decision events. Click to expand and browse all decisions with pagination.</div>
    ${data.topFiles.slice(0, 12).map((f, idx) => {
      const max = data.topFiles[0]?.events ?? 1;
      return `
      <div class="file-row-wrap">
        <div class="br clickable" onclick="toggleFileEvents(${idx})" style="margin-bottom:.3rem">
          <div class="bl">${esc(shortFile(f.file))}</div>
          <div class="bt"><div class="bf fill-blue" style="width:${((f.events / max) * 100).toFixed(0)}%"></div></div>
          <div class="bv">${f.events} events &#9660;</div>
        </div>
        <div class="file-events" id="fe-${idx}" style="display:none">
          <div id="fe-list-${idx}"></div>
          <div class="paging fe-paging" id="fe-paging-${idx}"></div>
        </div>
      </div>`;
    }).join("")}
  </div>

  ${data.topPageRank.length > 0 ? `
  <div class="card mt">
    <div class="cl">Most Load-Bearing Functions (PageRank)</div>
    <div class="cd">Functions ranked by how many other functions depend on them. Higher = wider impact if changed.</div>
    <div class="bars">${data.topPageRank.map(f => `
      <div class="br" title="${esc(f.file)}">
        <div class="bl">${esc(f.name)}()</div>
        <div class="bt"><div class="bf fill-purple" style="width:${(f.score * 100).toFixed(0)}%"></div></div>
        <div class="bv">${f.score.toFixed(3)}</div>
      </div>`).join("")}
    </div>
  </div>` : ""}
</div>

<!-- ═══ CONTRIBUTORS TAB ═══ -->
<div class="panel" id="panel-contributors">
  <div class="card">
    <div class="cl">Team Members</div>
    <table><tr><th>Author</th><th>Commits</th><th>Last Active</th><th>Status</th></tr>
    ${data.contributors.slice(0, 20).map(c => `<tr><td>${esc(c.author)}</td><td>${c.commits}</td><td class="dim">${c.lastActive?.slice(0, 10) ?? ""}</td><td><span class="badge ${c.isActive ? 'active' : 'inactive'}">${c.isActive ? "active" : "inactive"}</span></td></tr>`).join("")}
    </table>
  </div>
  ${data.contributorFiles.length > 0 ? `
  <div class="card mt">
    <div class="cl">Who Knows What</div>
    <div class="cd">Which contributors have the most commit history with which files. Useful for finding who to ask about specific code.</div>
    <table><tr><th>Contributor</th><th>File</th><th>Commits</th></tr>
    ${data.contributorFiles.slice(0, 20).map(cf => `<tr><td>${esc(cf.author)}</td><td class="dim">${esc(shortFile(cf.file))}</td><td>${cf.commits}</td></tr>`).join("")}
    </table>
  </div>` : ""}
</div>

<!-- ═══ SEARCH TAB ═══ -->
<div class="panel" id="panel-search">
  <div class="card">
    <input type="text" id="decision-search" placeholder="Search functions, commits, files, contributors..." class="sinput sinput-lg" oninput="doSearch()">
    <div id="search-results"><div class="dim" style="padding:1.5rem;text-align:center">Search across ${fmt(data.totalFunctions)} functions, ${fmt(data.totalCommits)} commits, and ${data.contributors.length} contributors</div></div>
  </div>
</div>

<footer>Generated by <b>wisegit</b> &mdash; decision protection for code that matters. <a href="https://github.com/Sandip124/wisegit">github.com/Sandip124/wisegit</a></footer>

<script>
var D=${dataJson};
var COMMITS=${JSON.stringify(data.commits)};
var FUNS=${JSON.stringify(data.allFunctions)};
var CONTRIBUTORS=${JSON.stringify(data.contributors)};
${SCRIPT}
</script>
</body></html>`;
}

function esc(s: string): string { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function fmt(n: number): string { return n.toLocaleString(); }
function pct(n: number, t: number): string { return t === 0 ? "0%" : `${((n / t) * 100).toFixed(1)}%`; }
function pctN(n: number, t: number): number { return t === 0 ? 0 : Math.max(1, (n / t) * 100); }
function shortFile(f: string): string { const p = f.split("/"); return p.length > 2 ? `.../${p.slice(-2).join("/")}` : f; }
function scColor(s: number): string { return s >= 0.8 ? "fill-red" : s >= 0.5 ? "fill-yellow" : "fill-green"; }

function renderClassificationBars(data: { classification: string; count: number }[]): string {
  const total = data.reduce((s, x) => s + x.count, 0);
  if (total === 0) return "";
  // Render each as a separate row to avoid label clipping
  return data.map(c => {
    const pctVal = (c.count / total * 100);
    return `<div class="cls-row">
      <span class="cls-label cls-${c.classification.toLowerCase()}">${c.classification}</span>
      <div class="cls-track"><div class="cls-fill cls-bg-${c.classification.toLowerCase()}" style="width:${Math.max(3, pctVal)}%"></div></div>
      <span class="cls-val">${c.count} (${pctVal.toFixed(0)}%)</span>
    </div>`;
  }).join("");
}

function renderDonut(h: number, f: number, c: number, t: number): string {
  if (t === 0) return "";
  const r = 70, cx = 80, cy = 80, ci = 2 * Math.PI * r;
  const pH = h / t, pF = f / t, pC = c / t;
  return `<svg viewBox="0 0 160 160" width="170" height="170">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#21262d" stroke-width="20"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#3fb950" stroke-width="20" stroke-dasharray="${pH * ci} ${ci}" stroke-dashoffset="0" transform="rotate(-90 ${cx} ${cy})"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#d29922" stroke-width="20" stroke-dasharray="${pF * ci} ${ci}" stroke-dashoffset="-${pH * ci}" transform="rotate(-90 ${cx} ${cy})"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#f85149" stroke-width="20" stroke-dasharray="${pC * ci} ${ci}" stroke-dashoffset="-${(pH + pF) * ci}" transform="rotate(-90 ${cx} ${cy})"/>
    <text x="${cx}" y="${cy - 6}" text-anchor="middle" fill="#f0f6fc" font-size="22" font-weight="600">${t}</text>
    <text x="${cx}" y="${cy + 12}" text-anchor="middle" fill="#8b949e" font-size="10">functions</text>
  </svg>`;
}

function renderTimeline(tl: { month: string; events: number }[]): string {
  if (!tl.length) return "<p class='dim'>No timeline data.</p>";
  const max = Math.max(...tl.map(t => t.events));
  return `<div class="tl">${tl.map(t => `<div class="tlc" title="${t.month}: ${t.events} events"><div class="tlb" style="height:${Math.max(3, (t.events / max) * 120)}px"></div></div>`).join("")}</div><div class="tll"><span>${tl[0].month}</span><span>${tl[tl.length - 1].month}</span></div>`;
}

const CSS = `
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0d1117;color:#c9d1d9;max-width:1100px;margin:0 auto;padding:0 1.5rem 3rem;line-height:1.5}

/* Nav */
.nav{position:sticky;top:0;background:#0d1117ee;backdrop-filter:blur(8px);padding:.6rem 0;border-bottom:1px solid #21262d;z-index:10;display:flex;align-items:center;gap:1.5rem}
.brand{color:#58a6ff;font-weight:700;font-size:.9rem;flex-shrink:0}
.tabs{display:flex;gap:.3rem;flex-wrap:wrap}
.tab{background:none;border:1px solid transparent;color:#8b949e;padding:.3rem .7rem;border-radius:6px;cursor:pointer;font-size:.75rem;transition:.2s}
.tab:hover{color:#c9d1d9}.tab.active{border-color:#58a6ff;color:#58a6ff;background:#58a6ff11}

/* Header */
header{margin:1.5rem 0 1rem}
h1{color:#f0f6fc;font-size:1.5rem;display:flex;align-items:center;gap:.6rem;flex-wrap:wrap}
.branch-badge{font-size:.7rem;font-weight:500;background:#1f6feb22;color:#58a6ff;padding:.2rem .6rem;border-radius:12px;border:1px solid #1f6feb44}
.sub{color:#484f58;font-size:.82rem;margin-top:.2rem}
.guide{margin-top:.8rem;border:1px solid #21262d;border-radius:8px;padding:.5rem .8rem}
.guide summary{color:#8b949e;font-size:.8rem;cursor:pointer}
.guide summary:hover{color:#c9d1d9}
.guide-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:.6rem;margin-top:.6rem}
.gc{font-size:.78rem;color:#8b949e;line-height:1.4;padding:.4rem;background:#161b22;border-radius:6px}

/* Panels (tab content) */
.panel{display:none}.panel.active{display:block}

/* Cards */
.card{background:#161b22;border:1px solid #21262d;border-radius:8px;padding:1.1rem;transition:border-color .2s}
.card:hover{border-color:#30363d}
.cl{color:#8b949e;font-size:.78rem;margin-bottom:.2rem}
.cd{color:#484f58;font-size:.72rem;margin-bottom:.6rem}
.cv{font-size:1.8rem;font-weight:700;color:#f0f6fc}
.mt{margin-top:1rem}
.ac-red{border-left:3px solid #f85149}.ac-yellow{border-left:3px solid #d29922}.ac-green{border-left:3px solid #3fb950}

/* Grid */
.g2{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem}
.g3{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1rem}
.g4{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1rem}

/* Colors */
.green{color:#3fb950}.yellow{color:#d29922}.red{color:#f85149}.blue{color:#58a6ff}.purple{color:#bc8cff}.dim{color:#484f58}
.bg-green{background:#3fb950}.bg-yellow{background:#d29922}.bg-red{background:#f85149}

/* Pills */
.pills{display:flex;flex-wrap:wrap;gap:.4rem}
.pill{background:#21262d;padding:.25rem .65rem;border-radius:14px;font-size:.72rem;color:#8b949e}
.pill b{color:#c9d1d9;margin-left:.2rem}
.pbtn{background:#21262d;border:1px solid #30363d;padding:.25rem .6rem;border-radius:14px;font-size:.72rem;color:#8b949e;cursor:pointer}
.pbtn.active,.pbtn:hover{border-color:#58a6ff;color:#58a6ff}
.cls-str{border-color:#3fb950!important;color:#3fb950!important}
.cls-desc{border-color:#58a6ff!important;color:#58a6ff!important}
.cls-noise{border-color:#484f58!important;color:#8b949e!important}

/* Classification bars (horizontal, separate rows) */
.cls-chart{margin-top:.5rem}
.cls-row{display:flex;align-items:center;gap:.5rem;margin-bottom:.4rem}
.cls-label{width:90px;font-size:.72rem;font-weight:600;text-align:right}
.cls-structured{color:#3fb950}.cls-descriptive{color:#58a6ff}.cls-noise{color:#8b949e}
.cls-track{flex:1;height:20px;background:#21262d;border-radius:4px;overflow:hidden}
.cls-fill{height:100%;border-radius:4px}
.cls-bg-structured{background:#238636}.cls-bg-descriptive{background:#1f6feb}.cls-bg-noise{background:#30363d}
.cls-val{font-size:.7rem;color:#8b949e;width:80px}
.cls-legend{display:flex;gap:1rem;margin-top:.4rem;flex-wrap:wrap}
.cls-leg-item{font-size:.68rem}

/* Distribution */
.dist-bars{margin-top:.5rem}
.dist-row{display:flex;align-items:center;gap:.5rem;margin-bottom:.5rem}
.dist-label{width:55px;font-size:.75rem;font-weight:600}
.dist-track{flex:1;height:22px;background:#21262d;border-radius:4px;overflow:hidden}
.dist-fill{height:100%;border-radius:4px;min-width:2px}
.dist-val{width:40px;font-size:.75rem;color:#8b949e;text-align:right}

/* Bar charts */
.bars{display:flex;flex-direction:column;gap:.55rem;margin-top:.5rem}
.br{display:flex;align-items:center;gap:.5rem;padding:.15rem 0}
.bl{width:150px;font-size:.72rem;color:#8b949e;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt{flex:1;height:20px;background:#21262d;border-radius:4px;overflow:hidden}
.bf{height:100%;border-radius:4px;min-width:2px}
.bv{width:70px;font-size:.72rem;color:#8b949e;text-align:right}
.fill-blue{background:linear-gradient(90deg,#1f6feb,#58a6ff)}
.fill-green{background:linear-gradient(90deg,#238636,#3fb950)}
.fill-yellow{background:linear-gradient(90deg,#9e6a03,#d29922)}
.fill-red{background:linear-gradient(90deg,#b62324,#f85149)}
.fill-purple{background:linear-gradient(90deg,#8957e5,#bc8cff)}

/* Histogram */
.histogram{display:flex;align-items:flex-end;gap:4px;height:180px;margin:2rem 0 .5rem;padding-bottom:2rem}
.hc{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end}
.hbar{width:100%;border-radius:3px 3px 0 0;min-height:2px;opacity:.85;transition:opacity .2s}
.hbar:hover{opacity:1}
.hlabel{font-size:.6rem;color:#484f58;margin-top:.3rem}
.hcount{font-size:.62rem;color:#8b949e;margin-bottom:.2rem;min-height:14px}
.hscale{display:flex;justify-content:space-between;font-size:.7rem}

/* Timeline */
.tl{display:flex;align-items:flex-end;gap:2px;height:130px;margin-top:.5rem}
.tlc{flex:1;display:flex;align-items:flex-end}
.tlb{width:100%;background:linear-gradient(0deg,#1f6feb,#58a6ff);border-radius:2px 2px 0 0;min-height:3px;opacity:.7;transition:opacity .2s}
.tlb:hover{opacity:1}
.tll{display:flex;justify-content:space-between;font-size:.65rem;color:#484f58;margin-top:.3rem}

/* Stat list */
.stat-list{display:flex;flex-direction:column;gap:.4rem}
.sr{display:flex;justify-content:space-between;align-items:center;padding:.35rem 0;border-bottom:1px solid #21262d;font-size:.8rem}
.sc{font-weight:600}

/* Tables */
table{width:100%;border-collapse:collapse;margin-top:.3rem}
th,td{text-align:left;padding:.4rem .6rem;border-bottom:1px solid #21262d;font-size:.78rem}
th{color:#484f58;font-weight:500;text-transform:uppercase;font-size:.65rem;letter-spacing:.04em}
.scroll-table{max-height:400px;overflow-y:auto}
.more{color:#484f58;font-size:.72rem;padding:.5rem;text-align:center}

/* Badges */
.badge{display:inline-block;padding:.1rem .5rem;border-radius:12px;font-size:.68rem;font-weight:500}
.badge.active{background:#0d4429;color:#3fb950}.badge.inactive{background:#3d1f00;color:#d29922}.badge.critical{background:#3d0000;color:#f85149}

/* Donut legend */
.legend{display:flex;gap:.8rem;justify-content:center;margin-top:.8rem;font-size:.72rem;flex-wrap:wrap;color:#8b949e}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:.2rem;vertical-align:middle}

/* Sub-tabs */
.sub-tabs{display:flex;gap:.3rem;margin:.5rem 0}
.stab{background:none;border:1px solid #30363d;color:#8b949e;padding:.25rem .6rem;border-radius:5px;cursor:pointer;font-size:.72rem}
.stab.active{border-color:#58a6ff;color:#58a6ff}
.stab-content{display:none}.stab-content.active{display:block}

/* Commit explorer */
.commit-controls{display:flex;gap:1rem;align-items:center;flex-wrap:wrap;margin-bottom:.8rem}
.sinput{background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:.45rem .7rem;border-radius:6px;font-size:.8rem;flex:1;min-width:200px}
.sinput:focus{outline:none;border-color:#58a6ff}
.sinput-lg{width:100%;max-width:100%;font-size:.85rem;padding:.6rem .8rem}
.commit-row{padding:.5rem 0;border-bottom:1px solid #161b22}
.commit-row:hover{background:#161b2288}
.commit-meta{display:flex;gap:.4rem;align-items:center;margin-bottom:.15rem;flex-wrap:wrap}
.commit-sha{font-family:monospace;font-size:.72rem;color:#58a6ff;background:#1f6feb22;padding:.1rem .35rem;border-radius:3px}
.commit-msg{font-size:.8rem;color:#c9d1d9}
.commit-info{font-size:.68rem;color:#484f58;margin-top:.1rem}
.commit-fns{font-size:.65rem;color:#484f58}
.cls-badge-structured{background:#23863622;color:#3fb950;padding:.1rem .35rem;border-radius:3px;font-size:.65rem}
.cls-badge-descriptive{background:#1f6feb22;color:#58a6ff;padding:.1rem .35rem;border-radius:3px;font-size:.65rem}
.cls-badge-noise{background:#21262d;color:#484f58;padding:.1rem .35rem;border-radius:3px;font-size:.65rem}
.cls-badge-unknown{background:#21262d;color:#484f58;padding:.1rem .35rem;border-radius:3px;font-size:.65rem}
.paging{display:flex;align-items:center;justify-content:center;gap:1rem;padding:.8rem 0;font-size:.75rem;color:#484f58}
.paging button{background:#21262d;border:1px solid #30363d;color:#8b949e;padding:.3rem .7rem;border-radius:5px;cursor:pointer;font-size:.72rem}
.paging button:hover:not(:disabled){border-color:#58a6ff;color:#58a6ff}
.paging button:disabled{opacity:.3;cursor:default}

/* File explorer */
.file-row-wrap{margin-bottom:.6rem;padding-bottom:.4rem;border-bottom:1px solid #21262d11}
.clickable{cursor:pointer}.clickable:hover .bl{color:#58a6ff}
.file-events{padding:.3rem 0 .3rem 1rem;border-left:2px solid #21262d;margin-left:.5rem}
.fe-item{display:flex;gap:.4rem;align-items:center;padding:.3rem 0;font-size:.72rem;flex-wrap:wrap;border-bottom:1px solid #0d111755}
.fe-sha{font-family:monospace;color:#58a6ff;font-size:.7rem}
.fe-msg{color:#c9d1d9;flex:1;min-width:150px}
.fe-meta{color:#484f58;font-size:.65rem}
.fe-paging{justify-content:flex-start;padding:.4rem 0}
.fe-paging button{font-size:.65rem;padding:.2rem .5rem}

/* Folder tree */
.folder-row{display:flex;align-items:center;gap:.4rem;padding:.35rem .5rem;border-bottom:1px solid #0d1117;font-size:.78rem;cursor:pointer;user-select:none}
.folder-row:hover{background:#21262d44}
.folder-toggle{width:16px;color:#484f58;font-size:.7rem;text-align:center}
.file-leaf{display:flex;align-items:center;gap:.4rem;padding:.25rem .5rem;font-size:.72rem;border-bottom:1px solid #0d111744;color:#8b949e}
.file-leaf:hover{background:#21262d22}
.file-leaf-name{color:#c9d1d9;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.folder-name{color:#c9d1d9;font-weight:500}
.folder-stats{color:#484f58;font-size:.68rem;flex:1;text-align:right;margin-right:.5rem}

/* Search */
.search-results{max-height:500px;overflow-y:auto;margin-top:.5rem}
.sr-section{padding:.4rem 0;color:#8b949e;font-size:.72rem;font-weight:600;border-bottom:1px solid #21262d}

footer{margin-top:3rem;padding:1.2rem 0;border-top:1px solid #21262d;color:#484f58;font-size:.75rem;text-align:center}
footer a{color:#58a6ff;text-decoration:none}
@media(max-width:768px){.nav{flex-direction:column;align-items:flex-start;gap:.5rem}.g4{grid-template-columns:1fr 1fr}.bl{width:100px}}
`;

const SCRIPT = `
// Tab navigation
document.querySelectorAll('#main-tabs .tab').forEach(function(btn){
  btn.addEventListener('click',function(){
    document.querySelectorAll('#main-tabs .tab').forEach(function(b){b.classList.remove('active')});
    document.querySelectorAll('.panel').forEach(function(p){p.classList.remove('active')});
    btn.classList.add('active');
    document.getElementById('panel-'+btn.getAttribute('data-tab')).classList.add('active');
    if(btn.getAttribute('data-tab')==='commits'&&!window._commitsInit){window._commitsInit=true;renderCommitPage();}
    if(btn.getAttribute('data-tab')==='files'&&!window._treeInit){window._treeInit=true;buildFolderTree();}
  });
});

// Sub-tabs
function showSubTab(id,btn){
  var parent=btn.parentElement.parentElement;
  parent.querySelectorAll('.stab-content').forEach(function(el){el.classList.remove('active')});
  parent.querySelectorAll('.stab').forEach(function(el){el.classList.remove('active')});
  document.getElementById(id).classList.add('active');
  btn.classList.add('active');
}

// === COMMITS ===
var commitPage_=0,commitPageSize=25,commitFilter='all',commitQuery='';
function getFilteredCommits(){
  return COMMITS.filter(function(c){
    var matchCls=commitFilter==='all'||c.classification===commitFilter;
    var matchQ=!commitQuery||c.message.toLowerCase().indexOf(commitQuery)!==-1||c.author.toLowerCase().indexOf(commitQuery)!==-1||c.sha.indexOf(commitQuery)!==-1;
    return matchCls&&matchQ;
  });
}
function renderCommitPage(){
  var filtered=getFilteredCommits();
  var start=commitPage_*commitPageSize;
  var page=filtered.slice(start,start+commitPageSize);
  var html='';
  page.forEach(function(c){
    html+='<div class="commit-row"><div class="commit-meta"><span class="commit-sha">'+c.sha+'</span><span class="cls-badge-'+c.classification.toLowerCase()+'">'+c.classification+'</span><span class="commit-fns">'+c.functionsAffected+' fn'+(c.functionsAffected!==1?'s':'')+'</span></div><div class="commit-msg">'+escH(c.message)+'</div><div class="commit-info">'+escH(c.author)+' — '+c.date+'</div></div>';
  });
  if(!html)html='<div class="dim" style="padding:1rem;text-align:center">No commits match</div>';
  document.getElementById('commit-list').innerHTML=html;
  document.getElementById('page-info').textContent=(start+1)+' \\u2013 '+Math.min(start+commitPageSize,filtered.length)+' of '+filtered.length;
  document.getElementById('prev-btn').disabled=commitPage_===0;
  document.getElementById('next-btn').disabled=start+commitPageSize>=filtered.length;
}
function commitPage(dir){commitPage_+=dir;renderCommitPage();}
function filterCls(cls,btn){
  commitFilter=cls;commitPage_=0;
  document.querySelectorAll('.commit-controls .pbtn').forEach(function(b){b.classList.remove('active')});
  btn.classList.add('active');
  renderCommitPage();
}
function filterCommits(){
  commitQuery=(document.getElementById('commit-search').value||'').toLowerCase();
  commitPage_=0;renderCommitPage();
}

// === FOLDER TREE ===
function buildFolderTree(){
  var tree=D.folderTree;
  if(!tree||!tree.length){document.getElementById('folder-tree').innerHTML='<div class="dim">No folder data</div>';return}
  var roots=tree.filter(function(f){return f.path.indexOf('/')===-1});
  var html='';
  roots.forEach(function(r){html+=renderFolder(r,tree,0);});
  document.getElementById('folder-tree').innerHTML=html;
}
function renderFolder(folder,all,depth){
  var children=(folder.children||[]).map(function(cp){return all.find(function(f){return f.path===cp})}).filter(Boolean);
  var fileList=folder.fileList||[];
  var hasContent=children.length>0||fileList.length>0;
  var sc=folder.avgScore>=0.8?'red':folder.avgScore>=0.5?'yellow':'green';
  var html='<div class="folder-row" style="padding-left:'+(depth*20+8)+'px" onclick="toggleFolder(this)">';
  html+='<span class="folder-toggle">'+(hasContent?'\\u25b6':'\\u00a0')+'</span>';
  html+='<span class="folder-name">'+(folder.path.split('/').pop()||folder.path)+'/</span>';
  html+='<span class="folder-stats">'+folder.files+' files, '+folder.functions+' fns</span>';
  html+='<span class="sc '+sc+'">'+folder.avgScore.toFixed(2)+'</span>';
  html+='</div>';
  if(hasContent){
    html+='<div class="folder-children" style="display:none">';
    children.forEach(function(c){html+=renderFolder(c,all,depth+1);});
    // Show files in this folder
    fileList.forEach(function(fp){
      var fname=fp.split('/').pop()||fp;
      html+='<div class="file-leaf" style="padding-left:'+((depth+1)*20+24)+'px">';
      html+='<span class="file-leaf-name">'+escH(fname)+'</span>';
      html+='</div>';
    });
    html+='</div>';
  }
  return html;
}
function toggleFolder(el){
  var children=el.nextElementSibling;
  if(!children||!children.classList.contains('folder-children'))return;
  var isOpen=children.style.display!=='none';
  children.style.display=isOpen?'none':'block';
  el.querySelector('.folder-toggle').innerHTML=isOpen?'\\u25bc':'\\u25b6';
}

// === FILE EVENTS (paginated) ===
var fePageSize=10;
var fePages={};
function toggleFileEvents(idx){
  var el=document.getElementById('fe-'+idx);
  var isHidden=el.style.display==='none';
  el.style.display=isHidden?'block':'none';
  if(isHidden&&!fePages[idx]){
    fePages[idx]=0;
    renderFileEvents(idx);
  }
}
function renderFileEvents(idx){
  var allEvts=(D.fileEvents[idx]||{}).events||[];
  var page=fePages[idx]||0;
  var start=page*fePageSize;
  var slice=allEvts.slice(start,start+fePageSize);
  var html='';
  slice.forEach(function(e){
    html+='<div class="fe-item"><span class="fe-sha">'+e.sha+'</span><span class="cls-badge-'+e.classification.toLowerCase()+'">'+e.classification+'</span><span class="fe-msg">'+escH(e.message)+'</span><span class="fe-meta">'+escH(e.author)+' \\u2014 '+e.date+'</span></div>';
  });
  if(!html)html='<div class="dim" style="padding:.5rem">No events</div>';
  document.getElementById('fe-list-'+idx).innerHTML=html;
  // Pagination controls
  var total=allEvts.length;
  var pagingHtml='';
  if(total>fePageSize){
    pagingHtml+='<button onclick="fePageNav('+idx+',-1)"'+(page===0?' disabled':'')+'>\\u2190 Prev</button>';
    pagingHtml+='<span>'+(start+1)+' \\u2013 '+Math.min(start+fePageSize,total)+' of '+total+'</span>';
    pagingHtml+='<button onclick="fePageNav('+idx+',1)"'+(start+fePageSize>=total?' disabled':'')+'>Next \\u2192</button>';
  } else {
    pagingHtml='<span>'+total+' event'+(total!==1?'s':'')+'</span>';
  }
  document.getElementById('fe-paging-'+idx).innerHTML=pagingHtml;
}
function fePageNav(idx,dir){
  fePages[idx]=(fePages[idx]||0)+dir;
  renderFileEvents(idx);
}

// === SEARCH ===
function doSearch(){
  var q=(document.getElementById('decision-search').value||'').toLowerCase();
  var res=document.getElementById('search-results');
  if(q.length<2){res.innerHTML='<div class="dim" style="padding:1.5rem;text-align:center">Type at least 2 characters</div>';return}
  var html='';
  var fns=FUNS.filter(function(f){return f.name.toLowerCase().indexOf(q)!==-1||f.file.toLowerCase().indexOf(q)!==-1});
  if(fns.length>0){
    html+='<div class="sr-section">Functions ('+fns.length+')</div>';
    fns.slice(0,15).forEach(function(f){
      var sc=f.score>=0.8?'red':f.score>=0.5?'yellow':'green';
      html+='<div class="commit-row"><div class="commit-msg">'+escH(f.name)+'()</div><div class="commit-info">'+escH(f.file)+' \\u2014 <span class="sc '+sc+'">score: '+f.score.toFixed(2)+'</span></div></div>';
    });
  }
  var cms=COMMITS.filter(function(c){return c.message.toLowerCase().indexOf(q)!==-1||c.sha.indexOf(q)!==-1});
  if(cms.length>0){
    html+='<div class="sr-section">Commits ('+cms.length+')</div>';
    cms.slice(0,15).forEach(function(c){
      html+='<div class="commit-row"><div class="commit-meta"><span class="commit-sha">'+c.sha+'</span><span class="cls-badge-'+c.classification.toLowerCase()+'">'+c.classification+'</span></div><div class="commit-msg">'+escH(c.message)+'</div><div class="commit-info">'+escH(c.author)+' \\u2014 '+c.date+'</div></div>';
    });
  }
  var cbs=CONTRIBUTORS.filter(function(c){return c.author.toLowerCase().indexOf(q)!==-1});
  if(cbs.length>0){
    html+='<div class="sr-section">Contributors ('+cbs.length+')</div>';
    cbs.slice(0,5).forEach(function(c){
      html+='<div class="commit-row"><div class="commit-msg">'+escH(c.author)+'</div><div class="commit-info">'+c.commits+' commits \\u2014 last active: '+(c.lastActive||'').slice(0,10)+'</div></div>';
    });
  }
  if(!html)html='<div class="dim" style="padding:1rem;text-align:center">No results for "'+escH(q)+'"</div>';
  res.innerHTML=html;
}
function escH(s){return s?s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'):''}
`;
