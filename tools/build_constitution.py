#!/usr/bin/env python3
"""生成 TCM v3 constitution.js（体质辨识 + 调理方案模块）
数据源: tiaoli.db（证型调理知识）+ 内嵌九种体质规则
用法: python3 build_constitution.py
"""
import sqlite3, json, os

BASE = "/opt/data/tcm_data/tcm_v3"
DB = "/opt/data/tcm_data/tiaoli.db"

# ── 1. 读取证型数据 ──────────────────────────────
def load_patterns():
    db = sqlite3.connect(DB)
    db.row_factory = sqlite3.Row
    cur = db.cursor()
    patterns = {}
    cur.execute('SELECT id, name, category, description, key_symptoms, tongue, pulse, principle FROM patterns')
    for r in cur.fetchall():
        patterns[r['id']] = {
            'id': r['id'], 'name': r['name'], 'category': r['category'],
            'description': r['description'],
            'symptoms': [s.strip() for s in r['key_symptoms'].split(',') if s.strip()],
            'tongue': r['tongue'], 'pulse': r['pulse'], 'principle': r['principle'],
            'formulas': [], 'diet': [], 'acupoints': [], 'lifestyle': []
        }
    cur.execute('SELECT pattern_id, name, source, ingredients, usage_method, notes FROM formulas')
    for r in cur.fetchall():
        if r['pattern_id'] in patterns:
            patterns[r['pattern_id']]['formulas'].append({
                'name': r['name'], 'source': r['source'],
                'ingredients': r['ingredients'], 'usage': r['usage_method'], 'notes': r['notes']
            })
    cur.execute('SELECT pattern_id, name, ingredients, method, efficacy, frequency FROM diet_therapy')
    for r in cur.fetchall():
        if r['pattern_id'] in patterns:
            patterns[r['pattern_id']]['diet'].append({
                'name': r['name'], 'ingredients': r['ingredients'],
                'method': r['method'], 'efficacy': r['efficacy'], 'frequency': r['frequency']
            })
    cur.execute('SELECT pattern_id, name, location, method, duration, caution FROM acupoints')
    for r in cur.fetchall():
        if r['pattern_id'] in patterns:
            patterns[r['pattern_id']]['acupoints'].append({
                'name': r['name'], 'location': r['location'],
                'method': r['method'], 'duration': r['duration'], 'caution': r['caution']
            })
    cur.execute('SELECT pattern_id, category, advice FROM lifestyle_advice')
    for r in cur.fetchall():
        if r['pattern_id'] in patterns:
            patterns[r['pattern_id']]['lifestyle'].append({'category': r['category'], 'advice': r['advice']})
    db.close()
    return patterns

# ── 2. 内嵌九种体质知识（中医体质九分法） ──────────
CONSTITUTIONS = {
    "平和质": {
        "features": ["精力充沛", "面色红润", "食欲好", "睡眠佳", "二便正常", "不易生病", "精神饱满"],
        "description": "阴阳气血调和，体态适中，面色红润，精力充沛。是最健康的体质类型。",
        "advice": {
            "diet": ["均衡饮食，五谷为养，多吃新鲜蔬果", "饮食有节，三餐定时定量，忌暴饮暴食"],
            "lifestyle": ["劳逸结合，保持规律作息", "每周3-5次有氧运动，如快走、慢跑、游泳", "保持心态平和，乐观开朗"],
            "acupoints": ["足三里（强壮要穴，每日按揉3分钟）", "涌泉（补肾安神，睡前按揉）"]
        }
    },
    "气虚质": {
        "features": ["容易疲劳", "乏力", "气短", "自汗", "易感冒", "声低", "懒言", "没精神", "稍动即喘", "面色苍白"],
        "description": "元气不足，以疲乏、气短、自汗等气虚表现为主要特征。",
        "advice": {
            "diet": ["黄芪山药粥、党参炖鸡、红枣桂圆茶", "多食小米、山药、大枣、鸡肉等补气食物", "忌生冷寒凉，少食耗气之品（萝卜过量、浓茶）"],
            "lifestyle": ["避免剧烈运动和大汗出，以散步、八段锦等温和运动为主", "保证充足睡眠，避免熬夜和过度劳累", "注意保暖，预防感冒"],
            "acupoints": ["足三里（补气要穴，按揉或艾灸）", "气海（培补元气，摩揉或艾灸）", "关元（固本培元）"]
        }
    },
    "阳虚质": {
        "features": ["怕冷", "手足凉", "畏寒", "喜热饮", "大便稀", "夜尿多", "四肢不温", "腰膝酸冷", "精神不振"],
        "description": "阳气不足，以畏寒怕冷、手足不温等虚寒表现为主要特征。",
        "advice": {
            "diet": ["当归生姜羊肉汤、韭菜炒核桃、姜枣茶", "多食羊肉、桂圆、核桃等温热食物", "忌生冷、冰饮、凉茶、西瓜等寒凉之品"],
            "lifestyle": ["注意腰腹、足部保暖，每晚热水泡脚20分钟", "多晒太阳，尤其后背督脉", "适度运动助阳气升发，避免大汗"],
            "acupoints": ["关元（温阳要穴，艾灸10-15分钟）", "命门（壮火益肾，艾灸或搓热按揉）", "足三里（艾灸补气）"]
        }
    },
    "阴虚质": {
        "features": ["口干", "手足心热", "盗汗", "大便干", "喜冷饮", "五心烦热", "潮热", "失眠多梦", "舌红少苔", "咽干"],
        "description": "阴液亏少，以口燥咽干、手足心热等虚热表现为主要特征。",
        "advice": {
            "diet": ["百合银耳羹、生地麦冬茶、石斛炖瘦肉", "多食银耳、百合、梨、莲藕、鸭肉等滋阴食材", "忌辛辣燥热（辣椒、羊肉、酒类），少熬夜"],
            "lifestyle": ["保证夜间睡眠，11点前入睡，避免熬夜", "避免情绪波动过大，可练习静坐或冥想", "运动以中小强度为宜，避免大汗伤阴"],
            "acupoints": ["三阴交（滋阴要穴）", "太溪（补肾阴）", "涌泉（引火归元，睡前按揉）"]
        }
    },
    "痰湿质": {
        "features": ["体型偏胖", "肥胖", "腹部肥满", "口中黏腻", "大便黏", "苔白腻", "痰多", "身体困重", "胸闷", "容易困倦"],
        "description": "痰湿凝聚，以形体肥胖、腹部肥满、口黏苔腻等表现为主要特征。",
        "advice": {
            "diet": ["薏米赤小豆汤、冬瓜薏米汤、陈皮普洱茶、白扁豆粥", "少食肥甘厚味、甜食、油炸及酒类", "多食冬瓜、薏米、赤小豆、白萝卜等祛湿食物"],
            "lifestyle": ["坚持运动，适度出汗有助祛湿（快走、慢跑）", "居住环境保持干燥通风，避免潮湿", "晚餐七分饱，忌夜宵"],
            "acupoints": ["丰隆（化痰要穴）", "阴陵泉（健脾祛湿）", "中脘（和胃化湿）"]
        }
    },
    "湿热质": {
        "features": ["口苦", "口臭", "面部油", "痤疮", "长痘", "大便黏滞", "小便黄", "舌苔黄腻", "身体困重", "易生疮疖"],
        "description": "湿热内蕴，以面垢油光、口苦苔黄腻等湿热表现为主要特征。",
        "advice": {
            "diet": ["绿豆薏米汤、冬瓜汤、苦瓜、菊花茶", "忌油腻、甜食、煎炸、辛辣及酒类", "多食冬瓜、苦瓜、薏米、绿豆、赤小豆等清热利湿食物"],
            "lifestyle": ["适当运动出汗有助于湿热排出", "避免长时间处于潮湿闷热环境，保持居室通风", "保证睡眠，避免熬夜生内热"],
            "acupoints": ["曲池（清热）", "阴陵泉（利湿）", "丰隆（化痰祛湿）"]
        }
    },
    "血瘀质": {
        "features": ["面色晦暗", "唇色紫暗", "皮肤瘀斑", "痛经", "舌紫暗", "身体局部刺痛", "固定刺痛", "面色暗沉", "易有黑眼圈"],
        "description": "血行不畅，以肤色晦暗、舌质紫暗等血瘀表现为主要特征。",
        "advice": {
            "diet": ["山楂红糖水、三七煲汤、丹参茶、黑木耳", "多食山楂、黑木耳、洋葱、红糖等活血食物", "忌生冷寒凉，以免加重血凝"],
            "lifestyle": ["坚持适度运动促进气血运行（散步、太极、八段锦）", "保持心情愉悦，避免久坐久卧", "注意保暖，避免受寒"],
            "acupoints": ["血海（活血要穴）", "膈俞（活血化瘀）", "三阴交（调经活血）"]
        }
    },
    "气郁质": {
        "features": ["情绪低落", "敏感多虑", "胁肋胀", "嗳气", "脉弦", "易怒", "叹气", "胸闷", "喜欢叹气", "咽部异物感"],
        "description": "气机郁滞，以神情抑郁、忧虑脆弱等气郁表现为主要特征。",
        "advice": {
            "diet": ["玫瑰花茶、佛手柑茶、金桔柠檬茶、陈皮水", "多食行气解郁之品（玫瑰、佛手、金桔、薄荷）", "少食收敛酸涩及油腻碍气之物"],
            "lifestyle": ["主动调节情绪，多倾诉、多社交", "练习八段锦、太极拳、瑜伽等舒展运动", "培养兴趣爱好，减少思虑压力"],
            "acupoints": ["太冲（疏肝解郁要穴）", "期门（理气）", "内关（宽胸解郁）"]
        }
    },
    "特禀质": {
        "features": ["过敏体质", "哮喘", "荨麻疹", "药物过敏", "鼻塞", "过敏性鼻炎", "皮肤瘙痒", "食物过敏", "花粉过敏"],
        "description": "先天失常，以生理缺陷、过敏反应等为主要特征。",
        "advice": {
            "diet": ["玉屏风散（黄芪、白术、防风）调理，黄芪粥固表", "多食山药、大枣、灵芝等扶正食物", "避免已知过敏原，慎食海鲜、辛辣刺激食物"],
            "lifestyle": ["保持居室清洁，避免尘螨、花粉等过敏原", "适度锻炼增强体质，注意保暖预防感冒", "外出可戴口罩，过敏季节减少外出"],
            "acupoints": ["足三里（扶正固本）", "肺俞（固表）", "迎香（通鼻窍）"]
        }
    }
}

# ── 3. JS 模板 ─────────────────────────────────
TEMPLATE = r"""// ============================================================
// TCM v3 体质辨识 + 调理方案模块
// 文件: constitution.js
// ------------------------------------------------------------
// 功能:
//   1. analyzeConstitution(symptoms, env) — 体质辨识
//      输入症状 → 查 KV tcm:constitution:*（九种体质）→ 规则打分
//      → 返回体质判定 + 置信度 + 调理建议
//   2. getPlan(patternName, env) — 调理方案
//      输入证型名 → 查 KV tcm:pattern:* → 返回结构化调理方案
//      （方剂 / 饮食 / 穴位 / 生活建议）
//   3. matchKeywords(text, keywords) — 关键词命中数统计
// ------------------------------------------------------------
// 数据源: Cloudflare KV（tcm:constitution:* / tcm:pattern:*），
//         KV 不可用或未绑定时自动回退到内嵌数据（九种体质 + 10 证型）。
// 格式:   ES Module（export 函数），同时挂载到 globalThis，
//         兼容 build_v3_worker.py 的 Service Worker 拼接构建。
// ============================================================

// ─── 内嵌九种体质知识（KV 回退数据） ─────────────
const CONSTITUTIONS = __CONSTITUTIONS__;

// ─── 内嵌证型调理知识（来自 tiaoli.db，KV 回退数据） ───
const PATTERNS = __PATTERNS__;

// 体质判定并列时的参考顺序
const CONSTITUTION_ORDER = ['平和质', '气虚质', '阳虚质', '阴虚质', '痰湿质', '湿热质', '血瘀质', '气郁质', '特禀质'];

const DISCLAIMER = '本结果由中医体质规则模型自动生成，仅供健康参考，不构成医疗诊断。如有明显不适请及时就医。';

// ════════════════════════════════════════════════════════════
// 工具函数
// ════════════════════════════════════════════════════════════

/** 统计 text 中命中 keywords 的数量（子串匹配）
 *  @param {string} text     待匹配文本（症状描述）
 *  @param {string[]} keywords 关键词数组（体质特征 / 症状）
 *  @returns {number} 命中数 */
function matchKeywords(text, keywords) {
  if (!text || !Array.isArray(keywords) || keywords.length === 0) return 0;
  let hits = 0;
  for (const kw of keywords) {
    if (kw && text.includes(kw)) hits++;
  }
  return hits;
}

/** 命中明细版：返回 { hits, matched }（供内部评分使用） */
function matchKeywordsDetail(text, keywords) {
  const matched = [];
  if (text && Array.isArray(keywords)) {
    for (const kw of keywords) {
      if (kw && text.includes(kw)) matched.push(kw);
    }
  }
  return { hits: matched.length, matched };
}

/** 归一化证型/体质名：去空白、去括号内容、去「证/症/病」尾缀 */
function normalizeName(name) {
  if (!name) return '';
  return String(name)
    .replace(/[\s\u3000]+/g, '')            // 去空白
    .replace(/[（(].*?[)）]/g, '')            // 去括号内容
    .replace(/[证症病]$/, '')                // 去尾缀
    .toLowerCase();
}

/** 生成证型名匹配变体：原样 + 去尾缀 */
function nameVariants(raw) {
  const out = [raw];
  const t = String(raw).replace(/[证症]$/, '');
  if (t !== raw) out.push(t);
  return out;
}

/** 从对象中取第一个存在的字段值 */
function pick(obj, keys, fallback = null) {
  if (!obj || typeof obj !== 'object') return fallback;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return fallback;
}

/** 统一转为字符串数组（兼容字符串/数组输入） */
function toArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(s => (typeof s === 'string' ? s.trim() : s)).filter(Boolean);
  if (typeof v === 'string') return v.split(/[,，、;；\n]/).map(s => s.trim()).filter(Boolean);
  return [v];
}

/** 统一转为对象数组（兼容 [{...}] / [字符串] / 字符串） */
function toObjArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) {
    return v.map(item => {
      if (typeof item === 'string') return { name: item };
      if (item && typeof item === 'object') return item;
      return { name: String(item) };
    });
  }
  if (typeof v === 'string') return v.split(/[,，、;；]/).map(s => ({ name: s.trim() })).filter(o => o.name);
  return [];
}

/** KV 读取并解析 JSON，失败返回 fallback */
async function kvGetJSON(env, key, fallback = null) {
  try {
    if (env && env.TCM_KV) {
      const v = await env.TCM_KV.get(key);
      if (v) return JSON.parse(v);
    }
  } catch (e) { /* KV 异常时静默降级到 fallback */ }
  return fallback;
}

/** 按前缀列出 KV 键值（返回 { 去掉前缀的name: 解析后的value }） */
async function kvListPrefix(env, prefix) {
  const out = {};
  try {
    if (env && env.TCM_KV) {
      const list = await env.TCM_KV.list({ prefix });
      for (const k of list.keys || []) {
        const name = k.name.replace(prefix, '');
        const v = await env.TCM_KV.get(k.name);
        if (v) {
          try { out[name] = JSON.parse(v); } catch (e) { out[name] = v; }
        }
      }
    }
  } catch (e) { /* KV 异常时返回空对象 */ }
  return out;
}

/** 提取体质对象中的特征关键词（兼容不同字段命名） */
function extractFeatures(info, fallback = []) {
  return toArray(pick(info, ['features', 'keywords', 'symptoms', 'key_symptoms', '特征', '症状', '特征表现']))
    || fallback;
}

/** 提取体质对象中的调理建议（兼容嵌套/平铺结构） */
function extractAdvice(info) {
  const adv = {};
  // 直接字段
  adv.diet = toObjArray(pick(info, ['diet', 'food', '饮食', '食疗', 'food_advice']));
  adv.lifestyle = toObjArray(pick(info, ['lifestyle', 'daily', '起居', '生活', 'lifestyle_advice']));
  adv.acupoints = toObjArray(pick(info, ['acupoints', '穴位', 'acupoint']));
  // 嵌套对象（advice / 调理建议 / 调理 / plan）
  const nested = pick(info, ['advice', '调理建议', '调理', 'plan'], null);
  if (nested && typeof nested === 'object') {
    if (!adv.diet.length) adv.diet = toObjArray(pick(nested, ['diet', 'food', '饮食', '食疗']));
    if (!adv.lifestyle.length) adv.lifestyle = toObjArray(pick(nested, ['lifestyle', 'daily', '起居', '生活']));
    if (!adv.acupoints.length) adv.acupoints = toObjArray(pick(nested, ['acupoints', '穴位']));
    // 字符串形式建议兜底
    if (!adv.diet.length && !adv.lifestyle.length && !adv.acupoints.length) {
      const str = pick(nested, ['summary', 'text', '内容'], '');
      if (str) adv.lifestyle = toObjArray(str);
    }
  }
  return adv;
}

/** 置信度计算：命中数/特征总数，命中≥3 时至少 0.75 */
function calcConfidence(hits, total) {
  if (total <= 0) return hits > 0 ? 0.5 : 0;
  let c = hits / total;
  if (hits >= 3) c = Math.max(c, 0.75);
  return Math.round(Math.min(1, c) * 100) / 100;
}

/** 从体质条目组装调理建议输出 */
function buildConstitutionAdvice(entry) {
  const info = entry.info || {};
  // 优先 KV 中自带建议，否则用内嵌建议
  let adv = extractAdvice(info);
  if (!adv.diet.length && !adv.lifestyle.length && !adv.acupoints.length) {
    const embedded = CONSTITUTIONS[entry.name];
    if (embedded && embedded.advice) {
      adv = {
        diet: toObjArray(embedded.advice.diet),
        lifestyle: toObjArray(embedded.advice.lifestyle),
        acupoints: toObjArray(embedded.advice.acupoints),
      };
    }
  }
  return adv;
}

// ════════════════════════════════════════════════════════════
// 1. 体质辨识
// ════════════════════════════════════════════════════════════

/** 体质辨识：症状 → 九种体质规则打分 → 判定 + 置信度 + 调理建议
 *  @param {string} symptoms 症状描述（如 "容易疲劳，气短，自汗"）
 *  @param {object} env      Worker 环境（含 TCM_KV 绑定；测试可传 null）
 *  @returns {Promise<object>} JSON 结果 */
export async function analyzeConstitution(symptoms, env) {
  const text = String(symptoms || '').trim();
  if (!text) {
    return { error: '请输入症状描述', disclaimer: DISCLAIMER };
  }

  // 1) 加载体质库：KV 优先，内嵌回退
  let constitutionLib = null;
  let method = 'embedded';
  if (env && env.TCM_KV) {
    try {
      const listed = await kvListPrefix(env, 'tcm:constitution:');
      if (listed && Object.keys(listed).length > 0) {
        constitutionLib = listed;
        method = 'kv';
      }
    } catch (e) { /* 忽略，走内嵌 */ }
  }
  if (!constitutionLib) constitutionLib = Object.assign({}, CONSTITUTIONS);

  // 2) 规则打分：每个体质的特征关键词在症状文本中的命中数
  const scores = [];
  for (const [name, info] of Object.entries(constitutionLib)) {
    const features = extractFeatures(info);
    const detail = matchKeywordsDetail(text, features);
    if (detail.hits === 0) continue;
    scores.push({
      name,
      hits: detail.hits,
      confidence: calcConfidence(detail.hits, features.length),
      matched: detail.matched,
      info,
    });
  }

  // 排序：命中数优先，其次置信度，再按体质参考顺序
  scores.sort((a, b) => {
    if (b.hits !== a.hits) return b.hits - a.hits;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    const ia = CONSTITUTION_ORDER.indexOf(a.name);
    const ib = CONSTITUTION_ORDER.indexOf(b.name);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  if (scores.length === 0) {
    return {
      error: '未匹配到明确体质特征，请补充更多症状描述',
      matched: false,
      method,
      disclaimer: DISCLAIMER,
    };
  }

  const primary = scores[0];
  const info = primary.info || {};
  const description = pick(info, ['description', 'desc', '概述', '特征描述'], '')
    || (CONSTITUTIONS[primary.name] ? CONSTITUTIONS[primary.name].description : '');

  return {
    constitution: primary.name,
    confidence: primary.confidence,
    matched_keywords: primary.matched,
    matched_count: primary.hits,
    description,
    advice: buildConstitutionAdvice(primary),
    candidates: scores.slice(0, 3).map(s => ({
      name: s.name, hits: s.hits, confidence: s.confidence, matched: s.matched,
    })),
    method,
    disclaimer: DISCLAIMER,
  };
}

// ════════════════════════════════════════════════════════════
// 2. 调理方案
// ════════════════════════════════════════════════════════════

/** 调理方案：证型名 → KV tcm:pattern:* → 结构化方案
 *  @param {string} patternName 证型名（如 "肝气郁结" / "ganyu"）
 *  @param {object} env         Worker 环境（含 TCM_KV 绑定；测试可传 null）
 *  @returns {Promise<object>} JSON 结果 */
export async function getPlan(patternName, env) {
  const raw = String(patternName || '').trim();
  if (!raw) {
    return { error: '请输入证型名', disclaimer: DISCLAIMER };
  }

  const variants = nameVariants(raw);
  let data = null;
  let method = 'embedded';

  // 1) KV 查询（优先）
  if (env && env.TCM_KV) {
    try {
      // 1a) 直接 get 尝试（key 可能是证型名或 id）
      for (const cand of variants) {
        const v = await kvGetJSON(env, `tcm:pattern:${cand}`);
        if (v) { data = v; method = 'kv'; break; }
      }
      // 1b) 前缀遍历匹配（容忍 key 命名差异，如 tcm:pattern:肝气郁结 / ganyu）
      if (!data) {
        const listed = await kvListPrefix(env, 'tcm:pattern:');
        const normVariants = variants.map(normalizeName).filter(Boolean);
        for (const [key, val] of Object.entries(listed)) {
          const normKey = normalizeName(key);
          const keyMatches = normVariants.some(v => normKey === v || normKey.includes(v) || v.includes(normKey));
          if (keyMatches || variants.some(v => key.includes(v))) {
            data = val; method = 'kv'; break;
          }
        }
      }
    } catch (e) { /* 忽略，走内嵌 */ }
  }

  // 2) 内嵌证型库回退
  if (!data) {
    const normVariants = variants.map(normalizeName).filter(Boolean);
    for (const pid of Object.keys(PATTERNS)) {
      const p = PATTERNS[pid];
      const candNames = [pid, p.name || ''].map(normalizeName).filter(Boolean);
      if (normVariants.some(v => candNames.includes(v) || candNames.some(c => c.includes(v)))) {
        data = p; method = 'embedded'; break;
      }
    }
  }

  if (!data) {
    return {
      error: `未找到证型「${raw}」`,
      found: false,
      hint: '请尝试：肝气郁结 / 脾气虚弱 / 阴虚火旺 / 湿热内蕴 / 寒湿困脾 / 肾阳虚衰 等',
      method,
      disclaimer: DISCLAIMER,
    };
  }

  // 3) 组装结构化结果（兼容不同字段命名）
  return {
    pattern: pick(data, ['name', 'pattern', '证型'], ''),
    pattern_id: pick(data, ['id', 'pattern_id', 'key'], ''),
    category: pick(data, ['category', '分类'], ''),
    found: true,
    description: pick(data, ['description', 'desc', '概述', '描述'], ''),
    symptoms: toArray(pick(data, ['symptoms', 'key_symptoms', '症状'], [])),
    tongue: pick(data, ['tongue', '舌象'], ''),
    pulse: pick(data, ['pulse', '脉象'], ''),
    principle: pick(data, ['principle', '治法', '治则', '调理原则'], ''),
    formulas: toObjArray(pick(data, ['formulas', 'formula', '方剂'], [])),
    diet: toObjArray(pick(data, ['diet', 'diet_therapy', '食疗', '饮食'], [])),
    acupoints: toObjArray(pick(data, ['acupoints', '穴位'], [])),
    lifestyle: toObjArray(pick(data, ['lifestyle', 'lifestyle_advice', '生活建议', '起居'], [])),
    method,
    disclaimer: DISCLAIMER,
  };
}

// ════════════════════════════════════════════════════════════
// 导出 + globalThis 挂载（兼容 Service Worker 拼接构建）
// ════════════════════════════════════════════════════════════

export { matchKeywords, CONSTITUTIONS, PATTERNS };

if (typeof globalThis !== 'undefined') {
  globalThis.analyzeConstitution = analyzeConstitution;
  globalThis.getPlan = getPlan;
  globalThis.matchKeywords = matchKeywords;
  globalThis.CONSTITUTIONS = CONSTITUTIONS;
  globalThis.PATTERNS = PATTERNS;
}
"""

# ── 4. 注入数据并写出 ─────────────────────────────
def main():
    patterns = load_patterns()
    js = TEMPLATE
    js = js.replace('__CONSTITUTIONS__', json.dumps(CONSTITUTIONS, ensure_ascii=False, indent=2))
    js = js.replace('__PATTERNS__', json.dumps(patterns, ensure_ascii=False, indent=2))
    out = os.path.join(BASE, "constitution.js")
    with open(out, "w", encoding="utf-8") as f:
        f.write(js)
    print(f"✅ {out} ({len(js)} 字节, {len(patterns)} 个证型, {len(CONSTITUTIONS)} 种体质)")

if __name__ == "__main__":
    main()
