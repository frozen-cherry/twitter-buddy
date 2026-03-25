/**
 * 单例浏览器管理器
 *
 * 所有浏览器任务共享同一个 Chrome 实例，避免反复启动/关闭。
 * 用户可以看到并操作浏览器窗口（解验证码、手动导航等）。
 */

const { chromium } = require("playwright");
const config = require("./config");

let _browser = null;

/**
 * 获取或创建浏览器实例
 */
async function getBrowser() {
  if (_browser) {
    try {
      _browser.pages(); // liveness check
      return _browser;
    } catch {
      _browser = null;
    }
  }

  _browser = await chromium.launchPersistentContext(
    config.chromeDataDir,
    {
      channel: "chrome",
      headless: false,
      viewport: { width: 1280, height: 800 },
      ignoreDefaultArgs: ["--enable-automation"],
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-first-run",
        "--no-default-browser-check",
      ],
    }
  );

  await _browser.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  _browser.on("close", () => { _browser = null; });

  return _browser;
}

/**
 * 获取第一个 tab（关闭多余 tab）
 */
async function getPage() {
  const browser = await getBrowser();
  const pages = browser.pages();
  // 关闭多余 tab
  for (let i = 1; i < pages.length; i++) {
    await pages[i].close().catch(() => {});
  }
  return pages[0] || await browser.newPage();
}

/**
 * 关闭浏览器（仅进程退出时使用）
 */
async function closeBrowser() {
  if (_browser) {
    try {
      await _browser.close();
    } catch {}
    _browser = null;
  }
}

/**
 * 浏览器是否存活
 */
function isBrowserAlive() {
  if (!_browser) return false;
  try {
    _browser.pages();
    return true;
  } catch {
    _browser = null;
    return false;
  }
}

module.exports = { getBrowser, getPage, closeBrowser, isBrowserAlive };
