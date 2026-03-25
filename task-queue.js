/**
 * 任务队列管理器
 *
 * - browser 任务：串行队列，一次只执行一个（共享 Chrome profile）
 * - analysis 任务：立即执行，不排队，可与浏览器任务并行
 *
 * 所有任务都在面板中显示状态和日志。
 */

const config = require("./config");

let _nextId = 1;
const _browserQueue = [];       // 等待中的 browser 任务
let _currentBrowserTask = null; // 当前正在执行的 browser 任务
const _runningAnalyses = [];    // 正在执行的 analysis 任务
const _completedTasks = [];     // 已完成任务（最近 N 个）

const MAX_COMPLETED = config.tasks?.maxCompletedTasks || 20;
const MAX_LOGS = config.tasks?.maxLogsPerTask || 500;

function makeTask(def) {
  return {
    id: "task_" + Date.now() + "_" + (_nextId++),
    type: def.type,          // "browser" | "analysis"
    operation: def.operation, // "collection" | "discover" | "profile-scrape" | "analyze" | "profile-analyze"
    label: def.label,
    status: "queued",
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    logs: [],
    result: null,
    error: null,
  };
}

function createLogger(task) {
  return function log(msg) {
    const entry = { time: new Date().toISOString(), message: String(msg) };
    task.logs.push(entry);
    if (task.logs.length > MAX_LOGS) {
      task.logs = task.logs.slice(-MAX_LOGS);
    }
    // Also forward to console with task prefix
    console.log(`[${task.operation}] ${msg}`);
  };
}

function archiveTask(task) {
  _completedTasks.unshift(task);
  if (_completedTasks.length > MAX_COMPLETED) {
    _completedTasks.length = MAX_COMPLETED;
  }
}

async function executeBrowserTask(task, executorFn) {
  _currentBrowserTask = task;
  task.status = "running";
  task.startedAt = new Date().toISOString();
  const log = createLogger(task);

  try {
    const result = await executorFn({ log });
    task.status = "completed";
    task.result = result || null;
  } catch (err) {
    task.status = "failed";
    task.error = err.message;
    log(`ERROR: ${err.message}`);
  } finally {
    task.completedAt = new Date().toISOString();
    _currentBrowserTask = null;
    archiveTask(task);
    // Process next in queue
    processNextBrowser();
  }
}

function processNextBrowser() {
  if (_currentBrowserTask) return; // busy
  if (_browserQueue.length === 0) return; // nothing to do
  const next = _browserQueue.shift();
  executeBrowserTask(next.task, next.executorFn);
}

async function executeAnalysisTask(task, executorFn) {
  _runningAnalyses.push(task);
  task.status = "running";
  task.startedAt = new Date().toISOString();
  const log = createLogger(task);

  try {
    const result = await executorFn({ log });
    task.status = "completed";
    task.result = result || null;
  } catch (err) {
    task.status = "failed";
    task.error = err.message;
    log(`ERROR: ${err.message}`);
  } finally {
    task.completedAt = new Date().toISOString();
    const idx = _runningAnalyses.indexOf(task);
    if (idx >= 0) _runningAnalyses.splice(idx, 1);
    archiveTask(task);
  }
}

/**
 * Enqueue a task.
 *
 * @param {Object} def - { type, operation, label }
 * @param {Function} executorFn - async ({ log }) => result
 * @returns {{ task, promise }} - task object + promise that resolves when done
 */
function enqueue(def, executorFn) {
  const task = makeTask(def);

  let promise;

  if (def.type === "browser") {
    promise = new Promise((resolve) => {
      const wrappedExecutor = async (ctx) => {
        try {
          const result = await executorFn(ctx);
          resolve({ task, result });
          return result;
        } catch (err) {
          resolve({ task, error: err.message });
          throw err;
        }
      };

      if (!_currentBrowserTask) {
        // Execute immediately
        executeBrowserTask(task, wrappedExecutor);
      } else {
        // Queue it
        _browserQueue.push({ task, executorFn: wrappedExecutor });
      }
    });
  } else {
    // analysis - execute immediately
    promise = new Promise((resolve) => {
      const wrappedExecutor = async (ctx) => {
        try {
          const result = await executorFn(ctx);
          resolve({ task, result });
          return result;
        } catch (err) {
          resolve({ task, error: err.message });
          throw err;
        }
      };
      executeAnalysisTask(task, wrappedExecutor);
    });
  }

  return { task, promise };
}

/**
 * Get all tasks: running + queued + recently completed
 */
function getAll() {
  const tasks = [];

  // Current browser task
  if (_currentBrowserTask) tasks.push(_currentBrowserTask);

  // Running analyses
  for (const t of _runningAnalyses) tasks.push(t);

  // Queued browser tasks
  for (const q of _browserQueue) tasks.push(q.task);

  // Recently completed
  for (const t of _completedTasks) tasks.push(t);

  return tasks;
}

/**
 * Get a single task by ID
 */
function getTask(id) {
  if (_currentBrowserTask && _currentBrowserTask.id === id) return _currentBrowserTask;
  for (const t of _runningAnalyses) if (t.id === id) return t;
  for (const q of _browserQueue) if (q.task.id === id) return q.task;
  for (const t of _completedTasks) if (t.id === id) return t;
  return null;
}

/**
 * Get summary for top bar status
 */
function getStatus() {
  return {
    browserBusy: !!_currentBrowserTask,
    currentOperation: _currentBrowserTask ? _currentBrowserTask.operation : null,
    currentLabel: _currentBrowserTask ? _currentBrowserTask.label : null,
    currentStartedAt: _currentBrowserTask ? _currentBrowserTask.startedAt : null,
    queuedCount: _browserQueue.length,
    runningAnalyses: _runningAnalyses.length,
  };
}

module.exports = { enqueue, getAll, getTask, getStatus };
