const { spawn } = require("child_process");

/**
 * 调用本地 `claude -p` (Claude Code headless) 完成一次单轮推理。
 * Prompt 通过 stdin 写入，避免命令行长度限制（Windows 上 ~8K）。
 *
 * @param {string} prompt 完整 prompt 文本
 * @param {object} options
 * @param {string} [options.model] 模型名（如 "claude-opus-4-6"），透传给 `--model`
 * @returns {Promise<string>} 模型输出的纯文本（已 trim）
 */
function callClaude(prompt, { model } = {}) {
  return new Promise((resolve, reject) => {
    const args = ["-p", "--output-format", "text"];
    if (model) args.push("--model", model);

    const child = spawn("claude", args, {
      // Windows 需要 shell 才能解析 claude.cmd
      shell: process.platform === "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stdout = [];
    const stderr = [];

    child.stdout.on("data", chunk => stdout.push(chunk));
    child.stderr.on("data", chunk => stderr.push(chunk));

    child.on("error", err => reject(err));
    child.on("close", code => {
      if (code !== 0) {
        const errText = Buffer.concat(stderr).toString("utf-8").trim();
        reject(new Error(`claude CLI exited with code ${code}: ${errText || "(no stderr)"}`));
        return;
      }
      resolve(Buffer.concat(stdout).toString("utf-8").trim());
    });

    child.stdin.end(prompt, "utf-8");
  });
}

module.exports = { callClaude };
