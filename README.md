# Twitter Buddy

Your personal Twitter/X assistant that automatically scrolls your timeline, collects tweets, analyzes trends with AI, and discovers accounts worth following — so you don't have to.

你的私人推特助手 — 自动帮你刷推特、采集推文、AI 分析趋势、发现值得关注的账号。

[中文说明](#中文说明)

## What It Does

- **Auto-collect tweets** — Launches Chrome, switches to your "Following" timeline (sorted by latest), scrolls and saves every tweet with deduplication
- **AI analysis** — Periodically sends collected tweets to Claude for trend analysis, key highlights, and sentiment summary
- **Account discovery** — Scrolls the "For You" tab and uses AI to find high-quality accounts worth following, with follow-status detection and persistent user scoring
- **User profile analysis** — Scrape any Twitter user's timeline and get an AI-powered deep analysis: content quality, topic expertise, prediction accuracy, risk signals, and a 1-10 score
- **Dashboard** — Web UI to view analysis reports, discover reports, user profiles, tweet volume charts, and trigger all actions manually

## Requirements

- Node.js 18+
- Google Chrome installed
- [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) installed and logged in (`claude /login`) — analysis runs through `claude -p` (no API key needed)

## Setup

```bash
git clone https://github.com/YOUR_USERNAME/twitter-buddy.git
cd twitter-buddy
npm install
npx playwright install-deps
```

Log in to Twitter (opens a Chrome window, log in manually, then close it):

```bash
npm run login
```

## Usage

### Daemon Mode (recommended)

Runs everything automatically — tweet collection, analysis every 2h, account discovery every 6h, plus a dashboard at `http://localhost:3456`:

```bash
npm run daemon
```

### Individual Commands

| Command | Description |
|---|---|
| `npm run collect` | One-time tweet collection |
| `npm run collect:5` | Quick collection (5 scrolls) |
| `npm run analyze` | Analyze recent 2h of tweets |
| `npm run analyze:4h` | Analyze recent 4h of tweets |
| `npm run discover` | Discover accounts from "For You" |
| `npm run discover:50` | Quick discovery (50 scrolls) |
| `npm run profile -- --handle <user>` | Scrape a user's tweets |
| `npm run profile -- --handle <user> --analyze` | Analyze a user's tweets |
| `npm run dashboard` | Start dashboard only (manual mode) |
| `npm run login` | Log in to Twitter |

### Dashboard

Open `http://localhost:3456` after starting the daemon or dashboard.

- **Analysis Reports** — AI-generated trend reports with next auto-run countdown
- **Discover** — Account recommendations with follow status tags, "Run Now" button
- **Profiles** — Scrape and analyze any user's timeline from the UI (enter handle, set scroll count, scrape, then analyze with configurable time range and model)
- **User Scores** — Leaderboard of discovered accounts ranked by cumulative AI scores across runs
- **Stats** — Tweet volume charts by hour/day
- **Tweet Data Files** — Raw collected data

## Configuration

Edit `config.js` to customize:

- `scroll.*` — Scroll speed, burst size, delays (for anti-detection)
- `daemon.intervalMin/Max` — Collection frequency (default: 5-60 min random)
- `daemon.analysisIntervalMs` — Analysis frequency (default: 2 hours)
- `discover.intervalMs` — Discovery frequency (default: 6 hours)
- `discover.maxScrolls` — How far to scroll "For You" (default: 100)
- `analysis.model` / `discover.model` / `profile.model` — Claude model to use
- `analysis.prompt` / `discover.prompt` / `profile.prompt` — Custom AI prompts
- `profile.maxScrolls` — Default scroll count for user profile scraping (default: 50)

## User Profile Analysis

Scrape any public Twitter user's timeline and get a detailed AI evaluation:

```bash
# Scrape tweets (default 50 scrolls)
node profile.js --handle cissan_9984 --max-scrolls 50

# Analyze with defaults (last 30 days, Sonnet 4.6)
node profile.js --handle cissan_9984 --analyze

# Analyze with options
node profile.js --handle cissan_9984 --analyze --days 60 --max-tweets 500 --model claude-opus-4-6
```

Or use the **Profiles** tab in the Dashboard — enter a handle, scrape, then analyze with adjustable parameters.

The analysis covers: content quality, topic expertise, prediction accuracy (especially for market/crypto calls), posting habits, a 1-10 overall score, and risk signals (marketing accounts, pump-and-dump, etc.).

## Account Discovery Details

The discover feature goes beyond simple recommendations:

- **Follow-status detection** — Automatically detects which accounts you already follow. Uses a two-phase approach: first hovering over avatars on the timeline to trigger profile cards (fast, no navigation), then visiting profile pages for any remaining unchecked users
- **Persistent user scoring** — Each discovered account receives a score from -5 to +5 per run based on content quality. Scores accumulate across runs, building a long-term quality signal. High-scoring accounts get prioritized in future reports
- **Score leaderboard** — Dashboard shows a ranked table of all scored users with cumulative scores, appearance count, latest evaluation, and links to their profiles
- **Smart context** — Historical scores are fed back to the AI on subsequent runs, helping it make more informed recommendations over time

## Data Storage

All data is stored locally in the `data/` directory:

```
data/
├── tweets/          # tweets_YYYY-MM-DD.json (per-day, deduplicated)
├── analysis/        # analysis_YYYY-MM-DD-HH-MM.md
├── discover/        # discover_YYYY-MM-DD-HH-MM.md
│   └── user_scores.json  # persistent user scoring data
├── profiles/        # per-user scraped data + analysis
│   └── {handle}/
│       ├── tweets_YYYY-MM-DD.json
│       └── analysis_YYYY-MM-DD-HH-MM.md
└── state.json       # daemon state (last run times, gaps, etc.)
```

## Running on a Server

**Windows Server (with desktop)** — Works out of the box. RDP in, run `npm run login`, then `npm run daemon`.

**Headless Linux VPS** — Use `xvfb` for a virtual display:

```bash
sudo apt install -y xvfb google-chrome-stable
npx playwright install-deps
xvfb-run node daemon.js
```

## Tech Stack

- [Playwright](https://playwright.dev/) — Browser automation
- [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) (`claude -p`) — AI analysis
- Vanilla Node.js HTTP server — Dashboard (zero dependencies)

---

## 中文说明

你的私人推特助手 — 自动帮你刷推特、采集推文、AI 分析趋势、发现值得关注的账号。

### 功能

- **自动采集推文** — 启动 Chrome，切到 "Following" 时间线（最新排序），自动滚动采集，按天去重保存
- **AI 分析** — 定时把采集到的推文发给 Claude 分析，输出热点话题、重点推文、情绪倾向
- **账号发现** — 自动刷 "为你推荐" 标签页，用 AI 找出值得关注的高质量账号。自动检测关注状态，跨轮次持久化评分
- **用户分析** — 抓取任意推特用户的时间线，AI 深度分析：内容质量、专业领域、预测准确性、风险提示、1-10 综合评分
- **Dashboard** — 网页界面查看分析报告、发现报告、用户分析、推文数量图表，全部操作支持手动触发

### 快速开始

```bash
# 安装
npm install
npx playwright install-deps

# 确保 Claude Code CLI 已安装并登录（分析走 claude -p，无需 API Key）
claude /login

# 登录推特（手动登录后关闭浏览器）
npm run login

# 启动守护进程（全自动）
npm run daemon
```

打开 `http://localhost:3456` 查看 Dashboard。

### 命令一览

| 命令 | 说明 |
|---|---|
| `npm run daemon` | 守护进程（采集 + 分析 + 发现 全自动） |
| `npm run collect` | 单次采集推文 |
| `npm run analyze` | 分析最近 2 小时推文 |
| `npm run discover` | 发现值得关注的账号 |
| `npm run profile -- --handle <用户>` | 抓取某用户推文 |
| `npm run profile -- --handle <用户> --analyze` | 分析某用户推文 |
| `npm run dashboard` | 只启动 Dashboard（纯手动模式） |
| `npm run login` | 登录推特 |

### 部署

- **Windows Server**（带桌面）— 直接跑，没问题
- **Linux VPS**（无屏幕）— 用 `xvfb-run node daemon.js`

### 用户分析

在 Dashboard 的 **Profiles** 标签页中输入用户名即可抓取和分析，也可以命令行操作：

```bash
node profile.js --handle cissan_9984 --max-scrolls 50    # 抓取
node profile.js --handle cissan_9984 --analyze --days 30  # 分析
```

分析内容：内容质量、专业领域、预测准确性（尤其是行情/加密判断）、发帖习惯、综合评分（1-10）、风险提示。

### 账号发现机制

- **关注状态检测** — 自动识别你已关注的账号。先通过悬停头像触发 HoverCard 快速检测，剩余的再访问主页兜底
- **持久化评分** — 每次发现运行时，AI 会对每个未关注账号打分（-5 到 +5）。分数跨轮次累积，形成长期质量信号
- **评分排行榜** — Dashboard 中可查看所有被评分用户的排名、累积分数、出现次数、最近评语
- **历史上下文** — 历史评分会反馈给 AI，帮助后续推荐更精准

### 数据安全

所有数据本地存储，不上传任何地方。`.chrome-profile`（推特登录态）已在 `.gitignore` 中排除。
