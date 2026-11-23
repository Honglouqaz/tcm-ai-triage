/* family.js — 家庭健康档案（纯前端 · 数据不出设备）
 *
 * ★ 形态说明：本项目前端是 ES5 + IIFE（app.js 同款），不用 ES module。
 *   原因是 Capacitor/Electron/旧版 Android WebView 对 module 支持不一，
 *   统一成普通 script 最省事。对外通过 window.TCM_FAMILY 暴露。
 *
 * ── 为什么这样设计 ────────────────────────────────────────────
 * 1) 数据放 IndexedDB，不放服务器。
 *    健康数据是最私密的，一旦上传就收不回来。放本地意味着：
 *    用户自己就是数据的唯一持有者，删了就是真删了。这也是它能离线跑、
 *    能塞进 APK/Electron 的前提。
 *
 * 2) 只记「发生了什么」，不记「诊断了什么」。
 *    事件表里存的是「2026-03-15 体检 尿酸 486 偏高」这种客观事实，
 *    中医辨证是**当下重新算**的（规则引擎每次跑）。这样教材改了口径，
 *    历史记录不会被旧结论污染。
 *
 * 3) 一定要能导出。
 *    用户敢把三年数据放进来，前提是随时能拿走。导出格式是人可读的
 *    JSON + 一份纯文本摘要，不依赖这个 App 也能看。
 *
 * ── 数据模型 ──────────────────────────────────────────────────
 *   member  = { id, name, relation, sex, birth, note, createdAt }
 *   event   = { id, memberId, date, kind, title, payload, note, createdAt }
 *     kind: 'checkup' 体检 | 'lab' 化验 | 'symptom' 症状 |
 *           'med' 用药 | 'visit' 就诊 | 'note' 随手记
 *     payload: 结构化数据（化验项数组 / 症状词数组等），可为空
 *
 * ── 不做什么 ─────────────────────────────────────────────────
 *   · 不做账号体系（没有服务器就没有账号）
 *   · 不做云同步（要同步请用导出文件自己搬）
 *   · 不做自动识别归档（拍完报告先存原文，归类由用户确认，
 *     因为「这份报告属于谁」猜错比不猜更糟）
 */

(function () {
'use strict';

const FAMILY_VERSION = '1.1.0';

const DB_NAME = 'tcm-family';
const DB_VER = 1;
const ST_MEMBER = 'members';
const ST_EVENT = 'events';

const RELATIONS = ['本人', '父亲', '母亲', '配偶', '儿子', '女儿',
                   '祖父', '祖母', '外祖父', '外祖母', '其他'];
// 用文字标签而非 emoji：Chromium（Electron/旧 WebView）常缺 emoji 字体，
// 会渲染成方块；文字标签跨平台稳定，老人也更容易看懂。
const KINDS = {
  checkup: { label: '体检', icon: '体检' },
  lab:     { label: '化验', icon: '化验' },
  symptom: { label: '症状', icon: '症状' },
  med:     { label: '用药', icon: '用药' },
  visit:   { label: '就诊', icon: '就诊' },
  note:    { label: '记录', icon: '记录' },
};

/* ── IndexedDB 极简封装 ───────────────────────────────────────
 * 不引第三方库：整个项目零依赖是它能在 Worker/APK/Electron 里
 * 都跑得动的原因之一，不能因为一个存储层就破功。
 */
let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(ST_MEMBER)) {
        const s = db.createObjectStore(ST_MEMBER, { keyPath: 'id' });
        s.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains(ST_EVENT)) {
        const s = db.createObjectStore(ST_EVENT, { keyPath: 'id' });
        s.createIndex('memberId', 'memberId');
        s.createIndex('date', 'date');
        s.createIndex('member_date', ['memberId', 'date']);
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    try { out = fn(s); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ── 成员 ─────────────────────────────────────────────────── */
const Members = {
  list() {
    return tx(ST_MEMBER, 'readonly', (s) => s.getAll()).then((arr) =>
      (arr || []).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)));
  },
  add({ name, relation = '本人', sex = '', birth = '', note = '' }) {
    const m = {
      id: uid(), name: (name || '').trim(), relation, sex, birth, note,
      createdAt: Date.now(),
    };
    if (!m.name) return Promise.reject(new Error('名字不能为空'));
    return tx(ST_MEMBER, 'readwrite', (s) => s.put(m)).then(() => m);
  },
  update(id, patch) {
    return Members.get(id).then((m) => {
      if (!m) throw new Error('成员不存在');
      const next = { ...m, ...patch, id };
      return tx(ST_MEMBER, 'readwrite', (s) => s.put(next)).then(() => next);
    });
  },
  get(id) {
    return tx(ST_MEMBER, 'readonly', (s) => s.get(id));
  },
  remove(id) {
    return tx(ST_MEMBER, 'readwrite', (s) => s.delete(id))
      .then(() => tx(ST_EVENT, 'readwrite', (s) => {
        const idx = s.index('memberId');
        const cur = idx.openCursor(IDBKeyRange.only(id));
        cur.onsuccess = (e) => {
          const c = e.target.result;
          if (c) { s.delete(c.primaryKey); c.continue(); }
        };
      }));
  },
};

/* ── 事件 ─────────────────────────────────────────────────── */
const Events = {
  listByMember(memberId, limit = 500) {
    return tx(ST_EVENT, 'readonly', (s) => s.getAll()).then((arr) => {
      const out = (arr || []).filter((e) => e.memberId === memberId);
      out.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      return out.slice(0, limit);
    });
  },
  add({ memberId, date, kind = 'note', title = '', payload = null, note = '' }) {
    if (!memberId) return Promise.reject(new Error('缺少成员'));
    const e = {
      id: uid(), memberId,
      date: date || new Date().toISOString().slice(0, 10),
      kind, title: (title || '').trim(), payload, note,
      createdAt: Date.now(),
    };
    return tx(ST_EVENT, 'readwrite', (s) => s.put(e)).then(() => e);
  },
  remove(id) {
    return tx(ST_EVENT, 'readwrite', (s) => s.delete(id));
  },
  /** 某个指标的历史序列 —— 报表「趋势」就靠这个，不用另存一份 */
  series(memberId, indicatorName) {
    return Events.listByMember(memberId, 2000).then((evs) => {
      const pts = [];
      for (const e of evs) {
        if (!Array.isArray(e.payload)) continue;
        for (const it of e.payload) {
          const nm = (it && (it.name || it.名称)) || '';
          if (nm && nm.indexOf(indicatorName) >= 0) {
            const v = parseFloat(it.value != null ? it.value : it.值);
            if (isFinite(v)) pts.push({ date: e.date, value: v, unit: it.unit || it.单位 || '' });
          }
        }
      }
      pts.sort((a, b) => a.date.localeCompare(b.date));
      return pts;
    });
  },
};

/* ── 导出 / 导入（用户敢用三年数据的前提）────────────────────── */
async function exportAll() {
  const members = await Members.list();
  const events = await tx(ST_EVENT, 'readonly', (s) => s.getAll()) || [];
  return {
    format: 'tcm-family-backup',
    version: FAMILY_VERSION,
    exportedAt: new Date().toISOString(),
    members, events,
  };
}

function exportText(data) {
  const lines = [];
  lines.push('家庭健康档案 导出摘要');
  lines.push('导出时间：' + (data.exportedAt || '').replace('T', ' ').slice(0, 19));
  lines.push('');
  for (const m of data.members || []) {
    lines.push('━━ ' + m.name + '（' + m.relation + '）━━');
    if (m.birth) lines.push('  出生：' + m.birth);
    if (m.note) lines.push('  备注：' + m.note);
    const evs = (data.events || []).filter((e) => e.memberId === m.id)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    if (!evs.length) lines.push('  （无记录）');
    for (const e of evs) {
      const k = KINDS[e.kind] || { label: '记录', icon: '·' };
      lines.push('  ' + e.date + ' ' + k.icon + ' ' + (e.title || k.label)
        + (e.note ? ' — ' + e.note : ''));
      if (Array.isArray(e.payload)) {
        for (const it of e.payload) {
          const nm = it.name || it.名称 || '';
          const v = it.value != null ? it.value : it.值;
          if (nm) lines.push('      · ' + nm + ' ' + (v != null ? v : '') + (it.unit || ''));
        }
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

function importAll(obj, { merge = true } = {}) {
  if (!obj || obj.format !== 'tcm-family-backup') {
    return Promise.reject(new Error('不是本应用导出的备份文件'));
  }
  const members = obj.members || [];
  const events = obj.events || [];
  return Promise.all([
    tx(ST_MEMBER, 'readwrite', (s) => {
      for (const m of members) s.put(m);
    }),
    tx(ST_EVENT, 'readwrite', (s) => {
      for (const e of events) s.put(e);
    }),
  ]).then(() => ({ members: members.length, events: events.length }));
}

function clearAll() {
  return Promise.all([
    tx(ST_MEMBER, 'readwrite', (s) => s.clear()),
    tx(ST_EVENT, 'readwrite', (s) => s.clear()),
  ]);
}

/* exported to window: RELATIONS, KINDS */

/* ── 对外挂载（普通 script，非 module）── */
window.TCM_FAMILY = {
  version: FAMILY_VERSION,
  Members, Events,
  exportAll, exportText, importAll, clearAll,
  RELATIONS, KINDS,
};
})();
