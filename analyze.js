const fs = require("fs");
const path = require("path");
const config = require("./config");
const { callClaude } = require("./claude-cli");

function log(msg) {
  const ts = new Date().toLocaleTimeString();
  console.log(`[${ts}] [analyze] ${msg}`);
}

/**
 * 读取指定时间范围内的推文
 */
function loadTweetsSince(hoursAgo) {
  const cutoff = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  const tweetsDir = config.tweetsDir;

  if (!fs.existsSync(tweetsDir)) return [];

  const files = fs.readdirSync(tweetsDir)
    .filter(f => f.endsWith(".json"))
    .sort()
    .reverse();

  const allTweets = new Map();

  for (const file of files) {
    // 按天文件：tweets_YYYY-MM-DD.json，检查日期是否在范围内
    const dayMatch = file.match(/tweets_(\d{4}-\d{2}-\d{2})\.json/);
    if (dayMatch) {
      const fileDate = new Date(dayMatch[1] + "T23:59:59Z");
      if (fileDate < new Date(cutoff.getTime() - 8 * 3600000)) continue;
    }
    // 兼容旧格式：timeline_YYYY-MM-DD-HH-MM.json
    const oldMatch = file.match(/timeline_(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})\.json/);
    if (oldMatch) {
      const fileTime = new Date(`${oldMatch[1]}-${oldMatch[2]}-${oldMatch[3]}T${oldMatch[4]}:${oldMatch[5]}:00Z`);
      if (fileTime < new Date(cutoff.getTime() - 2 * 60 * 60 * 1000)) continue;
    }

    try {
      const tweets = JSON.parse(fs.readFileSync(path.join(tweetsDir, file), "utf-8"));
      for (const tweet of tweets) {
        if (new Date(tweet.time) >= cutoff) {
          const key = tweet.time + "|" + tweet.link;
          if (!allTweets.has(key)) allTweets.set(key, tweet);
        }
      }
    } catch {}
  }

  return Array.from(allTweets.values()).sort((a, b) => b.time.localeCompare(a.time));
}

/**
 * 构建分析用的推文摘要（减少 token 用量）
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
 * 运行 LLM 分析
 */
async function runAnalysis(hoursAgo, model) {
  hoursAgo = hoursAgo || config.analysis.analysisHours;
  const useModel = model || config.analysis.model;

  log(`Loading tweets from last ${hoursAgo} hours ...`);
  const tweets = loadTweetsSince(hoursAgo);

  if (tweets.length === 0) {
    log("No tweets found for analysis.");
    return null;
  }

  log(`Found ${tweets.length} tweets for analysis.`);

  const tweetSummary = buildTweetSummary(tweets);

  log(`Calling claude CLI (${useModel}) ...`);

  const userContent = `${config.analysis.prompt}\n\n---\n\n以下是最近 ${hoursAgo} 小时的 ${tweets.length} 条推文：\n\n${tweetSummary}`;
  const analysisText = await callClaude(userContent, { model: useModel });

  // 保存分析结果
  fs.mkdirSync(config.analysisDir, { recursive: true });
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const timestamp = now.toISOString().slice(0, 16).replace(/[T:]/g, "-");
  const filename = `analysis_${timestamp}.md`;
  const filepath = path.join(config.analysisDir, filename);

  const fmtTime = (iso) => {
    if (!iso) return "N/A";
    const d = new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 19).replace("T", " ");
  };
  const header = `# 时间线分析报告\n\n- 时间：${fmtTime(new Date().toISOString())} (UTC+8)\n- 推文数量：${tweets.length}\n- 时间范围：${fmtTime(tweets[tweets.length - 1]?.time)} ~ ${fmtTime(tweets[0]?.time)}\n\n---\n\n`;
  fs.writeFileSync(filepath, header + analysisText, "utf-8");

  log(`Analysis saved to ${filepath}`);
  console.log("\n" + analysisText + "\n");

  return { filepath, analysis: analysisText, tweetCount: tweets.length };
}

// 导出
module.exports = { runAnalysis, loadTweetsSince, buildTweetSummary };

// CLI 模式
if (require.main === module) {
  const args = process.argv.slice(2);
  let hours = config.analysis.analysisHours;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--hours" && args[i + 1]) hours = parseFloat(args[++i]);
  }
  runAnalysis(hours).catch(console.error);
}
