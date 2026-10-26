/* QQ 人设工作台 —— 前端（无构建、无依赖） */

const $ = (id) => document.getElementById(id);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const DEFAULT_PERSONA = {
  id: '',
  name: '',
  enabled: true,
  identity: '',
  relationship: '',
  background: '',
  personality: [],
  personalityDetail: '',
  style: {
    tone: '随口的、有点懒的语气，像深夜发微信',
    length: 'short',
    sentence: '多用短句，一句一行',
    particles: ['啊', '吧', '嘛'],
    catchphrases: [],
    emojiRate: 0.2,
    punctuation: '经常不加句号',
    typos: '',
    avoid: ['书面语', '长篇大论', '说教', '客服腔'],
  },
  taboos: ['不承认自己是 AI 或机器人', '不聊政治，不评价现实中的具体人物'],
  examples: [],
  reply: { maxBubbles: 2, maxCharsPerBubble: 40 },
};

const state = {
  data: null,
  byId: new Map(),
  currentId: null,
  isNew: false,
  dirty: false,
  cursor: 0,
  logLines: 0,
};

// ── 基础工具 ─────────────────────────────────────────
async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = { ok: false, error: `HTTP ${response.status}` };
  }
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

let toastTimer;
function toast(message, type = 'ok') {
  const node = $('toast');
  node.textContent = message;
  node.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(
    () => {
      node.className = 'toast hidden';
    },
    type === 'error' ? 6500 : 3200,
  );
}

function openModal(title, body) {
  $('modal-title').textContent = title;
  $('modal-body').textContent = body;
  $('modal').classList.remove('hidden');
}

function closeModal() {
  $('modal').classList.add('hidden');
}

function formatDuration(seconds) {
  if (!seconds || seconds < 1) return '0s';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

// ── 标签页 ───────────────────────────────────────────
function activateTab(name) {
  const target = ['dashboard', 'personas', 'settings'].includes(name) ? name : 'dashboard';
  $$('.tab').forEach((item) => item.classList.toggle('active', item.dataset.tab === target));
  $$('.view').forEach((view) => view.classList.toggle('active', view.id === `tab-${target}`));
}

$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    activateTab(tab.dataset.tab);
    history.replaceState(null, '', `#${tab.dataset.tab}`);
  });
});

// 支持 /#personas 这种直接打开某个页签
activateTab((location.hash || '').replace('#', ''));

// ── chips 输入 ───────────────────────────────────────
function setupChips(root) {
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = '输入后回车';
  root.appendChild(input);

  const values = () => $$('.chip', root).map((chip) => chip.dataset.value);
  const make = (value) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.dataset.value = value;
    const text = document.createElement('span');
    text.textContent = value;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      chip.remove();
      markDirty();
    });
    chip.append(text, remove);
    return chip;
  };

  function add(raw) {
    const value = String(raw).trim();
    if (!value) return;
    if (values().includes(value)) {
      input.value = '';
      return;
    }
    root.insertBefore(make(value), input);
    input.value = '';
    markDirty();
  }

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ',' || event.key === '，') {
      event.preventDefault();
      add(input.value);
    } else if (event.key === 'Backspace' && input.value === '') {
      const chips = $$('.chip', root);
      const last = chips[chips.length - 1];
      if (last) {
        last.remove();
        markDirty();
      }
    }
  });
  input.addEventListener('blur', () => {
    if (input.value.trim()) add(input.value);
  });

  root.__get = values;
  root.__set = (list) => {
    $$('.chip', root).forEach((chip) => chip.remove());
    (list ?? []).forEach((value) => root.insertBefore(make(String(value)), input));
  };
}

['f-personality', 'f-particles', 'f-catchphrases', 'f-avoid', 's-keywords'].forEach((id) => {
  const node = $(id);
  if (node) setupChips(node);
});

// ── 示例对话 ─────────────────────────────────────────
function addExampleRow(data = { user: '', assistant: '' }) {
  const row = document.createElement('div');
  row.className = 'example-row';

  const user = document.createElement('input');
  user.className = 'input ex-user';
  user.placeholder = '对方说…';
  user.value = data.user;

  const assistant = document.createElement('textarea');
  assistant.className = 'input ex-assistant';
  assistant.placeholder = '它回什么（一行一条，可多行）';
  assistant.value = data.assistant;

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'icon-btn';
  remove.textContent = '×';
  remove.title = '删除这组';
  remove.addEventListener('click', () => {
    row.remove();
    markDirty();
  });

  row.append(user, assistant, remove);
  $('f-examples').appendChild(row);
}

$('btn-add-example').addEventListener('click', () => {
  addExampleRow();
  markDirty();
});

// ── 编辑器：读取 / 填充 ──────────────────────────────
function readForm() {
  const examples = $$('#f-examples .example-row').map((row) => ({
    user: row.querySelector('.ex-user').value.trim(),
    assistant: row
      .querySelector('.ex-assistant')
      .value.split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  }));

  return {
    id: $('f-id').value.trim(),
    name: $('f-name').value.trim(),
    enabled: $('f-enabled').checked,
    identity: $('f-identity').value.trim(),
    relationship: $('f-relationship').value.trim(),
    background: $('f-background').value.trim(),
    personality: $('f-personality').__get(),
    personalityDetail: $('f-personalityDetail').value.trim(),
    style: {
      tone: $('f-tone').value.trim(),
      length: $('f-length').value,
      sentence: $('f-sentence').value.trim(),
      particles: $('f-particles').__get(),
      catchphrases: $('f-catchphrases').__get(),
      emojiRate: Number($('f-emojiRate').value),
      punctuation: $('f-punctuation').value.trim(),
      typos: $('f-typos').value.trim(),
      avoid: $('f-avoid').__get(),
    },
    taboos: $('f-taboos')
      .value.split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
    examples: examples.filter((example) => example.user && example.assistant.length > 0),
    reply: {
      maxBubbles: Number($('f-maxBubbles').value) || 2,
      maxCharsPerBubble: Number($('f-maxChars').value) || 40,
    },
  };
}

function fillForm(persona) {
  $('f-id').value = persona.id ?? '';
  $('f-id').disabled = !state.isNew;
  $('f-name').value = persona.name ?? '';
  $('f-enabled').checked = persona.enabled !== false;
  $('f-identity').value = persona.identity ?? '';
  $('f-relationship').value = persona.relationship ?? '';
  $('f-background').value = persona.background ?? '';
  $('f-personality').__set(persona.personality ?? []);
  $('f-personalityDetail').value = persona.personalityDetail ?? '';
  $('f-tone').value = persona.style?.tone ?? '';
  $('f-length').value = persona.style?.length ?? 'short';
  $('f-sentence').value = persona.style?.sentence ?? '';
  $('f-particles').__set(persona.style?.particles ?? []);
  $('f-catchphrases').__set(persona.style?.catchphrases ?? []);
  $('f-emojiRate').value = String(persona.style?.emojiRate ?? 0.2);
  $('f-emoji-label').textContent = `${Math.round((persona.style?.emojiRate ?? 0.2) * 100)}%`;
  $('f-punctuation').value = persona.style?.punctuation ?? '';
  $('f-typos').value = persona.style?.typos ?? '';
  $('f-avoid').__set(persona.style?.avoid ?? []);
  $('f-taboos').value = (persona.taboos ?? []).join('\n');
  $('f-maxBubbles').value = persona.reply?.maxBubbles ?? 2;
  $('f-maxChars').value = persona.reply?.maxCharsPerBubble ?? 40;

  $('f-examples').innerHTML = '';
  const examples = (persona.examples ?? []).map((example) => ({
    user: example.user,
    assistant: (example.assistant ?? []).join('\n'),
  }));
  (examples.length > 0 ? examples : [{}]).forEach((example) => addExampleRow(example));

  $('editor-title').textContent = state.isNew ? '新建人设' : `${persona.name}（${persona.id}）`;
  const meta = state.byId.get(persona.id);
  $('editor-sub').textContent = state.isNew
    ? '填完点右下角保存，会写进 ~/.dsh/qq-persona/personas/'
    : meta?.builtin
      ? '内置人设 · 保存会生成一份可编辑副本'
      : '自定义人设 · 保存在 ~/.dsh/qq-persona/personas/';
  $('editor-sub').title = meta?.file ?? '';

  $('btn-delete').disabled = state.isNew || !meta || meta.builtin;
  $('btn-delete').title = meta?.builtin ? '内置人设不能删除，可以“另存为”副本' : '';
  $('btn-raw').disabled = state.isNew;
  $('btn-default').disabled = state.isNew;
  editorError = '';
  setDirty(false);
}

function markDirty() {
  if (state.isNew || state.currentId) {
    setEditorError('');
    setDirty(true);
  }
}

function setDirty(value) {
  state.dirty = value;
  renderEditorStatus();
}

// 保存失败时把原因直接显示在保存按钮旁边，不只在右下角弹一下
let editorError = '';
function setEditorError(message) {
  editorError = message || '';
  renderEditorStatus();
}

function renderEditorStatus() {
  const node = $('editor-status');
  if (editorError) {
    node.textContent = `✕ ${editorError}`;
    node.className = 'editor-status err small';
    return;
  }
  node.textContent = state.dirty ? '● 有未保存的修改' : '';
  node.className = 'muted small';
}

// ── 人设列表 ─────────────────────────────────────────
function renderPersonaList(filter = '') {
  const container = $('persona-list');
  container.innerHTML = '';
  const keyword = filter.trim().toLowerCase();
  const personas = (state.data?.personas ?? []).filter((persona) => {
    if (!keyword) return true;
    return persona.id.toLowerCase().includes(keyword) || persona.name.toLowerCase().includes(keyword);
  });

  for (const persona of personas) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `persona-item${persona.id === state.currentId ? ' active' : ''}`;

    const name = document.createElement('div');
    name.className = 'pi-name';
    const label = document.createElement('span');
    label.textContent = persona.name;
    name.appendChild(label);
    if (persona.builtin) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = '内置';
      name.appendChild(badge);
    }
    if (persona.id === state.data?.defaultPersonaId) {
      const badge = document.createElement('span');
      badge.className = 'badge accent';
      badge.textContent = '默认';
      name.appendChild(badge);
    }

    const sub = document.createElement('div');
    sub.className = 'pi-sub';
    sub.textContent = persona.identity || persona.id;

    button.append(name, sub);
    button.addEventListener('click', () => selectPersona(persona.id));
    container.appendChild(button);
  }

  if (personas.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted small';
    empty.textContent = '没有匹配的人设';
    container.appendChild(empty);
  }
}

async function selectPersona(id) {
  if (state.dirty && !window.confirm('当前有未保存的修改，确定切换吗？')) return;
  try {
    const { persona } = await api(`/api/personas/${encodeURIComponent(id)}`);
    state.currentId = id;
    state.isNew = false;
    fillForm(persona);
    renderPersonaList($('persona-search').value);
  } catch (error) {
    toast(error.message, 'error');
  }
}

function newPersona() {
  if (state.dirty && !window.confirm('当前有未保存的修改，确定新建吗？')) return;
  state.currentId = null;
  state.isNew = true;
  fillForm(JSON.parse(JSON.stringify(DEFAULT_PERSONA)));
  renderPersonaList($('persona-search').value);
  $('f-id').focus();
}

$('btn-new-persona').addEventListener('click', newPersona);
$('persona-search').addEventListener('input', (event) => renderPersonaList(event.target.value));
$('f-emojiRate').addEventListener('input', (event) => {
  $('f-emoji-label').textContent = `${Math.round(Number(event.target.value) * 100)}%`;
});

// ── 保存 / 删除 / 预览 ───────────────────────────────
$('btn-save').addEventListener('click', async () => {
  const persona = readForm();
  if (!persona.name) {
    setEditorError('先填个名字');
    return toast('先填个名字', 'error');
  }

  const button = $('btn-save');
  const original = button.textContent;
  button.disabled = true;
  button.textContent = '保存中…';
  setEditorError('');

  try {
    const path = state.isNew ? '/api/personas' : `/api/personas/${encodeURIComponent(persona.id)}`;
    const method = state.isNew ? 'POST' : 'PUT';
    const result = await api(path, { method, body: { persona } });
    state.isNew = false;
    state.currentId = result.persona.id;
    state.dirty = false;
    // 清掉搜索过滤，否则新人设可能被过滤掉、看起来“没保存”
    $('persona-search').value = '';
    await refreshState();
    fillForm(result.persona);
    renderPersonaList('');
    toast(`已保存「${result.persona.name}」，重启机器人后生效`);
  } catch (error) {
    setEditorError(error.message);
    toast(`保存失败：${error.message}`, 'error');
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
});

$('btn-delete').addEventListener('click', async () => {
  if (!state.currentId) return;
  if (!window.confirm(`删除人设「${state.currentId}」？这个操作不可撤销。`)) return;
  try {
    await api(`/api/personas/${encodeURIComponent(state.currentId)}`, { method: 'DELETE' });
    const removed = state.currentId;
    state.currentId = null;
    await refreshState();
    if (state.data.personas.length > 0) await selectPersona(state.data.personas[0].id);
    toast(`已删除 ${removed}`);
  } catch (error) {
    toast(error.message, 'error');
  }
});

$('btn-duplicate').addEventListener('click', async () => {
  if (!state.currentId) return toast('先保存当前人设', 'error');
  const targetId = window.prompt('新 id（英文/数字/下划线/短横线）', `${state.currentId}-copy`);
  if (!targetId) return;
  const targetName = window.prompt('新名字', `${readForm().name} 副本`);
  if (!targetName) return;
  try {
    const result = await api(`/api/personas/${encodeURIComponent(state.currentId)}/duplicate`, {
      method: 'POST',
      body: { id: targetId, name: targetName },
    });
    await refreshState();
    await selectPersona(result.persona.id);
    toast('已另存为人设副本');
  } catch (error) {
    toast(error.message, 'error');
  }
});

$('btn-preview').addEventListener('click', async () => {
  try {
    const result = await api('/api/preview', {
      method: 'POST',
      body: { persona: readForm(), scene: { scope: 'group' } },
    });
    openModal('system prompt 预览（群聊场景）', result.prompt);
  } catch (error) {
    toast(error.message, 'error');
  }
});

$('btn-raw').addEventListener('click', async () => {
  if (!state.currentId) return;
  try {
    const result = await api(`/api/personas/${encodeURIComponent(state.currentId)}/raw`);
    openModal(`${state.currentId}.yaml`, result.raw || '（文件不存在）');
  } catch (error) {
    toast(error.message, 'error');
  }
});

$('btn-default').addEventListener('click', async () => {
  if (!state.currentId) return;
  try {
    await api(`/api/personas/${encodeURIComponent(state.currentId)}/default`, { method: 'POST' });
    await refreshState();
    toast('已设为默认人设');
  } catch (error) {
    toast(error.message, 'error');
  }
});

$('modal-close').addEventListener('click', closeModal);
$('modal').addEventListener('click', (event) => {
  if (event.target === $('modal')) closeModal();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeModal();
});

// ── 设置 ─────────────────────────────────────────────
// 设置区一旦被编辑，就不再被 2.5s 的轮询覆盖
let settingsDirty = false;

$('tab-settings').addEventListener('input', () => {
  settingsDirty = true;
});
$('tab-settings').addEventListener('change', () => {
  settingsDirty = true;
});

function fillSettings() {
  const settings = state.data.settings;
  const select = $('s-personaId');
  select.innerHTML = '';
  for (const persona of state.data.personas) {
    const option = document.createElement('option');
    option.value = persona.id;
    option.textContent = `${persona.name}（${persona.id}）`;
    select.appendChild(option);
  }
  select.value = state.data.defaultPersonaId;

  $('s-requireMention').checked = settings.trigger.requireMention !== false;
  $('s-keywords').__set(settings.trigger.keywords ?? []);
  $('s-randomChance').value = String(settings.trigger.randomChance ?? 0);
  $('s-random-label').textContent = `${Math.round((settings.trigger.randomChance ?? 0) * 100)}%`;
  $('s-cooldownSec').value = settings.trigger.cooldownSec ?? 20;
  $('s-activeWindowMin').value = settings.trigger.activeWindowMin ?? 30;
  $('s-historyLimit').value = settings.trigger.historyLimit ?? 20;
  $('s-historyTtlMin').value = settings.trigger.historyTtlMin ?? 30;
  $('s-maxBubbles').value = settings.style.maxBubbles ?? 0;
  $('s-maxChars').value = settings.style.maxCharsPerBubble ?? 0;
  $('s-emojiRate').value = settings.style.emojiRate ?? -1;
  $('s-typingBaseMs').value = settings.style.typingBaseMs ?? 600;
  $('s-typingPerCharMs').value = settings.style.typingPerCharMs ?? 30;
  $('s-maxTypingMs').value = settings.style.maxTypingMs ?? 4000;
  $('s-simulateTyping').checked = settings.style.simulateTyping !== false;

  const vision = settings.vision ?? {};
  $('s-visionEnabled').checked = vision.enabled !== false;
  $('s-visionBaseUrl').value = vision.baseUrl ?? '';
  $('s-visionModel').value = vision.model ?? '';
  $('s-visionApiKey').value = '';
  const hasVisionKey = Boolean(vision.hasKey ?? vision.apiKey);
  $('vision-badge').textContent = hasVisionKey ? '已配置' : '未配置';
  $('vision-badge').className = `badge ${hasVisionKey ? 'ok' : ''}`;
  $('s-vision-key-hint').textContent = hasVisionKey ? '已保存，留空不修改' : '还没配置';
  $('s-readTextFiles').checked = settings.media?.readTextFiles !== false;

  const imagegen = settings.imagegen ?? {};
  $('s-imageEnabled').checked = imagegen.enabled !== false;
  $('s-imageBaseUrl').value = imagegen.baseUrl ?? '';
  $('s-imageModel').value = imagegen.model ?? '';
  $('s-imageSize').value = imagegen.size ?? '1024x1024';
  $('s-imageApiKey').value = '';
  const hasImageKey = Boolean(imagegen.hasKey ?? imagegen.apiKey);
  $('image-badge').textContent = hasImageKey ? '已配置' : '未配置';
  $('image-badge').className = `badge ${hasImageKey ? 'ok' : ''}`;
  $('s-image-key-hint').textContent = hasImageKey ? '已保存，留空不修改' : '还没配置';

  const credentials = state.data.credentials;
  $('s-appId').value = credentials.appId ?? '';
  $('s-appSecret').value = '';
  $('cred-badge').textContent = credentials.hasSecret ? '已配置' : '未配置';
  $('cred-badge').className = `badge ${credentials.hasSecret ? 'ok' : ''}`;
  $('s-secret-hint').textContent = credentials.hasSecret ? '已保存，留空表示不修改' : '还没填';
}

$('s-randomChance').addEventListener('input', (event) => {
  $('s-random-label').textContent = `${Math.round(Number(event.target.value) * 100)}%`;
});

$('btn-test-vision').addEventListener('click', async () => {
  const button = $('btn-test-vision');
  const label = button.textContent;
  button.disabled = true;
  button.textContent = '测试中…';
  try {
    const key = $('s-visionApiKey').value.trim();
    const result = await api('/api/vision/test', {
      method: 'POST',
      body: {
        baseUrl: $('s-visionBaseUrl').value.trim(),
        model: $('s-visionModel').value.trim(),
        ...(key ? { apiKey: key } : {}),
      },
    });
    toast(result.message, result.valid ? 'ok' : 'error');
    const badge = $('vision-badge');
    if (result.valid) {
      badge.textContent = '连通正常';
      badge.className = 'badge ok';
      if (key) toast('测试通过。别忘了点「保存并重启机器人」把 Key 存下来', 'ok');
    } else {
      badge.textContent = '测试失败';
      badge.className = 'badge';
    }
  } catch (error) {
    toast(`测试失败：${error.message}`, 'error');
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
});

function readSettings() {
  const visionKey = $('s-visionApiKey').value.trim();
  const imageKey = $('s-imageApiKey').value.trim();
  return {
    personaId: $('s-personaId').value,
    trigger: {
      requireMention: $('s-requireMention').checked,
      keywords: $('s-keywords').__get(),
      randomChance: Number($('s-randomChance').value),
      cooldownSec: Number($('s-cooldownSec').value) || 0,
      activeWindowMin: Number($('s-activeWindowMin').value) || 30,
      historyLimit: Number($('s-historyLimit').value) || 20,
      historyTtlMin: Number($('s-historyTtlMin').value) || 30,
    },
    style: {
      maxBubbles: Number($('s-maxBubbles').value) || 0,
      maxCharsPerBubble: Number($('s-maxChars').value) || 0,
      emojiRate: Number($('s-emojiRate').value),
      typingBaseMs: Number($('s-typingBaseMs').value) || 0,
      typingPerCharMs: Number($('s-typingPerCharMs').value) || 0,
      maxTypingMs: Number($('s-maxTypingMs').value) || 0,
      simulateTyping: $('s-simulateTyping').checked,
    },
    vision: {
      enabled: $('s-visionEnabled').checked,
      baseUrl: $('s-visionBaseUrl').value.trim(),
      model: $('s-visionModel').value.trim(),
      ...(visionKey ? { apiKey: visionKey } : {}),
    },
    media: {
      readTextFiles: $('s-readTextFiles').checked,
    },
    imagegen: {
      enabled: $('s-imageEnabled').checked,
      baseUrl: $('s-imageBaseUrl').value.trim(),
      model: $('s-imageModel').value.trim(),
      size: $('s-imageSize').value.trim(),
      ...(imageKey ? { apiKey: imageKey } : {}),
    },
  };
}

async function saveSettings(restart) {
  try {
    const result = await api('/api/settings', { method: 'PUT', body: { ...readSettings(), restart } });
    settingsDirty = false;
    await refreshState();
    fillSettings();
    toast(result.restarted ? '已保存并重启机器人' : '设置已保存');
  } catch (error) {
    toast(error.message, 'error');
  }
}

$('btn-save-settings').addEventListener('click', () => saveSettings(false));
$('btn-save-restart').addEventListener('click', () => saveSettings(true));

$('btn-test-credentials').addEventListener('click', async () => {
  const button = $('btn-test-credentials');
  const label = button.textContent;
  button.disabled = true;
  button.textContent = '测试中…';
  try {
    const result = await api('/api/credentials/test', {
      method: 'POST',
      body: { appId: $('s-appId').value, appSecret: $('s-appSecret').value },
    });
    const badge = $('cred-badge');
    badge.textContent = result.valid ? '凭据有效' : '凭据无效';
    badge.className = `badge ${result.valid ? 'ok' : ''}`;
    if (result.valid) startError = '';
    toast(result.message, result.valid ? 'ok' : 'error');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
});

$('btn-save-credentials').addEventListener('click', async () => {
  try {
    await api('/api/credentials', {
      method: 'PUT',
      body: { appId: $('s-appId').value, appSecret: $('s-appSecret').value },
    });
    settingsDirty = false;
    await refreshState();
    fillSettings();
    startError = '';
    toast('凭据已保存');
  } catch (error) {
    toast(error.message, 'error');
  }
});

// ── 机器人控制 ───────────────────────────────────────
// 启动失败的原因会一直显示在状态栏，直到下次启动成功
let startError = '';

async function botAction(action) {
  try {
    const result = await api(`/api/bot/${action}`, { method: 'POST' });
    if (result.error) throw new Error(result.error);
    startError = '';
    await refreshState();
    if (action === 'start') toast('正在启动，日志里能看到进度');
    if (action === 'stop') toast('已停止');
    if (action === 'restart') toast('已重启');
  } catch (error) {
    startError = error.message;
    await refreshState();
    toast(`启动失败：${error.message}`, 'error');
  }
}

$('btn-start').addEventListener('click', () => botAction('start'));
$('btn-stop').addEventListener('click', () => botAction('stop'));
$('btn-restart').addEventListener('click', () => botAction('restart'));

$('btn-cleanup').addEventListener('click', async () => {
  const button = $('btn-cleanup');
  const label = button.textContent;
  button.disabled = true;
  button.textContent = '清理中…';
  try {
    const result = await api('/api/bot/cleanup', { method: 'POST' });
    const killed = result.killed ?? [];
    toast(
      killed.length > 0
        ? `清理了 ${killed.length} 个残留进程（${killed.join(', ')}）`
        : '没有发现残留进程',
      killed.length > 0 ? 'ok' : 'ok',
    );
    await refreshState();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
});

// ── 日志 ─────────────────────────────────────────────
const LOG_PLACEHOLDER = '还没有日志。点右上角「启动机器人」，dsh 的输出会实时出现在这里。';

function showLogPlaceholder() {
  const node = $('log');
  node.textContent = LOG_PLACEHOLDER;
  node.dataset.placeholder = '1';
}

function appendLog(lines) {
  const node = $('log');
  if (node.dataset.placeholder === '1') {
    node.textContent = '';
    node.dataset.placeholder = '0';
  }
  const fragment = document.createDocumentFragment();
  for (const line of lines) {
    const span = document.createElement('span');
    let cls = '';
    if (/error|失败|Error|✖|ERR_/i.test(line)) cls = 'line-error';
    else if (/上线|ready|✔|保存|成功/.test(line)) cls = 'line-good';
    else if (line.startsWith('[工作台')) cls = 'line-dim';
    span.className = cls;
    span.textContent = `${line}\n`;
    fragment.appendChild(span);
  }
  node.appendChild(fragment);

  // 只保留最近 600 行，避免页面越跑越重
  while (node.childNodes.length > 600) node.removeChild(node.firstChild);

  if ($('log-autoscroll').checked) node.scrollTop = node.scrollHeight;
  state.logLines = node.childNodes.length;
}

async function pollLogs() {
  try {
    const result = await api(`/api/logs?cursor=${state.cursor}`);
    state.cursor = result.cursor;
    if (result.lines.length > 0) appendLog(result.lines);
  } catch {
    // 静默
  }
}

$('btn-clear-log').addEventListener('click', async () => {
  try {
    await api('/api/logs/clear', { method: 'POST' });
    $('log').textContent = '';
    state.cursor = 0;
    showLogPlaceholder();
    toast('日志已清空');
  } catch (error) {
    toast(error.message, 'error');
  }
});

// ── 状态刷新 ─────────────────────────────────────────
function renderStatus() {
  const { bot, credentials, personas, defaultPersonaId } = state.data;

  const dot = $('status-dot');
  const running = bot.running;
  const phase = bot.phase;
  const online = running && phase === 'online';
  const failed = running && (phase === 'error' || phase === 'stalled');

  dot.className = `dot ${online ? 'online' : failed ? 'error' : running ? 'starting' : ''}`;
  $('status-text').textContent = online
    ? '运行中'
    : phase === 'error'
      ? '启动失败'
      : phase === 'stalled'
        ? '启动异常'
        : phase === 'restarting'
          ? '重启中'
          : running
            ? '启动中'
            : '已停止';
  $('status-sub').textContent = online
    ? `pid ${bot.pid ?? '-'}`
    : phase === 'error'
      ? bot.lastError || '看下面的日志'
      : phase === 'stalled'
        ? '30 秒还没上线，看下面的日志'
        : phase === 'restarting'
          ? '上次异常退出，正在自动重启…'
          : running
            ? '等待机器人上线…'
            : startError
              ? startError.slice(0, 120)
              : bot.lastExit
                ? `上次退出 code=${bot.lastExit.code ?? 'null'}`
                : '点右边启动';

  $('btn-start').disabled = running;
  $('btn-stop').disabled = !running;
  $('btn-restart').disabled = !running;

  $('stat-phase').textContent = online
    ? '已上线'
    : phase === 'error'
      ? '启动失败'
      : phase === 'stalled'
        ? '启动超时'
        : running
          ? '启动中'
          : '已停止';
  $('stat-pid').textContent = running ? `pid ${bot.pid ?? '-'}` : '—';
  $('stat-uptime').textContent = formatDuration(bot.uptimeSec);
  const activePersona = personas.find((persona) => persona.id === defaultPersonaId);
  $('stat-persona').textContent = activePersona?.name ?? '—';
  $('stat-persona-sub').textContent = activePersona ? activePersona.id : '未设置';
  $('stat-count').textContent = String(personas.length);

  $('profile-line').textContent = `${state.data.profile.profile} · ${state.data.profile.profileDir}`;

  // 首次使用清单
  const missing = [];
  if (!state.data.profile.installed) missing.push('插件还没装进 profile（点下面的“重新安装”或重启工作台）');
  if (!credentials.hasSecret) missing.push('还没填 QQ 机器人 AppID / AppSecret（去「设置」）');
  if (personas.length === 0) missing.push('还没有任何人设');
  if (!bot.dshCmd) missing.push('没找到 dsh，可设置环境变量 DSH_BIN');
  $('setup-card').classList.toggle('hidden', missing.length === 0);
  if (missing.length > 0) {
    const list = $('setup-list');
    list.innerHTML = '';
    for (const text of missing) {
      const item = document.createElement('li');
      item.textContent = text;
      list.appendChild(item);
    }
  }
}

async function refreshState() {
  try {
    const data = await api('/api/state');
    state.data = data;
    state.byId = new Map(data.personas.map((persona) => [persona.id, persona]));
    renderStatus();
    renderPersonaList($('persona-search').value);
    if (!settingsDirty) fillSettings();
    if (!state.currentId && !state.isNew && data.personas.length > 0) {
      await selectPersona(data.defaultPersonaId || data.personas[0].id);
    }
  } catch (error) {
    $('status-text').textContent = '工作台连接失败';
    $('status-sub').textContent = error.message;
  }
}

// ── 启动 ─────────────────────────────────────────────
setInterval(refreshState, 2500);
setInterval(pollLogs, 900);
showLogPlaceholder();
refreshState().then(pollLogs);
