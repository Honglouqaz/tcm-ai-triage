// ============================================================
// TCM v3 化验报告分析模块
// 文件: lab_analysis.js
// ------------------------------------------------------------
// 功能:
//   1. analyzeLab({image, text}, env) — 化验报告分析
//      image 非空 → Workers AI 多模态 OCR（@cf/llava-hf/llava-1.5-7b-hf）
//                    提取化验单指标列表；provider=external 时走外部视觉 API
//      image 为空 → 正则解析手动输入文本（支持 '血糖 7.2' / 'GLU 7.2' /
//                   '空腹血糖：7.2mmol/L' 等写法）
//   2. 指标解读 — 查 KV tcm:lab:<指标名>（normal_range / 偏高中医解读 /
//                  偏低中医解读 / 关联证型），KV 不可用回退内置 23 指标库
//   3. tcm_analysis — 聚合所有指标关联证型 + 解读文本，生成综合中医分析
// ------------------------------------------------------------
// 配置优先级（后写覆盖先写，与 ai_diagnose.js 一致）:
//   KV key "tcm:config:llm"（JSON）> 环境变量（LLM_PROVIDER /
//   LLM_BASE_URL / LLM_API_KEY / LLM_MODEL / LLM_VISION_MODEL）> 代码默认值
//   示例 KV 配置:
//   {
//     "provider": "external",
//     "external_base": "https://api.openai.com/v1",
//     "external_key": "sk-xxx",        // 或省略，用 env.LLM_API_KEY
//     "external_model": "gpt-4o",      // 视觉模型（OCR 用）
//     "external_vision_model": "gpt-4o-mini",
//     "workers_vision_model": "@cf/llava-hf/llava-1.5-7b-hf"
//   }
// 格式:   ES Module（export async function analyzeLab），同时挂载到
//         globalThis，兼容 build_v3_worker.py 的 Service Worker 拼接构建。
// 返回:   { extracted: [...], interpretations: [...], tcm_analysis, ... }
// ============================================================

export const LAB_ANALYSIS_VERSION = '1.0.0';

// ─── 默认配置 ───────────────────────────────────────────────
const DEFAULT_CONFIG = {
  provider: 'workers-ai',                    // workers-ai | external
  workers_vision_model: '@cf/llava-hf/llava-1.5-7b-hf',   // Workers AI 多模态模型
  external_base: '',                         // 预留: https://api.openai.com/v1
  external_key: '',                          // 预留: 环境变量 LLM_API_KEY
  external_model: '',                        // 预留: gpt-4o-mini
  external_vision_model: '',                 // 预留: gpt-4o（视觉 OCR）
  timeout_ms: 45000,                         // LLM 调用超时（视觉模型较慢）
  max_tokens: 1500,
  temperature: 0.1,                          // OCR 提取需要低温度保证准确
};

// ─── 内置 23 个化验指标映射（KV 不可用时的兜底）────────────
// 数据源: kv_data/lab_indicators.json（与 upload_kv.py 上传到 tcm:lab:* 一致）
// 字段: 中文名 → { 英文, 正常范围, 偏高中医解读, 偏低中医解读, 关联证型 }
const BUILTIN_INDICATORS = {
  "血糖(空腹)": {
    "name": "血糖(空腹)",
    "英文": "FBG / FPG",
    "正常范围": "3.9-6.1 mmol/L",
    "偏高中医解读": "属中医消渴范畴，多因阴虚燥热（肺胃燥热、肾阴亏虚）或脾虚痰湿、湿热内蕴所致。阴虚则津液耗伤，痰湿困脾则运化失司。治宜滋阴清热、健脾化湿。日常可食山药、苦瓜、枸杞、玉米须茶，控制甜食肥甘",
    "偏低中医解读": "多属气血亏虚、中气不足，清阳不升。常见头晕乏力、心悸汗出。治宜益气养血、健脾升清。可食红枣、桂圆、山药、黄芪炖鸡，忌空腹剧烈运动",
    "关联证型": ["阴虚火旺", "脾虚湿盛", "湿热内蕴", "气血两虚"]
  },
  "糖化血红蛋白": {
    "name": "糖化血红蛋白",
    "英文": "HbA1c",
    "正常范围": "4.0-6.0%",
    "偏高中医解读": "反映近2-3个月平均血糖，偏高提示消渴日久、阴虚燥热或痰湿内蕴较甚，为长期血糖控制不佳之象。治宜整体调理：滋阴清热、健脾化痰、活血通络兼顾",
    "偏低中医解读": "临床较少见，可见于贫血、失血等气血亏虚之证，按气血虚调理",
    "关联证型": ["阴虚火旺", "脾虚湿盛", "湿热内蕴", "气血两虚"]
  },
  "总胆固醇": {
    "name": "总胆固醇",
    "英文": "TC",
    "正常范围": "2.8-5.2 mmol/L",
    "偏高中医解读": "属膏脂代谢异常，多因过食肥甘厚味、脾虚痰湿内蕴、气滞血瘀所致。痰湿阻络、瘀血内停是核心病机。治宜健脾化痰、活血降浊。可食山楂、黑木耳、芹菜、决明子茶、荷叶茶，忌油腻内脏",
    "偏低中医解读": "多属气血不足、脾胃虚弱，运化失健。可食山药、大枣、瘦肉、鱼类补益",
    "关联证型": ["痰湿内阻", "脾虚湿盛", "气滞血瘀", "湿热内蕴"]
  },
  "甘油三酯": {
    "name": "甘油三酯",
    "英文": "TG",
    "正常范围": "0.4-1.7 mmol/L",
    "偏高中医解读": "多因嗜食肥甘厚味、饮酒过度，脾失健运、痰湿内生、脂浊停聚血脉。治宜健脾祛湿、化痰降浊。可食薏米、冬瓜、海带、山楂、决明子，戒烟限酒，忌油炸甜食",
    "偏低中医解读": "多属脾胃虚弱、气血不足，或久病体虚。宜健脾益气、均衡营养",
    "关联证型": ["痰湿内阻", "脾虚湿盛", "湿热内蕴", "肝气郁结"]
  },
  "低密度脂蛋白胆固醇": {
    "name": "低密度脂蛋白胆固醇",
    "英文": "LDL-C",
    "正常范围": "1.9-3.4 mmol/L（理想<2.6，合并心脑血管病<1.8）",
    "偏高中医解读": "为动脉粥样硬化的重要危险因素，中医视为痰浊瘀血阻滞脉道。多因脾虚痰湿、肝肾亏虚兼血瘀。治宜化痰降浊、活血通络。可食木耳、山楂、洋葱、深海鱼、绿茶，运动助气血运行",
    "偏低中医解读": "偏低一般无碍，多属气血亏虚者，注意营养均衡即可",
    "关联证型": ["痰湿内阻", "气滞血瘀", "气虚血瘀", "脾虚湿盛"]
  },
  "高密度脂蛋白胆固醇": {
    "name": "高密度脂蛋白胆固醇",
    "英文": "HDL-C",
    "正常范围": "1.0-1.6 mmol/L（男性>1.0，女性>1.3）",
    "偏高中医解读": "偏高为保护性因素，中医视为气血和畅、痰浊较少之象，无需处理",
    "偏低中医解读": "偏低提示痰湿瘀浊较甚、气血运行不畅。治宜健脾化痰、活血通络。可适度运动、戒烟、食黑木耳、山楂、鱼类",
    "关联证型": ["痰湿内阻", "气滞血瘀", "脾虚湿盛"]
  },
  "谷丙转氨酶": {
    "name": "谷丙转氨酶",
    "英文": "ALT",
    "正常范围": "0-40 U/L",
    "偏高中医解读": "提示肝细胞损伤，多因湿热蕴结肝胆、肝郁气滞化火或饮酒伤肝。治宜清利湿热、疏肝解郁。可食茵陈茶、菊花茶、冬瓜、绿豆，戒酒，忌油腻。持续偏高需就医排除肝病",
    "偏低中医解读": "偏低临床意义不大，多属正常",
    "关联证型": ["肝胆湿热", "湿热内蕴", "肝气郁结", "肝郁化火"]
  },
  "谷草转氨酶": {
    "name": "谷草转氨酶",
    "英文": "AST",
    "正常范围": "0-40 U/L",
    "偏高中医解读": "提示肝细胞或心肌损伤，多因湿热蕴结、肝郁化火或劳累过度耗伤肝血。治宜清利湿热、疏肝养血。可食枸杞、菊花、山药、大枣，忌酒、规律作息",
    "偏低中医解读": "偏低临床意义不大",
    "关联证型": ["肝胆湿热", "肝郁化火", "肝血虚", "湿热内蕴"]
  },
  "总胆红素": {
    "name": "总胆红素",
    "英文": "TBIL",
    "正常范围": "3.4-20.5 μmol/L",
    "偏高中医解读": "偏高多见于黄疸，阳黄多因肝胆湿热、热重于湿，色鲜明；阴黄多因寒湿困脾、脾阳不振，色晦暗。治宜清热利湿退黄（阳黄）或温中化湿（阴黄）。可食茵陈茶、冬瓜、薏米，及时就医",
    "偏低中医解读": "偏低临床意义不大",
    "关联证型": ["肝胆湿热", "湿热内蕴", "寒湿困脾", "脾虚湿盛"]
  },
  "肌酐": {
    "name": "肌酐",
    "英文": "Cr",
    "正常范围": "男性44-106 μmol/L，女性35-97 μmol/L",
    "偏高中医解读": "提示肾功能受损，多因肾气虚衰、水湿浊毒内停、肾络瘀阻。治宜补肾健脾、化浊排毒。可食山药、茯苓、冬瓜，控制蛋白摄入，忌滥用药物，需及时就医肾内科",
    "偏低中医解读": "多属气血亏虚、肌肉瘦削或年老体弱，脾肾气虚。宜健脾补肾，均衡营养",
    "关联证型": ["肾阳虚", "肾阴虚", "脾虚湿盛", "气虚血瘀"]
  },
  "尿素氮": {
    "name": "尿素氮",
    "英文": "BUN",
    "正常范围": "3.1-8.0 mmol/L",
    "偏高中医解读": "偏高提示肾气化失司、浊毒内停，多因肾虚水湿泛滥或湿热下注。治宜补肾利水、化浊排毒，需结合肌酐综合评估并就医",
    "偏低中医解读": "多属营养不良、气血亏虚或肝病所致，宜健脾益气、加强营养",
    "关联证型": ["肾阳虚", "脾虚湿盛", "气虚血瘀", "湿热内蕴"]
  },
  "尿酸": {
    "name": "尿酸",
    "英文": "UA",
    "正常范围": "男性150-420 μmol/L，女性89-360 μmol/L",
    "偏高中医解读": "属浊毒内蕴、湿热下注，多因过食海鲜啤酒肥甘、脾肾运化失司，湿热痰浊流注关节经络则发痛风。治宜清热利湿、化浊排毒、健脾益肾。可食冬瓜、薏米、芹菜、车前草茶，多饮水，忌海鲜啤酒内脏",
    "偏低中医解读": "偏低临床意义不大，多属正常或脾胃虚弱",
    "关联证型": ["湿热内蕴", "脾虚湿盛", "痰湿内阻", "肾气不固"]
  },
  "血红蛋白": {
    "name": "血红蛋白",
    "英文": "HGB",
    "正常范围": "男性120-160 g/L，女性110-150 g/L",
    "偏高中医解读": "偏高多见于血液黏稠、阴亏或高原环境，属血分壅滞，可伴血瘀证。宜多饮水、适度运动活血，定期复查",
    "偏低中医解读": "属血虚/气血两虚，多因脾胃虚弱生化乏源、失血过多或久病耗血。治宜健脾益气、补血养血。可食红枣、桂圆、动物肝脏、菠菜、阿胶，忌生冷",
    "关联证型": ["血虚", "气血两虚", "脾胃虚弱", "心脾两虚"]
  },
  "红细胞计数": {
    "name": "红细胞计数",
    "英文": "RBC",
    "正常范围": "男性4.3-5.8×10^12/L，女性3.8-5.1×10^12/L",
    "偏高中医解读": "偏高多见于血液浓稠、阴亏血燥，宜养阴生津、多饮水",
    "偏低中医解读": "同血红蛋白偏低，属血虚、气血两虚，宜健脾补血",
    "关联证型": ["血虚", "气血两虚", "脾胃虚弱"]
  },
  "白细胞计数": {
    "name": "白细胞计数",
    "英文": "WBC",
    "正常范围": "3.5-9.5×10^9/L",
    "偏高中医解读": "偏高多见于感染发热，属热毒炽盛、外感热邪或湿热内蕴。治宜清热解毒。可食金银花茶、菊花茶、绿豆汤，多休息，发热就医",
    "偏低中医解读": "属气血亏虚、卫气不固或脾肾阳虚，正气不足易感外邪。治宜益气养血、健脾补肾。可食黄芪、党参、山药、大枣、香菇",
    "关联证型": ["风热感冒", "肺热壅盛", "湿热内蕴", "气血两虚", "肺气虚"]
  },
  "血小板计数": {
    "name": "血小板计数",
    "英文": "PLT",
    "正常范围": "125-350×10^9/L",
    "偏高中医解读": "偏高提示血液黏稠、血瘀倾向，多因气滞血瘀或痰浊阻络。宜活血化瘀、化痰通络，多饮水、适度运动，可食山楂、黑木耳",
    "偏低中医解读": "属气血亏虚、脾不统血或热迫血行，易出血。治宜益气摄血、凉血止血。需就医查明原因，忌自行用药。可食花生衣、红枣、桂圆",
    "关联证型": ["气滞血瘀", "痰湿内阻", "气血两虚", "气虚血瘀"]
  },
  "甲状腺激素(TSH)": {
    "name": "甲状腺激素(TSH)",
    "英文": "TSH",
    "正常范围": "0.27-4.2 mIU/L",
    "偏高中医解读": "TSH偏高提示甲状腺功能减退倾向，多属脾肾阳虚、气虚痰凝。常见畏寒乏力、浮肿、精神不振。治宜温补脾肾、益气化痰。可食羊肉、山药、海带（遵医嘱），忌生冷",
    "偏低中医解读": "TSH偏低提示甲状腺功能亢进倾向，多属阴虚火旺、肝郁化火、气阴两虚。常见怕热多汗、心悸手抖、消瘦急躁。治宜滋阴降火、疏肝解郁。可食百合、银耳、麦冬茶，忌辛辣海带，及时就医",
    "关联证型": ["脾肾阳虚", "痰湿内阻", "阴虚火旺", "肝郁化火"]
  },
  "游离T3": {
    "name": "游离T3",
    "英文": "FT3",
    "正常范围": "3.1-6.8 pmol/L",
    "偏高中医解读": "偏高提示甲亢倾向，属阴虚火旺、肝火上炎，治宜滋阴降火。偏低提示甲减倾向，属脾肾阳虚，治宜温补脾肾",
    "偏低中医解读": "见上，多属脾肾阳虚、气虚痰凝",
    "关联证型": ["阴虚火旺", "肝郁化火", "脾肾阳虚", "痰湿内阻"]
  },
  "游离T4": {
    "name": "游离T4",
    "英文": "FT4",
    "正常范围": "12-22 pmol/L",
    "偏高中医解读": "偏高提示甲亢倾向，属阴虚火旺、肝郁化火，治宜滋阴降火、疏肝。偏低提示甲减倾向，属脾肾阳虚，治宜温补脾肾",
    "偏低中医解读": "见上",
    "关联证型": ["阴虚火旺", "肝郁化火", "脾肾阳虚", "痰湿内阻"]
  },
  "C反应蛋白": {
    "name": "C反应蛋白",
    "英文": "CRP",
    "正常范围": "0-8 mg/L",
    "偏高中医解读": "偏高提示体内炎症反应，属热毒、湿热或瘀热内蕴。外感急性期多属风热/热毒，慢性偏高多属湿热内蕴、瘀热互结。治宜清热解毒、化湿活血。可食金银花茶、鱼腥草、冬瓜",
    "偏低中医解读": "正常，无需处理",
    "关联证型": ["风热感冒", "湿热内蕴", "痰热壅肺", "气滞血瘀"]
  },
  "尿蛋白": {
    "name": "尿蛋白",
    "英文": "PRO",
    "正常范围": "阴性(-)",
    "偏高中医解读": "阳性提示肾气不固、精微下泄，多因脾肾气虚、肾失封藏。治宜补肾健脾、固摄精微。可食山药、芡实、莲子、茯苓，忌劳累，需就医肾内科",
    "偏低中医解读": "阴性为正常",
    "关联证型": ["肾气不固", "肾阳虚", "脾虚湿盛", "气虚血瘀"]
  },
  "尿糖": {
    "name": "尿糖",
    "英文": "GLU",
    "正常范围": "阴性(-)",
    "偏高中医解读": "阳性提示血糖异常或肾糖阈下降，属消渴范畴，多因阴虚燥热、脾虚痰湿。治宜滋阴清热、健脾化湿，复查血糖并就医",
    "偏低中医解读": "阴性为正常",
    "关联证型": ["阴虚火旺", "脾虚湿盛", "湿热内蕴"]
  },
  "尿白细胞": {
    "name": "尿白细胞",
    "英文": "LEU",
    "正常范围": "阴性(-)",
    "偏高中医解读": "阳性提示泌尿系感染，属膀胱湿热、下焦湿热蕴结。常见尿频尿急尿痛。治宜清热利湿通淋。可食冬瓜汤、赤小豆薏米汤，多饮水勤排尿，就医",
    "偏低中医解读": "阴性为正常",
    "关联证型": ["膀胱湿热", "湿热内蕴", "肝胆湿热"]
  }
};

// 指标别名表：化验单/用户输入常见英文缩写、口语写法 → 标准中文名
// 查询顺序：先精确匹配 KV key / 内置表，再用别名归一（避免 OCR 英文缩写）
const INDICATOR_ALIASES = {
  // 血糖
  '血糖': '血糖(空腹)', '空腹血糖': '血糖(空腹)', '葡萄糖': '血糖(空腹)',
  'fbg': '血糖(空腹)', 'fpg': '血糖(空腹)', 'glu': '血糖(空腹)',
  // 糖化
  '糖化血红蛋白': '糖化血红蛋白', '糖化': '糖化血红蛋白', 'hba1c': '糖化血红蛋白', 'a1c': '糖化血红蛋白',
  // 血脂
  '总胆固醇': '总胆固醇', '胆固醇': '总胆固醇', 'tc': '总胆固醇', 'chol': '总胆固醇', 'cholesterol': '总胆固醇',
  '甘油三酯': '甘油三酯', 'tg': '甘油三酯', 'trig': '甘油三酯', 'triglyceride': '甘油三酯',
  '低密度脂蛋白': '低密度脂蛋白胆固醇', '低密度脂蛋白胆固醇': '低密度脂蛋白胆固醇', 'ldl': '低密度脂蛋白胆固醇', 'ldl-c': '低密度脂蛋白胆固醇', 'ldlc': '低密度脂蛋白胆固醇',
  '高密度脂蛋白': '高密度脂蛋白胆固醇', '高密度脂蛋白胆固醇': '高密度脂蛋白胆固醇', 'hdl': '高密度脂蛋白胆固醇', 'hdl-c': '高密度脂蛋白胆固醇', 'hdlc': '高密度脂蛋白胆固醇',
  // 肝功
  '谷丙转氨酶': '谷丙转氨酶', '丙氨酸氨基转移酶': '谷丙转氨酶', 'alt': '谷丙转氨酶', 'gpt': '谷丙转氨酶',
  '谷草转氨酶': '谷草转氨酶', '天门冬氨酸氨基转移酶': '谷草转氨酶', 'ast': '谷草转氨酶', 'got': '谷草转氨酶',
  '总胆红素': '总胆红素', '胆红素': '总胆红素', 'tbil': '总胆红素',
  // 肾功
  '肌酐': '肌酐', 'cr': '肌酐', 'crea': '肌酐', 'creatinine': '肌酐',
  '尿素氮': '尿素氮', '尿素': '尿素氮', 'bun': '尿素氮', 'urea': '尿素氮',
  '尿酸': '尿酸', 'ua': '尿酸', 'uric acid': '尿酸',
  // 血常规
  '血红蛋白': '血红蛋白', 'hgb': '血红蛋白', 'hb': '血红蛋白', 'hemoglobin': '血红蛋白',
  '红细胞计数': '红细胞计数', '红细胞': '红细胞计数', 'rbc': '红细胞计数',
  '白细胞计数': '白细胞计数', '白细胞': '白细胞计数', 'wbc': '白细胞计数',
  '血小板计数': '血小板计数', '血小板': '血小板计数', 'plt': '血小板计数', 'plts': '血小板计数',
  // 甲功
  '促甲状腺激素': '甲状腺激素(TSH)', '甲状腺激素': '甲状腺激素(TSH)', 'tsh': '甲状腺激素(TSH)',
  '游离t3': '游离T3', 'ft3': '游离T3',
  '游离t4': '游离T4', 'ft4': '游离T4',
  // 炎症
  'c反应蛋白': 'C反应蛋白', '超敏c反应蛋白': 'C反应蛋白', 'crp': 'C反应蛋白', 'hs-crp': 'C反应蛋白',
  // 尿检
  '尿蛋白': '尿蛋白', 'pro': '尿蛋白', '蛋白质': '尿蛋白',
  '尿糖': '尿糖', '尿葡萄糖': '尿糖',
  '尿白细胞': '尿白细胞', 'leu': '尿白细胞',
};

// 单位别名归一（用于展示统一 + 数值类型判断）
const UNIT_ALIASES = {
  'mmol/l': 'mmol/L', 'mmol／l': 'mmol/L', 'mmoll': 'mmol/L',
  'umol/l': 'μmol/L', 'µmol/l': 'μmol/L', 'μmol/l': 'μmol/L',
  'u/l': 'U/L', 'iu/l': 'IU/L', 'miu/l': 'mIU/L', 'miu/ml': 'mIU/L',
  'g/l': 'g/L', 'mg/l': 'mg/L', 'mg/dl': 'mg/dL',
  'pg/ml': 'pg/mL', 'ng/ml': 'ng/mL',
  'pmol/l': 'pmol/L', 'nmol/l': 'nmol/L',
  '10^9/l': '×10^9/L', '10^12/l': '×10^12/L',
  '％': '%', '百分号': '%',
};

// 定性指标（阴性/阳性）关键词 — 无数值也可解读
const QUALITATIVE_POSITIVE = ['阳性', 'positive', '+', '弱阳性', '±'];
const QUALITATIVE_NEGATIVE = ['阴性', 'negative', '-', '正常'];

// ─── 工具函数 ───────────────────────────────────────────────

/** 字符串 trim + 小写（英文别名匹配用） */
function normKey(s) {
  return String(s || '').trim().toLowerCase();
}

/**
 * 指标名归一：中文/英文缩写 → 标准中文名
 * 1) 先尝试原样（内置表/KV 精确 key）
 * 2) 再按别名表匹配（大小写不敏感 + 去空格/符号容错）
 * @param {string} rawName 原始指标名（OCR 或用户输入）
 * @returns {string|null} 标准名（内置表 key），匹配不到返回 null
 */
function normalizeIndicatorName(rawName) {
  const raw = String(rawName || '').trim();
  if (!raw) return null;
  // 1. 精确匹配内置表（KV key 一致）
  if (Object.prototype.hasOwnProperty.call(BUILTIN_INDICATORS, raw)) return raw;
  // 2. 别名表直接命中
  const lower = normKey(raw);
  if (Object.prototype.hasOwnProperty.call(INDICATOR_ALIASES, lower)) {
    return INDICATOR_ALIASES[lower];
  }
  // 3. 去空格/全角/符号后再试（容错 OCR 噪声，如 "LDL-C" vs "LDLC"）
  const compact = lower.replace(/[\s\-_.·／/()（）]/g, '');
  if (Object.prototype.hasOwnProperty.call(INDICATOR_ALIASES, compact)) {
    return INDICATOR_ALIASES[compact];
  }
  // 4. 包含匹配：OCR 常见 "空腹血糖" 含 "血糖"、"血红蛋白(HGB)" 等
  const keys = Object.keys(INDICATOR_ALIASES).filter(k => k.length >= 2);
  for (const k of keys) {
    if (compact.includes(k) || k.includes(compact)) {
      return INDICATOR_ALIASES[k];
    }
  }
  return null;
}

/** 单位归一（大写字母 + 统一符号） */
function normalizeUnit(u) {
  if (!u) return '';
  const lower = normKey(u);
  if (Object.prototype.hasOwnProperty.call(UNIT_ALIASES, lower)) return UNIT_ALIASES[lower];
  return String(u).trim();
}

/** 读取 LLM 配置：KV(tcm:config:llm) > 环境变量 > 默认值。KV 失败静默降级。 */
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
    console.log('[lab_analysis] KV 配置读取失败，使用环境变量/默认配置:', e.message);
  }
  // 环境变量覆盖（后写覆盖先写）
  if (env) {
    if (env.LLM_PROVIDER) cfg.provider = env.LLM_PROVIDER;
    if (env.LLM_BASE_URL) cfg.external_base = env.LLM_BASE_URL;
    if (env.LLM_API_KEY) cfg.external_key = env.LLM_API_KEY;
    if (env.LLM_MODEL) cfg.external_model = env.LLM_MODEL;
    if (env.LLM_VISION_MODEL) cfg.external_vision_model = env.LLM_VISION_MODEL;
  }
  return cfg;
}

/**
 * 从 LLM 输出中提取 JSON（容忍 markdown 围栏 / 前后杂散文字）。
 * 与 ai_diagnose.js 的 extractJson 逻辑一致。
 */
function extractJson(text) {
  if (!text) return null;
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  try {
    return JSON.parse(t);
  } catch (e) { /* 继续 */ }
  const start = t.indexOf('[');
  const end = t.lastIndexOf(']');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(t.slice(start, end + 1));
    } catch (e2) { /* 继续 */ }
  }
  const s2 = t.indexOf('{');
  const e2 = t.lastIndexOf('}');
  if (s2 !== -1 && e2 > s2) {
    try {
      return JSON.parse(t.slice(s2, e2 + 1));
    } catch (e3) { /* 继续 */ }
  }
  return null;
}

/** 基础 base64 → data URL（jpg 默认；无头时按常见签名嗅探） */
function toDataUrl(b64) {
  const s = String(b64 || '').trim();
  if (!s) return '';
  // 已带前缀直接返回
  if (/^data:image\//i.test(s)) return s;
  let mime = 'image/jpeg';
  // 常见格式签名嗅探（png/jpg/webp/gif）
  const first = s.slice(0, 64);
  if (/^\/9j/.test(first)) mime = 'image/jpeg';
  else if (/^iVBORw0KGgo/.test(first)) mime = 'image/png';
  else if (/^UklGR/.test(first)) mime = 'image/webp';
  else if (/^R0lGOD/.test(first)) mime = 'image/gif';
  return `data:${mime};base64,${s}`;
}

// ─── OCR 提取（图片 → 指标列表）────────────────────────────

/** 构造 OCR 多模态 prompt：引导模型输出 JSON 指标列表 */
function buildOcrPrompt() {
  return [
    '你是一个医学化验单 OCR 识别助手。请仔细识别图片中的化验报告（血液/尿液/生化等检验单），',
    '提取所有化验指标，包括：指标名称、检测数值、单位、参考范围（如有）。',
    '',
    '要求：',
    '1. 指标名称优先保留中文（如 血糖、总胆固醇），若中文缺失可用英文缩写（如 ALT、HGB）；',
    '2. 数值保留原始精度，单位规范化（如 mmol/L、μmol/L、U/L、g/L、×10^9/L）；',
    '3. 参考范围如 "3.9-6.1" 或 "3.9~6.1" 直接保留为字符串；',
    '4. 只输出一个 JSON 数组，不要输出任何其他文字、markdown 代码块或解释。',
    '',
    'JSON 数组格式（每个元素）：',
    '[',
    '  { "name": "指标名", "value": "数值", "unit": "单位", "reference": "参考范围" }',
    ']',
    '',
    '如果图片不是化验单或无法识别任何指标，输出空数组 []。',
  ].join('\n');
}

/**
 * Workers AI 多模态 OCR（env.AI binding）
 * 模型: @cf/llava-hf/llava-1.5-7b-hf
 * inputs 格式: 文本 prompt + 图片（data URL base64，兼容 CF 文档用法）
 * @param {string} imageDataUrl base64 data URL
 * @returns {Promise<string>} 模型原始文本输出
 */
async function callWorkersAIOCR(imageDataUrl, cfg, env) {
  if (!env || !env.AI) throw new Error('Workers AI binding (env.AI) 未配置，无法识别图片');
  const model = cfg.workers_vision_model || DEFAULT_CONFIG.workers_vision_model;
  // 兼容两种 inputs 形态：
  //   1) { prompt, image: [dataUrl] }（CF llava 文档）
  //   2) { messages: [{role:'user', content:[{type:'text',...},{type:'image',...}]}] }（chat 类多模态）
  // 首选 messages 形态（llava 亦支持）；若模型报错再回退 prompt 形态。
  try {
    const resp = await env.AI.run(model, {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: buildOcrPrompt() },
            { type: 'image', image: imageDataUrl },
          ],
        },
      ],
      max_tokens: cfg.max_tokens || 1500,
      temperature: cfg.temperature != null ? cfg.temperature : 0.1,
    });
    return extractResponseText(resp);
  } catch (e1) {
    // 回退：prompt + image 数组形态
    const resp2 = await env.AI.run(model, {
      prompt: buildOcrPrompt(),
      image: [imageDataUrl],
      max_tokens: cfg.max_tokens || 1500,
      temperature: cfg.temperature != null ? cfg.temperature : 0.1,
    });
    return extractResponseText(resp2);
  }
}

/**
 * 外部多模态 LLM OCR（OpenAI 兼容视觉 API，预留）
 * 配置: KV tcm:config:llm 或环境变量 LLM_BASE_URL / LLM_API_KEY / LLM_VISION_MODEL
 */
async function callExternalOCR(imageDataUrl, cfg) {
  const base = (cfg.external_base || '').replace(/\/+$/, '');
  const key = cfg.external_key;
  const model = cfg.external_vision_model || cfg.external_model;
  if (!base || !key || !model) {
    throw new Error('外部视觉 LLM 配置不完整：需要 base_url / api_key / vision_model（KV tcm:config:llm 或环境变量）');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeout_ms || 45000);
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
          {
            role: 'user',
            content: [
              { type: 'text', text: buildOcrPrompt() },
              { type: 'image_url', image_url: { url: imageDataUrl } },
            ],
          },
        ],
        max_tokens: cfg.max_tokens || 1500,
        temperature: cfg.temperature != null ? cfg.temperature : 0.1,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const errText = (await resp.text()).slice(0, 200);
      throw new Error(`外部视觉 LLM HTTP ${resp.status}: ${errText}`);
    }
    const data = await resp.json();
    const text = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    if (!text) throw new Error('外部视觉 LLM 返回为空');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/** 从 Workers AI 响应对象中提取文本（兼容 string / {response} / {output:[...]}） */
function extractResponseText(resp) {
  if (typeof resp === 'string') return resp;
  if (!resp || typeof resp !== 'object') return '';
  if (typeof resp.response === 'string') return resp.response;
  if (Array.isArray(resp.output)) {
    return resp.output.map(o => (o && (o.response || o.text || o.content)) || '').join('');
  }
  if (typeof resp.output === 'string') return resp.output;
  if (Array.isArray(resp.result)) {
    return resp.result.map(o => (o && (o.response || o.text)) || '').join('');
  }
  if (typeof resp.result === 'string') return resp.result;
  if (typeof resp.description === 'string') return resp.description;
  return '';
}

/**
 * 图片 → 指标列表（OCR 主入口）
 * 返回 { items, method }；失败时 items 为空数组（不抛异常）
 */
async function extractFromImage(imageDataUrl, cfg, env) {
  try {
    const provider = (cfg.provider || 'workers-ai').toLowerCase();
    let raw = '';
    if (provider === 'external') {
      raw = await callExternalOCR(imageDataUrl, cfg);
    } else {
      raw = await callWorkersAIOCR(imageDataUrl, cfg, env);
    }
    const parsed = extractJson(raw);
    let list = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.indicators) ? parsed.indicators : []);
    const items = list
      .filter(x => x && typeof x === 'object' && (x.name || x.指标名))
      .map(x => ({
        name: String(x.name || x.指标名 || '').trim(),
        value: String(x.value != null ? x.value : (x.数值 != null ? x.数值 : '')).trim(),
        unit: String(x.unit || x.单位 || '').trim(),
        reference: String(x.reference || x.reference_range || x.参考范围 || x.参考值 || '').trim(),
        source: 'image',
      }));
    return { items, method: provider };
  } catch (e) {
    console.log('[lab_analysis] 图片 OCR 失败:', e.message);
    return { items: [], method: 'failed', error: e.message };
  }
}

// ─── 手动文本解析 ───────────────────────────────────────────

/**
 * 从一行文本中解析单个指标。
 * 支持形态：
 *   '血糖 7.2' / '血糖 7.2 mmol/L' / '血糖：7.2'
 *   'GLU 7.2' / '空腹血糖：7.2mmol/L'
 *   '总胆固醇 5.8 ↑' / '血红蛋白 120（正常）'
 *   '尿蛋白 阴性' / '尿糖 +'（定性指标）
 * @param {string} line 单行文本
 * @returns {Object|null} {name, value, unit, reference, raw} 或 null
 */
function parseLine(line) {
  const s = String(line || '').trim();
  if (!s) return null;

  // 形态1: 数值型 — 指标名 + 数值(±可选) + 单位(可选) + 参考范围(可选)
  // 数值: 整数/小数/科学计数（如 5.8、0.4、4.5×10^9、4.5e9）
  const numRe = /([+-]?\d+(?:\.\d+)?)(?:\s*[×x*]\s*10\s*[eE]?\^?\s*(\d+))?(?:\s*[eE]\s*([+-]?\d+))?/;
  const m = s.match(numRe);
  if (m) {
    // 指标名 = 数值前的文本（去掉 冒号/空格/箭头/括号注释）
    let namePart = s.slice(0, m.index).trim();
    namePart = namePart.replace(/[：:]\s*$/, '').replace(/[\u2191\u2193↑↓*]\s*$/, '').trim();
    if (!namePart) return null;

    // 数值主体
    let value = m[1];
    let consumedExp = false;                      // 数值是否含 ×10^n 科学计数
    if (m[2]) { value += '×10^' + m[2]; consumedExp = true; }
    else if (m[3]) { value += 'e' + m[3]; consumedExp = true; }

    // 单位 = 数值之后、参考范围/注释/下一个指标之前的文本（取第一个词）
    // 截断条件：箭头/括号/区间数字 / 下一个"中文名+数字"指标
    let rest = s.slice(m.index + m[0].length).trim();
    let unit = '';
    // 截断点：箭头↑↓、括号(、参考区间(-数字)、或 中文指标名+空格+数字（下一个指标）
    const unitCut = rest.match(/[\u2191\u2193↑↓]|[（(]|[~～\-–—]?\s*\d|[\u4e00-\u9fff]{2,}\s*\d/);
    let unitEnd = rest.length;
    if (unitCut) unitEnd = unitCut.index;
    unit = rest.slice(0, unitEnd).trim();
    // 如果 unit 太长（>12 字符）且含中文，说明吞了下一个指标，截断到第一个空格
    if (unit.length > 12 && /[\u4e00-\u9fff]/.test(unit)) {
      const sp = unit.search(/\s/);
      if (sp > 0) unit = unit.slice(0, sp).trim();
    }
    // 科学计数形态（4.5×10^9/L）：数值已含 ×10^9，单位仅剩 '/L'，
    // 需把指数部分补回单位（'×10^9/L'），保证与参考范围口径一致
    if (consumedExp && /^\/[a-zA-Z%μµ]+$/.test(unit)) {
      unit = (m[2] ? '×10^' + m[2] : (m[3] ? 'e' + m[3] : '')) + unit;
    }

    // 参考范围 = 括号内 或 数值后 ~ 区间（如 '3.9-6.1'）
    let reference = '';
    const parenRef = rest.match(/[（(]([^（）()]*)[）)]/);
    if (parenRef) reference = parenRef[1].trim();
    const rangeRef = rest.match(/(?:[~～\-–—]\s*\d+(?:\.\d+)?\s*(?:[a-zA-Zµ%^\/]+)?)/);
    if (!reference && rangeRef) {
      // 取 '3.9-6.1' 完整区间：往前回溯数值起点
      const pre = rest.slice(0, rangeRef.index);
      const numM = pre.match(/(\d+(?:\.\d+)?)\s*$/);
      if (numM) reference = numM[1] + rangeRef[0].trim();
    }

    return {
      name: namePart,
      value,
      unit: normalizeUnit(unit),
      reference,
      raw: s,
    };
  }

  // 形态2: 定性指标 — 指标名 + 阴性/阳性/+/-
  const qualRe = /^(.*?)[：:\s]*?(阴性|阳性|弱阳性|negative|positive|正常|异常|[+\-±])$/i;
  const qm = s.match(qualRe);
  if (qm) {
    let namePart = qm[1].trim();
    if (!namePart) return null;
    const val = qm[2].toLowerCase();
    const isPositive = ['阳性', 'positive', '+', '±', '弱阳性'].includes(val) || (val === '-' ? false : ['异常'].includes(val));
    return {
      name: namePart,
      value: val === '阴性' || val === 'negative' || val === '-' ? '阴性' : (val === '阳性' || val === 'positive' || val === '+' ? '阳性' : val),
      unit: '',
      reference: '',
      raw: s,
    };
  }

  return null;
}

/**
 * 解析手动输入的指标文本（多行 / 逗号 / 分号 / 顿号分隔均可）
 * @param {string} text 用户输入
 * @returns {Array} [{name, value, unit, reference, source:'text'}]
 */
function parseManualText(text) {
  const s = String(text || '').trim();
  if (!s) return [];
  const results = [];
  // 前置：把连续"指标名 数值"（无逗号分隔）拆开
  // 模式：指标名(中文≥1字) + 数值 + 单位? + 下一个指标名(中文≥2字) + 数字
  const reSplit = /([\u4e00-\u9fffA-Za-z]{2,})\s*([+-]?\d+(?:\.\d+)?(?:[\u00d7x*]\s*10\s*\^?\s*\d+)?[eE]?[+-]?\d*)\s*([\/a-zA-Z%\u03bc\u00b5\u00d7\^0-9.]*?)(?=\s*[\u4e00-\u9fffA-Za-z]{2,}\s*[+-]?\d)/g;
  let segs = [];
  let last = 0, m;
  while ((m = reSplit.exec(s)) !== null) {
    segs.push(s.slice(last, m.index + m[0].length).trim());
    last = m.index + m[0].length;
  }
  segs.push(s.slice(last).trim());
  // 按行 / 逗号 / 分号 / 顿号切分；保护 '4.5×10^9' 等不被误切
  for (const seg of segs) {
    const parts = seg.split(/[\n,，;；、]+/);
    for (const part of parts) {
      const p = part.trim();
      if (!p) continue;
      const parsed = parseLine(p);
      if (parsed && parsed.name) {
      // 指标名归一（别名 → 标准名）；归一失败保留原文
      const std = normalizeIndicatorName(parsed.name);
      results.push({
        name: std || parsed.name,
        rawName: parsed.name,
        value: parsed.value,
        unit: parsed.unit,
        reference: parsed.reference,
        source: 'text',
      });
    }
  }
  }
  return results;
}

// ─── 指标解读 ───────────────────────────────────────────────

/**
 * 从 KV 读取指标条目（tcm:lab:<标准名>），失败/缺失返回 null
 */
async function getKvIndicator(env, stdName) {
  try {
    if (env && env.TCM_KV) {
      const raw = await env.TCM_KV.get('tcm:lab:' + stdName);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    }
  } catch (e) {
    console.log('[lab_analysis] KV 指标读取失败:', stdName, e.message);
  }
  return null;
}

/**
 * 判断指标数值状态：'high' | 'low' | 'normal' | 'qual_positive' | 'qual_negative' | 'unknown'
 * 规则：优先定性词（阳性/阴性），其次参考范围区间（如 3.9-6.1），最后已知参考值描述。
 */
function judgeStatus(value, reference) {
  const v = String(value || '').trim();
  const ref = String(reference || '').trim();
  if (!v) return 'unknown';

  const vl = v.toLowerCase();
  // 定性判断
  if (QUALITATIVE_POSITIVE.some(k => vl.includes(k))) return 'qual_positive';
  if (QUALITATIVE_NEGATIVE.some(k => vl.includes(k))) return 'qual_negative';

  // 数值比较
  const num = parseFloat(v);
  if (isNaN(num)) return 'unknown';

  // 1) 参考范围区间（支持 3.9-6.1 / 3.9~6.1 / 3.9–6.1）
  const rangeRe = /(\d+(?:\.\d+)?)\s*[~～\-–—]\s*(\d+(?:\.\d+)?)/;
  const rm = ref.match(rangeRe);
  if (rm) {
    const lo = parseFloat(rm[1]);
    const hi = parseFloat(rm[2]);
    if (!isNaN(lo) && !isNaN(hi)) {
      if (num < lo) return 'low';
      if (num > hi) return 'high';
      return 'normal';
    }
  }

  // 2) 单边参考（如 <5.6、>1.0 或 '理想<2.6'）
  const ltRe = ref.match(/[<＜]\s*(\d+(?:\.\d+)?)/);
  if (ltRe && num > parseFloat(ltRe[1])) return 'high';
  const gtRe = ref.match(/[>＞]\s*(\d+(?:\.\d+)?)/);
  if (gtRe && num < parseFloat(gtRe[1])) return 'low';

  // 3) 区间描述但数字未匹配上（如 '3.9-6.1 mmol/L' 已在 1 处理）——兜底
  if (ref && !rm) {
    // 参考值含区间字样但格式特殊，无法精确判断 → unknown
    if (ref.includes('-') || ref.includes('~')) return 'unknown';
  }

  return 'unknown';
}

/**
 * 综合 tcm_analysis：聚合所有异常指标的解读与关联证型
 * @param {Array} interpretations 各指标解读数组
 * @returns {Object} { text, patterns, summary }
 */
function buildTcmAnalysis(interpretations) {
  const list = Array.isArray(interpretations) ? interpretations : [];
  const abnormal = list.filter(x => x && (x.status === 'high' || x.status === 'low' || x.status === 'qual_positive'));
  const normal = list.filter(x => x && (x.status === 'normal' || x.status === 'qual_negative'));

  // 证型聚合：按关联证型出现次数排序
  const patternCount = {};
  for (const it of abnormal) {
    const pats = (it.related_patterns && Array.isArray(it.related_patterns)) ? it.related_patterns : [];
    for (const p of pats) {
      if (!p) continue;
      patternCount[p] = (patternCount[p] || 0) + 1;
    }
  }
  const patterns = Object.entries(patternCount)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  // 文本组装
  const lines = [];
  if (abnormal.length === 0) {
    lines.push('本次化验指标均在正常范围内，中医辨证未见明显偏颇，说明气血阴阳尚属调和。');
    lines.push('建议保持规律作息、均衡饮食、适度运动，定期复查即可。');
  } else {
    lines.push(`本次化验共发现 ${abnormal.length} 项指标异常（${abnormal.map(x => x.name).join('、')}）。`);
    for (const it of abnormal) {
      const statusText = it.status === 'high' ? '偏高' : (it.status === 'low' ? '偏低' : '阳性');
      lines.push(`【${it.name}】${statusText}：${it.interpretation}`);
    }
    if (patterns.length > 0) {
      lines.push('');
      lines.push(`综合来看，主要关联中医证型为：${patterns.map(p => `${p.name}（${p.count}项指标关联）`).join('、')}。`);
      lines.push('整体调理方向：结合上述证型辨证施治，建议在中医师指导下综合调理，必要时就医明确诊断。');
    } else {
      lines.push('未聚合出明确关联证型，建议结合症状、舌脉进一步辨证，或咨询中医师。');
    }
  }
  if (normal.length > 0) {
    lines.push('');
    lines.push(`其余 ${normal.length} 项指标（${normal.map(x => x.name).join('、')}）处于正常范围。`);
  }
  lines.push('');
  lines.push('（本分析基于中医理论模型，仅供参考，不能替代医生诊断与治疗。）');

  return {
    text: lines.join('\n'),
    patterns,
    summary: abnormal.length === 0 ? '各项指标正常，无明显中医证型偏颇' : `发现 ${abnormal.length} 项异常指标，关联证型：${patterns.length ? patterns.map(p => p.name).join('、') : '未明确'}`,
  };
}

/**
 * 单指标解读：查 KV → 内置表 → 组装解读对象
 * @param {Object} item 提取的指标 {name, value, unit, reference}
 * @param {Object} env Worker 环境
 * @returns {Promise<Object>} 解读对象
 */
async function interpretItem(item, env) {
  const name = String(item.name || '').trim();
  const out = {
    name,
    value: item.value != null ? String(item.value) : '',
    unit: item.unit || '',
    reference: item.reference || '',
    status: 'unknown',
    interpretation: '',
    related_patterns: [],
    source: 'embedded',   // kv | embedded | unknown
  };
  if (!name) return out;

  // 1. 指标名归一（别名 → 标准名），归一成功则展示标准名
  const stdName = normalizeIndicatorName(name);
  if (stdName) out.name = stdName;

  // 2. KV 优先
  let info = null;
  if (stdName) {
    info = await getKvIndicator(env, stdName);
    if (info) out.source = 'kv';
  }
  // 3. 内置表回退
  if (!info && stdName && Object.prototype.hasOwnProperty.call(BUILTIN_INDICATORS, stdName)) {
    info = BUILTIN_INDICATORS[stdName];
    out.source = 'embedded';
  }

  // 状态判断（优先用 KV/内置表的参考范围；没有则用提取的 reference）
  const refText = (info && (info.正常范围 || info.normal_range || info.reference_range)) || item.reference || '';
  out.reference = out.reference || refText;
  const status = judgeStatus(out.value, refText || out.reference);

  if (info) {
    // 取 KV/内置解读字段（兼容中英字段名）
    const highText = info.偏高中医解读 || info.high_interpretation || '';
    const lowText = info.偏低中医解读 || info.low_interpretation || '';
    const patterns = info.关联证型 || info.related_patterns || [];
    out.related_patterns = Array.isArray(patterns) ? patterns.map(String) : [];

    if (status === 'high' || status === 'qual_positive') {
      out.status = status;
      out.interpretation = highText || `该指标${status === 'high' ? '偏高' : '阳性'}，请结合临床进一步评估。`;
    } else if (status === 'low' || status === 'qual_negative') {
      out.status = status;
      out.interpretation = lowText || (status === 'qual_negative' ? '阴性，正常。' : `该指标偏低，请结合临床进一步评估。`);
    } else if (status === 'normal') {
      out.status = 'normal';
      out.interpretation = `该指标在正常范围内（参考 ${refText}），未见明显异常。`;
    } else {
      out.status = 'unknown';
      out.interpretation = `该指标参考范围（${refText || '未知'}），建议结合临床综合判断。`;
    }
  } else {
    // 未匹配到知识库指标：给通用提示（不做中医解读，避免编造）
    out.status = status;
    out.interpretation = status === 'unknown'
      ? '该指标未在知识库中找到对应中医解读，建议结合临床或咨询医师。'
      : (status === 'high' ? '该指标偏高，建议结合临床进一步评估。'
        : (status === 'low' ? '该指标偏低，建议结合临床进一步评估。'
          : (status === 'qual_positive' ? '该指标阳性，建议结合临床进一步评估。' : '该指标未见明显异常。')));
  }

  return out;
}

// ─── 主入口 ─────────────────────────────────────────────────

/**
 * 化验报告分析主入口
 * @param {Object} payload { image: base64图片字符串, text: 手动输入指标文本 }
 * @param {Object} env Worker 环境（env.AI / env.TCM_KV / 环境变量）
 * @returns {Promise<Object>} { extracted, interpretations, tcm_analysis, ... }
 *   extracted:       识别/解析出的指标列表 [{name, value, unit, reference, source}]
 *   interpretations: 每个指标的解读 [{name, value, unit, reference, status, interpretation, related_patterns, source}]
 *   tcm_analysis:    { text, patterns, summary } 综合中医分析
 *   另含 meta（provider/识别方式/提示信息）与 disclaimer
 */
export async function analyzeLab(payload, env) {
  const p = (payload && typeof payload === 'object') ? payload : {};
  const image = String(p.image || '').trim();
  const text = String(p.text || '').trim();

  // ── 1. 提取指标 ──
  let extracted = [];
  let ocrFailed = false;
  let method = 'text';

  if (image) {
    // 图片优先：OCR（外部 provider 或 Workers AI）
    let cfg = null;
    try {
      cfg = await loadLlmConfig(env);
    } catch (e) {
      cfg = { ...DEFAULT_CONFIG };
    }
    const dataUrl = toDataUrl(image);
    const ocr = await extractFromImage(dataUrl, cfg, env);
    method = ocr.method;
    if (ocr.items && ocr.items.length > 0) {
      extracted = ocr.items;
    } else {
      ocrFailed = true;
      console.log('[lab_analysis] OCR 未识别出指标');
    }
    // OCR 失败且有手动文本 → 降级用手动文本
    if (ocrFailed && text) {
      extracted = parseManualText(text);
      method = 'text-fallback';
    }
  } else if (text) {
    extracted = parseManualText(text);
  }

  // ── 2. 指标解读 ──
  const interpretations = [];
  for (const item of extracted) {
    try {
      interpretations.push(await interpretItem(item, env));
    } catch (e) {
      console.log('[lab_analysis] 指标解读失败:', item && item.name, e.message);
    }
  }

  // ── 3. 综合中医分析 ──
  let tcmAnalysis = { text: '', patterns: [], summary: '' };
  if (interpretations.length > 0) {
    try {
      tcmAnalysis = buildTcmAnalysis(interpretations);
    } catch (e) {
      console.log('[lab_analysis] 综合分析失败:', e.message);
    }
  }

  // ── 4. 组装返回 ──
  const result = {
    extracted,
    interpretations,
    tcm_analysis: tcmAnalysis,
    meta: {
      method,                       // image(ocr) | text | text-fallback | failed
      ocr_failed: ocrFailed,
      count: extracted.length,
      provider: 'workers-ai',       // 默认；external 时在 meta 标注
    },
    disclaimer: '本分析基于中医理论模型与化验指标参考范围，仅供健康参考，不能替代医生诊断与治疗。',
  };
  if (extracted.length === 0) {
    result.error = '未能从图片或文本中识别出化验指标';
    result.hint = '请尝试：① 上传清晰的化验单图片（确保指标文字可辨认）；② 或手动输入指标，如「血糖 7.2 mmol/L」「总胆固醇 5.8」「血红蛋白 120 g/L」，一行一个或用逗号分隔。';
  }
  return result;
}

// ════════════════════════════════════════════════════════════
// 导出 + globalThis 挂载（兼容 Service Worker 拼接构建）
// ════════════════════════════════════════════════════════════

export {
  parseManualText,
  parseLine,
  normalizeIndicatorName,
  judgeStatus,
  buildTcmAnalysis,
  BUILTIN_INDICATORS,
};

if (typeof globalThis !== 'undefined') {
  globalThis.analyzeLab = analyzeLab;
  globalThis.parseManualText = parseManualText;
  globalThis.parseLine = parseLine;
  globalThis.normalizeIndicatorName = normalizeIndicatorName;
  globalThis.judgeStatus = judgeStatus;
  globalThis.buildTcmAnalysis = buildTcmAnalysis;
  globalThis.BUILTIN_INDICATORS = BUILTIN_INDICATORS;
}
