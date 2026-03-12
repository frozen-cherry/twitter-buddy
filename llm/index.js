const config = require("../config");

function getProviderCatalog() {
  return config.llm.providers;
}

function getProviderConfig(provider) {
  const providerConfig = getProviderCatalog()[provider];
  if (!providerConfig) {
    throw new Error(`Unsupported LLM provider: ${provider}`);
  }
  return providerConfig;
}

function getScopeConfig(scope) {
  const scopeConfig = config[scope];
  if (!scopeConfig) {
    throw new Error(`Unknown LLM scope: ${scope}`);
  }
  return scopeConfig;
}

function resolveScopeSettings(scope, overrides = {}) {
  const scopeConfig = getScopeConfig(scope);
  const provider = overrides.provider || scopeConfig.provider || config.llm.defaultProvider;
  const providerConfig = getProviderConfig(provider);
  const model = overrides.model || scopeConfig.model || providerConfig.models[0]?.id;
  const maxTokens = overrides.maxTokens || scopeConfig.maxTokens;

  return {
    provider,
    providerConfig,
    model,
    maxTokens,
  };
}

function readApiKey(providerConfig) {
  const apiKey = providerConfig.apiKeyEnv ? process.env[providerConfig.apiKeyEnv] : "";
  if (!apiKey && !providerConfig.apiKeyOptional) {
    throw new Error(
      `Missing API key for provider "${providerConfig.label}". Please set ${providerConfig.apiKeyEnv} in .env`
    );
  }
  return apiKey || "not-needed";
}

function readBaseURL(providerConfig) {
  const baseURL = providerConfig.baseUrlEnv ? process.env[providerConfig.baseUrlEnv] : "";
  if (!baseURL && providerConfig.baseUrlRequired) {
    throw new Error(
      `Missing base URL for provider "${providerConfig.label}". Please set ${providerConfig.baseUrlEnv} in .env`
    );
  }
  return baseURL || providerConfig.baseUrlDefault || undefined;
}

function extractAnthropicText(message) {
  if (!Array.isArray(message?.content)) return "";
  return message.content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n\n")
    .trim();
}

function extractOpenAIText(response) {
  const directText = response?.choices?.[0]?.message?.content;
  if (typeof directText === "string") return directText.trim();
  if (Array.isArray(directText)) {
    return directText
      .map((part) => {
        if (typeof part === "string") return part;
        if (part?.type === "text") return part.text || "";
        return "";
      })
      .join("\n")
      .trim();
  }
  return "";
}

function extractGeminiText(response) {
  if (typeof response?.text === "string" && response.text.trim()) return response.text.trim();

  const parts = response?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) => {
      if (typeof part?.text === "string") return part.text;
      return "";
    })
    .join("\n")
    .trim();
}

async function generateWithAnthropic({ providerConfig, model, maxTokens, prompt }) {
  const Anthropic = require("@anthropic-ai/sdk");
  const clientOptions = { apiKey: readApiKey(providerConfig) };
  const baseURL = readBaseURL(providerConfig);
  if (baseURL) clientOptions.baseURL = baseURL;
  const client = new Anthropic(clientOptions);
  const message = await client.messages.create({
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  });
  return extractAnthropicText(message);
}

async function generateWithOpenAI({ providerConfig, model, maxTokens, prompt }) {
  const OpenAI = require("openai");
  const client = new OpenAI({
    apiKey: readApiKey(providerConfig),
    baseURL: readBaseURL(providerConfig),
  });
  const completion = await client.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  });
  return extractOpenAIText(completion);
}

async function generateWithGemini({ providerConfig, model, maxTokens, prompt }) {
  const { GoogleGenAI } = require("@google/genai");
  const client = new GoogleGenAI({ apiKey: readApiKey(providerConfig) });
  const response = await client.models.generateContent({
    model,
    contents: prompt,
    config: {
      maxOutputTokens: maxTokens,
    },
  });
  return extractGeminiText(response);
}

async function generateText({ provider, model, maxTokens, prompt }) {
  const providerConfig = getProviderConfig(provider);

  if (providerConfig.apiStyle === "anthropic") {
    return generateWithAnthropic({ providerConfig, model, maxTokens, prompt });
  }
  if (providerConfig.apiStyle === "gemini") {
    return generateWithGemini({ providerConfig, model, maxTokens, prompt });
  }
  if (providerConfig.apiStyle === "openai") {
    return generateWithOpenAI({ providerConfig, model, maxTokens, prompt });
  }

  throw new Error(`Unsupported provider API style: ${providerConfig.apiStyle}`);
}

function getPublicLLMConfig() {
  const providers = Object.entries(getProviderCatalog()).map(([id, provider]) => ({
    id,
    label: provider.label,
    apiStyle: provider.apiStyle,
    apiKeyEnv: provider.apiKeyEnv,
    baseUrlEnv: provider.baseUrlEnv,
    baseUrlDefault: provider.baseUrlDefault,
    modelsEnv: provider.modelsEnv,
    configured: provider.apiKeyOptional ? true : Boolean(process.env[provider.apiKeyEnv]),
    baseUrlConfigured: provider.baseUrlEnv
      ? Boolean(process.env[provider.baseUrlEnv] || provider.baseUrlDefault)
      : true,
    models: provider.models,
  }));

  return {
    providers,
    defaultProvider: config.llm.defaultProvider,
    analysis: {
      provider: config.analysis.provider,
      model: config.analysis.model,
    },
    discover: {
      provider: config.discover.provider,
      model: config.discover.model,
    },
  };
}

module.exports = {
  generateText,
  getProviderCatalog,
  getPublicLLMConfig,
  getProviderConfig,
  resolveScopeSettings,
};
