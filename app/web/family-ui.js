/* family-ui.js — 家庭档案界面层
 *
 * 设计取舍：
 *   · 不引 UI 框架。整个 app 零依赖，加一个 Vue/React 就等于把
 *     APK 体积翻倍、把离线可用性赌在 CDN 上。
 *   · 一切用原生 DOM + 事件委托。代码直白，用户改得动。
 *   · 移动端优先：老人用手机看，字号给足（≥15px），点击区 ≥44px。
 */

var _F = window.TCM_FAMILY;
var Members = _F.Members, Events = _F.Events;
var exportAll = _F.exportAll, exportText = _F.exportText, importAll = _F.importAll;
var RELATIONS = _F.RELATIONS, KINDS = _F.KINDS, FAMILY_VERSION = _F.version;

(function () {
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

let _curMember = null;   // 当前展开的成员 id
let _clickHandler = null; // ★ 必须存引用：renderFamily 每次重渲染都会重新绑，
                          //   不先解绑就会累积监听器 → 一次点击触发 N 次 →
                          //   同一条记录被存两遍（实测踩到过）

/* ── 渲染 ─────────────────────────────────────────────────── */

// 统计单独算：加/删记录后只更新这一行，不用整页重渲染
async function _countEvents(members) {
  if (!members || !members.length) return 0;
  const lists = await Promise.all(members.map((m) => Events.listByMember(m.id, 2000)));
  return lists.reduce((n, arr) => n + arr.length, 0);
}

async function _refreshStat(root) {
  const sub = root.querySelector('.fam-sub');
  if (!sub) return;
  const ms = await Members.list();
  const n = await _countEvents(ms);
  sub.textContent = '共 ' + ms.length + ' 位成员 · ' + n + ' 条记录 · 数据仅存本机';
}

async function renderFamily(root) {
  const members = await Members.list();
  const totalEvents = await _countEvents(members);

  root.innerHTML = `
    <div class="fam-head">
      <div class="fam-title">家庭健康档案</div>
      <div class="fam-sub">共 ${members.length} 位成员 · ${totalEvents} 条记录 · 数据仅存本机</div>
      <div class="fam-actions">
        <button class="btn-primary" data-act="add-member">＋ 添加成员</button>
        <button class="btn-ghost" data-act="export">导出备份</button>
        <button class="btn-ghost" data-act="import">导入备份</button>
      </div>
    </div>
    <div class="fam-list">${
      members.length ? members.map((m) => memberCard(m)).join('')
        : `<div class="fam-empty">还没有成员。<br>先加一位，之后报告、症状、用药都记在他名下。</div>`
    }</div>
    <div class="fam-detail" id="fam-detail"></div>
    <input type="file" id="fam-import-file" accept=".json,application/json" hidden>
  `;

  // ★ 先解绑上一次的，再绑新的。
  //   原来直接 addEventListener 会在每次重渲染后累积，
  //   N 次重渲染 → 一次点击触发 N 次 → 同一条记录存 N 遍（实测存成 2 条）。
  if (_clickHandler) root.removeEventListener('click', _clickHandler);
  _clickHandler = onClick;
  root.addEventListener('click', _clickHandler);

  async function onClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;

    if (act === 'add-member') return showMemberForm(root, null);
    if (act === 'export') return doExport();
    if (act === 'import') return $('#fam-import-file', root).click();
    if (act === 'open-member') return openDetail(root, btn.dataset.id);
    if (act === 'del-member') {
      if (!confirm('删除成员会同时删除他的全部记录，确定吗？')) return;
      await Members.remove(btn.dataset.id);
      return renderFamily(root);
    }
    if (act === 'add-event') return showEventForm(root, btn.dataset.id);
    if (act === 'del-event') {
      if (!confirm('删除这条记录？删了就找不回来了。')) return;
      await Events.remove(btn.dataset.id);
      await openDetail(root, _curMember);
      await _refreshStat(root);
      return;
    }
    if (act === 'member-form-save') return saveMember(root, btn.dataset.id);
    if (act === 'event-form-save') return saveEvent(root, btn.dataset.member);
    if (act === 'form-cancel') { $('#fam-detail', root).innerHTML = ''; return; }
  }

  const fileInput = $('#fam-import-file', root);
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      const r = await importAll(obj);
      alert(`导入完成：${r.members} 位成员、${r.events} 条记录`);
      renderFamily(root);
    } catch (err) {
      alert('导入失败：' + err.message);
    } finally {
      fileInput.value = '';
    }
  });

  async function doExport() {
    const data = await exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `家庭健康档案_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);

    // 顺手给一份纯文本，不依赖本应用也能读
    const txt = new Blob([exportText(data)], { type: 'text/plain;charset=utf-8' });
    const b = document.createElement('a');
    b.href = URL.createObjectURL(txt);
    b.download = `家庭健康档案_${new Date().toISOString().slice(0, 10)}.txt`;
    b.click();
    setTimeout(() => URL.revokeObjectURL(b.href), 3000);
  }
}

function memberCard(m) {
  const age = m.birth ? ` · ${new Date().getFullYear() - parseInt(m.birth.slice(0, 4), 10)} 岁` : '';
  return `
    <div class="fam-card">
      <div class="fam-card-main">
        <div class="fam-avatar">${esc((m.name || '?').slice(0, 1))}</div>
        <div class="fam-info">
          <div class="fam-name">${esc(m.name)}</div>
          <div class="fam-meta">${esc(m.relation)}${age}${m.sex ? ' · ' + esc(m.sex) : ''}</div>
        </div>
      </div>
      <div class="fam-card-btns">
        <button class="btn-sm" data-act="open-member" data-id="${m.id}">查看</button>
        <button class="btn-sm btn-danger" data-act="del-member" data-id="${m.id}">删除</button>
      </div>
    </div>`;
}

async function openDetail(root, memberId) {
  _curMember = memberId;
  const m = await Members.get(memberId);
  const evs = await Events.listByMember(memberId);
  const box = $('#fam-detail', root);
  if (!m) { box.innerHTML = ''; return; }

  box.innerHTML = `
    <div class="fam-detail-head">
      <div style="min-width:0">
        <div class="fam-det-name">${esc(m.name)}<span class="fam-det-rel">${esc(m.relation)}</span></div>
        ${m.note ? `<div class="fam-det-note">${esc(m.note)}</div>` : ''}
      </div>
      <button class="btn-primary" data-act="add-event" data-id="${m.id}">＋ 记一笔</button>
    </div>
    <div class="fam-sec-title">${esc(m.name)}的健康记录（${evs.length} 条）</div>
    <div class="fam-timeline">${
      evs.length ? evs.map(tl).join('')
        : '<div class="fam-empty" style="padding:20px">还没有记录。体检、化验、症状、用药都可以记。</div>'
    }</div>
  `;

  function tl(e) {
    const k = KINDS[e.kind] || { label: '记录', icon: '·' };
    let payloadHtml = '';
    if (Array.isArray(e.payload) && e.payload.length) {
      payloadHtml = '<div class="fam-payload">' + e.payload.slice(0, 12).map((it) => {
        const nm = it.name || it.名称 || '';
        const v = it.value != null ? it.value : it.值;
        const u = it.unit || it.单位 || '';
        const flag = it.flag || it.标记 || '';
        if (!nm) return '';
        const uu = u && !/^[%℃]$/.test(u) ? ' ' + u : u;  // 单位与数值间留空格，% 和 ℃ 除外
        return `<span class="fam-chip${flag ? ' fam-chip-warn' : ''}">${esc(nm)} ${esc(v)}${esc(uu)}</span>`;
      }).join('') + '</div>';
    }
    return `
      <div class="fam-ev">
        <div class="fam-ev-date">${esc(e.date)}</div>
        <div class="fam-ev-body">
          <div class="fam-ev-title"><span class="fam-kind">${esc(k.icon)}</span>${esc(e.title || k.label)}</div>
          ${e.note ? `<div class="fam-ev-note">${esc(e.note)}</div>` : ''}
          ${payloadHtml}
        </div>
        <button class="btn-xs" data-act="del-event" data-id="${e.id}" title="删除">✕</button>
      </div>`;
  }
}

function showMemberForm(root, m) {
  const box = $('#fam-detail', root);
  box.innerHTML = `
    <div class="fam-form">
      <div class="fam-form-title">${m ? '编辑成员' : '添加成员'}</div>
      <label>称呼<input id="f-name" value="${m ? esc(m.name) : ''}" placeholder="如：妈妈"></label>
      <label>关系<select id="f-rel">${RELATIONS.map((r) =>
        `<option${m && m.relation === r ? ' selected' : ''}>${r}</option>`).join('')}</select></label>
      <label>性别<select id="f-sex">
        <option value="">未填</option>
        <option value="男"${m && m.sex === '男' ? ' selected' : ''}>男</option>
        <option value="女"${m && m.sex === '女' ? ' selected' : ''}>女</option>
      </select></label>
      <label>出生年份<input id="f-birth" value="${m ? esc(m.birth) : ''}" placeholder="1958-03（只填年份也行）"></label>
      <label>备注<input id="f-note" value="${m ? esc(m.note) : ''}" placeholder="慢性病、过敏史等"></label>
      <div class="fam-form-btns">
        <button class="btn-primary" data-act="member-form-save" data-id="${m ? m.id : ''}">保存</button>
        <button class="btn-ghost" data-act="form-cancel">取消</button>
      </div>
    </div>`;
}

async function saveMember(root, id) {
  const name = $('#f-name', root).value.trim();
  if (!name) { alert('请填写称呼'); return; }
  const data = {
    name,
    relation: $('#f-rel', root).value,
    sex: $('#f-sex', root).value,
    birth: $('#f-birth', root).value.trim(),
    note: $('#f-note', root).value.trim(),
  };
  if (id) await Members.update(id, data);
  else await Members.add(data);
  renderFamily(root);
}

function showEventForm(root, memberId) {
  const box = $('#fam-detail', root);
  box.innerHTML = `
    <div class="fam-form">
      <div class="fam-form-title">记一笔</div>
      <label>日期<input type="date" id="e-date" value="${new Date().toISOString().slice(0, 10)}"></label>
      <label>类型<select id="e-kind">${Object.entries(KINDS).map(([k, v]) =>
        `<option value="${k}">${v.icon} ${v.label}</option>`).join('')}</select></label>
      <label>标题<input id="e-title" placeholder="如：年度体检 / 感冒发热"></label>
      <label>备注<textarea id="e-note" rows="2" placeholder="当时的情况、医生说的、服药反应…"></textarea></label>
      <label>化验项（可选，每行「名称 数值 单位」，如：尿酸 486 μmol/L）
        <textarea id="e-payload" rows="3" placeholder="尿酸 486 μmol/L&#10;空腹血糖 7.4 mmol/L"></textarea></label>
      <div class="fam-form-btns">
        <button class="btn-primary" data-act="event-form-save" data-member="${memberId}">保存</button>
        <button class="btn-ghost" data-act="form-cancel">取消</button>
      </div>
    </div>`;
}

async function saveEvent(root, memberId) {
  const rawPayload = $('#e-payload', root).value.trim();
  let payload = null;
  if (rawPayload) {
    payload = rawPayload.split('\n').map((ln) => ln.trim()).filter(Boolean).map((ln) => {
      const parts = ln.split(/\s+/);
      return { name: parts[0] || '', value: parts[1] || '', unit: parts[2] || '' };
    }).filter((it) => it.name);
  }
  await Events.add({
    memberId,
    date: $('#e-date', root).value,
    kind: $('#e-kind', root).value,
    title: $('#e-title', root).value,
    note: $('#e-note', root).value,
    payload,
  });
  await openDetail(root, memberId);
  await _refreshStat(root);
}

/* ── 对外挂载 ── */
window.TCM_FAMILY_UI = { renderFamily: renderFamily };
})();
