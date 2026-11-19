/**
 * ai_diagnose.js — TCM v3 AI 辨证模块
 *
 * 职责：输入用户症状 + 古籍检索片段（retrievedTexts），输出结构化中医辨证结果
 *   { pattern, analysis, suggestions, formula, basis }
 *
 * 三级策略（按优先级依次尝试）：
 *   1. Workers AI（env.AI binding）— 默认 provider，模型 @cf/deepseek-ai/deepseek-r1-distill-qwen-32b
 *   2. 外部 LLM（预留）— provider=external 时，用 fetch 调 OpenAI 兼容 API
 *      （base_url + api_key + model 从 KV tcm:config:llm 或环境变量读取）
 *   3. 规则降级 — LLM 不可用时，症状关键词 → KV 证型库 tcm:pattern:* 匹配，返回结构化结果
 *
 * 模块格式：ES module（export 函数），Cloudflare Worker 环境可用 fetch / env.AI / env.TCM_KV。
 * 无第三方依赖，纯标准 JavaScript。
 *
 * 配置优先级（后写覆盖先写）：
 *   KV key "tcm:config:llm"（JSON）> 环境变量（LLM_PROVIDER / LLM_BASE_URL / LLM_API_KEY / LLM_MODEL）> 代码默认值
 *   KV 配置示例：
 *   {
 *     "provider": "external",
 *     "external_base": "https://api.deepseek.com/v1",
 *     "external_key": "sk-xxx",        // 或省略，用 env.LLM_API_KEY
 *     "external_model": "deepseek-chat",
 *     "workers_model": "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b"
 *   }
 */

export const AI_DIAGNOSE_VERSION = '1.0.0';

// ─── 默认配置 ───────────────────────────────────────────────
const DEFAULT_CONFIG = {
  provider: 'workers-ai',                                   // workers-ai | external
  workers_model: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
  external_base: '',                                        // 预留: https://api.deepseek.com/v1
  external_key: '',                                         // 预留: DEEPSEEK_API_KEY
  external_model: '',                                       // 预留: deepseek-chat
  timeout_ms: 30000,                                        // LLM 调用超时
  max_tokens: 1000,
  temperature: 0.6,
};

// ─── 内置规则库（KV 证型库缺失时的兜底）──────────────────────
// 症状关键词 → 证型。KV tcm:pattern:* 存在时以 KV 为准，本表仅用于无 KV 环境的降级。
const BUILTIN_RULES = [
  {
    pattern: '肝气郁结',
    keywords: ['胸闷', '胁痛', '两胁', '善太息', '叹气', '情志', '抑郁', '易怒', '烦躁', '乳房胀痛', '月经不调', '梅核气', '咽部异物感'],
    desc: '情志不舒，肝失疏泄，气机郁滞',
    suggestions: ['疏肝解郁，调畅情志', '可饮玫瑰花茶、陈皮茶', '按揉太冲穴、膻中穴', '适度运动，避免久坐郁结'],
    formula: '柴胡疏肝散加减',
  },
  {
    pattern: '脾气虚弱',
    keywords: ['食欲不振', '纳差', '食少', '腹胀', '便溏', '腹泻', '大便稀', '神疲', '乏力', '倦怠', '面色萎黄', '消瘦'],
    desc: '脾气亏虚，运化失健，气血生化乏源',
    suggestions: ['健脾益气，规律饮食', '山药、薏米、大枣煮粥', '按揉足三里、中脘穴', '忌生冷油腻，细嚼慢咽'],
    formula: '四君子汤加减',
  },
  {
    pattern: '阴虚火旺',
    keywords: ['口干', '咽干', '舌燥', '五心烦热', '潮热', '盗汗', '颧红', '失眠', '多梦', '腰膝酸软', '耳鸣', '大便干'],
    desc: '阴液亏虚，虚火内生',
    suggestions: ['滋阴降火，忌辛辣燥热', '银耳、百合、枸杞煲汤', '按揉太溪穴、涌泉穴', '早睡养阴，避免熬夜'],
    formula: '知柏地黄丸加减',
  },
  {
    pattern: '湿热内蕴',
    keywords: ['口苦', '口黏', '舌苔黄腻', '身重', '困重', '小便黄', '大便黏', '带下黄', '皮肤油腻', '湿疹', '痤疮'],
    desc: '湿热蕴结中焦或下焦，气机受阻',
    suggestions: ['清热利湿，清淡饮食', '薏米、赤小豆煮水', '按揉阴陵泉、丰隆穴', '忌酒忌甜腻，多饮水'],
    formula: '龙胆泻肝汤或三仁汤加减',
  },
  {
    pattern: '气虚血瘀',
    keywords: ['神疲乏力', '气短', '面色晦暗', '唇甲青紫', '刺痛', '痛处固定', '舌质紫暗', '瘀斑', '肢体麻木'],
    desc: '气虚推动无力，血行不畅成瘀',
    suggestions: ['益气活血，适度活动', '黄芪、丹参、山楂代茶饮', '按揉血海、足三里穴', '注意保暖，避免久坐'],
    formula: '补阳还五汤加减',
  },
  {
    pattern: '寒湿困脾',
    keywords: ['脘腹冷痛', '怕冷', '喜温', '大便稀溏', '口中黏腻', '食欲不振', '身重困倦', '舌苔白腻', '浮肿'],
    desc: '寒湿内停，困阻脾阳，运化失职',
    suggestions: ['温中散寒，健脾化湿', '生姜、陈皮、茯苓煮水', '按揉中脘、足三里穴', '忌生冷寒凉，注意腹部保暖'],
    formula: '平胃散合苓桂术甘汤加减',
  },
  {
    pattern: '肺气虚弱',
    keywords: ['气短', '乏力', '自汗', '易感冒', '咳嗽无力', '声低', '畏风', '面色淡白', '痰清稀'],
    desc: '肺气亏虚，卫外不固，宣降失常',
    suggestions: ['补肺益气，固护卫表', '黄芪、党参、山药炖汤', '按揉肺俞、足三里穴', '适度锻炼，防寒保暖'],
    formula: '玉屏风散合补肺汤加减',
  },
  {
    pattern: '痰热壅肺',
    keywords: ['咳嗽', '痰黄', '痰黏', '痰多', '发热', '口渴', '胸闷', '喘息', '气促', '舌红苔黄腻'],
    desc: '痰热互结，壅阻于肺，肺失宣降',
    suggestions: ['清热化痰，宣肺止咳', '川贝、雪梨、枇杷煮水', '按揉尺泽、丰隆穴', '忌辛辣煎炸，多饮温水'],
    formula: '清金化痰汤加减',
  },
  {
    pattern: '心脾两虚',
    keywords: ['失眠', '多梦', '心悸', '健忘', '食少', '腹胀', '便溏', '神疲乏力', '面色萎黄', '头晕'],
    desc: '心血不足，脾气亏虚，心神失养',
    suggestions: ['补益心脾，养血安神', '桂圆、莲子、红枣煮粥', '按揉神门、足三里穴', '睡前放松，避免思虑过度'],
    formula: '归脾汤加减',
  },
  {
    pattern: '肾阳虚衰',
    keywords: ['畏寒', '怕冷', '四肢不温', '腰膝冷痛', '夜尿多', '小便清长', '精神萎靡', '阳痿', '性欲减退', '五更泄泻'],
    desc: '肾阳不足，温煦失职，气化无权',
    suggestions: ['温补肾阳，注意保暖', '羊肉、核桃、韭菜温补', '按揉肾俞、关元穴', '适度运动，节制房劳'],
    formula: '金匮肾气丸加减',
  },
];

// ─── 工具函数 ───────────────────────────────────────────────

/** 归一化文本：提取中文字符（与古籍检索 tokenize 一致的口径） */
function normText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[\s，。、；：！？,.!?;:()（）"'“”‘’《》<>]/g, '');
}

/** 症状文本切分为单字+双字 token（多粒度，避免用词差异漏匹配） */
function symptomTokens(text) {
  const chars = [...String(text || '')].filter(c => /[\u4e00-\u9fff]/.test(c));
  const tokens = new Set(chars);
  for (let i = 0; i < chars.length - 1; i++) tokens.add(chars[i] + chars[i + 1]);
  for (let i = 0; i < chars.length - 2; i++) tokens.add(chars[i] + chars[i + 1] + chars[i + 2]);
  return [...tokens];
}

/** 读取 LLM 配置：KV(tcm:config:llm) > 环境变量 > 默认值。KV 失败静默降级，不影响主流程。 */
async function loadLlmConfig(env) {
  const cfg = { ...DEFAULT_CONFIG };
  try {
    if (env && env.TCM_KV) {
      const raw = await env.TCM_KV.get('tcm:config:llm');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') Object.assign(cfg, parsed);
      }
    }
  } catch (e) {
    console.log('[ai_diagnose] KV 配置读取失败，使用环境变量/默认配置:', e.message);
  }
  // 环境变量覆盖（后写覆盖先写）
  if (env) {
    if (env.LLM_PROVIDER) cfg.provider = env.LLM_PROVIDER;
    if (env.LLM_BASE_URL) cfg.external_base = env.LLM_BASE_URL;
    if (env.LLM_API_KEY) cfg.external_key = env.LLM_API_KEY;
    if (env.LLM_MODEL) cfg.external_model = env.LLM_MODEL;
  }
  return cfg;
}

/** 从 KV 读证型库条目（tcm:pattern:<证型名>），失败返回 null */
async function getKvPattern(env, patternName) {
  try {
    if (env && env.TCM_KV) {
      const raw = await env.TCM_KV.get('tcm:pattern:' + patternName);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    }
  } catch (e) {
    console.log('[ai_diagnose] KV 证型读取失败:', patternName, e.message);
  }
  return null;
}

/** 构造 LLM system prompt（辨证要求 + 严格 JSON 输出约束） */
function buildSystemPrompt() {
  return [
    '你是资深中医师（TCM 健康顾问）。请根据用户描述的症状和提供的古籍文献片段，进行中医辨证分析。',
    '要求：',
    '1. 专业、准确，引用古籍依据时注明出处；',
    '2. 语言通俗易懂，适合普通用户阅读；',
    '3. 必须只输出一个 JSON 对象，不要输出任何其他文字、markdown 代码块或解释。',
    'JSON 格式（字段含义）：',
    '{',
    '  "pattern": "证型名称，如 肝气郁结",',
    '  "analysis": "辨证分析：病机、症状对应、舌脉（如有），150字左右",',
    '  "suggestions": ["调理建议1（含饮食/情志/运动）", "调理建议2", ...],',
    '  "formula": "推荐方剂（如 柴胡疏肝散加减）",',
    '  "basis": "古籍依据：引用检索到的原文片段及出处，说明为何支持此辨证"',
    '}',
  ].join('\n');
}

/** 构造 user prompt：症状 + 古籍片段 */
function buildUserPrompt(query, retrievedTexts) {
  let prompt = '用户症状描述：\n' + (query || '（无）') + '\n\n';
  if (Array.isArray(retrievedTexts) && retrievedTexts.length > 0) {
    prompt += '相关古籍文献片段（供辨证参考）：\n';
    retrievedTexts.forEach((r, i) => {
      const src = (r && r.book) || (r && r.source) || '';
      const text = (r && (r.text || r.content)) || '';
      prompt += `[${i + 1}] ${src ? '《' + src + '》' : ''} ${String(text).slice(0, 300)}\n`;
    });
  } else {
    prompt += '（未检索到相关古籍片段，请依据中医理论辨证）\n';
  }
  prompt += '\n请输出 JSON 辨证结果。';
  return prompt;
}

/**
 * 从 LLM 输出中提取 JSON 对象。
 * 容忍：纯 JSON、被 ```json ``` 包裹、前后有杂散文字。
 */
function extractJson(text) {
  if (!text) return null;
  let t = String(text).trim();
  // 去掉 markdown 代码块围栏
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  // 直接解析
  try {
    return JSON.parse(t);
  } catch (e) { /* 继续 */ }
  // 截取第一个 { 到最后一个 } 再解析
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(t.slice(start, end + 1));
    } catch (e2) { /* 继续 */ }
  }
  return null;
}

/** 校验/规整辨证结果，补全缺失字段 */
function normalizeResult(obj, fallbackPattern) {
  const result = {
    pattern: String((obj && obj.pattern) || fallbackPattern || '未辨证'),
    analysis: String((obj && obj.analysis) || '（暂无辨证分析）'),
    suggestions: Array.isArray(obj && obj.suggestions)
      ? obj.suggestions.map(s => String(s))
      : [],
    formula: String((obj && obj.formula) || '（暂无推荐方剂）'),
    basis: String((obj && obj.basis) || ''),
  };
  return result;
}

/**
 * 规则降级：症状关键词 → 证型（内置规则库 + KV 证型库增强）
 * 返回统一 JSON 结果，绝不抛异常。
 */
async function ruleBasedDiagnose(query, retrievedTexts, env) {
  const tokens = symptomTokens(query);
  const text = normText(query);

  // 1. 用 token 匹配内置规则库，取命中关键词最多的证型
  let best = null;
  let bestHits = 0;
  for (const rule of BUILTIN_RULES) {
    let hits = 0;
    for (const kw of rule.keywords) {
      if (text.includes(kw)) hits++;
    }
    if (hits > bestHits) {
      bestHits = hits;
      best = rule;
    }
  }
  // 双字 token 交叉验证（如症状含 "胁痛"、"胸闷" 等双字词）
  if (!best) {
    for (const rule of BUILTIN_RULES) {
      let hits = 0;
      for (const kw of rule.keywords) {
        if (tokens.includes(kw)) hits++;
      }
      if (hits > bestHits) {
        bestHits = hits;
        best = rule;
      }
    }
  }

  // 2. 若命中，尝试用 KV 证型库增强（suggestions/formula 以 KV 为准）
  let kvInfo = null;
  if (best) {
    kvInfo = await getKvPattern(env, best.pattern);
  }

  const result = {
    pattern: best ? best.pattern : '（无法自动辨证）',
    analysis: best
      ? (kvInfo && kvInfo.description) || best.desc
      : '未能从症状中匹配到明确证型。建议补充更多症状细节（如舌象、脉象、二便、饮食睡眠等），或尝试 AI 辨证。',
    suggestions: [],
    formula: '',
    basis: '',
  };
  if (best) {
    result.suggestions = (kvInfo && kvInfo.suggestions) || best.suggestions;
    result.formula = (kvInfo && kvInfo.formula) || best.formula;
    // 古籍依据：从检索片段里挑出与证型关键词相关的片段
    const related = (Array.isArray(retrievedTexts) ? retrievedTexts : []).filter(r => {
      const t = String((r && (r.text || r.content)) || '');
      return best.keywords.some(kw => t.includes(kw));
    });
    if (related.length > 0) {
      result.basis = related.slice(0, 2)
        .map(r => `《${(r && r.book) || (r && r.source) || '古籍'}》：${String((r && (r.text || r.content)) || '').slice(0, 120)}`)
        .join('\n');
    } else if (kvInfo && kvInfo.basis) {
      result.basis = kvInfo.basis;
    }
  }
  return result;
}

/**
 * Workers AI 调用（env.AI binding，@cf/... 模型走 LLM 文本生成接口）
 * 兼容两种响应形态：text/string 或 { response: ... }
 */
async function callWorkersAI(query, retrievedTexts, cfg, env) {
  if (!env || !env.AI) throw new Error('Workers AI binding (env.AI) 未配置');
  const response = await env.AI.run(cfg.workers_model, {
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: buildUserPrompt(query, retrievedTexts) },
    ],
    max_tokens: cfg.max_tokens,
    temperature: cfg.temperature,
  });
  let text = '';
  if (typeof response === 'string') {
    text = response;
  } else if (response && typeof response === 'object') {
    if (typeof response.response === 'string') text = response.response;
    else if (Array.isArray(response.output)) {
      // 部分 Workers AI 文本模型返回 { output: [{ response: '...' }] }
      text = response.output.map(o => (o && (o.response || o.text)) || '').join('');
    } else if (response.output && typeof response.output === 'string') {
      text = response.output;
    }
  }
  if (!text) throw new Error('Workers AI 返回为空或格式不识别');
  return extractJson(text);
}

/**
 * 外部 LLM 调用（OpenAI 兼容 chat/completions API）
 * 配置：KV tcm:config:llm 或环境变量 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL
 */
async function callExternalLLM(query, retrievedTexts, cfg) {
  const base = (cfg.external_base || '').replace(/\/+$/, '');
  const key = cfg.external_key;
  const model = cfg.external_model;
  if (!base || !key || !model) {
    throw new Error('外部 LLM 配置不完整：需要 base_url / api_key / model（KV tcm:config:llm 或环境变量）');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeout_ms || 30000);
  try {
    const resp = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          { role: 'user', content: buildUserPrompt(query, retrievedTexts) },
        ],
        max_tokens: cfg.max_tokens,
        temperature: cfg.temperature,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const errText = (await resp.text()).slice(0, 200);
      throw new Error(`外部 LLM HTTP ${resp.status}: ${errText}`);
    }
    const data = await resp.json();
    const text = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    if (!text) throw new Error('外部 LLM 返回为空');
    return extractJson(text);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 主入口：AI 辨证
 * @param {string} query 用户症状描述
 * @param {Array} retrievedTexts 古籍检索片段 [{book, text, score}]
 * @param {Object} env Worker 环境（env.AI / env.TCM_KV / 环境变量）
 * @returns {Promise<Object>} { pattern, analysis, suggestions, formula, basis }
 */
export async function diagnose(query, retrievedTexts, env) {
  query = String(query || '').trim();
  if (!query) {
    return normalizeResult({}, '请输入症状描述');
  }
  let cfg = null;
  try {
    cfg = await loadLlmConfig(env);
  } catch (e) {
    cfg = { ...DEFAULT_CONFIG };
  }

  const provider = (cfg.provider || 'workers-ai').toLowerCase();

  // 1) 优先 LLM 辨证
  try {
    let parsed = null;
    if (provider === 'external') {
      parsed = await callExternalLLM(query, retrievedTexts, cfg);
    } else {
      parsed = await callWorkersAI(query, retrievedTexts, cfg, env);
    }
    if (parsed && parsed.pattern) {
      return normalizeResult(parsed, '');
    }
    console.log('[ai_diagnose] LLM 输出缺 pattern 字段，降级规则匹配');
  } catch (e) {
    console.log('[ai_diagnose] LLM 辨证失败，降级规则匹配:', e.message);
  }

  // 2) 规则降级
  try {
    return await ruleBasedDiagnose(query, retrievedTexts, env);
  } catch (e2) {
    console.log('[ai_diagnose] 规则降级失败，返回兜底:', e2.message);
    return normalizeResult({}, '');
  }
}

/**
 * 辅助导出：调理方案查询（按证型名）
 * @param {string} pattern 证型名（如 "肝气郁结"）
 * @param {Object} env Worker 环境
 * @returns {Promise<Object>} KV 证型条目或内置规则兜底
 */
// [2026-08-24 集成] 与 constitution.js 的 getPlan 冲突，改名 diagnosePlan（调理方案用 constitution 的更完整版）
export async function diagnosePlan(pattern, env) {
  pattern = String(pattern || '').trim();
  if (!pattern) return { error: '请输入证型' };
  const kv = await getKvPattern(env, pattern);
  if (kv) return kv;
  const rule = BUILTIN_RULES.find(r => r.pattern === pattern);
  if (rule) return rule;
  return { pattern, error: '未找到该证型的调理方案' };
}
