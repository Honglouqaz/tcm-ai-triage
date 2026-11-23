/* app.js — 四时辨证 前端（离线，无后端） */
(function () {
  'use strict';
  var TCM = window.TCM, RULES = window.TCM_RULES;
  var stats = TCM.load(RULES);
  document.getElementById('engine-stats').textContent =
    stats.constitutions + ' 体质 · ' + stats.patterns + ' 证型 · ' + stats.symptoms + ' 症状 · ' + stats.labs + ' 指标';
  document.getElementById('app-ver').textContent =
    '引擎 v' + TCM.version + ' · 规则库 ' + stats.patterns + ' 证型/' + stats.formulas + ' 方剂 · 构建 ' +
    (RULES.builtAt || '');

  /* ---------- tab 切换 ---------- */
  var tabs = document.querySelectorAll('.tab');
  tabs.forEach(function (t) {
    t.addEventListener('click', function () {
      tabs.forEach(function (x) { x.classList.remove('active'); });
      document.querySelectorAll('.panel').forEach(function (p) { p.classList.remove('active'); });
      t.classList.add('active');
      document.getElementById('panel-' + t.dataset.tab).classList.add('active');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  var esc = function (s) { return String(s == null ? '' : s).replace(/[<>&]/g, function (c) { return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]; }); };

  /* ---------- 辨证 ---------- */
  var QUICK = ['失眠', '急躁易怒', '口苦', '头晕', '乏力', '腹胀', '怕冷', '便秘'];
  var qs = document.getElementById('quick-symptoms');
  QUICK.forEach(function (s) {
    var b = document.createElement('button');
    b.textContent = s;
    b.onclick = function () {
      var el = document.getElementById('in-symptoms');
      el.value = (el.value ? el.value.replace(/[，,\s]+$/, '') + '，' : '') + s;
    };
    qs.appendChild(b);
  });

  document.getElementById('btn-diagnose').addEventListener('click', function () {
    var out = document.getElementById('out-diagnose');
    var r = TCM.diagnose({
      symptoms: document.getElementById('in-symptoms').value,
      tongue: document.getElementById('in-tongue').value,
      pulse: document.getElementById('in-pulse').value
    });
    if (!r.results.length) {
      out.innerHTML = '<div class="empty">' + esc(r.hint || '没有匹配结果') +
        '<br><span style="font-size:12.5px">已识别症状：' + esc(r.symptomsNormalized.join('、') || '（无）') + '</span></div>';
      return;
    }
    var head = '<div class="card" style="padding:12px 14px"><b>识别到的标准症状（' + r.symptomsNormalized.length + '）</b><div class="ev">' +
      esc(r.symptomsNormalized.join('、') || '（无）') + '</div></div>';
    out.innerHTML = head + r.results.map(function (x) {
      var ev = x.evidence.map(function (e) { return '<b>' + e.type + '</b> ' + esc(e.text) + '（+' + e.weight + '）'; }).join('　');
      return '<div class="result">' +
        '<h3>' + esc(x.name) + '<span class="score">' + x.score + ' 分</span></h3>' +
        (x.category ? '<div class="meta">分类：' + esc(x.category) + '</div>' : '') +
        (x.principle ? '<div class="meta">治则：' + esc(x.principle) + '</div>' : '') +
        (x.formulas.length ? '<div class="meta">参考方剂：' + x.formulas.map(function (f) { return '<span class="tag">' + esc(f) + '</span>'; }).join('') + '</div>' : '') +
        '<div class="ev">依据：' + ev + '</div>' +
        (x.diet.length ? '<div class="ev" style="margin-top:8px"><b>饮食</b></div><ul class="tight">' + x.diet.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul>' : '') +
        (x.acupoints.length ? '<div class="ev" style="margin-top:8px"><b>穴位</b></div><ul class="tight">' + x.acupoints.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul>' : '') +
        (x.lifestyle.length ? '<div class="ev" style="margin-top:8px"><b>起居</b></div><ul class="tight">' + x.lifestyle.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul>' : '') +
        '</div>';
    }).join('');
  });

  /* ---------- 体质 ---------- */
  var picked = {};
  var allSigns = [];
  TCM.list.constitutions().forEach(function (k) {
    (RULES.constitutions[k]['表现'] || []).forEach(function (s) { if (allSigns.indexOf(s) < 0) allSigns.push(s); });
  });
  var signList = document.getElementById('sign-list');
  allSigns.forEach(function (s) {
    var b = document.createElement('button');
    b.className = 'chip'; b.textContent = s;
    b.onclick = function () {
      if (picked[s]) { delete picked[s]; b.classList.remove('on'); } else { picked[s] = 1; b.classList.add('on'); }
      renderPicked();
    };
    signList.appendChild(b);
  });
  function renderPicked() {
    var box = document.getElementById('signs-selected');
    var keys = Object.keys(picked);
    box.hidden = !keys.length;
    box.textContent = keys.length ? '已选 ' + keys.length + ' 项：' + keys.join('、') : '';
  }
  document.getElementById('btn-constitution').addEventListener('click', function () {
    var typed = document.getElementById('in-signs').value;
    var signs = Object.keys(picked).concat(typed ? [typed] : []);
    var r = TCM.constitution({ signs: signs });
    var out = document.getElementById('out-constitution');
    if (!r.results.length) { out.innerHTML = '<div class="empty">没有命中，请多选几项表现</div>'; return; }
    out.innerHTML = r.results.slice(0, 3).map(function (x, i) {
      return '<div class="result"><h3>' + (i === 0 ? '主质' : '兼夹') + '：' + esc(x.name) +
        '<span class="score">命中 ' + x.matched + '/' + x.total + '</span></h3>' +
        (x.feature ? '<div class="meta">' + esc(x.feature) + '</div>' : '') +
        (x.principle ? '<div class="meta">调理原则：' + esc(x.principle) + '</div>' : '') +
        '<div class="ev">命中表现：' + esc(x.evidence.join('、')) + '</div>' +
        (x.diet.length ? '<div class="ev" style="margin-top:8px"><b>饮食</b></div><ul class="tight">' + x.diet.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul>' : '') +
        (x.acupoints.length ? '<div class="ev" style="margin-top:8px"><b>穴位</b></div><ul class="tight">' + x.acupoints.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul>' : '') +
        (x.lifestyle.length ? '<div class="ev" style="margin-top:8px"><b>起居</b></div><ul class="tight">' + x.lifestyle.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul>' : '') +
        '</div>';
    }).join('') + '<div class="empty" style="font-size:12.5px">' + esc(r.note) + '</div>';
  });

  /* ---------- 化验 ---------- */
  var labNames = TCM.list.labs();
  function addLabRow(name, val) {
    var row = document.createElement('div');
    row.className = 'labrow';
    row.innerHTML = '<select>' + labNames.map(function (n) {
      return '<option' + (n === name ? ' selected' : '') + '>' + esc(n) + '</option>';
    }).join('') + '</select><input placeholder="数值"' + (val != null ? ' value="' + val + '"' : '') + '>';
    document.getElementById('lab-rows').appendChild(row);
  }
  addLabRow(labNames[0]); addLabRow('总胆固醇');
  document.getElementById('btn-lab-add').addEventListener('click', function () { addLabRow(labNames[0]); });
  document.getElementById('btn-lab').addEventListener('click', function () {
    var items = [];
    document.querySelectorAll('#lab-rows .labrow').forEach(function (r) {
      var s = r.querySelector('select').value, v = r.querySelector('input').value;
      if (v !== '' && isFinite(parseFloat(v))) items.push({ name: s, value: parseFloat(v) });
    });
    var out = document.getElementById('out-lab');
    if (!items.length) { out.innerHTML = '<div class="empty">请至少填一项数值</div>'; return; }
    var res = TCM.lab(items);
    out.innerHTML = res.map(function (x) {
      var label = x.status === 'high' ? '偏高' : x.status === 'low' ? '偏低' : x.status === 'normal' ? '正常' : '未知';
      var color = x.status === 'high' || x.status === 'low' ? 'var(--accent)' : 'var(--green)';
      return '<div class="result" style="border-left-color:' + color + '">' +
        '<h3>' + esc(x.name) + '<span class="score" style="color:' + color + '">' + label + '</span></h3>' +
        '<div class="meta">你的数值：' + x.value + ' ' + esc(x.unit) + '　参考区间：' + esc(x.rangeText) + '</div>' +
        (x.advice ? '<div class="ev" style="margin-top:8px">' + esc(x.advice) + '</div>' : '') +
        (x.patterns && x.patterns.length ? '<div class="meta" style="margin-top:8px">可能相关的证型：' + x.patterns.map(function (p) { return '<span class="tag">' + esc(p) + '</span>'; }).join('') + '</div>' : '') +
        '</div>';
    }).join('') + '<div class="empty" style="font-size:12.5px">↑ 只做参考区间与中医视角提示，不做西医诊断。</div>';
  });

  /* ---------- 演示钩子：?demo=1 自动跑一次辨证（截图/文档用） ---------- */
  if (/[?&]demo=1/.test(location.search)) {
    document.getElementById('in-symptoms').value = '急躁易怒、口苦、失眠、头晕、胁痛';
    document.getElementById('in-tongue').value = '舌红苔黄';
    document.getElementById('in-pulse').value = '弦数';
    document.getElementById('btn-diagnose').click();
  }

  /* ---------- PWA ---------- */
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(function () { });
  }
})();
