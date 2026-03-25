const fs = require("fs");
const path = require("path");
const config = require("./config");

let _externalLog = null;

function log(msg) {
  const ts = new Date().toLocaleTimeString();
  console.log(`[${ts}] ${msg}`);
  if (_externalLog) _externalLog(msg);
}

function setLogger(fn) {
  _externalLog = fn;
}

function clearLogger() {
  _externalLog = null;
}

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// 注入页面的扫描函数：扫描当前 DOM 中的推文，存入 window._tweetMap
const SCAN_TWEETS_FN = `
(() => {
  if (!window._tweetMap) window._tweetMap = new Map();
  const visibleTimes = [];
  document.querySelectorAll('[data-testid="tweet"]').forEach(t => {
    const userEl = t.querySelector('[data-testid="User-Name"]');
    const user = userEl ? userEl.innerText.split('\\n').slice(0, 2).join(' ') : '';
    const time = t.querySelector('time')?.getAttribute('datetime') || '';
    const text = t.querySelector('[data-testid="tweetText"]')?.innerText || '[no text]';
    const hasMedia = !!(t.querySelector('[data-testid="tweetPhoto"]') || t.querySelector('video') || t.querySelector('[data-testid="card.wrapper"]'));
    const link = t.querySelector('a[href*="/status/"]')?.href || '';
    const socialCtx = t.closest('[data-testid="cellInnerDiv"]')?.querySelector('[data-testid="socialContext"]');
    const isRetweet = socialCtx ? /retweet|转推|已转帖|转发/i.test(socialCtx.innerText) : false;
    const quoteCard = Array.from(t.querySelectorAll('div[role="link"]')).find(
      el => el.querySelector('[data-testid="User-Name"]') && el.querySelector('[data-testid="tweetText"]') && el.querySelector('time')
    );
    // 注：For You 时间线的推文卡片内没有 Follow 按钮，关注状态改由 discover.js 通过访问用户主页检测
    const type = isRetweet ? 'retweet' : quoteCard ? 'quote' : 'tweet';
    let quoted = null;
    if (quoteCard) {
      quoted = {
        user: quoteCard.querySelector('[data-testid="User-Name"]')?.innerText?.split('\\n').slice(0, 2).join(' ') || '',
        text: quoteCard.querySelector('[data-testid="tweetText"]')?.innerText || '',
        time: quoteCard.querySelector('time')?.getAttribute('datetime') || '',
        link: quoteCard.querySelector('a[href*="/status/"]')?.href || ''
      };
    }
    if (time) {
      visibleTimes.push(time);
      const key = time + '|' + user.substring(0, 30);
      if (!window._tweetMap.has(key)) {
        window._tweetMap.set(key, { user, time, text, hasMedia, link, type, quoted });
      }
    }
  });
  const vals = Array.from(window._tweetMap.values());
  if (vals.length === 0) return { total: 0, oldest: null, newest: null, visibleTimes: [] };
  const oldest = vals.reduce((a, b) => (a.time < b.time ? a : b));
  const newest = vals.reduce((a, b) => (a.time > b.time ? a : b));
  return { total: vals.length, oldest: oldest.time, newest: newest.time, visibleTimes };
})()`;

// 提取所有收集到的推文
const EXTRACT_ALL_FN = `
(() => {
  if (!window._tweetMap) return [];
  return Array.from(window._tweetMap.values())
    .sort((a, b) => b.time.localeCompare(a.time))
    .map(t => {
      const obj = {
        user: t.user.split('\\n')[0],
        time: t.time,
        type: t.type || 'tweet',
        text: t.text,
        hasMedia: t.hasMedia,
        link: t.link,
        isFollowed: t.isFollowed != null ? t.isFollowed : null
      };
      if (t.quoted) obj.quoted = t.quoted;
      return obj;
    });
})()`;

/**
 * 导航到 Following 时间线（最近排序）
 */
async function navigateToTimeline(page) {
  // 清除上一次任务残留的扫描数据
  await page.evaluate(() => { window._tweetMap = new Map(); }).catch(() => {});
  log("Navigating to x.com/home ...");
  await page.goto("https://x.com/home", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  // 切换到"正在关注"标签
  log("Switching to Following tab ...");
  try {
    const followingTab = page.locator(
      '[role="tab"]:has-text("Following"), [role="tab"]:has-text("正在关注"), [role="tablist"] a:has-text("Following"), [role="tablist"] a:has-text("正在关注")'
    );
    if ((await followingTab.count()) > 0) {
      await followingTab.first().click();
      log("Clicked Following tab");
      await page.waitForTimeout(2000);
    } else {
      const clicked = await page.evaluate(() => {
        const tabs = document.querySelectorAll('[role="tab"] span, [role="tablist"] a span');
        for (const span of tabs) {
          if (/Following|正在关注/.test(span.textContent)) {
            span.closest('[role="tab"]') ? span.closest('[role="tab"]').click() : span.closest('a').click();
            return true;
          }
        }
        return false;
      });
      if (clicked) log("Clicked Following tab (fallback)");
      else log("Could not find Following tab");
      await page.waitForTimeout(2000);
    }
  } catch {
    log("Could not find Following tab, may already be active");
  }

  // 切换到"最近"排序
  log("Switching to Latest sort ...");
  try {
    const sortBtn = page.locator(
      '[aria-label="Sort"], [aria-label="排序方式"], [data-testid="sortButton"], a[href="/home/latest"]'
    );
    if ((await sortBtn.count()) > 0) {
      await sortBtn.first().click();
      await page.waitForTimeout(1000);
    } else {
      await page.evaluate(() => {
        const icons = document.querySelectorAll('[role="tablist"] ~ div [role="button"], [data-testid="ScrollSnap-prevButtonWrapper"] ~ div [role="button"]');
        for (const icon of icons) { icon.click(); return; }
      });
      await page.waitForTimeout(1000);
    }
    const latestOption = page.locator(
      '[role="menuitem"]:has-text("Latest"), [role="menuitem"]:has-text("最近"), [role="menuitemradio"]:has-text("Latest"), [role="menuitemradio"]:has-text("最近")'
    );
    if ((await latestOption.count()) > 0) {
      await latestOption.first().click();
      log("Selected 'Latest' sort");
      await page.waitForTimeout(2000);
    } else {
      log("Could not find Latest option, may already be active");
    }
  } catch {
    log("Could not switch sort mode");
  }

  // 点击"显示新帖子"
  log("Checking for new tweets banner ...");
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const banner = page.locator(
        '[data-testid="cellInnerDiv"] button, div[role="button"]'
      ).filter({ hasText: /显示.*帖子|Show.*post|Show.*tweet/i });
      if ((await banner.count()) > 0) {
        await banner.first().click();
        log("Clicked 'show new tweets' banner");
        await page.waitForTimeout(2000);
      } else break;
    } catch { break; }
  }

  // 回到顶部
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1000);
}

/**
 * 核心采集函数
 * @param {Page} page - Playwright page
 * @param {object} options
 * @param {string} options.stopAtTimestamp - 滚到这个时间戳就停（ISO string）
 * @param {number} options.maxScrolls - 最大滚动次数
 * @returns {{ tweets: Array, reachedTarget: boolean, newestTime: string, oldestTime: string }}
 */
async function collectTweets(page, options = {}) {
  const scrollCfg = config.scroll;
  const maxScrolls = options.maxScrolls || scrollCfg.maxScrolls;
  const stopAt = options.stopAtTimestamp || null;

  // 初始扫描
  let status = await page.evaluate(SCAN_TWEETS_FN);
  log(`Initial scan: ${status.total} tweets`);
  if (stopAt) log(`Will stop at timestamp: ${stopAt}`);

  let scrollCount = 0;
  let staleCount = 0;
  let lastTotal = status.total;
  let reachedTarget = false;

  while (scrollCount < maxScrolls) {
    // Burst 滚动
    const burstSize = Math.min(
      rand(scrollCfg.burstMin, scrollCfg.burstMax),
      maxScrolls - scrollCount
    );
    log(`Burst of ${burstSize} scrolls ...`);

    for (let i = 0; i < burstSize; i++) {
      await page.evaluate((px) => {
        window.scrollBy({ top: px, behavior: "smooth" });
      }, scrollCfg.scrollPixels);
      await page.waitForTimeout(rand(scrollCfg.burstDelayMin, scrollCfg.burstDelayMax));

      status = await page.evaluate(SCAN_TWEETS_FN);
      scrollCount++;

      if (status.total === lastTotal) {
        staleCount++;
      } else {
        staleCount = 0;
        lastTotal = status.total;
      }

      // 检查当前可见推文是否已过目标时间
      if (stopAt && status.visibleTimes && status.visibleTimes.length > 0) {
        const allPastTarget = status.visibleTimes.every(t => t <= stopAt);
        if (allPastTarget) {
          reachedTarget = true;
          log(`Reached target timestamp, stopping.`);
          break;
        }
      }
    }

    if (reachedTarget) break;

    log(
      `After burst: ${status.total} tweets | oldest: ${status.oldest || "N/A"} | stale: ${staleCount}/${scrollCfg.staleLimit}`
    );

    if (staleCount >= scrollCfg.staleLimit) {
      log("No new tweets for too long, stopping.");
      break;
    }

    if (scrollCount >= maxScrolls) break;

    // 随机暂停
    const pause = rand(scrollCfg.pauseMin, scrollCfg.pauseMax);
    log(`Pausing ${(pause / 1000).toFixed(1)}s ...`);
    await page.waitForTimeout(pause);
  }

  // 最终扫描 + 提取
  status = await page.evaluate(SCAN_TWEETS_FN);
  log(`Collection complete: ${status.total} tweets total`);
  log(`Time range: ${status.oldest} ~ ${status.newest}`);

  const tweets = await page.evaluate(EXTRACT_ALL_FN);

  return {
    tweets,
    reachedTarget,
    newestTime: tweets[0]?.time || null,
    oldestTime: tweets[tweets.length - 1]?.time || null,
  };
}

/**
 * 保存推文到文件（按天合并，去重）
 */
function saveTweets(tweets, outputDir) {
  outputDir = outputDir || config.tweetsDir;
  fs.mkdirSync(outputDir, { recursive: true });

  // 按推文日期（UTC+8）分组
  const byDay = {};
  for (const t of tweets) {
    if (!t.time) continue;
    const d = new Date(new Date(t.time).getTime() + 8 * 3600000);
    const day = d.toISOString().slice(0, 10); // YYYY-MM-DD
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(t);
  }

  const savedFiles = [];
  for (const [day, dayTweets] of Object.entries(byDay)) {
    const filename = `tweets_${day}.json`;
    const filepath = path.join(outputDir, filename);

    // 读取已有文件，合并去重
    let existing = [];
    try {
      if (fs.existsSync(filepath)) {
        existing = JSON.parse(fs.readFileSync(filepath, "utf-8"));
      }
    } catch {}

    // 用 time+user 去重
    const seen = new Set();
    const merged = [];
    for (const t of [...existing, ...dayTweets]) {
      const key = t.time + "|" + (t.user || "").substring(0, 30);
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(t);
      }
    }

    // 按时间倒序
    merged.sort((a, b) => b.time.localeCompare(a.time));

    fs.writeFileSync(filepath, JSON.stringify(merged, null, 2), "utf-8");
    const newCount = merged.length - existing.length;
    log(`${filename}: ${merged.length} tweets (+${newCount} new)`);
    savedFiles.push(filepath);
  }

  return savedFiles[0] || null;
}

// 导出供 daemon.js 使用
module.exports = { navigateToTimeline, collectTweets, saveTweets, log, setLogger, clearLogger };

// CLI 模式：直接运行
if (require.main === module) {
  const args = process.argv.slice(2);
  let loginMode = false;
  let maxScrolls = config.scroll.maxScrolls;
  let outputDir = config.tweetsDir;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--login") loginMode = true;
    if (args[i] === "--max-scrolls" && args[i + 1]) maxScrolls = parseInt(args[++i]);
    if (args[i] === "--output-dir" && args[i + 1]) outputDir = args[++i];
  }

  (async () => {
    const { getBrowser, closeBrowser } = require("./browser");
    const browser = await getBrowser();
    const page = browser.pages()[0] || (await browser.newPage());

    if (loginMode) {
      log("Login mode: please log in to X in the browser window.");
      log("After logging in, close the browser to save the session.");
      await page.goto("https://x.com/login", { waitUntil: "domcontentloaded" });
      await new Promise((resolve) => browser.on("close", resolve));
      log("Browser closed. Session saved.");
      return;
    }

    try {
      await navigateToTimeline(page);
      const result = await collectTweets(page, { maxScrolls });
      const filepath = saveTweets(result.tweets, outputDir);

      console.log("\n========== Summary ==========");
      console.log(`Total tweets: ${result.tweets.length}`);
      console.log(`Newest: ${result.newestTime}`);
      console.log(`Oldest: ${result.oldestTime}`);
      console.log(`File: ${path.resolve(filepath)}`);
      console.log("=============================\n");
    } catch (err) {
      console.error("Error:", err);
    } finally {
      await closeBrowser();
    }
  })();
}
