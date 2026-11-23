/* settings.js — 模型配置（BYOK · 自带模型）
 *
 * ── 为什么必须有这个 ─────────────────────────────────────────
 * 这个应用的核心价值是「能离线、数据不外传」。但它同时想用大模型做辨证解释，
 * 而大模型必然要联网。这两件事唯一的和解方式，是让用户自己决定：
 *
 *   · 不想联网 → 选「只用规则引擎」，功能照用，一个字节都不出设备
 *   · 有 API key → 填进去，直连模型厂商（或中转），我们不碰数据
 *   · 本地跑了模型 → 填 localhost，完全离线也能用大模型
 *
 * 所以这里不做「我们替你调用」的中间层。所有请求从浏览器直发，
 * key 只存在本机 localStorage，换设备就是空的。
 *
 * ── 支持的三类后端 ───────────────────────────────────────────
 *   rules    纯规则引擎，不联网（默认，最稳）
 *   openai   任何 OpenAI 兼容接口（DeepSeek / 通义 / Moonshot / 硅基流动 / 自建）
 *   ollama   本地 Ollama（默认 http://localhost:11434）
 *   lmstudio 本地 LM Studio（默认 http://localhost:1234/v1）
 *
 * ── 一个坑 ───────────────────────────────────────────────────
 * 浏览器直连本地模型会遇到 CORS。Ollama 要设 OLLAMA_ORIGINS=*，
 * LM Studio 要在设置里勾「启用 CORS」。这不是我们的 bug，是浏览器的安全策略，
 * 页面里会直接告诉用户怎么改，而不是让请求静默失败。
 */

const SETTINGS_KEY = 'tcm-model-settings';

/* ── 预设：常见服务商的 base_url，省得用户去查 ───────────── */
const PRESETS = {
  rules: {
    label: '只用规则引擎（不联网）',
    base: '',
    model: '',
    keyNeeded: false,
    hint: '完全离线，所有辨证在本机完成。功能可用，但没有 AI 生成的解释文字。',
  },
  openai: {
    label: 'OpenAI 兼容接口',
    base: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    keyNeeded: true,
    hint: '任何兼容 OpenAI 格式的服务都行：DeepSeek / 通义 / Moonshot / 硅基流动 / 自建网关。',
    common: [
      { name: 'DeepSeek', base: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
      { name: 'Moonshot', base: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
      { name: '通义千问', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
      { name: '硅基流动', base: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-7B-Instruct' },
      { name: '智谱', base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
    ],
  },
  ollama: {
    label: '本地 Ollama',
    base: 'http://localhost:11434/v1',
    model: 'qwen2.5:7b',
    keyNeeded: false,
    hint: '电脑上跑 Ollama 即可，完全免费且数据不出本机。需设 OLLAMA_ORIGINS=* 才能被网页访问。',
  },
  lmstudio: {
    label: '本地 LM Studio',
    base: 'http://localhost:1234/v1',
    model: 'local-model',
    keyNeeded: false,
    hint: 'LM Studio 加载模型后开启 Local Server，并在设置里勾选启用 CORS。',
  },
};

const DEFAULTS = {
  provider: 'rules',
  base: '',
  model: '',
  apiKey: '',
  temperature: 0.3,
};

/* ── 读写（localStorage：换设备就是空的，符合"数据不出本机"）── */
function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings(s) {
  const clean = {
    provider: s.provider || 'rules',
    base: (s.base || '').trim(),
    model: (s.model || '').trim(),
    apiKey: (s.apiKey || '').trim(),
    temperature: typeof s.temperature === 'number' ? s.temperature : 0.3,
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(clean));
  return clean;
}

function clearSettings() {
  localStorage.removeItem(SETTINGS_KEY);
  return { ...DEFAULTS };
}

/* ── 测试连接：真的发一次最小请求，不是假装成功 ─────────────── */
async function testConnection(s) {
  if (s.provider === 'rules') {
    return { ok: true, msg: '规则引擎无需联网，随时可用' };
  }
  const base = (s.base || '').replace(/\/+$/, '');
  if (!base) return { ok: false, msg: '没填接口地址' };
  if (s.provider === 'openai' && !s.apiKey) {
    return { ok: false, msg: '这类服务需要 API key' };
  }

  const t0 = Date.now();
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (s.apiKey) headers['Authorization'] = 'Bearer ' + s.apiKey;

    const resp = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: s.model,
        messages: [{ role: 'user', content: '只回复两个字：可用' }],
        max_tokens: 16,
        temperature: 0,
        stream: false,
      }),
      // 本地模型首次加载可能慢，给足 45 秒
      signal: AbortSignal.timeout ? AbortSignal.timeout(45000) : undefined,
    });

    const ms = Date.now() - t0;

    if (!resp.ok) {
      const body = await resp.text();
      let detail = body.slice(0, 200);
      try {
        const j = JSON.parse(body);
        detail = j.error?.message || j.message || detail;
      } catch {}
      // 把最常见的两类错误翻译成人话
      if (resp.status === 401 || resp.status === 403) {
        return { ok: false, msg: `key 无效或无权限（${resp.status}）`, detail };
      }
      if (resp.status === 404) {
        return { ok: false, msg: `接口地址或模型名不对（404）。检查 base_url 是否要带 /v1，模型名是否存在`, detail };
      }
      return { ok: false, msg: `服务返回 ${resp.status}`, detail };
    }

    const data = await resp.json();
    const reply = data.choices?.[0]?.message?.content || '(无内容)';
    return { ok: true, msg: `连接正常，${ms}ms，模型回复：${String(reply).slice(0, 30)}`, ms };
  } catch (e) {
    const msg = String(e && e.message || e);
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
      return {
        ok: false,
        msg: '请求被浏览器拦住了（多半是 CORS 或服务没启动）',
        detail: s.provider === 'ollama'
          ? 'Ollama 需要允许跨域：设环境变量 OLLAMA_ORIGINS=* 后重启 ollama serve'
          : s.provider === 'lmstudio'
            ? 'LM Studio 需要在设置里勾选「Enable CORS」，并确认 Local Server 已启动'
            : '检查地址是否正确、服务是否可达',
      };
    }
    if (/timeout|abort/i.test(msg)) {
      return { ok: false, msg: '超时了。本地模型首次加载需要时间，可以再试一次' };
    }
    return { ok: false, msg, detail: msg.slice(0, 200) };
  }
}

/* ── 统一调用入口（其它模块只用这个）───────────────────────── */
async function chat(messages, s) {
  const cfg = s || loadSettings();
  if (cfg.provider === 'rules') {
    throw new Error('RULES_ONLY');  // 调用方据此走规则引擎
  }
  const base = (cfg.base || '').replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers['Authorization'] = 'Bearer ' + cfg.apiKey;

  const resp = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: cfg.temperature ?? 0.3,
      stream: false,
    }),
  });
  if (!resp.ok) throw new Error('模型返回 ' + resp.status);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

/* ── 界面 ─────────────────────────────────────────────────── */
let _clickHandler = null;

function renderSettings(root) {
  const s = loadSettings();
  const p = PRESETS[s.provider] || PRESETS.rules;

  root.innerHTML = `
    <div class="set-head">
      <div class="set-title">模型配置</div>
      <div class="set-sub">配置只存在这台设备上，不会上传，也不进 git</div>
    </div>

    <div class="set-card">
      <label class="set-label">使用哪种方式</label>
      <div class="set-providers">
        ${Object.entries(PRESETS).map(([k, v]) => `
          <button class="set-prov${s.provider === k ? ' on' : ''}" data-prov="${k}">
            ${s.provider === k ? '✓ ' : ''}${v.label}
          </button>`).join('')}
      </div>
      <div class="set-hint">${p.hint}</div>
    </div>

    ${s.provider === 'rules' ? '' : `
    <div class="set-card">
      <label class="set-label">接口地址 (base_url)
        <input id="set-base" value="${esc(s.base || p.base)}" placeholder="${p.base}">
      </label>
      ${p.common ? `
      <div class="set-quick">快速填入：
        ${p.common.map((c) => `<button class="set-chip" data-fill='${JSON.stringify(c)}'>${c.name}</button>`).join('')}
      </div>` : ''}
      <label class="set-label">模型名
        <input id="set-model" value="${esc(s.model || p.model)}" placeholder="${p.model}">
      </label>
      ${p.keyNeeded ? `
      <label class="set-label">API key
        <input id="set-key" type="password" value="${esc(s.apiKey)}" placeholder="sk-...">
      </label>
      <div class="set-hint">key 只存在本机 localStorage。如果担心，可以只填不常用的低价 key。</div>` : `
      <div class="set-hint">本地模型不需要 key。</div>`}
    </div>`}

    <div class="set-btns">
      <button class="btn-primary" data-act="save-settings">保存</button>
      <button class="btn-ghost" data-act="test-settings">测试连接</button>
      <button class="btn-ghost" data-act="reset-settings">恢复默认</button>
    </div>

    <div id="set-result"></div>

    <div class="set-card set-note">
      <div class="set-label" style="margin-bottom:8px">关于隐私</div>
      <div class="set-hint">
        这个应用的辨证、体质辨识、化验解读都在你本机完成，不需要联网。<br>
        只有你选了「OpenAI 兼容接口」或本地模型，问题才会发给对应服务——发什么、发给谁，由你决定，<br>
        不经过本项目的任何服务器。
      </div>
    </div>
  `;

  if (_clickHandler) root.removeEventListener('click', _clickHandler);
  _clickHandler = async (e) => {
    const prov = e.target.closest('[data-prov]');
    if (prov) {
      const s2 = loadSettings();
      s2.provider = prov.dataset.prov;
      const np = PRESETS[s2.provider];
      s2.base = np.base;
      s2.model = np.model;
      saveSettings(s2);
      return renderSettings(root);
    }
    const fill = e.target.closest('[data-fill]');
    if (fill) {
      const c = JSON.parse(fill.dataset.fill);
      document.getElementById('set-base').value = c.base;
      document.getElementById('set-model').value = c.model;
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const box = document.getElementById('set-result');

    if (act === 'save-settings') {
      const s2 = collect();
      saveSettings(s2);
      box.innerHTML = '<div class="set-ok">已保存到本机</div>';
      return;
    }
    if (act === 'test-settings') {
      const s2 = collect();
      box.innerHTML = '<div class="set-wait">正在连接…（本地模型首次加载可能要几十秒）</div>';
      const r = await testConnection(s2);
      box.innerHTML = `<div class="${r.ok ? 'set-ok' : 'set-err'}">
        ${r.ok ? '✅' : '❌'} ${esc(r.msg)}
        ${r.detail ? `<div class="set-detail">${esc(r.detail)}</div>` : ''}
      </div>`;
      if (r.ok) saveSettings(s2);
      return;
    }
    if (act === 'reset-settings') {
      if (!confirm('恢复默认会清掉已填的接口地址和 key，确定吗？')) return;
      clearSettings();
      return renderSettings(root);
    }
  };
  root.addEventListener('click', _clickHandler);

  function collect() {
    const g = (id, d = '') => {
      const el = document.getElementById(id);
      return el ? el.value : d;
    };
    const s2 = loadSettings();
    s2.base = g('set-base', s2.base);
    s2.model = g('set-model', s2.model);
    if (document.getElementById('set-key')) s2.apiKey = g('set-key');
    return s2;
  }
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

window.TCM_SETTINGS = {
  PRESETS,
  load: loadSettings,
  save: saveSettings,
  clear: clearSettings,
  testConnection,
  chat,
  render: renderSettings,
};
