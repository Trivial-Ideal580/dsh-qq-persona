/**
 * 用无头 Edge 真正点一遍「新建 → 填写 → 保存」，抓前端的报错。
 * 需要工作台已经在一个端口上运行。
 *
 *   node scripts/ui-save-smoke.mjs --port 7794
 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.argv[process.argv.indexOf('--port') + 1]) || 7794;
const URL_TARGET = `http://127.0.0.1:${PORT}/#personas`;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const TMP = join(ROOT, '.tmp', 'ui-smoke');
const DBG_PORT = 9333;

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

const browser = spawn(
  EDGE,
  ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${DBG_PORT}`, `--user-data-dir=${TMP}`, URL_TARGET],
  { stdio: 'ignore', windowsHide: true },
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function findTarget() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${DBG_PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page' && t.url.includes(`:${PORT}/`));
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      // 还没起来
    }
    await sleep(250);
  }
  throw new Error('找不到浏览器调试目标');
}

const target = await findTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.once('open', resolve);
  ws.once('error', reject);
});

let id = 0;
const pending = new Map();
const events = [];
ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method) {
    events.push(msg);
  }
});

function send(method, params = {}) {
  return new Promise((resolve) => {
    const current = ++id;
    pending.set(current, resolve);
    ws.send(JSON.stringify({ id: current, method, params }));
  });
}

await send('Runtime.enable');
await send('Page.enable');

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.result?.exceptionDetails) {
    return { error: result.result.exceptionDetails.exception?.description ?? JSON.stringify(result.result.exceptionDetails) };
  }
  return { value: result.result?.result?.value };
}

// 等页面把状态拉回来
for (let i = 0; i < 60; i += 1) {
  const probe = await evaluate("document.querySelectorAll('#persona-list .persona-item').length");
  if (probe.value > 0) break;
  await sleep(250);
}

const result = await evaluate(`(async () => {
  const log = [];
  const $$ = (s) => document.querySelectorAll(s);
  document.getElementById('btn-new-persona').click();
  await new Promise((r) => setTimeout(r, 100));
  const setVal = (id, value) => {
    const el = document.getElementById(id);
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  setVal('f-id', '');
  setVal('f-name', '小夏测试');
  setVal('f-identity', '');
  await new Promise((r) => setTimeout(r, 100));
  document.getElementById('btn-save').click();
  await new Promise((r) => setTimeout(r, 2000));
  const first = {
    toast: document.getElementById('toast').textContent,
    editorTitle: document.getElementById('editor-title').textContent,
    hasItem: [...$$('#persona-list .persona-item')].some((n) => n.textContent.includes('小夏测试')),
  };

  // 再选中刚保存的中文人设，改个名字重新保存（验证中文 id 的 PUT 路径）
  const item = [...$$('#persona-list .persona-item')].find((n) => n.textContent.includes('小夏测试'));
  item.click();
  await new Promise((r) => setTimeout(r, 800));
  const selectedTitle = document.getElementById('editor-title').textContent;
  setVal('f-name', '小夏测试2');
  document.getElementById('btn-save').click();
  await new Promise((r) => setTimeout(r, 1800));

  return {
    ...first,
    selectedTitle,
    secondToast: document.getElementById('toast').textContent,
    finalTitle: document.getElementById('editor-title').textContent,
    listCount: $$('#persona-list .persona-item').length,
    hasRenamed: [...$$('#persona-list .persona-item')].some((n) => n.textContent.includes('小夏测试2')),
  };
})()`);

const errors = events
  .filter((e) => e.method === 'Runtime.exceptionThrown' || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'))
  .map((e) => e.params.exceptionDetails?.exception?.description ?? e.params.args?.map((a) => a.value ?? a.description).join(' '));

console.log('保存结果：', JSON.stringify(result.value ?? result, null, 2));
console.log('页面报错：', errors.length ? errors : '（无）');

ws.close();
browser.kill();
await sleep(800);
try {
  rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
} catch {
  // 浏览器可能还占着 user-data-dir，下次再清
}

if (!result.value?.hasRenamed) process.exitCode = 1;
