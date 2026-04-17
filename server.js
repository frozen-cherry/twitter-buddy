const http = require("http");
const fs = require("fs");
const path = require("path");
const config = require("./config");
const taskQueue = require("./task-queue");
const { setLogger, clearLogger } = require("./collect-timeline");
const { getBrowser, isBrowserAlive, closeBrowser } = require("./browser");
const scheduler = require("./scheduler");

const PORT = config.dashboard?.port || 3456;

// ========== API Handlers ==========

function getStatus() {
  let state = { lastNewestTweet: null, lastCollectionTime: null, totalCollected: 0, gaps: [] };
  try {
    if (fs.existsSync(config.stateFile)) {
      state = JSON.parse(fs.readFileSync(config.stateFile, "utf-8"));
    }
  } catch {}

  let tweetFiles = 0;
  let totalTweets = 0;
  try {
    const files = fs.readdirSync(config.tweetsDir).filter(f => f.endsWith(".json"));
    tweetFiles = files.length;
    for (const f of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(config.tweetsDir, f), "utf-8"));
        totalTweets += data.length;
      } catch {}
    }
  } catch {}

  let analysisCount = 0;
  try {
    analysisCount = fs.readdirSync(config.analysisDir).filter(f => f.endsWith(".md")).length;
  } catch {}

  let discoverCount = 0;
  try {
    discoverCount = fs.readdirSync(config.discoverDir).filter(f => f.endsWith(".md")).length;
  } catch {}

  return {
    state, tweetFiles, totalTweets, analysisCount, discoverCount,
    analysisIntervalMs: config.daemon.analysisIntervalMs,
    discoverIntervalMs: config.discover.intervalMs,
  };
}

function getTweetFiles() {
  try {
    const files = fs.readdirSync(config.tweetsDir)
      .filter(f => f.endsWith(".json"))
      .sort().reverse();
    return files.map(f => {
      const filepath = path.join(config.tweetsDir, f);
      const stat = fs.statSync(filepath);
      let count = 0;
      let newest = null;
      let oldest = null;
      try {
        const data = JSON.parse(fs.readFileSync(filepath, "utf-8"));
        count = data.length;
        if (data.length > 0) {
          newest = data[0].time;
          oldest = data[data.length - 1].time;
        }
      } catch {}
      return { filename: f, size: stat.size, count, newest, oldest };
    });
  } catch {
    return [];
  }
}

function getAnalyses() {
  try {
    const files = fs.readdirSync(config.analysisDir)
      .filter(f => f.endsWith(".md"))
      .sort().reverse();
    return files.map(f => {
      const stat = fs.statSync(path.join(config.analysisDir, f));
      // Parse date from filename: analysis_YYYY-MM-DD-HH-MM.md
      const match = f.match(/analysis_(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})\.md/);
      const date = match ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}` : f;
      return { filename: f, date, size: stat.size };
    });
  } catch {
    return [];
  }
}

function getAnalysisContent(filename) {
  // Sanitize filename to prevent path traversal
  const safe = path.basename(filename);
  if (!safe.endsWith(".md")) return null;
  const filepath = path.join(config.analysisDir, safe);
  if (!fs.existsSync(filepath)) return null;
  return fs.readFileSync(filepath, "utf-8");
}

function getDiscovers() {
  try {
    const files = fs.readdirSync(config.discoverDir)
      .filter(f => f.endsWith(".md"))
      .sort().reverse();
    return files.map(f => {
      const stat = fs.statSync(path.join(config.discoverDir, f));
      const match = f.match(/discover_(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})\.md/);
      const date = match ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}` : f;
      return { filename: f, date, size: stat.size };
    });
  } catch {
    return [];
  }
}

function getDiscoverContent(filename) {
  const safe = path.basename(filename);
  if (!safe.endsWith(".md")) return null;
  const filepath = path.join(config.discoverDir, safe);
  if (!fs.existsSync(filepath)) return null;
  return fs.readFileSync(filepath, "utf-8");
}

function getUserScores() {
  try {
    if (fs.existsSync(config.userScoresFile)) {
      return JSON.parse(fs.readFileSync(config.userScoresFile, "utf-8"));
    }
  } catch {}
  return {};
}

function getTweetStats() {
  const byHour = {};  // "YYYY-MM-DD HH" => count
  const byDay = {};   // "YYYY-MM-DD" => count

  try {
    const files = fs.readdirSync(config.tweetsDir).filter(f => f.endsWith(".json"));
    for (const f of files) {
      try {
        const tweets = JSON.parse(fs.readFileSync(path.join(config.tweetsDir, f), "utf-8"));
        for (const t of tweets) {
          if (!t.time) continue;
          // 转 UTC+8
          const d = new Date(new Date(t.time).getTime() + 8 * 3600000);
          const iso = d.toISOString();
          const day = iso.slice(0, 10);
          const hour = iso.slice(0, 13).replace("T", " ");

          byDay[day] = (byDay[day] || 0) + 1;
          byHour[hour] = (byHour[hour] || 0) + 1;
        }
      } catch {}
    }
  } catch {}

  // 排序
  const sortedDays = Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0]));
  const sortedHours = Object.entries(byHour).sort((a, b) => a[0].localeCompare(b[0]));

  return {
    byDay: sortedDays.map(([label, count]) => ({ label, count })),
    byHour: sortedHours.map(([label, count]) => ({ label, count })),
  };
}

// ========== HTML Dashboard ==========

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Twitter Timeline Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f1419; color: #e7e9ea; }
  .top-bar { background: #16202a; padding: 10px 24px; border-bottom: 1px solid #2f3336; display: flex; align-items: center; gap: 20px; transition: margin-top 0.3s, opacity 0.3s; }
  .top-bar.collapsed { margin-top: -52px; opacity: 0; pointer-events: none; }
  .top-bar h1 { font-size: 17px; font-weight: 700; white-space: nowrap; }
  .stat-inline { display: flex; gap: 16px; flex: 1; align-items: center; }
  .stat-chip { display: flex; align-items: center; gap: 5px; font-size: 13px; }
  .stat-chip .val { color: #1d9bf0; font-weight: 700; }
  .stat-chip .lbl { color: #71767b; }
  .top-actions { display: flex; gap: 8px; align-items: center; }
  .btn { background: #1d9bf0; color: #fff; border: none; padding: 5px 14px; border-radius: 16px; cursor: pointer; font-size: 13px; }
  .btn:hover { background: #1a8cd8; }
  .btn:disabled { background: #2f3336; color: #71767b; cursor: not-allowed; }

  .toolbar { display: flex; gap: 0; padding: 0 20px; background: #16202a; border-bottom: 1px solid #2f3336; align-items: center; }
  .view-tabs { display: flex; gap: 0; flex: 1; }
  .view-tab { padding: 10px 20px; font-size: 14px; cursor: pointer; border-bottom: 2px solid transparent; color: #71767b; transition: all 0.15s; }
  .view-tab:hover { color: #e7e9ea; }
  .view-tab.active { color: #1d9bf0; border-bottom-color: #1d9bf0; }

  .analyze-bar { display: flex; align-items: center; gap: 8px; padding: 8px 0; }
  .analyze-bar .label { color: #71767b; font-size: 13px; }
  .analyze-btn { background: #16202a; border: 1px solid #2f3336; color: #e7e9ea; padding: 5px 12px; border-radius: 16px; cursor: pointer; font-size: 13px; transition: all 0.15s; }
  .analyze-btn:hover { border-color: #1d9bf0; color: #1d9bf0; }
  .analyze-btn.running { border-color: #f4900c; color: #f4900c; cursor: wait; }
  .custom-hours { width: 50px; background: #16202a; border: 1px solid #2f3336; color: #e7e9ea; padding: 5px 8px; border-radius: 8px; font-size: 13px; text-align: center; }
  .custom-hours:focus { outline: none; border-color: #1d9bf0; }
  .model-select { background: #16202a; border: 1px solid #2f3336; color: #e7e9ea; padding: 5px 8px; border-radius: 8px; font-size: 13px; cursor: pointer; }
  .model-select:focus { outline: none; border-color: #1d9bf0; }

  .main { display: grid; grid-template-columns: 280px 1fr; gap: 0; min-height: calc(100vh - 90px); }
  .main.expanded .panel-list { display: none; }
  .main.expanded { grid-template-columns: 1fr; }
  @media (max-width: 900px) { .main { grid-template-columns: 1fr; } }

  .panel-list { border-right: 1px solid #2f3336; overflow-y: auto; max-height: calc(100vh - 90px); }
  .panel-content { overflow-y: auto; max-height: calc(100vh - 90px); }
  .panel-title { padding: 16px 20px; font-size: 16px; font-weight: 700; border-bottom: 1px solid #2f3336; background: #16202a; position: sticky; top: 0; z-index: 1; }

  .file-item { padding: 12px 20px; border-bottom: 1px solid #2f3336; cursor: pointer; transition: background 0.15s; }
  .file-item:hover { background: #1c2732; }
  .file-item.active { background: #1c2732; border-left: 3px solid #1d9bf0; }
  .file-item .name { font-size: 14px; font-weight: 600; }
  .file-item .meta { color: #71767b; font-size: 12px; margin-top: 4px; }

  .content-header { display: flex; align-items: center; padding: 10px 30px; border-bottom: 1px solid #2f3336; background: #16202a; position: sticky; top: 0; z-index: 1; gap: 10px; }
  .content-header .title { flex: 1; font-size: 14px; color: #71767b; }
  .expand-btn { background: none; border: 1px solid #2f3336; color: #71767b; padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 12px; }
  .expand-btn:hover { border-color: #1d9bf0; color: #1d9bf0; }

  .content-area { padding: 24px 36px; overflow-y: auto; }
  .content-area .placeholder { color: #71767b; text-align: center; margin-top: 80px; font-size: 15px; }

  .md-content { line-height: 1.8; font-size: 15px; max-width: 900px; }
  .md-content h1 { font-size: 22px; margin: 24px 0 12px; padding-bottom: 8px; border-bottom: 1px solid #2f3336; }
  .md-content h2 { font-size: 18px; margin: 20px 0 10px; color: #1d9bf0; }
  .md-content h3 { font-size: 16px; margin: 16px 0 8px; }
  .md-content p { margin: 10px 0; }
  .md-content ul, .md-content ol { margin: 8px 0 8px 20px; }
  .md-content li { margin: 6px 0; }
  .md-content a { color: #1d9bf0; text-decoration: none; }
  .md-content a:hover { text-decoration: underline; }
  .md-content strong { color: #fff; }
  .md-content hr { border: none; border-top: 1px solid #2f3336; margin: 20px 0; }
  .md-content code { background: #2f3336; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
  .md-content pre { background: #1c2732; padding: 12px; border-radius: 8px; overflow-x: auto; margin: 8px 0; }
  .md-content pre code { background: none; padding: 0; }
  .md-content blockquote { border-left: 3px solid #1d9bf0; padding-left: 12px; color: #71767b; margin: 8px 0; }

  .toast { position: fixed; bottom: 30px; right: 30px; background: #16202a; border: 1px solid #2f3336; color: #e7e9ea; padding: 12px 20px; border-radius: 12px; font-size: 14px; z-index: 100; display: none; box-shadow: 0 4px 12px rgba(0,0,0,0.4); }
  .toast.show { display: block; }
  .toast.error { border-color: #f4212e; }
  .toast.success { border-color: #00ba7c; }
</style>
</head>
<body>
  <div class="top-bar" id="top-bar">
    <h1>Timeline</h1>
    <div class="stat-inline" id="stats"></div>
    <div id="browser-status" style="display:flex;align-items:center;gap:6px;font-size:13px"></div>
    <div id="scheduler-status" style="display:flex;align-items:center;gap:12px;font-size:13px"></div>
    <div class="top-actions">
      <button class="btn" onclick="loadAll()">Refresh</button>
    </div>
  </div>

  <div class="toolbar">
    <div class="view-tabs">
      <div class="view-tab active" onclick="switchView('tasks')">Tasks</div>
      <div class="view-tab" onclick="switchView('analyses')">Analysis Reports</div>
      <div class="view-tab" onclick="switchView('discovers')">Discover</div>
      <div class="view-tab" onclick="switchView('profiles')">Profiles</div>
      <div class="view-tab" onclick="switchView('stats')">Stats</div>
      <div class="view-tab" onclick="switchView('tweets')">Tweet Data Files</div>
    </div>
    <div class="analyze-bar">
      <button class="analyze-btn" onclick="runCollectNow()" title="Run one collection cycle now">Collect Now</button>
      <span style="margin:0 6px;color:#333640">|</span>
      <span class="label">Analyze:</span>
      <button class="analyze-btn" onclick="runAnalyze(1)">1h</button>
      <button class="analyze-btn" onclick="runAnalyze(2)">2h</button>
      <button class="analyze-btn" onclick="runAnalyze(8)">8h</button>
      <input class="custom-hours" id="custom-hours" type="number" min="1" max="720" placeholder="h" title="Custom hours">
      <button class="analyze-btn" onclick="runAnalyze(null)">Go</button>
      <span class="label" style="margin-left:12px">Model:</span>
      <select class="model-select" id="model-select">
        <option value="claude-opus-4-7">Opus 4.7</option>
        <option value="claude-opus-4-6">Opus 4.6</option>
        <option value="claude-sonnet-4-6">Sonnet 4.6</option>
        <option value="claude-sonnet-4-20250514">Sonnet 4</option>
        <option value="claude-haiku-4-5-20251001">Haiku 4.5</option>
      </select>
    </div>
  </div>

  <div class="main" id="main-layout">
    <div class="panel-list" id="file-list"></div>
    <div class="panel-content">
      <div class="content-header" id="content-header" style="display:none">
        <div class="title" id="content-title"></div>
        <button class="expand-btn" onclick="toggleExpand()" id="expand-btn">Expand</button>
      </div>
      <div class="content-area" id="content-area">
        <div class="placeholder">Select a report to view</div>
      </div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

<script>
  let currentView = 'tasks';
  let isExpanded = false;

  function showToast(msg, type) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast show ' + (type || '');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.className = 'toast', 5000);
  }

  function toggleExpand() {
    isExpanded = !isExpanded;
    document.getElementById('main-layout').classList.toggle('expanded', isExpanded);
    document.getElementById('expand-btn').textContent = isExpanded ? 'Collapse' : 'Expand';
  }

  const viewOrder = ['tasks', 'analyses', 'discovers', 'profiles', 'stats', 'tweets'];
  function switchView(view) {
    currentView = view;
    document.querySelectorAll('.view-tab').forEach((tab, i) => {
      tab.classList.toggle('active', viewOrder[i] === view);
    });
    const fullWidth = view === 'stats' || view === 'tasks';
    document.getElementById('file-list').style.display = fullWidth ? 'none' : '';
    document.getElementById('main-layout').style.gridTemplateColumns = fullWidth ? '1fr' : '280px 1fr';
    document.getElementById('content-header').style.display = 'none';
    if (view === 'tasks') loadTasks();
    else if (view === 'analyses') { loadAnalyses(); document.getElementById('content-area').innerHTML = '<div class="placeholder">Select an item to view</div>'; }
    else if (view === 'discovers') { loadDiscovers(); document.getElementById('content-area').innerHTML = '<div class="placeholder">Select an item to view</div>'; }
    else if (view === 'profiles') { loadProfiles(); document.getElementById('content-area').innerHTML = '<div class="placeholder">Select a profile or scrape a new one</div>'; }
    else if (view === 'stats') loadStats();
    else { loadTweetFiles(); document.getElementById('content-area').innerHTML = '<div class="placeholder">Select an item to view</div>'; }
  }

  async function loadAll() {
    await loadStatus();
    loadBrowserStatus();
    loadSchedulerStatus();
    if (currentView === 'tasks') loadTasks();
    else if (currentView === 'analyses') loadAnalyses();
    else if (currentView === 'discovers') loadDiscovers();
    else if (currentView === 'profiles') loadProfiles();
    else if (currentView === 'stats') loadStats();
    else loadTweetFiles();
  }

  function toUTC8(iso) {
    if (!iso) return 'N/A';
    const d = new Date(new Date(iso).getTime() + 8 * 3600000);
    return d.toISOString().slice(0, 19).replace('T', ' ');
  }

  let _statusData = null;
  async function loadStatus() {
    const res = await fetch('/api/status');
    _statusData = await res.json();
    const s = _statusData.state;
    const lastCol = s.lastCollectionTime ? toUTC8(s.lastCollectionTime) : 'N/A';
    document.getElementById('stats').innerHTML = \`
      <div class="stat-chip"><span class="val">\${_statusData.totalTweets}</span><span class="lbl">tweets</span></div>
      <div class="stat-chip"><span class="val">\${_statusData.tweetFiles}</span><span class="lbl">files</span></div>
      <div class="stat-chip"><span class="val">\${_statusData.analysisCount}</span><span class="lbl">reports</span></div>
      <div class="stat-chip"><span class="val">\${_statusData.discoverCount}</span><span class="lbl">discovers</span></div>
      <div class="stat-chip"><span class="lbl">last:</span><span class="val" style="font-weight:400">\${lastCol}</span></div>
      \${s.gaps && s.gaps.length > 0 ? '<div class="stat-chip"><span style="color:#f4212e">' + s.gaps.length + ' gaps</span></div>' : ''}
    \`;
  }

  function calcNextRun(lastTime, intervalMs) {
    if (!lastTime) return 'soon';
    const next = new Date(new Date(lastTime).getTime() + intervalMs);
    const now = new Date();
    if (next <= now) return 'soon';
    const diff = next - now;
    const mins = Math.round(diff / 60000);
    if (mins < 60) return mins + ' min';
    const hrs = Math.floor(mins / 60);
    const m = mins % 60;
    return hrs + 'h ' + m + 'm';
  }

  async function loadAnalyses() {
    const res = await fetch('/api/analyses');
    const files = await res.json();
    const list = document.getElementById('file-list');
    const nextAnalysis = _statusData ? calcNextRun(_statusData.state.lastAnalysisTime, _statusData.analysisIntervalMs) : '...';
    const scheduleInfo = '<div style="font-size:11px;color:#71767b;font-weight:400;margin-top:4px">Next auto-analysis: <span style="color:#1d9bf0">' + nextAnalysis + '</span></div>';
    if (files.length === 0) {
      list.innerHTML = '<div class="panel-title">Analysis Reports' + scheduleInfo + '</div><div class="file-item"><div class="meta">No reports yet</div></div>';
      return;
    }
    list.innerHTML = '<div class="panel-title">Analysis Reports (' + files.length + ')' + scheduleInfo + '</div>' +
      files.map(f => \`
        <div class="file-item" onclick="loadAnalysis('\${f.filename}', this)">
          <div class="name">\${f.date}</div>
          <div class="meta">\${f.filename} | \${(f.size / 1024).toFixed(1)} KB</div>
        </div>
      \`).join('');
  }

  async function loadAnalysis(filename, el) {
    document.querySelectorAll('.file-item').forEach(e => e.classList.remove('active'));
    if (el) el.classList.add('active');
    const res = await fetch('/api/analysis/' + encodeURIComponent(filename));
    const md = await res.text();
    const html = marked.parse(md);
    document.getElementById('content-header').style.display = 'flex';
    document.getElementById('content-title').textContent = filename;
    document.getElementById('content-area').innerHTML = '<div class="md-content">' + html + '</div>';
    document.querySelectorAll('.md-content a').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
  }

  async function loadDiscovers() {
    const res = await fetch('/api/discovers');
    const files = await res.json();
    const list = document.getElementById('file-list');
    const nextDiscover = _statusData ? calcNextRun(_statusData.state.lastDiscoverTime, _statusData.discoverIntervalMs) : '...';
    const titleHtml = '<div class="panel-title" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
      '<span style="flex:1">Discover (' + files.length + ')</span>' +
      '<button class="analyze-btn" id="discover-run-btn" onclick="runDiscoverNow()" style="font-size:12px;padding:3px 10px">Run Now</button>' +
      '<button class="analyze-btn" onclick="showUserScores()" style="font-size:12px;padding:3px 10px">📊 Scores</button>' +
      '<div style="font-size:11px;color:#71767b;font-weight:400;width:100%">Next auto-discover: <span style="color:#1d9bf0">' + nextDiscover + '</span></div>' +
      '</div>';
    if (files.length === 0) {
      list.innerHTML = titleHtml + '<div class="file-item"><div class="meta">No reports yet</div></div>';
      return;
    }
    list.innerHTML = titleHtml +
      files.map(f => \`
        <div class="file-item" onclick="loadDiscover('\${f.filename}', this)">
          <div class="name">\${f.date}</div>
          <div class="meta">\${f.filename} | \${(f.size / 1024).toFixed(1)} KB</div>
        </div>
      \`).join('');
  }

  async function loadDiscover(filename, el) {
    document.querySelectorAll('.file-item').forEach(e => e.classList.remove('active'));
    if (el) el.classList.add('active');
    const res = await fetch('/api/discover/' + encodeURIComponent(filename));
    const md = await res.text();
    const html = marked.parse(md);
    document.getElementById('content-header').style.display = 'flex';
    document.getElementById('content-title').textContent = filename;
    document.getElementById('content-area').innerHTML = '<div class="md-content">' + html + '</div>';
    document.querySelectorAll('.md-content a').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
  }

  async function runDiscoverNow() {
    try {
      const res = await fetch('/api/discover', { method: 'POST' });
      const data = await res.json();
      if (data.error) {
        showToast('Discover failed: ' + data.error, 'error');
      } else {
        const msg = data.status === 'queued' ? 'Discovery queued (browser busy).' : 'Discovery started.';
        showToast(msg + ' Check Tasks tab.', 'success');
        switchView('tasks');
      }
    } catch (err) {
      showToast('Request failed: ' + err.message, 'error');
    }
  }

  async function showUserScores() {
    const res = await fetch('/api/user-scores');
    const scores = await res.json();
    const entries = Object.entries(scores).sort((a, b) => b[1].score - a[1].score);
    const area = document.getElementById('content-area');
    document.getElementById('content-header').style.display = 'flex';
    document.getElementById('content-title').textContent = 'User Scores (' + entries.length + ' tracked)';
    if (entries.length === 0) {
      area.innerHTML = '<div class="placeholder">No user scores yet. Run a discover first.</div>';
      return;
    }
    const rows = entries.map(([user, d]) => {
      const scoreColor = d.score > 0 ? '#00ba7c' : d.score < 0 ? '#f4212e' : '#71767b';
      const lastReason = d.history && d.history.length > 0 ? d.history[d.history.length - 1].reason : '';
      const lastDelta = d.history && d.history.length > 0 ? d.history[d.history.length - 1].delta : 0;
      const deltaStr = lastDelta > 0 ? '+' + lastDelta : lastDelta;
      const xUrl = 'https://x.com/' + user.replace('@', '');
      return '<tr>' +
        '<td style="padding:8px 12px"><a href="' + xUrl + '" target="_blank" style="color:#1d9bf0;text-decoration:none">' + user + '</a></td>' +
        '<td style="padding:8px 12px;color:' + scoreColor + ';font-weight:700;font-size:16px;text-align:center">' + d.score + '</td>' +
        '<td style="padding:8px 12px;text-align:center;color:#71767b">' + d.appearances + '</td>' +
        '<td style="padding:8px 12px;color:#71767b;font-size:13px">' + deltaStr + ' · ' + lastReason + '</td>' +
        '<td style="padding:8px 12px;color:#71767b;font-size:12px">' + toUTC8(d.lastSeen).slice(5, 16) + '</td>' +
        '</tr>';
    }).join('');
    area.innerHTML = '<div style="padding:24px 36px;max-width:1100px">' +
      '<h2 style="font-size:18px;margin-bottom:16px;color:#e7e9ea">📊 User Score Leaderboard</h2>' +
      '<p style="color:#71767b;font-size:13px;margin-bottom:16px">Scores accumulate across discover runs. High-scoring users have consistently produced quality content.</p>' +
      '<table style="width:100%;border-collapse:collapse;background:#16202a;border-radius:12px;overflow:hidden">' +
      '<thead><tr style="background:#1c2732;border-bottom:1px solid #2f3336">' +
      '<th style="padding:10px 12px;text-align:left;color:#71767b;font-size:13px;font-weight:600">User</th>' +
      '<th style="padding:10px 12px;text-align:center;color:#71767b;font-size:13px;font-weight:600">Score</th>' +
      '<th style="padding:10px 12px;text-align:center;color:#71767b;font-size:13px;font-weight:600">Appearances</th>' +
      '<th style="padding:10px 12px;text-align:left;color:#71767b;font-size:13px;font-weight:600">Latest</th>' +
      '<th style="padding:10px 12px;text-align:left;color:#71767b;font-size:13px;font-weight:600">Last Seen</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  let statsChart = null;
  async function loadStats(mode) {
    const area = document.getElementById('content-area');
    area.innerHTML = '<div style="padding:20px;color:#71767b">Loading stats...</div>';
    const res = await fetch('/api/tweet-stats');
    const data = await res.json();
    const curMode = mode || 'byDay';

    const btnStyle = (m) => 'background:' + (curMode === m ? '#1d9bf0' : '#16202a') + ';color:' + (curMode === m ? '#fff' : '#e7e9ea') + ';border:1px solid ' + (curMode === m ? '#1d9bf0' : '#2f3336') + ';padding:5px 14px;border-radius:16px;cursor:pointer;font-size:13px;';

    const items = data[curMode];
    const labels = items.map(i => curMode === 'byDay' ? i.label.slice(5) : i.label.slice(5).replace(' ', ' ') + ':00');
    const counts = items.map(i => i.count);
    const total = counts.reduce((a, b) => a + b, 0);
    const avg = counts.length > 0 ? (total / counts.length).toFixed(1) : 0;
    const max = Math.max(...counts, 0);
    const maxLabel = counts.length > 0 ? items[counts.indexOf(max)].label : 'N/A';

    area.innerHTML = \`
      <div style="padding:24px 36px;max-width:1200px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
          <h2 style="font-size:18px;flex:1;margin:0">Tweet Volume</h2>
          <button onclick="loadStats('byHour')" style="\${btnStyle('byHour')}">By Hour</button>
          <button onclick="loadStats('byDay')" style="\${btnStyle('byDay')}">By Day</button>
        </div>
        <div style="display:flex;gap:24px;margin-bottom:20px">
          <div style="background:#16202a;border:1px solid #2f3336;border-radius:12px;padding:12px 20px;flex:1">
            <div style="color:#71767b;font-size:12px">Total</div>
            <div style="color:#1d9bf0;font-size:22px;font-weight:700">\${total}</div>
          </div>
          <div style="background:#16202a;border:1px solid #2f3336;border-radius:12px;padding:12px 20px;flex:1">
            <div style="color:#71767b;font-size:12px">Avg / \${curMode === 'byDay' ? 'day' : 'hour'}</div>
            <div style="color:#1d9bf0;font-size:22px;font-weight:700">\${avg}</div>
          </div>
          <div style="background:#16202a;border:1px solid #2f3336;border-radius:12px;padding:12px 20px;flex:1">
            <div style="color:#71767b;font-size:12px">Peak</div>
            <div style="color:#1d9bf0;font-size:22px;font-weight:700">\${max}</div>
            <div style="color:#71767b;font-size:11px">\${maxLabel}</div>
          </div>
        </div>
        <div style="background:#16202a;border:1px solid #2f3336;border-radius:12px;padding:20px;position:relative;height:400px">
          <canvas id="statsChart"></canvas>
        </div>
      </div>
    \`;

    const ctx = document.getElementById('statsChart').getContext('2d');
    if (statsChart) statsChart.destroy();
    statsChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Tweets',
          data: counts,
          backgroundColor: 'rgba(29, 155, 240, 0.6)',
          borderColor: 'rgba(29, 155, 240, 1)',
          borderWidth: 1,
          borderRadius: 3,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#16202a',
            borderColor: '#2f3336',
            borderWidth: 1,
            titleColor: '#e7e9ea',
            bodyColor: '#1d9bf0',
            padding: 10,
            cornerRadius: 8,
          }
        },
        scales: {
          x: {
            ticks: { color: '#71767b', font: { size: 11 }, maxRotation: 45 },
            grid: { color: 'rgba(47,51,54,0.5)' },
          },
          y: {
            beginAtZero: true,
            ticks: { color: '#71767b' },
            grid: { color: 'rgba(47,51,54,0.5)' },
          }
        }
      }
    });
  }

  async function loadTweetFiles() {
    const res = await fetch('/api/tweets');
    const files = await res.json();
    const list = document.getElementById('file-list');
    if (files.length === 0) {
      list.innerHTML = '<div class="panel-title">Tweet Data Files</div><div class="file-item"><div class="meta">No data files yet</div></div>';
      return;
    }
    list.innerHTML = '<div class="panel-title">Tweet Data Files (' + files.length + ')</div>' +
      files.map(f => \`
        <div class="file-item" onclick="showTweetSummary('\${f.filename}', this)">
          <div class="name">\${f.filename}</div>
          <div class="meta">\${f.count} tweets | \${(f.size / 1024).toFixed(1)} KB | \${f.newest ? toUTC8(f.newest) : ''} ~ \${f.oldest ? toUTC8(f.oldest) : ''}</div>
        </div>
      \`).join('');
  }

  function showTweetSummary(filename, el) {
    document.querySelectorAll('.file-item').forEach(e => e.classList.remove('active'));
    if (el) el.classList.add('active');
    document.getElementById('content-header').style.display = 'flex';
    document.getElementById('content-title').textContent = filename;
    document.getElementById('content-area').innerHTML = '<div class="md-content"><h2>' + filename + '</h2><p>File path: <code>data/tweets/' + filename + '</code></p></div>';
  }

  async function runCollectNow() {
    try {
      const res = await fetch('/api/collect', { method: 'POST' });
      const data = await res.json();
      if (data.error) {
        showToast('Collect failed: ' + data.error, 'error');
      } else {
        showToast('Collection task queued');
        if (currentView === 'tasks') loadTasks();
      }
    } catch (err) {
      showToast('Request failed', 'error');
    }
  }

  async function runAnalyze(hours) {
    if (hours === null) {
      hours = parseFloat(document.getElementById('custom-hours').value);
      if (!hours || hours <= 0) { showToast('Please enter valid hours', 'error'); return; }
    }
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hours, model: document.getElementById('model-select').value })
      });
      const data = await res.json();
      if (data.error) {
        showToast('Analysis failed: ' + data.error, 'error');
      } else {
        showToast('Analysis task started. Check Tasks tab for progress.', 'success');
        switchView('tasks');
      }
    } catch (err) {
      showToast('Request failed: ' + err.message, 'error');
    }
  }

  // ========== Profile Functions ==========
  let _selectedProfile = null;

  async function loadProfiles() {
    const res = await fetch('/api/profiles');
    const profiles = await res.json();
    const list = document.getElementById('file-list');

    const inputHtml = '<div style="padding:16px 20px;border-bottom:1px solid #2f3336;background:#16202a">' +
      '<div style="font-size:16px;font-weight:700;margin-bottom:12px">User Profiles</div>' +
      '<div style="display:flex;gap:6px;align-items:center;margin-bottom:8px">' +
        '<span style="color:#1d9bf0;font-size:14px">@</span>' +
        '<input id="profile-handle" type="text" placeholder="e.g. elonmusk" style="flex:1;background:#0f1419;border:1px solid #2f3336;color:#e7e9ea;padding:6px 10px;border-radius:8px;font-size:13px;outline:none">' +
      '</div>' +
      '<div style="display:flex;gap:6px;align-items:center">' +
        '<span style="color:#71767b;font-size:12px">Scrolls:</span>' +
        '<input id="profile-scrolls" type="number" value="50" min="5" max="500" style="width:60px;background:#0f1419;border:1px solid #2f3336;color:#e7e9ea;padding:6px 8px;border-radius:8px;font-size:13px;text-align:center;outline:none">' +
        '<button class="btn" id="profile-scrape-btn" onclick="scrapeProfileAction()" style="margin-left:auto">Scrape</button>' +
      '</div>' +
    '</div>';

    const profileItems = profiles.map(p => {
      const timeRange = p.newestTime && p.oldestTime ? toUTC8(p.oldestTime).slice(0, 10) + ' ~ ' + toUTC8(p.newestTime).slice(0, 10) : '';
      return '<div class="file-item" onclick="selectProfile(\\''+p.handle+'\\', this)">' +
        '<div class="name">@' + p.handle + '</div>' +
        '<div class="meta">' + p.totalTweets + ' tweets | ' + p.analysisCount + ' analyses' + (timeRange ? ' | ' + timeRange : '') + '</div>' +
      '</div>';
    }).join('');

    list.innerHTML = inputHtml + profileItems;
  }

  async function scrapeProfileAction() {
    const handle = document.getElementById('profile-handle').value.trim().replace(/^@/, '');
    if (!handle) { showToast('Please enter a handle', 'error'); return; }
    const maxScrolls = parseInt(document.getElementById('profile-scrolls').value) || 50;

    try {
      const res = await fetch('/api/profile/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle, maxScrolls })
      });
      const data = await res.json();
      if (data.error) {
        showToast('Scrape failed: ' + data.error, 'error');
      } else {
        const msg = data.status === 'queued' ? 'Scrape queued (browser busy).' : 'Scrape started.';
        showToast(msg + ' Check Tasks tab.', 'success');
        switchView('tasks');
      }
    } catch (err) {
      showToast('Request failed: ' + err.message, 'error');
    }
  }

  async function selectProfile(handle, el) {
    _selectedProfile = handle;
    document.querySelectorAll('.file-item').forEach(e => e.classList.remove('active'));
    if (el) el.classList.add('active');

    // Load profile analyses
    const res = await fetch('/api/profile/' + encodeURIComponent(handle) + '/analyses');
    const analyses = await res.json();

    // Get profile stats from profiles list
    const profilesRes = await fetch('/api/profiles');
    const profiles = await profilesRes.json();
    const profile = profiles.find(p => p.handle === handle);

    const statsHtml = profile
      ? '<div style="display:flex;gap:16px;margin-bottom:16px;flex-wrap:wrap">' +
          '<div style="background:#16202a;border:1px solid #2f3336;border-radius:12px;padding:10px 16px">' +
            '<div style="color:#71767b;font-size:12px">Tweets</div>' +
            '<div style="color:#1d9bf0;font-size:20px;font-weight:700">' + profile.totalTweets + '</div>' +
          '</div>' +
          '<div style="background:#16202a;border:1px solid #2f3336;border-radius:12px;padding:10px 16px">' +
            '<div style="color:#71767b;font-size:12px">Range</div>' +
            '<div style="color:#e7e9ea;font-size:13px;margin-top:4px">' + (profile.oldestTime ? toUTC8(profile.oldestTime).slice(0,10) : '?') + ' ~ ' + (profile.newestTime ? toUTC8(profile.newestTime).slice(0,10) : '?') + '</div>' +
          '</div>' +
          '<div style="background:#16202a;border:1px solid #2f3336;border-radius:12px;padding:10px 16px">' +
            '<div style="color:#71767b;font-size:12px">Analyses</div>' +
            '<div style="color:#1d9bf0;font-size:20px;font-weight:700">' + profile.analysisCount + '</div>' +
          '</div>' +
        '</div>'
      : '';

    const controlsHtml = '<div style="display:flex;gap:8px;align-items:center;margin-bottom:20px;flex-wrap:wrap">' +
      '<span style="color:#71767b;font-size:13px">Days:</span>' +
      '<input id="profile-days" type="number" value="30" min="1" max="365" style="width:60px;background:#16202a;border:1px solid #2f3336;color:#e7e9ea;padding:5px 8px;border-radius:8px;font-size:13px;text-align:center;outline:none">' +
      '<span style="color:#71767b;font-size:13px;margin-left:8px">Max tweets:</span>' +
      '<input id="profile-max-tweets" type="number" value="500" min="10" max="5000" style="width:70px;background:#16202a;border:1px solid #2f3336;color:#e7e9ea;padding:5px 8px;border-radius:8px;font-size:13px;text-align:center;outline:none">' +
      '<span style="color:#71767b;font-size:13px;margin-left:8px">Model:</span>' +
      '<select id="profile-model" class="model-select">' +
        '<option value="claude-sonnet-4-6">Sonnet 4.6</option>' +
        '<option value="claude-opus-4-7">Opus 4.7</option>' +
        '<option value="claude-opus-4-6">Opus 4.6</option>' +
        '<option value="claude-haiku-4-5-20251001">Haiku 4.5</option>' +
      '</select>' +
      '<button class="btn" id="profile-analyze-btn" onclick="analyzeProfileAction()" style="margin-left:8px">Analyze</button>' +
    '</div>';

    const analysisListHtml = analyses.length > 0
      ? '<div style="margin-bottom:16px">' +
          '<div style="color:#71767b;font-size:13px;margin-bottom:8px">Reports:</div>' +
          analyses.map(a =>
            '<div class="file-item" style="padding:8px 12px;border-radius:8px;margin-bottom:4px" onclick="loadProfileReport(\\''+handle+'\\', \\''+a.filename+'\\', this)">' +
              '<div class="name" style="font-size:13px">' + a.date + '</div>' +
              '<div class="meta">' + (a.size / 1024).toFixed(1) + ' KB</div>' +
            '</div>'
          ).join('') +
        '</div>'
      : '';

    const area = document.getElementById('content-area');
    document.getElementById('content-header').style.display = 'flex';
    document.getElementById('content-title').textContent = '@' + handle;
    area.innerHTML = '<div style="padding:24px 36px;max-width:1000px">' +
      '<h2 style="font-size:18px;margin-bottom:16px"><a href="https://x.com/' + handle + '" target="_blank" style="color:#1d9bf0;text-decoration:none">@' + handle + '</a></h2>' +
      statsHtml + controlsHtml + analysisListHtml +
      '<div id="profile-report-area"></div>' +
    '</div>';
  }

  async function analyzeProfileAction() {
    if (!_selectedProfile) return;
    const days = parseInt(document.getElementById('profile-days').value) || 30;
    const maxTweets = parseInt(document.getElementById('profile-max-tweets').value) || 500;
    const model = document.getElementById('profile-model').value;

    try {
      const res = await fetch('/api/profile/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: _selectedProfile, days, maxTweets, model })
      });
      const data = await res.json();
      if (data.error) {
        showToast('Analysis failed: ' + data.error, 'error');
      } else {
        showToast('Analysis started. Check Tasks tab.', 'success');
        switchView('tasks');
      }
    } catch (err) {
      showToast('Request failed: ' + err.message, 'error');
    }
  }

  async function loadProfileReport(handle, filename, el) {
    if (el) {
      document.querySelectorAll('#profile-report-area').forEach(e => e.innerHTML = '');
      el.classList.add('active');
    }
    const res = await fetch('/api/profile/' + encodeURIComponent(handle) + '/analysis/' + encodeURIComponent(filename));
    const md = await res.text();
    const html = marked.parse(md);
    const reportArea = document.getElementById('profile-report-area');
    if (reportArea) {
      reportArea.innerHTML = '<hr style="border:none;border-top:1px solid #2f3336;margin:16px 0"><div class="md-content">' + html + '</div>';
      reportArea.querySelectorAll('a').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
    }
  }

  // ========== Browser Status & Task Queue ==========

  let _taskPollTimer = null;

  async function loadBrowserStatus() {
    try {
      const [taskRes, browserRes] = await Promise.all([
        fetch('/api/tasks/status'),
        fetch('/api/browser-status')
      ]);
      const s = await taskRes.json();
      const b = await browserRes.json();
      const el = document.getElementById('browser-status');
      if (!el) return;

      let html = '';
      if (s.browserBusy) {
        const elapsed = s.currentStartedAt ? formatElapsed(new Date(s.currentStartedAt)) : '';
        html = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#f59e0b"></span>' +
          '<span style="color:#f59e0b">' + (s.currentLabel || s.currentOperation) + '</span>' +
          (elapsed ? '<span style="color:#71767b">(' + elapsed + ')</span>' : '') +
          (s.queuedCount > 0 ? '<span style="color:#71767b;margin-left:4px">+' + s.queuedCount + ' queued</span>' : '');
      } else if (b.alive) {
        html = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#00ba7c"></span>' +
          '<span style="color:#71767b">Browser: idle</span>' +
          '<button class="btn" style="padding:2px 8px;font-size:12px;margin-left:4px" onclick="closeBrowserAction()">Close</button>';
      } else {
        html = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#71767b"></span>' +
          '<span style="color:#71767b">Browser: offline</span>' +
          '<button class="btn" style="padding:2px 8px;font-size:12px;margin-left:4px" onclick="launchBrowserAction()">Launch</button>';
      }
      el.innerHTML = html;
    } catch {}
  }

  async function launchBrowserAction() {
    const el = document.getElementById('browser-status');
    if (el) el.innerHTML = '<span style="color:#71767b">Launching...</span>';
    try {
      await fetch('/api/browser-launch', { method: 'POST' });
    } catch {}
    setTimeout(loadBrowserStatus, 1000);
  }

  async function closeBrowserAction() {
    try {
      await fetch('/api/browser-close', { method: 'POST' });
    } catch {}
    setTimeout(loadBrowserStatus, 500);
  }

  // ========== Scheduler Toggles ==========

  async function loadSchedulerStatus() {
    try {
      const res = await fetch('/api/scheduler');
      const s = await res.json();
      const el = document.getElementById('scheduler-status');
      if (!el) return;

      function toggleHtml(label, key, enabled, nextRunAt) {
        const color = enabled ? '#00ba7c' : '#71767b';
        const text = enabled ? 'ON' : 'OFF';
        let countdown = '';
        if (enabled && nextRunAt) {
          const diff = Math.max(0, Math.floor((new Date(nextRunAt).getTime() - Date.now()) / 1000));
          const m = Math.floor(diff / 60);
          const sec = diff % 60;
          countdown = ' <span style="color:#71767b">(' + m + 'm ' + sec + 's)</span>';
        }
        return '<span style="cursor:pointer;user-select:none" onclick="toggleScheduler(&apos;' + key + '&apos;, ' + !enabled + ')">' +
          '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + color + ';margin-right:4px"></span>' +
          '<span style="color:' + color + '">' + label + ': ' + text + '</span>' + countdown + '</span>';
      }

      el.innerHTML = toggleHtml('Collect', 'collect', s.collect.enabled, s.collect.nextRunAt) +
        toggleHtml('Discover', 'discover', s.discover.enabled, s.discover.nextRunAt);
    } catch {}
  }

  async function toggleScheduler(key, enabled) {
    try {
      await fetch('/api/scheduler/' + key, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
    } catch {}
    loadSchedulerStatus();
  }

  function formatElapsed(startDate) {
    const diff = Math.floor((Date.now() - startDate.getTime()) / 1000);
    if (diff < 60) return diff + 's';
    const m = Math.floor(diff / 60);
    const s = diff % 60;
    if (m < 60) return m + 'm ' + s + 's';
    const h = Math.floor(m / 60);
    return h + 'h ' + (m % 60) + 'm';
  }

  function formatDuration(start, end) {
    const diff = Math.floor((end.getTime() - start.getTime()) / 1000);
    if (diff < 60) return diff + 's';
    const m = Math.floor(diff / 60);
    const s = diff % 60;
    if (m < 60) return m + 'm ' + s + 's';
    const h = Math.floor(m / 60);
    return h + 'h ' + (m % 60) + 'm';
  }

  function statusBadge(status) {
    const colors = { running: '#f59e0b', queued: '#71767b', completed: '#00ba7c', failed: '#f4212e' };
    const c = colors[status] || '#71767b';
    return '<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:' + c + '22;color:' + c + ';border:1px solid ' + c + '44">' + status + '</span>';
  }

  function operationIcon(op) {
    const icons = { collection: '📥', discover: '🔍', 'profile-scrape': '👤', analyze: '📊', 'profile-analyze': '📝' };
    return icons[op] || '⚙️';
  }

  async function loadTasks() {
    const area = document.getElementById('content-area');
    area.innerHTML = '<div style="padding:20px;color:#71767b">Loading tasks...</div>';

    try {
      const [tasksRes, statusRes] = await Promise.all([
        fetch('/api/tasks'),
        fetch('/api/tasks/status')
      ]);
      const tasks = await tasksRes.json();
      const status = await statusRes.json();

      const running = tasks.filter(t => t.status === 'running');
      const queued = tasks.filter(t => t.status === 'queued');
      const completed = tasks.filter(t => t.status === 'completed' || t.status === 'failed');

      let html = '<div style="padding:24px 36px;max-width:1200px">';

      // Running tasks
      html += '<h2 style="font-size:18px;margin-bottom:16px">Running</h2>';
      if (running.length === 0) {
        html += '<div style="color:#71767b;margin-bottom:24px;padding:16px;background:#16202a;border:1px solid #2f3336;border-radius:12px">No tasks running</div>';
      } else {
        for (const t of running) {
          const elapsed = t.startedAt ? formatElapsed(new Date(t.startedAt)) : '';
          html += '<div style="background:#16202a;border:1px solid #2f3336;border-radius:12px;padding:16px;margin-bottom:12px">' +
            '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">' +
              '<span style="font-size:18px">' + operationIcon(t.operation) + '</span>' +
              statusBadge(t.status) +
              '<span style="color:#e7e9ea;font-weight:600">' + t.label + '</span>' +
              '<span style="color:#71767b;margin-left:auto;font-size:13px">' + elapsed + '</span>' +
            '</div>' +
            '<div id="task-logs-' + t.id + '" style="background:#0f1419;border:1px solid #2f3336;border-radius:8px;padding:10px;max-height:300px;overflow-y:auto;font-family:monospace;font-size:12px;color:#71767b;line-height:1.6">' +
              renderLogs(t.logs) +
            '</div>' +
          '</div>';
        }
      }

      // Queued tasks
      if (queued.length > 0) {
        html += '<h2 style="font-size:18px;margin-bottom:16px;margin-top:24px">Queued (' + queued.length + ')</h2>';
        for (const t of queued) {
          const waitTime = formatElapsed(new Date(t.createdAt));
          html += '<div style="background:#16202a;border:1px solid #2f3336;border-radius:12px;padding:12px 16px;margin-bottom:8px;display:flex;align-items:center;gap:10px">' +
            '<span style="font-size:16px">' + operationIcon(t.operation) + '</span>' +
            statusBadge(t.status) +
            '<span style="color:#e7e9ea">' + t.label + '</span>' +
            '<span style="color:#71767b;margin-left:auto;font-size:12px">waiting ' + waitTime + '</span>' +
          '</div>';
        }
      }

      // Completed tasks
      if (completed.length > 0) {
        html += '<h2 style="font-size:18px;margin-bottom:16px;margin-top:24px">Recent (' + completed.length + ')</h2>';
        for (const t of completed) {
          const duration = t.startedAt && t.completedAt
            ? formatDuration(new Date(t.startedAt), new Date(t.completedAt))
            : '';
          const timeStr = t.completedAt ? toUTC8(t.completedAt).slice(5, 16) : '';
          html += '<div style="background:#16202a;border:1px solid #2f3336;border-radius:12px;padding:12px 16px;margin-bottom:8px">' +
            '<div style="display:flex;align-items:center;gap:10px;cursor:pointer" onclick="toggleTaskLogs(this)">' +
              '<span style="font-size:16px">' + operationIcon(t.operation) + '</span>' +
              statusBadge(t.status) +
              '<span style="color:#e7e9ea">' + t.label + '</span>' +
              (t.error ? '<span style="color:#f4212e;font-size:12px">' + t.error + '</span>' : '') +
              '<span style="color:#71767b;margin-left:auto;font-size:12px">' + duration + ' | ' + timeStr + '</span>' +
              '<span style="color:#71767b;font-size:10px">▼</span>' +
            '</div>' +
            '<div style="display:none;margin-top:10px;background:#0f1419;border:1px solid #2f3336;border-radius:8px;padding:10px;max-height:200px;overflow-y:auto;font-family:monospace;font-size:12px;color:#71767b;line-height:1.6">' +
              renderLogs(t.logs) +
            '</div>' +
          '</div>';
        }
      }

      html += '</div>';
      area.innerHTML = html;

      // Auto-scroll running task logs to bottom
      for (const t of running) {
        const logEl = document.getElementById('task-logs-' + t.id);
        if (logEl) logEl.scrollTop = logEl.scrollHeight;
      }

      // Start polling if there are running/queued tasks
      if (running.length > 0 || queued.length > 0) {
        startTaskPoll();
      } else {
        stopTaskPoll();
      }

    } catch (err) {
      area.innerHTML = '<div style="padding:20px;color:#f4212e">Failed to load tasks: ' + err.message + '</div>';
    }
  }

  function renderLogs(logs) {
    if (!logs || logs.length === 0) return '<span style="color:#555">No logs yet...</span>';
    const recent = logs.slice(-100); // show last 100 in UI
    return recent.map(l => {
      const time = l.time ? new Date(new Date(l.time).getTime() + 8*3600000).toISOString().slice(11, 19) : '';
      const isError = l.message && l.message.startsWith('ERROR');
      return '<div' + (isError ? ' style="color:#f4212e"' : '') + '><span style="color:#555">[' + time + ']</span> ' + escapeHtml(l.message) + '</div>';
    }).join('');
  }

  function escapeHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function toggleTaskLogs(header) {
    const logsDiv = header.nextElementSibling;
    if (logsDiv) {
      logsDiv.style.display = logsDiv.style.display === 'none' ? 'block' : 'none';
    }
  }

  function startTaskPoll() {
    if (_taskPollTimer) return;
    _taskPollTimer = setInterval(() => {
      if (currentView === 'tasks') loadTasks();
      loadBrowserStatus();
      loadSchedulerStatus();
    }, 3000);
  }

  function stopTaskPoll() {
    if (_taskPollTimer) {
      clearInterval(_taskPollTimer);
      _taskPollTimer = null;
    }
  }

  // Auto-collapse top bar on report scroll
  document.querySelector('.panel-content').addEventListener('scroll', function() {
    const bar = document.getElementById('top-bar');
    if (this.scrollTop > 60) bar.classList.add('collapsed');
    else bar.classList.remove('collapsed');
  });

  // Initial load
  loadAll();
  loadSchedulerStatus();
  // Poll browser + scheduler status every 5s
  setInterval(() => { loadBrowserStatus(); loadSchedulerStatus(); }, 5000);
</script>
</body>
</html>`;

// ========== HTTP Server ==========

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(DASHBOARD_HTML);
    return;
  }

  if (url.pathname === "/api/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(getStatus()));
    return;
  }

  if (url.pathname === "/api/tweets") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(getTweetFiles()));
    return;
  }

  if (url.pathname === "/api/tweet-stats") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(getTweetStats()));
    return;
  }

  if (url.pathname === "/api/analyses") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(getAnalyses()));
    return;
  }

  if (url.pathname === "/api/analyze" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const { hours, model } = JSON.parse(body);
        const h = hours || 2;
        const { task } = taskQueue.enqueue(
          { type: "analysis", operation: "analyze", label: `Timeline analysis (${h}h)` },
          async ({ log }) => {
            log(`Starting analysis for ${h}h...`);
            const { runAnalysis } = require("./analyze");
            const result = await runAnalysis(h, model);
            if (!result) {
              log("No tweets found in this time range");
              return null;
            }
            log(`Analysis complete: ${result.tweetCount} tweets`);
            return { filename: path.basename(result.filepath), tweetCount: result.tweetCount };
          }
        );
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ taskId: task.id, status: "started" }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 手动触发一次采集
  if (url.pathname === "/api/collect" && req.method === "POST") {
    try {
      const state = scheduler.loadState();
      const { task } = taskQueue.enqueue(
        { type: "browser", operation: "collection", label: "Manual collect timeline" },
        async ({ log: taskLog }) => {
          setLogger(taskLog);
          try {
            taskLog("=== Starting manual collection ===");
            const { getBrowser } = require("./browser");
            const { navigateToTimeline, collectTweets, saveTweets } = require("./collect-timeline");
            const browser = await getBrowser();
            const page = browser.pages()[0] || (await browser.newPage());
            await navigateToTimeline(page);
            const result = await collectTweets(page, {
              stopAtTimestamp: state.lastNewestTweet,
            });
            if (result.tweets.length === 0) {
              taskLog("No tweets collected.");
              return { tweetCount: 0 };
            }
            saveTweets(result.tweets, config.tweetsDir);
            if (state.lastNewestTweet && !result.reachedTarget) {
              taskLog(`GAP DETECTED: ${state.lastNewestTweet} ~ ${result.oldestTime}`);
            }
            state.lastNewestTweet = result.newestTime;
            state.lastCollectionTime = new Date().toISOString();
            state.totalCollected += result.tweets.length;
            scheduler.saveState(state);
            taskLog(`Complete: ${result.tweets.length} new tweets (total: ${state.totalCollected})`);
            return { tweetCount: result.tweets.length };
          } finally {
            clearLogger();
          }
        }
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ taskId: task.id, status: task.status }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === "/api/discover" && req.method === "POST") {
    try {
      const { task } = taskQueue.enqueue(
        { type: "browser", operation: "discover", label: "Account discovery (manual)" },
        async ({ log }) => {
          setLogger(log);
          try {
            log("Starting account discovery...");
            const { runDiscover } = require("./discover");
            const result = await runDiscover();
            if (!result) {
              log("No tweets collected from For You");
              return null;
            }
            // 更新 state 的 lastDiscoverTime
            try {
              const stateData = JSON.parse(fs.readFileSync(config.stateFile, "utf-8"));
              stateData.lastDiscoverTime = new Date().toISOString();
              fs.writeFileSync(config.stateFile, JSON.stringify(stateData, null, 2), "utf-8");
            } catch {}
            log(`Discovery complete: ${result.tweetCount} tweets analyzed`);
            return { filename: result.filename, tweetCount: result.tweetCount };
          } finally {
            clearLogger();
          }
        }
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ taskId: task.id, status: task.status }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === "/api/discovers") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(getDiscovers()));
    return;
  }

  if (url.pathname === "/api/user-scores") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(getUserScores()));
    return;
  }

  // ========== Profile API Routes ==========

  if (url.pathname === "/api/profiles") {
    const { listProfiles } = require("./profile");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(listProfiles()));
    return;
  }

  if (url.pathname === "/api/profile/scrape" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const { handle, maxScrolls } = JSON.parse(body);
        if (!handle) throw new Error("handle is required");
        const scrolls = maxScrolls || config.profile.maxScrolls;
        const { task } = taskQueue.enqueue(
          { type: "browser", operation: "profile-scrape", label: `Scrape @${handle} (${scrolls} scrolls)` },
          async ({ log }) => {
            setLogger(log);
            try {
              log(`Starting scrape of @${handle}...`);
              const { scrapeProfile } = require("./profile");
              const result = await scrapeProfile(handle, { maxScrolls: scrolls });
              log(`Scraped ${result.tweetCount} tweets from @${handle}`);
              return result;
            } finally {
              clearLogger();
            }
          }
        );
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ taskId: task.id, status: task.status }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (url.pathname === "/api/profile/analyze" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const { handle, days, maxTweets, model } = JSON.parse(body);
        if (!handle) throw new Error("handle is required");
        const { task } = taskQueue.enqueue(
          { type: "analysis", operation: "profile-analyze", label: `Analyze @${handle}` },
          async ({ log }) => {
            log(`Starting analysis of @${handle}...`);
            const { analyzeProfile } = require("./profile");
            const result = await analyzeProfile(handle, { days, maxTweets, model });
            if (!result) {
              log("No tweets found for this user");
              return null;
            }
            log(`Analysis complete: ${result.tweetCount} tweets analyzed`);
            return { handle: result.handle, filename: result.filename, tweetCount: result.tweetCount };
          }
        );
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ taskId: task.id, status: "started" }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  const profileAnalysisMatch = url.pathname.match(/^\/api\/profile\/([^/]+)\/analysis\/(.+)$/);
  if (profileAnalysisMatch) {
    const { getProfileAnalysisContent } = require("./profile");
    const content = getProfileAnalysisContent(decodeURIComponent(profileAnalysisMatch[1]), decodeURIComponent(profileAnalysisMatch[2]));
    if (content === null) {
      res.writeHead(404);
      res.end("Not found");
    } else {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(content);
    }
    return;
  }

  const profileAnalysesMatch = url.pathname.match(/^\/api\/profile\/([^/]+)\/analyses$/);
  if (profileAnalysesMatch) {
    const { getProfileAnalyses } = require("./profile");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(getProfileAnalyses(decodeURIComponent(profileAnalysesMatch[1]))));
    return;
  }

  const discoverMatch = url.pathname.match(/^\/api\/discover\/(.+)$/);
  if (discoverMatch) {
    const content = getDiscoverContent(decodeURIComponent(discoverMatch[1]));
    if (content === null) {
      res.writeHead(404);
      res.end("Not found");
    } else {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(content);
    }
    return;
  }

  const analysisMatch = url.pathname.match(/^\/api\/analysis\/(.+)$/);
  if (analysisMatch) {
    const content = getAnalysisContent(decodeURIComponent(analysisMatch[1]));
    if (content === null) {
      res.writeHead(404);
      res.end("Not found");
    } else {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(content);
    }
    return;
  }

  // ========== Task Queue API Routes ==========

  if (url.pathname === "/api/tasks") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(taskQueue.getAll()));
    return;
  }

  if (url.pathname === "/api/tasks/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(taskQueue.getStatus()));
    return;
  }

  const taskMatch = url.pathname.match(/^\/api\/tasks\/(.+)$/);
  if (taskMatch && taskMatch[1] !== "status") {
    const task = taskQueue.getTask(decodeURIComponent(taskMatch[1]));
    if (!task) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Task not found" }));
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(task));
    }
    return;
  }

  // 浏览器状态
  if (url.pathname === "/api/browser-status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ alive: isBrowserAlive() }));
    return;
  }

  // 手动启动浏览器
  if (url.pathname === "/api/browser-launch" && req.method === "POST") {
    getBrowser().then(() => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    }).catch((err) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  // 关闭浏览器
  if (url.pathname === "/api/browser-close" && req.method === "POST") {
    closeBrowser().then(() => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    }).catch((err) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  // 调度器状态
  if (url.pathname === "/api/scheduler") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(scheduler.getSchedulerStatus()));
    return;
  }

  // 开关自动采集
  if (url.pathname === "/api/scheduler/collect" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { enabled } = JSON.parse(body);
        if (enabled) scheduler.startAutoCollect();
        else scheduler.stopAutoCollect();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(scheduler.getSchedulerStatus()));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 开关自动发现
  if (url.pathname === "/api/scheduler/discover" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { enabled } = JSON.parse(body);
        if (enabled) scheduler.startAutoDiscover();
        else scheduler.stopAutoDiscover();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(scheduler.getSchedulerStatus()));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

function startDashboard() {
  server.listen(PORT, () => {
    console.log(`Dashboard running at http://localhost:${PORT}`);
  });
}

module.exports = { startDashboard };

// CLI 模式：直接运行
if (require.main === module) {
  startDashboard();
}
