const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const path = require("path");
const config = require("./config");
const { collectTweets, saveTweets, log } = require("./collect-timeline");
const { getBrowser, closeBrowser } = require("./browser");

const dotenvResult = require("dotenv").config({ path: path.join(__dirname, ".env") });
if (dotenvResult.parsed) {
  for (const [k, v] of Object.entries(dotenvResult.parsed)) {
    if (!process.env[k]) process.env[k] = v;
  }
}

// ========== 用户评分系统 ==========

/**
 * 加载持久化的用户评分数据
 * @returns {object} { "@username": { score, appearances, firstSeen, lastSeen, history[] } }
 */
function loadUserScores() {
  try {
    if (fs.existsSync(config.userScoresFile)) {
      return JSON.parse(fs.readFileSync(config.userScoresFile, "utf-8"));
    }
  } catch (err) {
    log(`[discover] Failed to load user scores: ${err.message}`);
  }
  return {};
}

/**
 * 保存用户评分数据
 */
function saveUserScores(scores) {
  fs.mkdirSync(path.dirname(config.userScoresFile), { recursive: true });
  fs.writeFileSync(config.userScoresFile, JSON.stringify(scores, null, 2), "utf-8");
  log(`[discover] User scores saved (${Object.keys(scores).length} users tracked)`);
}

/**
 * 从 LLM 输出中解析评分 JSON
 * 寻找 ```json:scores ... ``` 代码块
 */
function parseScoresFromAnalysis(analysisText) {
  // 匹配 ```json:scores ... ``` 或 ```json ... ```
  const patterns = [
    /```json:scores\s*\n([\s\S]*?)```/,
    /```json\s*\n(\[[\s\S]*?\])\s*```(?![\s\S]*```json)/,  // 最后一个 json block
  ];

  for (const pattern of patterns) {
    const match = analysisText.match(pattern);
    if (match) {
      try {
        const parsed = JSON.parse(match[1]);
        if (Array.isArray(parsed)) {
          return parsed.filter(item =>
            item.user && typeof item.delta === "number" && item.reason
          );
        }
      } catch (err) {
        log(`[discover] Failed to parse scores JSON: ${err.message}`);
      }
    }
  }

  // 兜底：如果 JSON 被截断（LLM 输出不完整），尝试提取已有的完整条目
  const truncatedMatch = analysisText.match(/```json:scores\s*\n\[([\s\S]*)/);
  if (truncatedMatch) {
    log("[discover] Scores JSON appears truncated, attempting partial parse ...");
    try {
      // 找到最后一个完整的 } 后加上 ] 来关闭数组
      const partial = truncatedMatch[1];
      const lastBrace = partial.lastIndexOf("}");
      if (lastBrace > 0) {
        const fixedJson = "[" + partial.substring(0, lastBrace + 1) + "]";
        const parsed = JSON.parse(fixedJson);
        if (Array.isArray(parsed)) {
          const valid = parsed.filter(item =>
            item.user && typeof item.delta === "number" && item.reason
          );
          log(`[discover] Recovered ${valid.length} scores from truncated output`);
          return valid;
        }
      }
    } catch (err) {
      log(`[discover] Partial parse also failed: ${err.message}`);
    }
  }

  log("[discover] No valid scores JSON found in LLM output");
  return [];
}

/**
 * 将 LLM 输出的评分更新到持久化的评分数据中
 */
function updateUserScores(existingScores, newScoreDeltas) {
  const now = new Date().toISOString();
  const today = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);

  for (const item of newScoreDeltas) {
    const username = item.user.startsWith("@") ? item.user : `@${item.user}`;
    const delta = Math.max(-5, Math.min(5, item.delta)); // 限制在 -5 到 +5

    if (!existingScores[username]) {
      existingScores[username] = {
        score: 0,
        appearances: 0,
        firstSeen: now,
        lastSeen: now,
        history: [],
      };
    }

    const user = existingScores[username];
    user.score += delta;
    user.appearances += 1;
    user.lastSeen = now;
    user.history.push({
      date: today,
      delta,
      reason: item.reason,
    });

    // 只保留最近 20 条历史记录
    if (user.history.length > 20) {
      user.history = user.history.slice(-20);
    }
  }

  return existingScores;
}

/**
 * 构建历史评分摘要（供 LLM 参考）
 */
function buildScoresSummary(scores, tweetUsers) {
  // 只包含本次推文中出现的用户 + 高分/低分用户
  const relevant = {};

  // 从推文中提取用户名（去掉 @ 和后面的内容）
  const tweetUserSet = new Set();
  for (const u of tweetUsers) {
    // user 格式可能是 "Name @handle" 或 "@handle"
    const handleMatch = u.match(/@([\w]+)/);
    if (handleMatch) tweetUserSet.add(`@${handleMatch[1]}`);
  }

  for (const [username, data] of Object.entries(scores)) {
    // 本次推文中出现的用户
    if (tweetUserSet.has(username)) {
      relevant[username] = data;
      continue;
    }
    // 高分用户（≥8）或低分用户（≤-5）也包含进来做参考
    if (data.score >= 8 || data.score <= -5) {
      relevant[username] = data;
    }
  }

  if (Object.keys(relevant).length === 0) return "";

  const lines = Object.entries(relevant)
    .sort((a, b) => b[1].score - a[1].score)
    .map(([username, data]) => {
      const recentReason = data.history.length > 0
        ? data.history[data.history.length - 1].reason
        : "";
      return `${username}: 累计 ${data.score} 分 (出现 ${data.appearances} 次, 最近: ${recentReason})`;
    });

  return `\n\n## 历史评分数据（供参考）\n\n${lines.join("\n")}`;
}

// ========== 关注状态检测 ==========

/**
 * 从推文 user 字段提取 @handle
 * user 格式例如: "Orange AI @oran_ge" 或 "猎手killer @memekiller365"
 */
function extractHandle(userStr) {
  const match = userStr.match(/@([\w]+)/);
  return match ? match[1] : null;
}

/**
 * 从 HoverCard 弹窗中读取关注状态
 * @param {string} expectedHandle - 期望的用户 handle（用于验证卡片是否属于正确的用户）
 */
function _evaluateHoverCard(expectedHandle) {
  const card = document.querySelector('[data-testid="HoverCard"]');
  if (!card) return { isFollowed: null, match: false };

  // 验证卡片是否属于正确的用户（通过 aria-label 或链接中的 handle）
  const cardLinks = card.querySelectorAll('a[href]');
  let isCorrectUser = false;
  for (const link of cardLinks) {
    const href = link.getAttribute('href');
    if (href && href.toLowerCase() === '/' + expectedHandle.toLowerCase()) {
      isCorrectUser = true;
      break;
    }
  }
  if (!isCorrectUser) return { isFollowed: null, match: false };

  let isFollowed = null;
  if (card.querySelector('[data-testid$="-unfollow"]')) isFollowed = true;
  else if (card.querySelector('[data-testid$="-follow"]')) isFollowed = false;
  // aria-label 兜底
  else if (card.querySelector('[aria-label^="Following @"], [aria-label^="正在关注"], [aria-label^="Unfollow @"], [aria-label^="取消关注"]')) isFollowed = true;
  else if (card.querySelector('[aria-label^="Follow @"], [aria-label^="关注 @"], [aria-label^="关注@"]')) isFollowed = false;
  // 按钮文本兜底
  else {
    const btns = card.querySelectorAll('[role="button"]');
    for (const btn of btns) {
      const text = btn.textContent.trim();
      if (/^Following$|^正在关注$/.test(text)) { isFollowed = true; break; }
      if (/^Follow$|^关注$/.test(text)) { isFollowed = false; break; }
    }
  }
  return { isFollowed, match: true };
}

/**
 * 方法1: 通过悬停头像触发 HoverCard 来检测关注状态
 * 优点：不需要离开时间线，速度快
 * 在时间线页面上重新滚动，悬停每个用户的头像
 */
async function checkFollowViaHover(page, handles) {
  const unchecked = new Set(handles.map(h => h.toLowerCase()));
  const followMap = {};

  // 回到顶部，开始重新扫描
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1000);

  let scrolls = 0;
  const maxScrolls = 80;
  let staleCount = 0;
  let lastCheckedCount = 0;

  log(`[discover] Hover-scan: checking ${unchecked.size} users via avatar hover ...`);

  while (unchecked.size > 0 && scrolls < maxScrolls && staleCount < 10) {
    // 找到当前视口中未检查用户的头像位置
    const avatars = await page.evaluate((uncheckedArr) => {
      const results = [];
      const seen = new Set();
      document.querySelectorAll('[data-testid="tweet"]').forEach(tweet => {
        const imgs = tweet.querySelectorAll('img[src*="profile_images"]');
        for (const img of imgs) {
          const link = img.closest('a[href]');
          if (!link) continue;
          const href = link.getAttribute('href');
          if (!href || href === '/') continue;
          const handle = href.replace(/^\//, '').split('/')[0].toLowerCase();
          if (!uncheckedArr.includes(handle) || seen.has(handle)) continue;
          seen.add(handle);
          const rect = img.getBoundingClientRect();
          // 只处理视口内的头像
          if (rect.top > 50 && rect.bottom < window.innerHeight - 50 && rect.width > 0) {
            results.push({
              handle,
              x: Math.round(rect.x + rect.width / 2),
              y: Math.round(rect.y + rect.height / 2),
            });
          }
        }
      });
      return results;
    }, Array.from(unchecked));

    // 悬停每个头像
    for (const avatar of avatars) {
      if (!unchecked.has(avatar.handle)) continue;

      // 先确保没有残留的 HoverCard
      await page.mouse.move(0, 0);
      try {
        await page.waitForSelector('[data-testid="HoverCard"]', { state: "hidden", timeout: 1000 });
      } catch {}
      await page.waitForTimeout(100);

      await page.mouse.move(avatar.x, avatar.y);
      try {
        await page.waitForSelector('[data-testid="HoverCard"]', { timeout: 2000 });
        await page.waitForTimeout(400); // 等待卡片完全渲染

        const result = await page.evaluate(_evaluateHoverCard, avatar.handle);
        if (result.match && result.isFollowed !== null) {
          followMap[avatar.handle] = result.isFollowed;
          unchecked.delete(avatar.handle);
        }
      } catch {
        // HoverCard 没出现，跳过
      }

      // 移走鼠标关闭卡片
      await page.mouse.move(0, 0);
      await page.waitForTimeout(300);
    }

    // 进度追踪
    const currentCount = Object.keys(followMap).length;
    if (currentCount === lastCheckedCount) {
      staleCount++;
    } else {
      staleCount = 0;
      lastCheckedCount = currentCount;
    }

    if (scrolls % 10 === 0 && scrolls > 0) {
      log(`[discover]   Hover progress: ${currentCount} checked, ${unchecked.size} remaining (scroll ${scrolls})`);
    }

    // 向下滚动
    await page.evaluate(() => window.scrollBy({ top: 500, behavior: "smooth" }));
    await page.waitForTimeout(400);
    scrolls++;
  }

  log(`[discover] Hover-scan done: ${Object.keys(followMap).length} detected, ${unchecked.size} remaining`);
  return { followMap, uncheckedHandles: Array.from(unchecked) };
}

/**
 * 方法2: 访问用户主页检测关注状态（兜底方案）
 */
async function checkFollowOnProfile(page, handle) {
  try {
    await page.goto(`https://x.com/${handle}`, { waitUntil: "domcontentloaded", timeout: 15000 });

    // 等待关注按钮出现
    try {
      await page.waitForSelector(
        '[data-testid$="-follow"], [data-testid$="-unfollow"]',
        { timeout: 8000 }
      );
    } catch {
      await page.waitForTimeout(2000);
    }

    const result = await page.evaluate(() => {
      if (document.querySelector('[data-testid$="-unfollow"]')) return true;
      if (document.querySelector('[data-testid$="-follow"]')) return false;
      if (document.querySelector('[aria-label^="Following @"], [aria-label^="正在关注"], [aria-label^="Unfollow @"], [aria-label^="取消关注"]')) return true;
      if (document.querySelector('[aria-label^="Follow @"], [aria-label^="关注 @"], [aria-label^="关注@"]')) return false;
      const btns = document.querySelectorAll('[role="button"], button');
      for (const btn of btns) {
        const text = btn.textContent.trim();
        if (/^Following$|^正在关注$/.test(text)) return true;
        if (/^Follow$|^关注$/.test(text)) return false;
      }
      return null;
    });
    return result;
  } catch {
    return null;
  }
}

/**
 * 批量检测关注状态：先用悬停，再用主页兜底
 */
async function checkFollowStatusBatch(page, tweets) {
  // 提取唯一 handle 列表
  const handleSet = new Set();
  for (const t of tweets) {
    const handle = extractHandle(t.user);
    if (handle) handleSet.add(handle.toLowerCase());
  }

  const allHandles = Array.from(handleSet);
  log(`[discover] Checking follow status for ${allHandles.length} unique users ...`);

  // 第一阶段：悬停检测（不离开时间线，速度快）
  const { followMap, uncheckedHandles } = await checkFollowViaHover(page, allHandles);

  // 第二阶段：对悬停未覆盖的用户，访问主页检测
  if (uncheckedHandles.length > 0) {
    log(`[discover] Falling back to profile visits for ${uncheckedHandles.length} remaining users ...`);
    let checked = 0;
    for (const handle of uncheckedHandles) {
      const isFollowed = await checkFollowOnProfile(page, handle);
      if (isFollowed !== null) {
        followMap[handle] = isFollowed;
      }
      checked++;
      if (checked <= 5 || checked % 10 === 0) {
        const status = isFollowed === true ? "✅" : isFollowed === false ? "❌" : "❓";
        log(`[discover]   [${checked}/${uncheckedHandles.length}] @${handle}: ${status}`);
      }
      await page.waitForTimeout(300 + Math.random() * 500);
    }
  }

  const followedCount = Object.values(followMap).filter(v => v === true).length;
  const unfollowedCount = Object.values(followMap).filter(v => v === false).length;
  const unknownCount = allHandles.length - followedCount - unfollowedCount;
  log(`[discover] Follow check complete: ${followedCount} followed, ${unfollowedCount} not followed, ${unknownCount} unknown`);

  return followMap;
}

// ========== 导航 ==========

/**
 * 导航到 "为你推荐" (For You) 标签页
 */
async function navigateToForYou(page) {
  // 清除上一次任务残留的扫描数据
  await page.evaluate(() => { window._tweetMap = new Map(); }).catch(() => {});
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

// ========== 推文处理 ==========

/**
 * 构建推文摘要（供 LLM 分析用），包含关注状态
 */
function buildTweetSummary(tweets) {
  return tweets.map((t, i) => {
    const followTag = t.isFollowed === true ? " [已关注]" :
                      t.isFollowed === false ? " [未关注]" : "";
    let line = `[${i + 1}] ${t.time} | ${t.user}${followTag} | [${t.type}] ${t.text}`;
    if (t.link) line += `\n    🔗 ${t.link}`;
    if (t.quoted) {
      line += `\n    ↳ 引用: ${t.quoted.user}: ${t.quoted.text.substring(0, 100)}`;
      if (t.quoted.link) line += `\n    🔗 ${t.quoted.link}`;
    }
    if (t.hasMedia) line += " [有媒体]";
    return line;
  }).join("\n\n");
}

// ========== LLM 分析 ==========

/**
 * 调用 LLM 分析推文，发现值得关注的账号
 */
async function analyzeForDiscover(tweets) {
  if (tweets.length === 0) {
    log("[discover] No tweets to analyze.");
    return null;
  }

  log(`[discover] Analyzing ${tweets.length} tweets for account discovery ...`);

  // 加载历史评分
  const existingScores = loadUserScores();
  const scoredUserCount = Object.keys(existingScores).length;
  if (scoredUserCount > 0) {
    log(`[discover] Loaded scores for ${scoredUserCount} tracked users`);
  }

  // 构建推文摘要（含关注状态）
  const tweetSummary = buildTweetSummary(tweets);

  // 构建历史评分摘要
  const tweetUsers = tweets.map(t => t.user);
  const scoresSummary = buildScoresSummary(existingScores, tweetUsers);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const discoverPrompt = config.discover.prompt;

  const userContent = `${discoverPrompt}${scoresSummary}\n\n---\n\n以下是从"为你推荐"采集到的 ${tweets.length} 条推文：\n\n${tweetSummary}`;

  const message = await client.messages.create({
    model: config.discover.model || config.analysis.model,
    max_tokens: config.discover.maxTokens || config.analysis.maxTokens,
    messages: [
      { role: "user", content: userContent },
    ],
  });

  const analysisText = message.content[0].text;

  // 解析 LLM 输出中的评分
  const newScoreDeltas = parseScoresFromAnalysis(analysisText);
  if (newScoreDeltas.length > 0) {
    log(`[discover] Parsed ${newScoreDeltas.length} user score updates from LLM`);
    const updatedScores = updateUserScores(existingScores, newScoreDeltas);
    saveUserScores(updatedScores);

    // 输出评分摘要
    for (const item of newScoreDeltas) {
      const username = item.user.startsWith("@") ? item.user : `@${item.user}`;
      const total = updatedScores[username]?.score || 0;
      const sign = item.delta > 0 ? "+" : "";
      log(`[discover]   ${username}: ${sign}${item.delta} → 累计 ${total} (${item.reason})`);
    }
  }

  // 统计关注状态
  const followedCount = tweets.filter(t => t.isFollowed === true).length;
  const unfollowedCount = tweets.filter(t => t.isFollowed === false).length;
  const unknownCount = tweets.filter(t => t.isFollowed == null).length;
  log(`[discover] Follow status: ${followedCount} followed, ${unfollowedCount} not followed, ${unknownCount} unknown`);

  // 从报告中移除原始 JSON 评分块（用户看到的报告更干净）
  // 移除评分 JSON 块（完整或截断的都移除）
  const cleanAnalysis = analysisText
    .replace(/```json:scores[\s\S]*?```/g, "")   // 完整的 block
    .replace(/```json:scores[\s\S]*$/g, "")       // 被截断的 block（没有结尾 ```）
    .trim();

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

  // 在报告头部加入评分统计
  const scoreStats = scoredUserCount > 0
    ? `\n- 已跟踪用户：${Object.keys(existingScores).length} 个`
    : "";
  const followStats = `\n- 关注状态：已关注 ${followedCount} / 未关注 ${unfollowedCount} / 未知 ${unknownCount}`;

  const header = `# 账号发现报告\n\n- 时间：${fmtTime(new Date().toISOString())} (UTC+8)\n- 推文数量：${tweets.length}\n- 来源：为你推荐 (For You)\n- 时间范围：${fmtTime(tweets[tweets.length - 1]?.time)} ~ ${fmtTime(tweets[0]?.time)}${followStats}${scoreStats}\n\n---\n\n`;
  fs.writeFileSync(filepath, header + cleanAnalysis, "utf-8");

  log(`[discover] Report saved to ${filepath}`);
  console.log("\n" + cleanAnalysis + "\n");

  return { filepath, filename, analysis: cleanAnalysis, tweetCount: tweets.length };
}

// ========== 主流程 ==========

/**
 * 完整的发现流程：启动浏览器 → 采集 For You → LLM 分析
 */
async function runDiscover(options = {}) {
  log("=== Starting account discovery ===");

  const maxScrolls = options.maxScrolls || config.discover.maxScrolls;
  const browser = await getBrowser();
  const page = browser.pages()[0] || (await browser.newPage());

  try {
    await navigateToForYou(page);

    const result = await collectTweets(page, { maxScrolls });

    if (result.tweets.length === 0) {
      log("[discover] No tweets collected.");
      return null;
    }

    // 检测每个用户的关注状态（通过访问用户主页）
    const followMap = await checkFollowStatusBatch(page, result.tweets);
    for (const t of result.tweets) {
      const handle = extractHandle(t.user);
      if (handle && followMap[handle.toLowerCase()] != null) {
        t.isFollowed = followMap[handle.toLowerCase()];
      }
    }

    // 保存原始推文到 discover 目录
    saveTweets(result.tweets, config.discoverDir);

    // LLM 分析
    const analysisResult = await analyzeForDiscover(result.tweets);

    log("=== Account discovery complete ===");
    return analysisResult;
  } catch (err) {
    log(`[discover] Error: ${err.message}`);
    return null;
  }
}

// 导出
module.exports = { runDiscover, navigateToForYou, analyzeForDiscover, loadUserScores };

// CLI 模式
if (require.main === module) {
  const args = process.argv.slice(2);
  let maxScrolls = config.discover.maxScrolls;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--max-scrolls" && args[i + 1]) maxScrolls = parseInt(args[++i]);
  }

  runDiscover({ maxScrolls }).then(async (result) => {
    if (result) {
      console.log("\n========== Discovery Summary ==========");
      console.log(`Tweets analyzed: ${result.tweetCount}`);
      console.log(`Report: ${path.resolve(result.filepath)}`);
      console.log("========================================\n");
    } else {
      console.log("No results.");
    }
    await closeBrowser();
  }).catch(async (err) => {
    console.error(err);
    await closeBrowser();
  });
}
