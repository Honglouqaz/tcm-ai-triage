/* triage.js — 就医等级判断（观察 / 门诊 / 急诊）
 *
 * ── 这个模块要解决什么 ───────────────────────────────────────
 * 用户描述不舒服时，最想知道的一句话其实不是「你是什么证型」，
 * 而是「我现在要不要去医院、挂什么科、还是先观察两天」。
 * 这是整个应用里最有实用价值的一块，也是最不能出错的一块。
 *
 * ── 三条铁律 ────────────────────────────────────────────────
 * 1) 宁可高一级。拿不准的时候向上取（门诊 < 急诊），
 *    因为「白跑一趟」的代价远小于「该去没去」。
 *
 * 2) 只判「去哪儿」，不判「是什么病」。这里不做诊断，
 *    只说这个情况适合在哪一级医疗场景处理。诊断权在医生。
 *
 * 3) 判据要能说清。每条判断都带 why（依据）和 action（做什么），
 *    用户能看懂为什么给这个级别，而不是被一个黑箱结论吓到。
 *
 * ── 判据来源 ────────────────────────────────────────────────
 * 红旗症状取自通用院前急救识别共识（FAST 中风识别、胸痛高危特征、
 * 脓毒症警示等）；化验危急值取自国内检验科通用的危急值上报范围。
 * 都是公开通行标准，不是本项目自创。具体数值见下方注释。
 *
 * ── 明确免责 ────────────────────────────────────────────────
 * 本模块是**分诊参考**，不是诊断工具。它无法查体、无法看片子、
 * 无法知道你的既往史和用药。任何时候以医生判断为准；
 * 出现红旗症状请直接拨打 120，不要在这个页面上继续操作。
 */

const TRIAGE_VERSION = '1.0.0';

/* ── 三级 ─────────────────────────────────────────────────── */
const LEVELS = {
  emergency: {
    key: 'emergency',
    label: '立即急诊',
    short: '急诊',
    color: 'danger',
    order: 3,
    headline: '建议立即前往急诊，或直接拨打 120',
    desc: '存在需要紧急处理的表现。不要自行服药观察，不要等到明天。',
  },
  clinic: {
    key: 'clinic',
    label: '尽快门诊',
    short: '门诊',
    color: 'warn',
    order: 2,
    headline: '建议 1-3 天内去医院门诊看一次',
    desc: '不属于紧急情况，但需要医生面诊判断，不建议长期自行观察。',
  },
  observe: {
    key: 'observe',
    label: '可先观察',
    short: '观察',
    color: 'ok',
    order: 1,
    headline: '可以先在家观察，注意变化',
    desc: '目前没有提示严重问题的表现。若加重或出现新症状，按下方提示升级。',
  },
};

/* ── 红旗症状：出现任一即急诊 ───────────────────────────────
 * 这些是院前急救公认的「不能等」的表现。宁可多转诊，不能漏。 */
const RED_FLAGS = [
  {
    id: 'chest_pain',
    name: '胸痛 / 胸闷压榨感',
    // 关键词按「用户可能怎么说」来写，不是按教科书术语
    kw: ['胸痛', '胸口痛', '心口疼', '胸闷', '压榨', '胸部压', '心绞痛', '胸口压'],
    why: '胸痛是急性心梗最常见的表现，救治有明确时间窗（越早越好），不能等',
    action: '立刻停止活动，坐下或半卧，拨打 120。不要自己开车去医院。',
  },
  {
    id: 'dyspnea',
    name: '呼吸困难 / 喘不上气',
    kw: ['呼吸困难', '喘不上', '呼吸困难', '憋气', '透不过气', '气短得厉害', '不能平卧'],
    why: '急性呼吸困难可能来自心衰、肺栓塞、哮喘持续状态等，都需要紧急处理',
    action: '保持半坐位，解开衣领，立即急诊或呼叫 120。',
  },
  {
    id: 'consciousness',
    name: '意识改变 / 晕厥',
    kw: ['昏迷', '晕倒', '晕厥', '意识不清', '叫不醒', '抽搐', '抽风', '意识模糊', '说胡话'],
    why: '意识障碍提示脑、心或代谢出现急性问题，必须现场评估',
    action: '让患者侧卧防误吸，不要喂水喂药，立即拨打 120。',
  },
  {
    id: 'stroke',
    name: '中风征象（口角歪斜 / 单侧无力 / 言语不清）',
    kw: ['口角歪', '嘴歪', '半身不遂', '一侧无力', '单侧麻', '说话不清', '言语不清',
         '口齿不清', '看不清', '一侧手脚'],
    why: 'FAST 征象提示急性脑卒中，溶栓有时间窗（通常 4.5 小时内），每延误一分钟都在损失脑细胞',
    action: '记住症状出现的准确时间（医生要问），立即拨打 120，不要自行服药。',
  },
  {
    id: 'severe_bleeding',
    name: '大量出血 / 呕血黑便',
    kw: ['大出血', '呕血', '吐血', '咳血', '咯血', '黑便', '血便', '便血', '血崩'],
    why: '消化道大出血与咯血都可迅速导致失血性休克',
    action: '禁食禁水，平卧保暖，立即急诊。呕血时头偏向一侧防窒息。',
  },
  {
    id: 'thunderclap_headache',
    name: '突发剧烈头痛（雷击样）',
    kw: ['剧烈头痛', '爆炸样头', '雷击样', '突然头痛得厉害', '最严重的头痛'],
    why: '突发的剧烈头痛需排除蛛网膜下腔出血等致命病因',
    action: '避免用力与情绪激动，立即急诊做头颅影像检查。',
  },
  {
    id: 'high_fever_rash',
    name: '高热伴皮疹 / 颈硬',
    kw: ['高热', '高烧不退', '皮疹', '颈硬', '脖子硬', '怕光'],
    why: '高热伴皮疹、颈项强直需排除脑膜炎、败血症等急症',
    action: '立即急诊。儿童、老人、免疫低下者尤其不要等。',
  },
  {
    id: 'severe_abdomen',
    name: '剧烈腹痛 / 腹硬如板',
    kw: ['剧烈腹痛', '肚子剧痛', '腹硬', '肚子硬', '按不得', '急腹痛', '痛得打滚'],
    why: '急腹症（穿孔、肠梗阻、胰腺炎、宫外孕等）需要急诊排除',
    action: '禁食禁水、不要吃止痛药（会掩盖病情），立即急诊。',
  },
  {
    id: 'anaphylaxis',
    name: '过敏反应（喉紧 / 全身风团）',
    kw: ['喉咙紧', '喉头水肿', '全身起疹', '呼吸困难伴皮疹', '过敏休克', '嘴唇肿'],
    why: '严重过敏反应可在数分钟内进展为气道梗阻与休克',
    action: '立即拨打 120。有肾上腺素笔（EpiPen）按说明立即使用。',
  },
  {
    id: 'self_harm',
    name: '自伤 / 轻生念头',
    kw: ['自杀', '轻生', '不想活', '活着没意思', '想死'],
    why: '这类情况需要专业心理危机干预，越早介入越好',
    action: '请立即联系信任的人陪在身边，拨打心理援助热线 12356，或前往急诊。你不必独自扛。',
  },
  {
    id: 'infant_danger',
    name: '婴幼儿危险征象',
    kw: ['婴儿不哭不动', '孩子抽搐', '小儿高热惊厥', '宝宝不吃奶', '婴儿嗜睡',
         '孩子精神差', '哭声弱'],
    why: '婴幼儿代偿能力差，病情变化快，危险征象出现时往往已经很重',
    action: '立即前往有儿科急诊的医院，不要在家观察。',
  },
];

/* ── 化验危急值：命中即急诊 ─────────────────────────────────
 * 数值取国内检验科通用危急值上报范围（各院略有差异）。
 * 这里只做「明显越过危险线」的判断，避免过度报警。 */
const CRITICAL_LABS = [
  { name: '血糖(空腹)', low: 2.8, high: 22.2, unit: 'mmol/L',
    why: '血糖 <2.8 可致低血糖昏迷；>22.2 有酮症酸中毒/高渗风险',
    action: '立即急诊查血气与酮体，不要自行加减降糖药。' },
  { name: '肌酐', high: 707, unit: 'μmol/L',
    why: '肌酐 >707 提示肾功能严重受损，可能已达需要替代治疗的阶段',
    action: '尽快肾内科急诊评估，注意尿量与水肿情况。' },
  { name: '血红蛋白', low: 60, unit: 'g/L',
    why: '血红蛋白 <60 属重度贫血，可能出现组织缺氧与心功能失代偿',
    action: '急诊评估是否需要输血，避免剧烈活动。' },
  { name: '白细胞计数', low: 1.5, high: 30, unit: '×10⁹/L',
    why: '<1.5 提示粒细胞严重减少、感染风险高；>30 常见于严重感染或血液系统疾病',
    action: '急诊查感染灶与血象，发热时不要自行吃退烧药后在家等。' },
  { name: '血小板计数', low: 20, high: 1000, unit: '×10⁹/L',
    why: '<20 有自发出血风险；>1000 有血栓风险',
    action: '急诊血液科评估，避免磕碰与剧烈运动。' },
  { name: '谷丙转氨酶', high: 400, unit: 'U/L',
    why: 'ALT 明显升高（约 10 倍上限）提示急性肝损伤',
    action: '尽快消化/肝病科就诊，停用可疑药物与酒精。' },
  { name: '总胆红素', high: 100, unit: 'μmol/L',
    why: '总胆红素显著升高可出现黄疸，需排除胆道梗阻与肝衰竭',
    action: '尽快就诊，注意尿色与大便颜色变化。' },
  { name: 'C反应蛋白', high: 100, unit: 'mg/L',
    why: 'CRP 明显升高提示较强炎症反应，需结合症状排除严重感染',
    action: '结合发热情况尽早就诊，不要只靠退烧药。' },
];

/* ── 门诊级判据：需要医生看，但不紧急 ───────────────────────
 * 判据偏「持续时间」和「进行性加重」——这两类是最容易被
 * 用户自己拖过去、但其实该看医生的。 */
const CLINIC_RULES = [
  { id: 'fever_long', kw: ['发烧', '发热', '低烧'], days: 3,
    why: '发热超过 3 天需排查感染灶，不建议继续自行服退烧药',
    dept: '发热门诊 / 内科' },
  { id: 'cough_long', kw: ['咳嗽', '咳痰'], days: 14,
    why: '咳嗽超过 2 周需查胸片排除肺炎、结核等',
    dept: '呼吸内科' },
  { id: 'weight_loss', kw: ['消瘦', '体重下降', '瘦了', '掉体重'],
    why: '非刻意减重下的体重明显下降，需排查代谢、肿瘤、慢性感染',
    dept: '内科 / 内分泌科' },
  { id: 'blood_stool_mild', kw: ['大便带血', '便中带血', '纸巾带血'],
    why: '便血无论多少都建议查清来源（痔疮之外还需排除肠道病变）',
    dept: '消化内科 / 肛肠科' },
  { id: 'dysphagia', kw: ['吞咽困难', '咽不下', '吃东西噎'],
    why: '进行性吞咽困难需排除食管病变，不能只当咽炎',
    dept: '消化内科 / 耳鼻喉科' },
  { id: 'chest_discomfort_mild', kw: ['心悸', '心慌', '心跳快'],
    why: '反复心悸需做心电图与动态心电，排除心律失常',
    dept: '心内科' },
  { id: 'edema', kw: ['水肿', '浮肿', '腿肿', '眼皮肿'],
    why: '水肿需区分心源性、肾源性、肝源性与局部因素',
    dept: '内科 / 肾内科' },
  { id: 'jaundice', kw: ['发黄', '眼黄', '尿黄得像茶', '皮肤黄'],
    why: '黄疸需查肝功能与胆道影像，属需要明确病因的情况',
    dept: '消化内科 / 肝病科' },
  { id: 'lump', kw: ['肿块', '长了个包', '脖子有包', '乳房有硬块', '淋巴结肿大'],
    why: '新出现的肿块需要触诊与影像判断性质，不建议长期观察',
    dept: '相应专科 / 普外科' },
  { id: 'urine_change', kw: ['尿血', '血尿', '尿泡沫多', '夜尿多'],
    why: '血尿与泡沫尿需查尿常规与肾功能',
    dept: '肾内科 / 泌尿外科' },
  { id: 'chronic_pain', kw: ['疼了几个月', '痛了很久', '一直不好', '反复疼'], days: 14,
    why: '持续两周以上不缓解的疼痛需要明确原因，不宜只靠止痛药',
    dept: '相应专科' },
  { id: 'mental', kw: ['睡不着', '失眠', '情绪低落', '焦虑', '提不起劲'], days: 30,
    why: '持续一个月的睡眠或情绪问题，建议专业评估而不是硬扛',
    dept: '精神心理科 / 睡眠门诊' },
];

/* ── 高危人群：同样的症状，门槛要更低 ─────────────────────── */
const HIGH_RISK_GROUPS = [
  { kw: ['孕妇', '怀孕', '孕期'], note: '孕期许多症状的鉴别范围不同，建议更早就诊' },
  { kw: ['宝宝', '婴儿', '新生儿', '孩子', '小孩', '儿童'], note: '儿童代偿能力弱、变化快，同等症状应更早看医生' },
  { kw: ['老人', '老年', '八十', '七十多', '年纪大'], note: '老年人症状常不典型，可能比表现出的更重' },
  { kw: ['糖尿病', '高血压', '心脏病', '肾病', '免疫抑制', '化疗', '透析'], note: '有基础病者出现新症状，风险高于常人' },
];

/* ── 主函数 ────────────────────────────────────────────────── */

function _parseLabs(raw) {
  // 接受 [{name, value, unit}] 或纯文本「尿酸 486」两行
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return [];
  return raw.split('\n').map((ln) => ln.trim()).filter(Boolean).map((ln) => {
    const m = ln.match(/^(.*?)[\s:：]+([\d.]+)\s*(.*)$/);
    if (!m) return null;
    return { name: m[1].trim(), value: parseFloat(m[2]), unit: (m[3] || '').trim() };
  }).filter(Boolean);
}

/**
 * 判断就医等级
 * @param {Object} input
 * @param {string} input.symptoms  症状描述（自由文本）
 * @param {Array|string} input.labs 化验值
 * @param {number} input.age       年龄（可选）
 * @param {number} input.durationDays 症状持续天数（可选）
 * @returns {Object} { level, headline, desc, hits, depts, escalation, isRedFlag }
 */
function triage(input) {
  const text = String((input && input.symptoms) || '');
  const labs = _parseLabs(input && input.labs);
  const age = Number(input && input.age) || 0;
  const days = Number(input && input.durationDays) || 0;

  const hits = [];        // 命中的判据
  const depts = new Set(); // 建议科室
  let level = LEVELS.observe;
  let isRedFlag = false;

  const bump = (lv) => {
    if (lv.order > level.order) level = lv;
  };

  /* ① 红旗症状 —— 最高优先，命中即急诊 */
  for (const f of RED_FLAGS) {
    if (f.kw.some((k) => text.includes(k))) {
      isRedFlag = true;
      hits.push({ layer: '红旗症状', name: f.name, why: f.why, action: f.action, level: 'emergency' });
      bump(LEVELS.emergency);
    }
  }

  /* ② 化验危急值 */
  for (const c of CRITICAL_LABS) {
    const item = labs.find((l) => l.name && (l.name.includes(c.name) || c.name.includes(l.name)));
    if (!item || !isFinite(item.value)) continue;
    let bad = false, dir = '';
    if (c.low != null && item.value < c.low) { bad = true; dir = `低于 ${c.low}`; }
    if (c.high != null && item.value > c.high) { bad = true; dir = `高于 ${c.high}`; }
    if (bad) {
      hits.push({
        layer: '化验危急值',
        name: `${c.name} ${item.value}${item.unit || c.unit}（${dir}${c.unit}）`,
        why: c.why, action: c.action, level: 'emergency',
      });
      bump(LEVELS.emergency);
    }
  }

  /* ③ 门诊级判据 */
  for (const r of CLINIC_RULES) {
    if (!r.kw.some((k) => text.includes(k))) continue;
    // 带天数门槛的，只有在明确达到天数时才升级
    if (r.days && days && days < r.days) {
      hits.push({
        layer: '需就医', name: r.why.split('，')[0],
        why: `目前持续 ${days} 天，未到通常的就诊门槛（${r.days} 天），但要盯着`,
        action: `若超过 ${r.days} 天仍不缓解，去${r.dept}`, level: 'clinic',
      });
      continue;
    }
    hits.push({ layer: '需就医', name: r.why.split('，')[0], why: r.why,
                action: `建议挂${r.dept}`, level: 'clinic' });
    if (r.dept) depts.add(r.dept.split(' / ')[0]);
    bump(LEVELS.clinic);
  }

  /* ④ 高危人群：把观察抬成门诊 */
  const groups = HIGH_RISK_GROUPS.filter((g) => g.kw.some((k) => text.includes(k)));
  for (const g of groups) {
    hits.push({ layer: '高危人群', name: '需要更低的就诊门槛', why: g.note,
                action: '同等症状下建议更早看医生', level: 'clinic' });
    bump(LEVELS.clinic);
  }
  if (age && age >= 75) {
    hits.push({ layer: '高危人群', name: `年龄 ${age} 岁`, why: '高龄者症状常不典型，可能比表现出的更重',
                action: '建议更早面诊', level: 'clinic' });
    bump(LEVELS.clinic);
  }
  if (age && age <= 3) {
    hits.push({ layer: '高危人群', name: `年龄 ${age} 岁`, why: '婴幼儿病情变化快',
                action: '有异常就去看儿科', level: 'clinic' });
    bump(LEVELS.clinic);
  }

  /* ⑤ 科室推荐 */
  if (isRedFlag) depts.add('急诊科');
  if (!depts.size) depts.add(level.key === 'emergency' ? '急诊科' : '全科 / 内科');

  /* ⑥ 观察级的升级提示 —— 告诉用户「什么情况下要变」 */
  let escalation = '';
  if (level.key === 'observe') {
    escalation = '如果出现以下任一情况，请升级为门诊或急诊：'
      + '发热超过 3 天、疼痛明显加重、出现胸闷/呼吸困难/意识改变、'
      + '症状影响到吃喝睡、或你对情况感到不安（这条本身就是理由）。';
  } else if (level.key === 'clinic') {
    escalation = '就诊前如果出现胸闷、呼吸困难、意识改变、大出血或剧烈疼痛，'
      + '不要等门诊，直接去急诊。';
  } else {
    escalation = '现在就去。不要先吃药观察，不要等到明天，也不要自己开车。';
  }

  return {
    level: level.key,
    label: level.label,
    short: level.short,
    headline: level.headline,
    desc: level.desc,
    color: level.color,
    isRedFlag,
    hits,
    depts: [...depts],
    escalation,
    disclaimer: '这是分诊参考，不是诊断。出现红旗症状请直接拨打 120。'
      + '医生面诊、查体与影像检查才是判断依据——本工具看不到这些。',
    version: TRIAGE_VERSION,
  };
}

/* ── 对外挂载 ── */
window.TCM_TRIAGE = {
  version: TRIAGE_VERSION,
  LEVELS, RED_FLAGS, CRITICAL_LABS, CLINIC_RULES, HIGH_RISK_GROUPS,
  triage,
};
