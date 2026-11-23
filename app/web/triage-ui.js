/* triage-ui.js — 就医等级界面
 *
 * 这一页只有一个目的：让用户在两分钟内知道「现在该去哪儿」。
 * 所以不堆功能——两个输入框、一个按钮、一个结论，结论占最大篇幅。
 */

// ★ 包 IIFE：settings.js 也有个 esc()，普通 script 共享全局作用域会报
//   "Identifier 'esc' has already been declared"，所有临时名字必须私有。
(function () {
'use strict';

let _triageClick = null;

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const SAMPLES = [
  { label: '胸口压榨感', v: '胸口有压榨感，出冷汗，有点恶心' },
  { label: '咳嗽两周多', v: '咳嗽咳痰', d: 20 },
  { label: '孩子发烧', v: '宝宝发烧，精神差，不吃奶' },
  { label: '普通感冒', v: '鼻塞流鼻涕，有点咽痛' },
];

function renderTriage(root) {
  root.innerHTML = `
    <div class="tr-head">
      <div class="tr-title">现在该去哪儿？</div>
      <div class="tr-sub">按症状判断适合「先观察 / 门诊 / 急诊」。不是诊断，是分诊参考。</div>
    </div>

    <div class="tr-card">
      <label class="tr-label">哪里不舒服？尽量说具体
        <textarea id="tr-sym" rows="3" placeholder="例：胸口有压榨感，出冷汗，有点恶心&#10;例：咳嗽咳痰 20 天了，晚上更厉害"></textarea>
      </label>

      <div class="tr-quick">
        试试：
        ${SAMPLES.map((s, i) => `<button class="tr-chip" data-sample="${i}">${s.label}</button>`).join('')}
      </div>

      <div class="tr-row">
        <label class="tr-label tr-half">持续几天
          <input id="tr-days" type="number" min="0" placeholder="如 3">
        </label>
        <label class="tr-label tr-half">年龄
          <input id="tr-age" type="number" min="0" placeholder="如 68">
        </label>
      </div>

      <label class="tr-label">有化验单？填关键几项（每行一项）
        <textarea id="tr-labs" rows="2" placeholder="例：血糖(空腹) 26.5 mmol/L&#10;例：血红蛋白 52 g/L"></textarea>
      </label>

      <button class="btn-primary tr-go" data-act="judge">判断</button>
    </div>

    <div id="tr-result"></div>
  `;

  if (_triageClick) root.removeEventListener('click', _triageClick);
  _triageClick = (e) => {
    const sample = e.target.closest('[data-sample]');
    if (sample) {
      const s = SAMPLES[Number(sample.dataset.sample)];
      document.getElementById('tr-sym').value = s.v;
      if (s.d) document.getElementById('tr-days').value = s.d;
      return;
    }
    if (e.target.closest('[data-act="judge"]')) return judge(root);
  };
  root.addEventListener('click', _triageClick);
}

function judge(root) {
  const sym = document.getElementById('tr-sym').value.trim();
  const labs = document.getElementById('tr-labs').value.trim();
  const days = parseFloat(document.getElementById('tr-days').value) || 0;
  const age = parseFloat(document.getElementById('tr-age').value) || 0;

  const box = document.getElementById('tr-result');

  if (!sym && !labs) {
    box.innerHTML = '<div class="tr-empty">至少说一下哪里不舒服，或者填一项化验值。</div>';
    return;
  }

  const r = window.TCM_TRIAGE.triage({ symptoms: sym, labs, age, durationDays: days });

  const colorMap = {
    emergency: { bg: '#4a1f1a', bd: '#7a3128', fg: '#ffc9bd', tag: '#b5402f' },
    clinic:    { bg: '#3d3018', bd: '#66512a', fg: '#f0d9a8', tag: '#a07a28' },
    observe:   { bg: '#1f3524', bd: '#2f5238', fg: '#b5dfc0', tag: '#3d7a4e' },
  };
  const c = colorMap[r.level] || colorMap.observe;

  box.innerHTML = `
    <div class="tr-result" style="background:${c.bg};border-color:${c.bd}">
      <div class="tr-badge" style="background:${c.tag}">${esc(r.label)}</div>
      <div class="tr-headline" style="color:${c.fg}">${esc(r.headline)}</div>
      <div class="tr-desc">${esc(r.desc)}</div>
      ${r.depts.length ? `<div class="tr-dept">建议科室：${r.depts.map(esc).join(' · ')}</div>` : ''}
    </div>

    ${r.hits.length ? `
    <div class="tr-sec">判断依据</div>
    <div class="tr-hits">
      ${r.hits.map((h) => `
        <div class="tr-hit">
          <div class="tr-hit-head">
            <span class="tr-hit-layer" data-lv="${esc(h.level)}">${esc(h.layer)}</span>
            <span class="tr-hit-name">${esc(h.name)}</span>
          </div>
          <div class="tr-hit-why">${esc(h.why)}</div>
          ${h.action ? `<div class="tr-hit-action">→ ${esc(h.action)}</div>` : ''}
        </div>`).join('')}
    </div>` : ''}

    <div class="tr-sec">接下来</div>
    <div class="tr-esc">${esc(r.escalation)}</div>

    <div class="tr-disclaimer">${esc(r.disclaimer)}</div>
  `;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

window.TCM_TRIAGE_UI = { render: renderTriage };
})();
