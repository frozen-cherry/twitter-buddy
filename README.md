# Twitter Buddy

Your personal Twitter/X assistant that automatically scrolls your timeline, collects tweets, analyzes trends with AI, and discovers accounts worth following — so you don't have to.

你的私人推特助手 — 自动帮你刷推特、采集推文、AI 分析趋势、发现值得关注的账号。

[中文说明](#中文说明)

## What It Does

- **Auto-collect tweets** — Launches Chrome, switches to your "Following" timeline (sorted by latest), scrolls and saves every tweet with deduplication
- **AI analysis** — Periodically sends collected tweets to your configured LLM provider for trend analysis, key highlights, and sentiment summary
- **Account discovery** — Scrolls the "For You" tab and uses your configured LLM provider to find high-quality accounts worth following
- **Dashboard** — Web UI to view analysis reports, discover reports, tweet volume charts, and trigger manual runs

## Requirements

- Node.js 18+
- Google Chrome installed
- At least one LLM provider configured:
  - [Anthropic API key](https://console.anthropic.com/)
  - [OpenAI API key](https://platform.openai.com/)
  - [Google AI Studio API key](https://aistudio.google.com/)
  - OpenAI-compatible endpoint
  - Local OpenAI-compatible service (for example Ollama)

## Setup

```bash
git clone https://github.com/YOUR_USERNAME/twitter-buddy.git
cd twitter-buddy
npm install
npx playwright install-deps
```

Create a `.env` file:

```
ANTHROPIC_API_KEY=sk-ant-xxxxx
# or OPENAI_API_KEY=...
# or GOOGLE_API_KEY=...
# or OPENAI_COMPATIBLE_BASE_URL=https://your-gateway.example/v1
# or LOCAL_LLM_BASE_URL=http://127.0.0.1:11434/v1
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
| `npm run dashboard` | Start dashboard only |
| `npm run login` | Log in to Twitter |

### Dashboard

Open `http://localhost:3456` after starting the daemon or dashboard.

- **Analysis Reports** — AI-generated trend reports with next auto-run countdown
- **Discovery Reports** — Account recommendations with provider/model selector and "Run Now" button
- **Settings** — Edit provider keys, base URLs, default models, test connections, and refresh model lists into `.env`
- **Stats** — Tweet volume charts by hour/day
- **Tweet Data Files** — Raw collected data

### Settings Workflow

1. Open `Settings`
2. Fill in API key / base URL for the providers you want to use
3. Click `Test` to verify connectivity
4. Click `Refresh Models` to fetch the latest available models for that provider
5. Set `Default Provider`, `Analysis Provider`, `Analysis Model`, `Discovery Provider`, `Discovery Model`
6. Click `Save Settings`

The settings page writes back to `.env` and refreshes the in-memory config immediately.

## Configuration

Edit `config.js` to customize:

- `scroll.*` — Scroll speed, burst size, delays (for anti-detection)
- `daemon.intervalMin/Max` — Collection frequency (default: 5-60 min random)
- `daemon.analysisIntervalMs` — Analysis frequency (default: 2 hours)
- `discover.intervalMs` — Discovery frequency (default: 6 hours)
- `discover.maxScrolls` — How far to scroll "For You" (default: 100)
- `analysis.provider` / `discover.provider` — Which provider to use
- `analysis.model` / `discover.model` — Which model to use
- `llm.providers.*` — Provider catalog, default model list, OpenAI-compatible/local endpoint settings
- `analysis.prompt` / `discover.prompt` — Custom AI prompts

### Supported Providers

- `anthropic` — Claude models via `@anthropic-ai/sdk`
- `anthropicCompatible` — Anthropic-compatible endpoint, useful for providers that expose Claude-compatible APIs
- `openai` — GPT models via `openai`
- `gemini` — Gemini models via `@google/genai`
- `deepseek` — DeepSeek official OpenAI-compatible API
- `qwen` — Qwen / DashScope compatible API
- `minimax` — MiniMax compatible API
- `zhipu` — Zhipu / GLM compatible API
- `kimi` — Kimi / Moonshot compatible API
- `doubao` — Doubao / Ark compatible API
- `openaiCompatible` — Any OpenAI-compatible remote endpoint, configured with `OPENAI_COMPATIBLE_BASE_URL`
- `local` — Local OpenAI-compatible service, defaulting to `http://127.0.0.1:11434/v1`

### Provider Notes

- `anthropic` and `anthropicCompatible` use the Anthropic Messages API shape
- `openai`, `deepseek`, `qwen`, `minimax`, `zhipu`, `kimi`, `doubao`, `openaiCompatible`, and `local` use OpenAI-compatible chat completions
- `gemini` uses Google Gen AI's native SDK and model listing API
- If a provider supports both native and compatible APIs, this project prefers the officially documented, most stable Node integration path

### Model Refresh

- `OpenAI` — refreshes from the official Models API
- `Anthropic` / `Anthropic Compatible` — refreshes from `GET /v1/models`
- `Gemini` — refreshes from Google's official model listing API
- OpenAI-compatible providers — refreshes from the standard `/models` endpoint when available
- Refreshed model IDs are written back to `.env`, so the Dashboard and daemon can reuse them later

### Environment Variables

```bash
ANTHROPIC_API_KEY=
ANTHROPIC_MODELS=claude-opus-4-1,claude-sonnet-4-5,claude-sonnet-4-20250514
ANTHROPIC_COMPATIBLE_API_KEY=
ANTHROPIC_COMPATIBLE_BASE_URL=
ANTHROPIC_COMPATIBLE_MODELS=MiniMax-M2.5,MiniMax-M2.5-highspeed
LLM_DEFAULT_PROVIDER=
ANALYSIS_PROVIDER=
ANALYSIS_MODEL=
DISCOVER_PROVIDER=
DISCOVER_MODEL=
OPENAI_API_KEY=
OPENAI_BASE_URL=
OPENAI_MODELS=gpt-5,gpt-5-mini,gpt-5-nano,gpt-4.1
GOOGLE_API_KEY=
GEMINI_MODELS=gemini-2.5-pro,gemini-2.5-flash,gemini-2.5-flash-lite
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODELS=deepseek-chat,deepseek-reasoner
DASHSCOPE_API_KEY=
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
DASHSCOPE_MODELS=qwen-plus,qwen-max,qwen-turbo
MINIMAX_API_KEY=
MINIMAX_BASE_URL=https://api.minimaxi.com/v1
MINIMAX_MODELS=MiniMax-M2.5,MiniMax-M2.5-highspeed
ZHIPU_API_KEY=
ZHIPU_BASE_URL=https://open.bigmodel.cn/api/paas/v4/
ZHIPU_MODELS=glm-4.5,glm-4.5-air,glm-4-flash
MOONSHOT_API_KEY=
MOONSHOT_BASE_URL=https://api.moonshot.cn/v1
MOONSHOT_MODELS=moonshot-v1-32k,moonshot-v1-128k,kimi-thinking-preview
ARK_API_KEY=
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_MODELS=Doubao-Seed-1.6,Doubao-1.5-pro-32k
OPENAI_COMPATIBLE_API_KEY=
OPENAI_COMPATIBLE_BASE_URL=
OPENAI_COMPATIBLE_MODELS=deepseek-chat,deepseek-reasoner
LOCAL_LLM_API_KEY=
LOCAL_LLM_BASE_URL=http://127.0.0.1:11434/v1
LOCAL_LLM_MODELS=qwen2.5:14b-instruct,llama3.1:8b-instruct
```

## Data Storage

All data is stored locally in the `data/` directory:

```
data/
├── tweets/          # tweets_YYYY-MM-DD.json (per-day, deduplicated)
├── analysis/        # analysis_YYYY-MM-DD-HH-MM.md
├── discover/        # discover_YYYY-MM-DD-HH-MM.md
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
- [Anthropic SDK](https://docs.anthropic.com/) — Claude provider
- [OpenAI SDK](https://platform.openai.com/docs/libraries) — OpenAI and OpenAI-compatible providers
- [Google Gen AI SDK](https://ai.google.dev/gemini-api/docs/quickstart?lang=node) — Gemini provider
- Vanilla Node.js HTTP server — Dashboard (zero dependencies)

## Troubleshooting

- `invalid x-api-key` — the current default provider is still pointing at a provider whose API key is invalid or empty; change it in `Settings` or `.env`
- Analysis only sees a few tweets — the daemon analyzes the recent `analysisHours` window, not all collected tweets
- Dashboard looks stale after code changes — restart `npm run dashboard` or `npm run daemon`, then hard refresh the browser
- A provider shows no models after refresh — verify API key, base URL, and whether that provider exposes a standard model listing endpoint

---

## 中文说明

你的私人推特助手 — 自动帮你刷推特、采集推文、AI 分析趋势、发现值得关注的账号。

### 功能

- **自动采集推文** — 启动 Chrome，切到 "Following" 时间线（最新排序），自动滚动采集，按天去重保存
- **AI 分析** — 定时把采集到的推文发给你配置的 LLM provider 分析，输出热点话题、重点推文、情绪倾向
- **账号发现** — 自动刷 "为你推荐" 标签页，用你配置的 LLM provider 找出值得关注的高质量账号
- **Dashboard** — 网页界面查看分析报告、发现报告、推文数量图表，支持手动触发

### 快速开始

```bash
# 安装
npm install
npx playwright install-deps

# 配置至少一个 provider
cp .env.example .env

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
| `npm run dashboard` | 只启动 Dashboard |
| `npm run login` | 登录推特 |

### 部署

- **Windows Server**（带桌面）— 直接跑，没问题
- **Linux VPS**（无屏幕）— 用 `xvfb-run node daemon.js`

### 数据安全

所有数据本地存储，不上传任何地方。`.env`（API Key）和 `.chrome-profile`（登录态）已在 `.gitignore` 中排除。

### Provider 配置

- `analysis.provider` / `discover.provider` 控制分析和账号发现分别走哪个 provider
- `analysis.model` / `discover.model` 控制默认模型
- 也可以直接在 `.env` 里用 `LLM_DEFAULT_PROVIDER`、`ANALYSIS_PROVIDER`、`DISCOVER_PROVIDER` 覆盖 daemon 默认值
- 已预置 `deepseek`、`qwen`、`minimax`、`zhipu`、`kimi`、`doubao` 等常见国内 provider
- 对支持 Anthropic API 的服务，可以直接走 `anthropicCompatible`
- Dashboard 里手动运行分析和发现时，可以动态切换 provider 和 model
- Dashboard 新增了 `Settings` 页面，可直接编辑并写回 `.env`
- `Settings` 页支持 `Test` 和 `Refresh Models`
- `OpenAI / Anthropic / Gemini` 的模型刷新走官方接口，兼容型 provider 优先尝试标准 `/models`
- `openaiCompatible` 适合 OpenRouter、DeepSeek 网关、各种代理服务
- `local` 适合 Ollama、LM Studio、vLLM 等本地 OpenAI-compatible 服务

### Settings 页面使用

1. 打开 `Settings`
2. 填入要使用的 provider 的 API key / Base URL
3. 点击 `Test` 验证连通性
4. 点击 `Refresh Models` 拉取该 provider 当前可用模型列表
5. 选择 `Default Provider`、`Analysis Provider / Model`、`Discovery Provider / Model`
6. 点击 `Save Settings`

`Settings` 页面会把配置写回 `.env`，并立即刷新当前进程内的配置。

### Provider 说明

- `anthropic` 和 `anthropicCompatible` 走 Anthropic Messages API
- `openai`、`deepseek`、`qwen`、`minimax`、`zhipu`、`kimi`、`doubao`、`openaiCompatible`、`local` 走 OpenAI-compatible Chat Completions
- `gemini` 走 Google Gen AI 原生 SDK
- 如果某家同时支持原生接口和兼容接口，本项目优先采用官方文档里最稳定、Node 生态最成熟的接法

### 模型刷新

- `OpenAI` 走官方 Models API
- `Anthropic / Anthropic Compatible` 走 `GET /v1/models`
- `Gemini` 走 Google 官方模型列表接口
- OpenAI-compatible provider 会优先尝试标准 `/models`
- 刷新得到的模型 ID 会回写到 `.env`，供 Dashboard 和 daemon 复用

### 常见问题

- `invalid x-api-key`
  当前默认 provider 仍指向一个 key 无效或为空的服务，去 `Settings` 或 `.env` 改默认 provider
- 分析只看到几条推文
  分析只读取最近 `analysisHours` 时间窗口，不是把刚采集到的全部推文都送去分析
- Dashboard 看起来没更新
  重启 `npm run dashboard` 或 `npm run daemon`，然后浏览器强制刷新
- 某个 provider 刷不出模型
  先检查 API key、Base URL 是否正确，再确认该 provider 是否真的暴露了标准模型列表接口
