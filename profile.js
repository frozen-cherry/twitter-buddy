const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const path = require("path");
const config = require("./config");
const { collectTweets, saveTweets, log } = require("./collect-timeline");
const { getBrowser, closeBrowser } = require("./browser");
const { buildTweetSummary } = require("./analyze");

const dotenvResult = require("dotenv").config({ path: path.join(__dirname, ".env") });
if (dotenvResult.parsed) {
  for (const [k, v] of Object.entries(dotenvResult.parsed)) {
    if (!process.env[k]) process.env[k] = v;
  }
}

function profileLog(msg) {
  const ts = new Date().toLocaleTimeString();
  console.log(`[${ts}] [profile] ${msg}`);
}

/**
 * 抓取某个用户的推文
 */
async function scrapeProfile(handle, options = {}) {
  handle = handle.replace(/^@/, "").trim();
  const maxScrolls = options.maxScrolls || config.profile.maxScrolls;
  const profileDir = path.join(config.profilesDir, handle);
  fs.mkdirSync(profileDir, { recursive: true });

  profileLog(`Scraping @${handle} (max ${maxScrolls} scrolls) ...`);

  const browser = await getBrowser();
  const page = browser.pages()[0] || await browser.newPage();

  profileLog(`Navigating to https://x.com/${handle} ...`);
  await page.goto(`https://x.com/${handle}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  // 等待推文加载
  try {
    await page.waitForSelector('[data-testid="tweet"]', { timeout: 10000 });
  } catch {
    profileLog("Warning: No tweets found on page, user may have no tweets or page didn't load");
  }

  // 清空 _tweetMap，避免残留数据
  await page.evaluate(() => { window._tweetMap = new Map(); });

  // 滚到顶部
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1000);

  // 复用 collectTweets
  const result = await collectTweets(page, { maxScrolls });

  profileLog(`Collected ${result.tweets.length} tweets from @${handle}`);

  if (result.tweets.length > 0) {
    // saveTweets 支持自定义输出目录
    saveTweets(result.tweets, profileDir);
    profileLog(`Saved to ${profileDir}`);
  }

  return {
    handle,
    tweetCount: result.tweets.length,
    newestTime: result.newestTime || null,
    oldestTime: result.oldestTime || null,
  };
}

/**
 * 加载某用户的推文
 */
function loadProfileTweets(handle, options = {}) {
  handle = handle.replace(/^@/, "").trim();
  const profileDir = path.join(config.profilesDir, handle);

  if (!fs.existsSync(profileDir)) return [];

  const files = fs.readdirSync(profileDir)
    .filter(f => f.endsWith(".json"))
    .sort()
    .reverse();

  const allTweets = new Map();
  const sinceDate = options.sinceDate ? new Date(options.sinceDate) : null;

  for (const file of files) {
    // 如果指定了 sinceDate，按文件名粗筛
    if (sinceDate) {
      const dayMatch = file.match(/tweets_(\d{4}-\d{2}-\d{2})\.json/);
      if (dayMatch) {
        const fileDate = new Date(dayMatch[1] + "T23:59:59Z");
        if (fileDate < new Date(sinceDate.getTime() - 8 * 3600000)) continue;
      }
    }

    try {
      const tweets = JSON.parse(fs.readFileSync(path.join(profileDir, file), "utf-8"));
      for (const tweet of tweets) {
        if (sinceDate && new Date(tweet.time) < sinceDate) continue;
        const key = tweet.time + "|" + tweet.link;
        if (!allTweets.has(key)) allTweets.set(key, tweet);
      }
    } catch {}
  }

  let result = Array.from(allTweets.values()).sort((a, b) => b.time.localeCompare(a.time));

  if (options.maxTweets && result.length > options.maxTweets) {
    result = result.slice(0, options.maxTweets);
  }

  return result;
}

/**
 * 分析某用户的推文
 */
async function analyzeProfile(handle, options = {}) {
  handle = handle.replace(/^@/, "").trim();
  const profileDir = path.join(config.profilesDir, handle);
  fs.mkdirSync(profileDir, { recursive: true });

  const sinceDate = options.days
    ? new Date(Date.now() - options.days * 24 * 60 * 60 * 1000)
    : options.sinceDate || null;

  const tweets = loadProfileTweets(handle, {
    sinceDate,
    maxTweets: options.maxTweets || null,
  });

  if (tweets.length === 0) {
    profileLog(`No tweets found for @${handle}`);
    return null;
  }

  profileLog(`Analyzing ${tweets.length} tweets from @${handle} ...`);

  const tweetSummary = buildTweetSummary(tweets);
  const useModel = options.model || config.profile.model;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  profileLog(`Calling Claude API (${useModel}) ...`);

  const timeRange = tweets.length > 0
    ? `${tweets[tweets.length - 1].time} ~ ${tweets[0].time}`
    : "N/A";

  const message = await client.messages.create({
    model: useModel,
    max_tokens: config.profile.maxTokens,
    messages: [
      {
        role: "user",
        content: `${config.profile.prompt}\n\n---\n\n用户：@${handle}\n推文数量：${tweets.length}\n时间范围：${timeRange}\n\n${tweetSummary}`,
      },
    ],
  });

  const analysisText = message.content[0].text;

  // 保存报告
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const timestamp = now.toISOString().slice(0, 16).replace(/[T:]/g, "-");
  const filename = `analysis_${timestamp}.md`;
  const filepath = path.join(profileDir, filename);

  const fmtTime = (iso) => {
    if (!iso) return "N/A";
    const d = new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 19).replace("T", " ");
  };

  const header = `# @${handle} 用户分析报告\n\n- 时间：${fmtTime(new Date().toISOString())} (UTC+8)\n- 推文数量：${tweets.length}\n- 时间范围：${fmtTime(tweets[tweets.length - 1]?.time)} ~ ${fmtTime(tweets[0]?.time)}\n- 模型：${useModel}\n\n---\n\n`;
  fs.writeFileSync(filepath, header + analysisText, "utf-8");

  profileLog(`Analysis saved to ${filepath}`);
  console.log("\n" + analysisText + "\n");

  return { filepath, filename, analysis: analysisText, tweetCount: tweets.length, handle };
}

/**
 * 列出所有已抓取的 profile
 */
function listProfiles() {
  if (!fs.existsSync(config.profilesDir)) return [];

  const dirs = fs.readdirSync(config.profilesDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  return dirs.map(handle => {
    const profileDir = path.join(config.profilesDir, handle);
    const tweetFiles = fs.readdirSync(profileDir).filter(f => f.match(/^tweets_.*\.json$/));
    const analysisFiles = fs.readdirSync(profileDir).filter(f => f.match(/^analysis_.*\.md$/));

    let totalTweets = 0;
    let newestTime = null;
    let oldestTime = null;

    for (const f of tweetFiles) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(profileDir, f), "utf-8"));
        totalTweets += data.length;
        for (const t of data) {
          if (!newestTime || t.time > newestTime) newestTime = t.time;
          if (!oldestTime || t.time < oldestTime) oldestTime = t.time;
        }
      } catch {}
    }

    return {
      handle,
      totalTweets,
      tweetFiles: tweetFiles.length,
      analysisCount: analysisFiles.length,
      newestTime,
      oldestTime,
    };
  }).sort((a, b) => b.totalTweets - a.totalTweets);
}

/**
 * 获取某用户的分析报告列表
 */
function getProfileAnalyses(handle) {
  handle = handle.replace(/^@/, "").trim();
  const profileDir = path.join(config.profilesDir, handle);
  if (!fs.existsSync(profileDir)) return [];

  return fs.readdirSync(profileDir)
    .filter(f => f.match(/^analysis_.*\.md$/))
    .sort()
    .reverse()
    .map(f => {
      const stat = fs.statSync(path.join(profileDir, f));
      const match = f.match(/analysis_(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})\.md/);
      const date = match ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}` : f;
      return { filename: f, date, size: stat.size };
    });
}

/**
 * 读取某个分析报告内容
 */
function getProfileAnalysisContent(handle, filename) {
  handle = handle.replace(/^@/, "").trim();
  const safe = path.basename(filename);
  if (!safe.endsWith(".md")) return null;
  const filepath = path.join(config.profilesDir, handle, safe);
  if (!fs.existsSync(filepath)) return null;
  return fs.readFileSync(filepath, "utf-8");
}

// 导出
module.exports = {
  scrapeProfile,
  loadProfileTweets,
  analyzeProfile,
  listProfiles,
  getProfileAnalyses,
  getProfileAnalysisContent,
};

// CLI 模式
if (require.main === module) {
  const args = process.argv.slice(2);
  let handle = null;
  let maxScrolls = config.profile.maxScrolls;
  let doAnalyze = false;
  let days = null;
  let maxTweets = null;
  let model = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--handle" && args[i + 1]) handle = args[++i];
    if (args[i] === "--max-scrolls" && args[i + 1]) maxScrolls = parseInt(args[++i]);
    if (args[i] === "--analyze") doAnalyze = true;
    if (args[i] === "--days" && args[i + 1]) days = parseFloat(args[++i]);
    if (args[i] === "--max-tweets" && args[i + 1]) maxTweets = parseInt(args[++i]);
    if (args[i] === "--model" && args[i + 1]) model = args[++i];
  }

  if (!handle) {
    console.error("Usage:");
    console.error("  node profile.js --handle <username> [--max-scrolls 50]          # scrape");
    console.error("  node profile.js --handle <username> --analyze [--days 30] [--max-tweets 500] [--model claude-sonnet-4-6]");
    process.exit(1);
  }

  (async () => {
    try {
      if (doAnalyze) {
        await analyzeProfile(handle, { days, maxTweets, model });
      } else {
        await scrapeProfile(handle, { maxScrolls });
      }
    } finally {
      await closeBrowser();
    }
  })().catch(console.error);
}
