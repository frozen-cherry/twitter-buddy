/**
 * Daemon 模式 — 启动 Dashboard + 自动开启定时采集和发现
 *
 * 等价于 `npm run dashboard` 然后手动打开两个开关。
 */

const { startAutoCollect, startAutoDiscover } = require("./scheduler");
const { closeBrowser } = require("./browser");

function log(msg) {
  const ts = new Date().toLocaleTimeString();
  console.log(`[${ts}] ${msg}`);
}

async function main() {
  log("========================================");
  log("  Twitter Buddy — Daemon Mode");
  log("========================================");

  // 启动 Dashboard
  const { startDashboard } = require("./server");
  startDashboard();

  // 自动开启定时器
  startAutoCollect();
  startAutoDiscover();
  log("Auto-collect and auto-discover enabled");

  // 优雅退出
  process.on("SIGINT", async () => {
    log("\nShutting down...");
    await closeBrowser();
    log("Goodbye.");
    process.exit(0);
  });
}

main();
