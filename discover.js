const fs = require("fs");
const path = require("path");
require("./env");
const config = require("./config");
const { launchBrowser, collectTweets, saveTweets, log } = require("./collect-timeline");
const { generateText, resolveScopeSettings } = require("./llm");

/**
 * 导航到 "为你推荐" (For You) 标签页
 */
async function navigateToForYou(page) {
  log("[discover] Navigating to x.com/home ...");
  await page.goto("https://x.com/home", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  // 点击 "For you / 为你推荐" tab
  log("[discover] Switching to For You tab ...");
  try {
    const forYouTab = page.locator(
      '[role="tab"]:has-text("For you"), [role="tab"]:has-text("为你推荐"), [role="tablist"] a:has-text("For you"), [role="tablist"] a:has-text("为你推荐")'
    );
    if ((await forYouTab.count()) > 0) {
      await forYouTab.first().click();
      log("[discover] Clicked For You tab");
      await page.waitForTimeout(2000);
    } else {
      const clicked = await page.evaluate(() => {
        const tabs = document.querySelectorAll('[role="tab"] span, [role="tablist"] a span');
        for (const span of tabs) {
          if (/For you|为你推荐/i.test(span.textContent)) {
            span.closest('[role="tab"]') ? span.closest('[role="tab"]').click() : span.closest('a').click();
            return true;
          }
        }
        return false;
      });
      if (clicked) log("[discover] Clicked For You tab (fallback)");
      else log("[discover] Could not find For You tab, may already be active");
      await page.waitForTimeout(2000);
    }
  } catch {
    log("[discover] Could not find For You tab, may already be active");
  }

  // 点击"显示新帖子"
  log("[discover] Checking for new tweets banner ...");
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const banner = page.locator(
        '[data-testid="cellInnerDiv"] button, div[role="button"]'
      ).filter({ hasText: /显示.*帖子|Show.*post|Show.*tweet/i });
      if ((await banner.count()) > 0) {
        await banner.first().click();
        log("[discover] Clicked 'show new tweets' banner");
        await page.waitForTimeout(2000);
      } else break;
    } catch { break; }
  }

  // 回到顶部
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1000);
}

/**
 * 构建推文摘要（供 LLM 分析用）
 */
function buildTweetSummary(tweets) {
  return tweets.map((t, i) => {
    let line = `[${i + 1}] ${t.time} | ${t.user} | [${t.type}] ${t.text}`;
    if (t.link) line += `\n    🔗 ${t.link}`;
    if (t.quoted) {
      line += `\n    ↳ 引用: ${t.quoted.user}: ${t.quoted.text.substring(0, 100)}`;
      if (t.quoted.link) line += `\n    🔗 ${t.quoted.link}`;
    }
    if (t.hasMedia) line += " [有媒体]";
    return line;
  }).join("\n\n");
}

/**
 * 调用 LLM 分析推文，发现值得关注的账号
 */
async function analyzeForDiscover(tweets, options = {}) {
  if (tweets.length === 0) {
    log("[discover] No tweets to analyze.");
    return null;
  }

  log(`[discover] Analyzing ${tweets.length} tweets for account discovery ...`);

  const tweetSummary = buildTweetSummary(tweets);
  const discoverPrompt = config.discover.prompt;
  const llm = resolveScopeSettings("discover", options);
  const prompt = `${discoverPrompt}\n\n---\n\n以下是从"为你推荐"采集到的 ${tweets.length} 条推文：\n\n${tweetSummary}`;

  log(`[discover] Calling ${llm.providerConfig.label} (${llm.provider}/${llm.model}) ...`);

  const analysisText = await generateText({
    provider: llm.provider,
    model: llm.model,
    maxTokens: llm.maxTokens,
    prompt,
  });

  if (!analysisText) {
    throw new Error(`LLM returned empty content (${llm.provider}/${llm.model})`);
  }

  // 保存结果
  fs.mkdirSync(config.discoverDir, { recursive: true });
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const timestamp = now.toISOString().slice(0, 16).replace(/[T:]/g, "-");
  const filename = `discover_${timestamp}.md`;
  const filepath = path.join(config.discoverDir, filename);

  const fmtTime = (iso) => {
    if (!iso) return "N/A";
    const d = new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 19).replace("T", " ");
  };
  const header = `# 账号发现报告\n\n- 时间：${fmtTime(new Date().toISOString())} (UTC+8)\n- Provider：${llm.provider}\n- Model：${llm.model}\n- 推文数量：${tweets.length}\n- 来源：为你推荐 (For You)\n- 时间范围：${fmtTime(tweets[tweets.length - 1]?.time)} ~ ${fmtTime(tweets[0]?.time)}\n\n---\n\n`;
  fs.writeFileSync(filepath, header + analysisText, "utf-8");

  log(`[discover] Report saved to ${filepath}`);
  console.log("\n" + analysisText + "\n");

  return {
    filepath,
    filename,
    analysis: analysisText,
    tweetCount: tweets.length,
    provider: llm.provider,
    model: llm.model,
  };
}

/**
 * 完整的发现流程：启动浏览器 → 采集 For You → LLM 分析
 */
async function runDiscover(options = {}) {
  log("=== Starting account discovery ===");

  const maxScrolls = options.maxScrolls || config.discover.maxScrolls;
  const browser = await launchBrowser();
  const page = browser.pages()[0] || (await browser.newPage());

  try {
    await navigateToForYou(page);

    const result = await collectTweets(page, { maxScrolls });

    if (result.tweets.length === 0) {
      log("[discover] No tweets collected.");
      return null;
    }

    // 保存原始推文到 discover 目录
    saveTweets(result.tweets, config.discoverDir);

    // LLM 分析
    const analysisResult = await analyzeForDiscover(result.tweets, {
      provider: options.provider,
      model: options.model,
    });

    log("=== Account discovery complete ===");
    return analysisResult;
  } catch (err) {
    log(`[discover] Error: ${err.message}`);
    return null;
  } finally {
    await browser.close();
  }
}

// 导出
module.exports = { runDiscover, navigateToForYou, analyzeForDiscover };

// CLI 模式
if (require.main === module) {
  const args = process.argv.slice(2);
  let maxScrolls = config.discover.maxScrolls;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--max-scrolls" && args[i + 1]) maxScrolls = parseInt(args[++i]);
  }

  runDiscover({ maxScrolls }).then((result) => {
    if (result) {
      console.log("\n========== Discovery Summary ==========");
      console.log(`Tweets analyzed: ${result.tweetCount}`);
      console.log(`Report: ${path.resolve(result.filepath)}`);
      console.log("========================================\n");
    } else {
      console.log("No results.");
    }
  }).catch(console.error);
}
