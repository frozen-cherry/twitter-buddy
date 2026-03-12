require("./env");

const path = require("path");

function envOr(value, fallback) {
  return value || fallback;
}

function buildModelList(defaultModels, envValue) {
  if (!envValue) return defaultModels;
  return envValue
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((id) => ({ id, label: id }));
}

function buildOpenAICompatibleProvider({
  label,
  apiKeyEnv,
  baseUrlEnv,
  baseUrlDefault,
  models,
  modelsEnv,
  apiKeyOptional = false,
  baseUrlRequired = false,
}) {
  return {
    label,
    apiStyle: "openai",
    apiKeyEnv,
    apiKeyOptional,
    baseUrlEnv,
    baseUrlDefault,
    baseUrlRequired,
    modelsEnv,
    models: buildModelList(models, modelsEnv ? process.env[modelsEnv] : ""),
  };
}

function buildProviderCatalog() {
  return {
    anthropic: {
      label: "Anthropic",
      apiStyle: "anthropic",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      modelsEnv: "ANTHROPIC_MODELS",
      models: buildModelList(
        [
          { id: "claude-opus-4-1", label: "Claude Opus 4.1" },
          { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
          { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
          { id: "claude-3-7-sonnet-latest", label: "Claude 3.7 Sonnet" },
          { id: "claude-3-5-haiku-latest", label: "Claude 3.5 Haiku" },
        ],
        process.env.ANTHROPIC_MODELS
      ),
    },
    anthropicCompatible: {
      label: "Anthropic Compatible",
      apiStyle: "anthropic",
      apiKeyEnv: "ANTHROPIC_COMPATIBLE_API_KEY",
      baseUrlEnv: "ANTHROPIC_COMPATIBLE_BASE_URL",
      baseUrlRequired: true,
      modelsEnv: "ANTHROPIC_COMPATIBLE_MODELS",
      models: buildModelList(
        [
          { id: "MiniMax-M2.5", label: "MiniMax M2.5" },
          { id: "MiniMax-M2.5-highspeed", label: "MiniMax M2.5 Highspeed" },
        ],
        process.env.ANTHROPIC_COMPATIBLE_MODELS
      ),
    },
    openai: buildOpenAICompatibleProvider({
      label: "OpenAI",
      apiKeyEnv: "OPENAI_API_KEY",
      baseUrlEnv: "OPENAI_BASE_URL",
      modelsEnv: "OPENAI_MODELS",
      models: [
        { id: "gpt-5", label: "GPT-5" },
        { id: "gpt-5-mini", label: "GPT-5 mini" },
        { id: "gpt-5-nano", label: "GPT-5 nano" },
        { id: "gpt-4.1", label: "GPT-4.1" },
      ],
    }),
    gemini: {
      label: "Google Gemini",
      apiStyle: "gemini",
      apiKeyEnv: "GOOGLE_API_KEY",
      modelsEnv: "GEMINI_MODELS",
      models: buildModelList(
        [
          { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
          { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
          { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite" },
          { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
        ],
        process.env.GEMINI_MODELS
      ),
    },
    deepseek: buildOpenAICompatibleProvider({
      label: "DeepSeek",
      apiKeyEnv: "DEEPSEEK_API_KEY",
      baseUrlEnv: "DEEPSEEK_BASE_URL",
      baseUrlDefault: "https://api.deepseek.com",
      modelsEnv: "DEEPSEEK_MODELS",
      models: [
        { id: "deepseek-chat", label: "DeepSeek Chat" },
        { id: "deepseek-reasoner", label: "DeepSeek Reasoner" },
      ],
    }),
    qwen: buildOpenAICompatibleProvider({
      label: "Qwen / DashScope",
      apiKeyEnv: "DASHSCOPE_API_KEY",
      baseUrlEnv: "DASHSCOPE_BASE_URL",
      baseUrlDefault: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      modelsEnv: "DASHSCOPE_MODELS",
      models: [
        { id: "qwen-plus", label: "Qwen Plus" },
        { id: "qwen-max", label: "Qwen Max" },
        { id: "qwen-turbo", label: "Qwen Turbo" },
      ],
    }),
    minimax: buildOpenAICompatibleProvider({
      label: "MiniMax",
      apiKeyEnv: "MINIMAX_API_KEY",
      baseUrlEnv: "MINIMAX_BASE_URL",
      baseUrlDefault: "https://api.minimaxi.com/v1",
      modelsEnv: "MINIMAX_MODELS",
      models: [
        { id: "MiniMax-M2.5", label: "MiniMax M2.5" },
        { id: "MiniMax-M2.5-highspeed", label: "MiniMax M2.5 Highspeed" },
        { id: "MiniMax-M2.1", label: "MiniMax M2.1" },
      ],
    }),
    zhipu: buildOpenAICompatibleProvider({
      label: "Zhipu / GLM",
      apiKeyEnv: "ZHIPU_API_KEY",
      baseUrlEnv: "ZHIPU_BASE_URL",
      baseUrlDefault: "https://open.bigmodel.cn/api/paas/v4/",
      modelsEnv: "ZHIPU_MODELS",
      models: [
        { id: "glm-4.5", label: "GLM 4.5" },
        { id: "glm-4.5-air", label: "GLM 4.5 Air" },
        { id: "glm-4-flash", label: "GLM 4 Flash" },
      ],
    }),
    kimi: buildOpenAICompatibleProvider({
      label: "Kimi / Moonshot",
      apiKeyEnv: "MOONSHOT_API_KEY",
      baseUrlEnv: "MOONSHOT_BASE_URL",
      baseUrlDefault: "https://api.moonshot.cn/v1",
      modelsEnv: "MOONSHOT_MODELS",
      models: [
        { id: "moonshot-v1-32k", label: "Moonshot V1 32K" },
        { id: "moonshot-v1-128k", label: "Moonshot V1 128K" },
        { id: "kimi-thinking-preview", label: "Kimi Thinking Preview" },
      ],
    }),
    doubao: buildOpenAICompatibleProvider({
      label: "Doubao / Ark",
      apiKeyEnv: "ARK_API_KEY",
      baseUrlEnv: "ARK_BASE_URL",
      baseUrlDefault: "https://ark.cn-beijing.volces.com/api/v3",
      modelsEnv: "ARK_MODELS",
      models: [
        { id: "Doubao-Seed-1.6", label: "Doubao Seed 1.6" },
        { id: "Doubao-1.5-pro-32k", label: "Doubao 1.5 Pro 32K" },
        { id: "Doubao-1.5-pro-256k", label: "Doubao 1.5 Pro 256K" },
      ],
    }),
    openaiCompatible: buildOpenAICompatibleProvider({
      label: "OpenAI Compatible",
      apiKeyEnv: "OPENAI_COMPATIBLE_API_KEY",
      apiKeyOptional: true,
      baseUrlEnv: "OPENAI_COMPATIBLE_BASE_URL",
      baseUrlRequired: true,
      modelsEnv: "OPENAI_COMPATIBLE_MODELS",
      models: [
        { id: "deepseek-chat", label: "DeepSeek Chat" },
        { id: "deepseek-reasoner", label: "DeepSeek Reasoner" },
        { id: "qwen/qwen3-32b", label: "Qwen3 32B" },
      ],
    }),
    local: buildOpenAICompatibleProvider({
      label: "Local",
      apiKeyEnv: "LOCAL_LLM_API_KEY",
      apiKeyOptional: true,
      baseUrlEnv: "LOCAL_LLM_BASE_URL",
      baseUrlDefault: "http://127.0.0.1:11434/v1",
      modelsEnv: "LOCAL_LLM_MODELS",
      models: [
        { id: "qwen2.5:14b-instruct", label: "Qwen2.5 14B Instruct" },
        { id: "llama3.1:8b-instruct", label: "Llama 3.1 8B Instruct" },
        { id: "deepseek-r1:8b", label: "DeepSeek R1 8B" },
      ],
    }),
  };
}

function applyEnvOverrides(target) {
  target.llm.defaultProvider = envOr(process.env.LLM_DEFAULT_PROVIDER, "anthropic");
  target.llm.providers = buildProviderCatalog();

  target.analysis.provider = envOr(process.env.ANALYSIS_PROVIDER, target.llm.defaultProvider);
  target.analysis.model = envOr(process.env.ANALYSIS_MODEL, "claude-opus-4-1");

  target.discover.provider = envOr(process.env.DISCOVER_PROVIDER, target.llm.defaultProvider);
  target.discover.model = envOr(process.env.DISCOVER_MODEL, "claude-sonnet-4-20250514");
}

const config = {
  // Chrome 配置
  chromeDataDir: path.join(__dirname, ".chrome-profile"),

  // 采集配置
  scroll: {
    burstMin: 3,
    burstMax: 10,
    burstDelayMin: 200,
    burstDelayMax: 500,
    pauseMin: 3000,
    pauseMax: 9000,
    scrollPixels: 700,
    maxScrolls: 200,
    staleLimit: 10,
  },

  // 守护进程配置
  daemon: {
    intervalMin: 5 * 60 * 1000,   // 最短间隔 5 分钟
    intervalMax: 60 * 60 * 1000,  // 最长间隔 60 分钟
    analysisIntervalMs: 2 * 60 * 60 * 1000, // 每 2 小时触发一次分析
  },

  llm: {
    defaultProvider: "anthropic",
    providers: {},
  },

  analysis: {
    provider: "anthropic",
    model: "claude-opus-4-1",
    maxTokens: 4096,
    analysisHours: 2,
    prompt: `你是一个推特时间线分析助手。以下是最近一段时间采集到的推文数据（JSON 格式）。

请用中文分析：
1. **主要话题和趋势**：当前讨论的热点是什么
2. **值得重点关注的推文**：突发新闻、alpha 信息、深度见解、重要公告。每条都要给出推文摘要和原文链接（用 Markdown 格式 [摘要](链接)），方便直接点击查看
3. **整体情绪倾向**：乐观/悲观/中性，以及原因
4. **值得跟进的讨论**：有哪些对话串或话题值得深入关注，附上相关推文链接
5. **值得关注的人物**：提到任何推特用户时，都用 Markdown 链接格式 [@用户名](https://x.com/用户名)，方便直接点击查看主页

关注重点：加密货币、AI/科技、宏观经济、地缘政治`,
  },

  discover: {
    maxScrolls: 100,
    intervalMs: 6 * 60 * 60 * 1000,
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    maxTokens: 4096,
    prompt: `你是一个推特账号发现助手。以下是从"为你推荐"(For You) 时间线采集到的推文数据（JSON 格式）。

请用中文分析并推荐值得关注的账号：

1. **值得关注的账号**：找出推文中出现的、内容质量高的账号。每个账号请给出：
   - 账号名和链接（用 Markdown 格式 [@用户名](https://x.com/用户名)）
   - 该账号发了什么内容（附推文链接）
   - 为什么值得关注（内容质量、专业领域、影响力等）
   - 推荐指数（⭐ 1-5 星）

2. **优质内容精选**：挑出最有价值的 5-10 条推文，给出摘要和原文链接（用 Markdown 格式 [摘要](链接)）

3. **新发现的话题/领域**：有没有你之前没接触过的有趣话题或圈子

4. **不推荐关注的类型**：哪些账号看起来是营销号、机器人、或者低质量内容

关注重点：加密货币、AI/科技、宏观经济、地缘政治、深度思考、原创内容`,
  },

  dashboard: { port: 3456 },

  dataDir: path.join(__dirname, "data"),
  tweetsDir: path.join(__dirname, "data", "tweets"),
  analysisDir: path.join(__dirname, "data", "analysis"),
  discoverDir: path.join(__dirname, "data", "discover"),
  stateFile: path.join(__dirname, "data", "state.json"),

  refreshFromEnv() {
    applyEnvOverrides(this);
    return this;
  },
};

config.refreshFromEnv();

module.exports = config;
