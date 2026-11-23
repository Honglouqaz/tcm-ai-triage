/**
 * tcm-engine.js — 中医辨证规则引擎（纯 JS，零依赖，可离线）
 *
 * 设计来源：tcm-ai-triage 仓库的 rules/*.json。
 * 与云端 Worker 版的区别（必须说清楚，不做虚假宣称）：
 *   · 云端版：LLM 负责「自然语言 → 结构化主诉」，规则库在 KV。
 *   · 本地版（本文件）：**完全不接大模型**，输入是勾选/输入的标准化症状，
 *     推理全部在本地完成 —— 因此可离线、可复现、结果确定。
 *
 * 权重口径（写在代码里，可被追问，也可改）：
 *   · 症状命中：该证型「典型症状」列表的前 40%（至少 2 条）记为主症，权重 1.0；
 *     其余记次症，权重 0.6。
 *   · 舌象命中关键词 +0.8，脉象命中关键词 +0.8。
 *   · 归一分 = 实际得分 / 该证型可拿满的上限 × 100。
 *   ⚠️ 这是可解释的启发式权重，不是某个教材的原始量表；
 *      替换成你自己的权重表只需改 WEIGHTS 常量。
 *
 * 用法（浏览器）：
 *   await TCM.load(rulesObject)          // rulesObject = {patterns, constitutions, ...}
 *   TCM.diagnose({symptoms:['失眠','心烦'], tongue:'舌红苔黄', pulse:'弦'})
 * 用法（Node）：
 *   const {createEngine} = require('./tcm-engine.js'); ...
 */

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TCM = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var WEIGHTS = {
    primary: 1.0,   // 主症
    secondary: 0.6, // 次症
    tongue: 0.8,    // 舌象
    pulse: 0.8,     // 脉象
    primaryRatio: 0.4, // 前 40% 的典型症状视为主症
    minPrimary: 2,
    topN: 5
  };

  var DB = {
    patterns: {},
    constitutions: {},
    symptoms: {},
    formulas: {},
    labs: {},
    synonyms: {}
  };
  var loaded = false;

  var FILLERS = /(最近|这几天|总是|老是|有点|一直|感觉|好像|觉得|比较|特别|很|太|有些|有时候|偶尔|里|着|的|了)/g;

  function _norm(s) {
    return String(s == null ? '' : s)
      .replace(/[\s,，、。;；:：()（）\[\]【】"'“”‘’]/g, '')
      .replace(FILLERS, '')
      .toLowerCase();
  }

  /** 把一句口语/半结构化输入归一成标准症状节点名数组 */
  function normalizeSymptoms(input) {
    var raw = [];
    if (Array.isArray(input)) raw = input.slice();
    else if (typeof input === 'string') {
      raw = input.split(/[\s,，、。;；\n]+/).filter(Boolean);
    }
    var out = [];
    var names = Object.keys(DB.symptoms);
    // 先建"变体 → 标准名"索引（标准名本身 + synonyms 表 + 症状名内部关键词）
    var variantMap = {};
    names.forEach(function (n) { variantMap[_norm(n)] = n; });
    Object.keys(DB.synonyms).forEach(function (canon) {
      var vs = DB.synonyms[canon] || [];
      if (!DB.symptoms[canon]) return;
      vs.forEach(function (v) { variantMap[_norm(v)] = canon; });
    });

    raw.forEach(function (item) {
      var n = _norm(item);
      if (!n) return;
      if (variantMap[n]) { if (out.indexOf(variantMap[n]) < 0) out.push(variantMap[n]); return; }
      // 包含式匹配：输入里含某标准名的核心词（如「晚上睡不好」→ 失眠）
      var hit = null;
      for (var i = 0; i < names.length; i++) {
        var c = names[i];
        if (n.indexOf(_norm(c)) >= 0) { hit = c; break; }
      }
      // 变体包含：变体是输入的子串（「入睡难」⊂「入睡困难」）
      if (!hit) {
        for (var v in variantMap) {
          if (v.length >= 2 && n.indexOf(v) >= 0) { hit = variantMap[v]; break; }
        }
      }
      if (hit && out.indexOf(hit) < 0) out.push(hit);
    });
    return out;
  }

  function _textHas(text, kw) {
    if (!text || !kw) return false;
    return _norm(text).indexOf(_norm(kw)) >= 0;
  }

  /** 证型匹配：返回按分数排序的 Top-N，每条都带可追溯依据 */
  function diagnose(opts) {
    opts = opts || {};
    var syms = normalizeSymptoms(opts.symptoms || []);
    var tongue = opts.tongue || '';
    var pulse = opts.pulse || '';
    var results = [];

    Object.keys(DB.patterns).forEach(function (key) {
      var p = DB.patterns[key];
      var list = p['典型症状'] || [];
      if (!list.length) return;
      var nPrimary = Math.max(WEIGHTS.minPrimary, Math.ceil(list.length * WEIGHTS.primaryRatio));
      var maxScore = 0, score = 0, evidence = [];

      list.forEach(function (s, idx) {
        var w = idx < nPrimary ? WEIGHTS.primary : WEIGHTS.secondary;
        maxScore += w;
        var hit = syms.indexOf(s) >= 0 || syms.some(function (x) { return _textHas(x, s) || _textHas(s, x); });
        if (hit) { score += w; evidence.push({ type: idx < nPrimary ? '主症' : '次症', text: s, weight: w }); }
      });
      maxScore += WEIGHTS.tongue + WEIGHTS.pulse;
      // 舌象：按证型舌象描述里的关键词逐词命中（2 字以上才算）
      var tg = p['舌象'] || '';
      if (tongue && tg) {
        var tgHit = _splitKw(tg).some(function (k) { return _textHas(tongue, k); });
        if (tgHit) { score += WEIGHTS.tongue; evidence.push({ type: '舌象', text: tg, weight: WEIGHTS.tongue }); }
      }
      var pl = p['脉象'] || '';
      if (pulse && pl) {
        var plHit = _splitKw(pl).some(function (k) { return _textHas(pulse, k); });
        if (plHit) { score += WEIGHTS.pulse; evidence.push({ type: '脉象', text: pl, weight: WEIGHTS.pulse }); }
      }
      if (score <= 0) return;
      results.push({
        name: p.name || key,
        score: Math.round(score / maxScore * 1000) / 10,
        category: p.category || '',
        principle: p['治则'] || '',
        formulas: p['推荐方剂'] || [],
        tongue: tg,
        pulse: pl,
        evidence: evidence,
        diet: p['饮食建议'] || [],
        acupoints: p['穴位按摩'] || [],
        lifestyle: p['生活调理'] || []
      });
    });

    results.sort(function (a, b) { return b.score - a.score; });
    return {
      symptomsNormalized: syms,
      results: results.slice(0, WEIGHTS.topN),
      hint: results.length ? null : '没有匹配到证型：请确认症状是否在词表内，或补充舌象/脉象。'
    };
  }

  /** 把「舌质淡红，苔薄白」切成可匹配的关键词 */
  function _splitKw(text) {
    var parts = String(text).split(/[，,、；;。\s]+/).filter(function (s) { return s.length >= 2; });
    var extra = [];
    parts.forEach(function (p) {
      if (p.length > 4) {
        extra.push(p.slice(0, 3));
        extra.push(p.slice(-3));
      }
    });
    return parts.concat(extra);
  }

  /** 体质辨识：基于「表现」命中（诚实说明：数据里没有问卷权重，做的是表现匹配） */
  function constitution(opts) {
    opts = opts || {};
    var signs = normalizeSigns(opts.signs || opts.text || '');
    var res = [];
    Object.keys(DB.constitutions).forEach(function (k) {
      var c = DB.constitutions[k];
      var list = c['表现'] || [];
      if (!list.length) return;
      var score = 0, ev = [];
      list.forEach(function (s) {
        if (signs.some(function (x) { return _textHas(x, s) || _textHas(s, x); })) {
          score += 1; ev.push(s);
        }
      });
      if (score > 0) {
        res.push({
          name: c.name || k, score: Math.round(score / list.length * 1000) / 10,
          matched: score, total: list.length, evidence: ev,
          feature: c['特征'] || '', principle: c['调理原则'] || '',
          diet: c['饮食建议'] || [], acupoints: c['穴位保健'] || [], lifestyle: c['生活调理'] || []
        });
      }
    });
    res.sort(function (a, b) { return b.matched - a.matched; });
    return { signsNormalized: signs, results: res, note: '体质结果按「表现命中数」排序，非标准量表加权；兼夹体质取前三名对照看。' };
  }

  function normalizeSigns(input) {
    var raw = Array.isArray(input) ? input : String(input).split(/[\s,，、。;；\n]+/).filter(Boolean);
    var pool = [];
    Object.keys(DB.constitutions).forEach(function (k) {
      (DB.constitutions[k]['表现'] || []).forEach(function (s) { if (pool.indexOf(s) < 0) pool.push(s); });
    });
    var out = [];
    raw.forEach(function (item) {
      var n = _norm(item);
      if (!n) return;
      var hit = null;
      for (var i = 0; i < pool.length; i++) {
        if (n.indexOf(_norm(pool[i])) >= 0 || _norm(pool[i]).indexOf(n) >= 0 && n.length >= 2) { hit = pool[i]; break; }
      }
      if (hit && out.indexOf(hit) < 0) out.push(hit);
      else if (!hit && item.trim().length >= 2 && out.indexOf(item.trim()) < 0) out.push(item.trim());
    });
    return out;
  }

  /** 化验指标：解析参考区间 → 判高/低 → 给出中医解读与关联证型 */
  function lab(items) {
    var out = [];
    (items || []).forEach(function (it) {
      var name = it.name || it[0], value = parseFloat(it.value != null ? it.value : it[1]);
      var ind = DB.labs[name];
      if (!ind) { out.push({ name: name, value: value, status: 'unknown', note: '知识库暂无该指标' }); return; }
      var range = parseRange(ind['正常范围']);
      var status = 'normal', advice = '';
      if (isFinite(value) && range) {
        if (value > range.high) { status = 'high'; advice = ind['偏高中医解读'] || ''; }
        else if (value < range.low) { status = 'low'; advice = ind['偏低中医解读'] || ''; }
      }
      out.push({
        name: name, value: value, unit: range && range.unit || '',
        rangeText: ind['正常范围'] || '', status: status, advice: advice,
        patterns: ind['关联证型'] || [], en: ind['英文'] || ''
      });
    });
    return out;
  }

  /** "3.9-6.1 mmol/L" / "0-40 U/L" / "4.0~10.0" → {low, high, unit} */
  function parseRange(text) {
    if (!text) return null;
    var s = String(text);
    var m = s.match(/(-?\d+(?:\.\d+)?)\s*[-~–—至]\s*(-?\d+(?:\.\d+)?)/);
    if (!m) return null;
    var unit = s.replace(m[0], '').trim();
    return { low: parseFloat(m[1]), high: parseFloat(m[2]), unit: unit };
  }

  function formula(name) {
    var f = DB.formulas[name];
    if (!f) return null;
    return {
      name: f.name || name, source: f['来源'] || '', composition: f['组成'] || '',
      effect: f['功效'] || '', indication: f['主治'] || '', modify: f['加减'] || '',
      usage: f['用法'] || '', caution: f['注意事项'] || ''
    };
  }

  function listSymptoms() { return Object.keys(DB.symptoms); }
  function listPatterns() { return Object.keys(DB.patterns); }
  function listConstitutions() { return Object.keys(DB.constitutions); }
  function listLabs() { return Object.keys(DB.labs); }

  function load(bundle) {
    if (!bundle) throw new Error('load(bundle) 需要一个包含 patterns/constitutions/symptoms/formulas/labs 的对象');
    DB.patterns = bundle.patterns || {};
    DB.constitutions = bundle.constitutions || {};
    DB.symptoms = bundle.symptoms || {};
    DB.formulas = bundle.formulas || {};
    DB.labs = bundle.labs || bundle.lab_indicators || {};
    DB.synonyms = bundle.synonyms || {};
    loaded = true;
    return {
      patterns: Object.keys(DB.patterns).length,
      constitutions: Object.keys(DB.constitutions).length,
      symptoms: Object.keys(DB.symptoms).length,
      formulas: Object.keys(DB.formulas).length,
      labs: Object.keys(DB.labs).length
    };
  }

  return {
    version: '1.0.0',
    load: load,
    isLoaded: function () { return loaded; },
    normalizeSymptoms: normalizeSymptoms,
    diagnose: diagnose,
    constitution: constitution,
    lab: lab,
    formula: formula,
    parseRange: parseRange,
    list: { symptoms: listSymptoms, patterns: listPatterns, constitutions: listConstitutions, labs: listLabs },
    WEIGHTS: WEIGHTS,
    DISCLAIMER: '本工具为中医知识整理与参考，不是医疗器械，不提供医疗建议；方剂与用药必须由执业中医师面诊后决定。'
  };
});
