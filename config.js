const path = require("path");

module.exports = {
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

  // LLM 分析配置
  analysis: {
    model: "claude-opus-4-6",
    maxTokens: 4096,
    analysisHours: 2, // 分析最近几小时的推文
    prompt: `你是一个推特时间线分析助手。以下是最近一段时间采集到的推文数据（JSON 格式）。

请用中文分析：
1. **主要话题和趋势**：当前讨论的热点是什么
2. **值得重点关注的推文**：突发新闻、alpha 信息、深度见解、重要公告。每条都要给出推文摘要和原文链接（用 Markdown 格式 [摘要](链接)），方便直接点击查看
3. **整体情绪倾向**：乐观/悲观/中性，以及原因
4. **值得跟进的讨论**：有哪些对话串或话题值得深入关注，附上相关推文链接
5. **值得关注的人物**：提到任何推特用户时，都用 Markdown 链接格式 [@用户名](https://x.com/用户名)，方便直接点击查看主页

关注重点：加密货币、AI/科技、宏观经济、地缘政治`,
  },

  // 账号发现配置
  discover: {
    maxScrolls: 100,
    intervalMs: 6 * 60 * 60 * 1000, // daemon 中每 6 小时跑一次
    model: "claude-sonnet-4-6",
    maxTokens: 8192,
    prompt: `你是一个推特账号发现助手。以下是从"为你推荐"(For You) 时间线采集到的推文数据。

## 注意事项
- 推文数据中标注了 [已关注] 的账号是我已经关注的，不需要推荐关注，但如果它的内容特别好可以在"优质内容精选"中提及
- 如果提供了"历史评分数据"，请参考这些分数来辅助判断账号质量。高分用户更值得推荐，低分用户的内容要更谨慎评价

## 请用中文分析并推荐：

1. **值得关注的新账号**：找出推文中出现的、内容质量高的【未关注】账号。每个账号请给出：
   - 账号名和链接（用 Markdown 格式 [@用户名](https://x.com/用户名)）
   - 该账号发了什么内容（附推文链接）
   - 为什么值得关注（内容质量、专业领域、影响力等）
   - 推荐指数（⭐ 1-5 星）
   - 如果有历史评分，也注明

2. **优质内容精选**：挑出最有价值的 5-10 条推文，给出摘要和原文链接（用 Markdown 格式 [摘要](链接)）。已关注和未关注的都可以选

3. **新发现的话题/领域**：有没有你之前没接触过的有趣话题或圈子

4. **建议隐藏/不推荐**：哪些账号看起来是营销号、机器人、或者低质量内容，建议隐藏

5. **账号评分**（重要！请严格按格式输出）：
对本次出现的所有未关注账号进行评分。请在报告最后输出一个 JSON 代码块，格式如下：
\`\`\`json:scores
[
  { "user": "@用户名", "delta": 3, "reason": "高质量原创加密分析" },
  { "user": "@用户名2", "delta": -2, "reason": "营销推广，低质量" }
]
\`\`\`
评分规则：
- delta 范围：-5 到 +5
- +3~+5：深度原创、独到见解、稀缺信息
- +1~+2：内容不错，有一定价值
- 0：普通内容
- -1~-2：偏营销/搬运/低质量
- -3~-5：明显机器人/垃圾/诈骗

关注重点：加密货币、AI/科技、宏观经济、地缘政治、深度思考、原创内容`,
  },

  // 用户 Profile 分析配置
  profile: {
    maxScrolls: 50,
    model: "claude-sonnet-4-6",
    maxTokens: 8192,
    prompt: `你是一个推特用户分析助手。以下是某个推特用户最近发布的推文数据。

请用中文对该用户进行深度分析：

1. **内容质量评估**：原创性、深度、信息密度。是搬运/翻译还是原创观点？
2. **专业领域**：该用户主要关注哪些领域？在这些领域的专业程度如何？
3. **预测准确性**：如果有市场/加密货币相关的预测或判断（看涨/看跌/价格目标），分析其历史准确性。列出具体的预测及其结果（如果可以判断）
4. **发帖习惯**：发帖频率、活跃时间段、互动模式
5. **影响力指标**：转发/引用比例、是否经常被引用
6. **综合评价**：该用户值不值得长期关注？给出 1-10 分的综合评分，并说明理由
7. **风险提示**：是否有可能是营销号、带单号、或有其他需要注意的风险信号

请特别关注：加密货币交易观点、市场判断、技术分析的质量和准确性。`,
  },

  // 任务队列配置
  tasks: {
    maxCompletedTasks: 20,   // 保留最近 20 个已完成任务
    maxLogsPerTask: 500,     // 每个任务最多 500 条日志
  },

  // Dashboard 配置
  dashboard: { port: 3456 },

  // 数据目录
  dataDir: path.join(__dirname, "data"),
  tweetsDir: path.join(__dirname, "data", "tweets"),
  analysisDir: path.join(__dirname, "data", "analysis"),
  discoverDir: path.join(__dirname, "data", "discover"),
  profilesDir: path.join(__dirname, "data", "profiles"),
  userScoresFile: path.join(__dirname, "data", "discover", "user_scores.json"),
  stateFile: path.join(__dirname, "data", "state.json"),
};
