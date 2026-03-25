/**
 * 定时调度器
 *
 * 管理两个独立定时器（autoCollect / autoDiscover），
 * 定时往任务队列里塞任务。由 dashboard 开关控制。
 */

const fs = require("fs");
const config = require("./config");
const { navigateToTimeline, collectTweets, saveTweets, setLogger, clearLogger } = require("./collect-timeline");
const { getBrowser } = require("./browser");
const taskQueue = require("./task-queue");

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// ========== State 管理（供采集用） ==========

function loadState() {
  try {
    if (fs.existsSync(config.stateFile)) {
      return JSON.parse(fs.readFileSync(config.stateFile, "utf-8"));
    }
  } catch {}
  return {
    lastNewestTweet: null,
    lastCollectionTime: null,
    lastAnalysisTime: null,
    lastDiscoverTime: null,
    totalCollected: 0,
    gaps: [],
  };
}

function saveState(state) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(config.stateFile, JSON.stringify(state, null, 2), "utf-8");
}

// ========== Auto Collect ==========

let _collectTimer = null;
let _collectEnabled = false;
let _collectNextRunAt = null;

function scheduleNextCollect() {
  if (!_collectEnabled) return;
  const waitMs = rand(config.daemon.intervalMin, config.daemon.intervalMax);
  _collectNextRunAt = new Date(Date.now() + waitMs).toISOString();
  _collectTimer = setTimeout(() => runAutoCollect(), waitMs);
}

async function runAutoCollect() {
  _collectTimer = null;
  _collectNextRunAt = null;
  if (!_collectEnabled) return;

  const state = loadState();

  taskQueue.enqueue(
    { type: "browser", operation: "collection", label: "Auto collect timeline" },
    async ({ log: taskLog }) => {
      setLogger(taskLog);
      try {
        taskLog("=== Starting collection cycle ===");

        const browser = await getBrowser();
        const page = browser.pages()[0] || (await browser.newPage());

        await navigateToTimeline(page);

        const result = await collectTweets(page, {
          stopAtTimestamp: state.lastNewestTweet,
        });

        if (result.tweets.length === 0) {
          taskLog("No tweets collected this cycle.");
          return { tweetCount: 0 };
        }

        saveTweets(result.tweets, config.tweetsDir);

        // 缺口检测
        if (state.lastNewestTweet && !result.reachedTarget) {
          const gap = {
            from: state.lastNewestTweet,
            to: result.oldestTime,
            detectedAt: new Date().toISOString(),
          };
          state.gaps.push(gap);
          taskLog(`GAP DETECTED: ${gap.from} ~ ${gap.to}`);
        }

        state.lastNewestTweet = result.newestTime;
        state.lastCollectionTime = new Date().toISOString();
        state.totalCollected += result.tweets.length;
        saveState(state);

        taskLog(`Cycle complete: ${result.tweets.length} new tweets (total: ${state.totalCollected})`);

        // 检查是否触发自动分析
        const lastAnalysis = state.lastAnalysisTime ? new Date(state.lastAnalysisTime).getTime() : 0;
        if (Date.now() - lastAnalysis >= config.daemon.analysisIntervalMs) {
          taskQueue.enqueue(
            { type: "analysis", operation: "analyze", label: "Auto timeline analysis (2h)" },
            async ({ log: aLog }) => {
              const { runAnalysis } = require("./analyze");
              aLog("Starting analysis...");
              const aResult = await runAnalysis();
              const s = loadState();
              s.lastAnalysisTime = new Date().toISOString();
              saveState(s);
              aLog("Analysis complete");
              return aResult;
            }
          );
        }

        return { tweetCount: result.tweets.length };
      } finally {
        clearLogger();
        // 采集完成后调度下一次
        scheduleNextCollect();
      }
    }
  );
}

function startAutoCollect() {
  if (_collectEnabled) return;
  _collectEnabled = true;
  scheduleNextCollect();
}

function stopAutoCollect() {
  _collectEnabled = false;
  if (_collectTimer) {
    clearTimeout(_collectTimer);
    _collectTimer = null;
  }
  _collectNextRunAt = null;
}

// ========== Auto Discover ==========

let _discoverTimer = null;
let _discoverEnabled = false;
let _discoverNextRunAt = null;

function scheduleNextDiscover() {
  if (!_discoverEnabled) return;
  const waitMs = config.discover.intervalMs;
  _discoverNextRunAt = new Date(Date.now() + waitMs).toISOString();
  _discoverTimer = setTimeout(() => runAutoDiscover(), waitMs);
}

async function runAutoDiscover() {
  _discoverTimer = null;
  _discoverNextRunAt = null;
  if (!_discoverEnabled) return;

  taskQueue.enqueue(
    { type: "browser", operation: "discover", label: "Auto account discovery" },
    async ({ log: taskLog }) => {
      setLogger(taskLog);
      try {
        taskLog("Starting account discovery...");
        const { runDiscover } = require("./discover");
        const result = await runDiscover();
        const state = loadState();
        state.lastDiscoverTime = new Date().toISOString();
        saveState(state);
        taskLog("Discovery complete");
        return result;
      } finally {
        clearLogger();
        // 发现完成后调度下一次
        scheduleNextDiscover();
      }
    }
  );
}

function startAutoDiscover() {
  if (_discoverEnabled) return;
  _discoverEnabled = true;
  scheduleNextDiscover();
}

function stopAutoDiscover() {
  _discoverEnabled = false;
  if (_discoverTimer) {
    clearTimeout(_discoverTimer);
    _discoverTimer = null;
  }
  _discoverNextRunAt = null;
}

// ========== Status ==========

function getSchedulerStatus() {
  return {
    collect: {
      enabled: _collectEnabled,
      nextRunAt: _collectNextRunAt,
    },
    discover: {
      enabled: _discoverEnabled,
      nextRunAt: _discoverNextRunAt,
    },
  };
}

module.exports = {
  startAutoCollect, stopAutoCollect,
  startAutoDiscover, stopAutoDiscover,
  getSchedulerStatus,
  loadState, saveState,
};
