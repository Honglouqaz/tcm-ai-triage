// ============================================================
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
const CONSTITUTIONS = {
  "平和质": {
    "features": [
      "精力充沛",
      "面色红润",
      "食欲好",
      "睡眠佳",
      "二便正常",
      "不易生病",
      "精神饱满"
    ],
    "description": "阴阳气血调和，体态适中，面色红润，精力充沛。是最健康的体质类型。",
    "advice": {
      "diet": [
        "均衡饮食，五谷为养，多吃新鲜蔬果",
        "饮食有节，三餐定时定量，忌暴饮暴食"
      ],
      "lifestyle": [
        "劳逸结合，保持规律作息",
        "每周3-5次有氧运动，如快走、慢跑、游泳",
        "保持心态平和，乐观开朗"
      ],
      "acupoints": [
        "足三里（强壮要穴，每日按揉3分钟）",
        "涌泉（补肾安神，睡前按揉）"
      ]
    }
  },
  "气虚质": {
    "features": [
      "容易疲劳",
      "乏力",
      "气短",
      "自汗",
      "易感冒",
      "声低",
      "懒言",
      "没精神",
      "稍动即喘",
      "面色苍白"
    ],
    "description": "元气不足，以疲乏、气短、自汗等气虚表现为主要特征。",
    "advice": {
      "diet": [
        "黄芪山药粥、党参炖鸡、红枣桂圆茶",
        "多食小米、山药、大枣、鸡肉等补气食物",
        "忌生冷寒凉，少食耗气之品（萝卜过量、浓茶）"
      ],
      "lifestyle": [
        "避免剧烈运动和大汗出，以散步、八段锦等温和运动为主",
        "保证充足睡眠，避免熬夜和过度劳累",
        "注意保暖，预防感冒"
      ],
      "acupoints": [
        "足三里（补气要穴，按揉或艾灸）",
        "气海（培补元气，摩揉或艾灸）",
        "关元（固本培元）"
      ]
    }
  },
  "阳虚质": {
    "features": [
      "怕冷",
      "手足凉",
      "畏寒",
      "喜热饮",
      "大便稀",
      "夜尿多",
      "四肢不温",
      "腰膝酸冷",
      "精神不振"
    ],
    "description": "阳气不足，以畏寒怕冷、手足不温等虚寒表现为主要特征。",
    "advice": {
      "diet": [
        "当归生姜羊肉汤、韭菜炒核桃、姜枣茶",
        "多食羊肉、桂圆、核桃等温热食物",
        "忌生冷、冰饮、凉茶、西瓜等寒凉之品"
      ],
      "lifestyle": [
        "注意腰腹、足部保暖，每晚热水泡脚20分钟",
        "多晒太阳，尤其后背督脉",
        "适度运动助阳气升发，避免大汗"
      ],
      "acupoints": [
        "关元（温阳要穴，艾灸10-15分钟）",
        "命门（壮火益肾，艾灸或搓热按揉）",
        "足三里（艾灸补气）"
      ]
    }
  },
  "阴虚质": {
    "features": [
      "口干",
      "手足心热",
      "盗汗",
      "大便干",
      "喜冷饮",
      "五心烦热",
      "潮热",
      "失眠多梦",
      "舌红少苔",
      "咽干"
    ],
    "description": "阴液亏少，以口燥咽干、手足心热等虚热表现为主要特征。",
    "advice": {
      "diet": [
        "百合银耳羹、生地麦冬茶、石斛炖瘦肉",
        "多食银耳、百合、梨、莲藕、鸭肉等滋阴食材",
        "忌辛辣燥热（辣椒、羊肉、酒类），少熬夜"
      ],
      "lifestyle": [
        "保证夜间睡眠，11点前入睡，避免熬夜",
        "避免情绪波动过大，可练习静坐或冥想",
        "运动以中小强度为宜，避免大汗伤阴"
      ],
      "acupoints": [
        "三阴交（滋阴要穴）",
        "太溪（补肾阴）",
        "涌泉（引火归元，睡前按揉）"
      ]
    }
  },
  "痰湿质": {
    "features": [
      "体型偏胖",
      "肥胖",
      "腹部肥满",
      "口中黏腻",
      "大便黏",
      "苔白腻",
      "痰多",
      "身体困重",
      "胸闷",
      "容易困倦"
    ],
    "description": "痰湿凝聚，以形体肥胖、腹部肥满、口黏苔腻等表现为主要特征。",
    "advice": {
      "diet": [
        "薏米赤小豆汤、冬瓜薏米汤、陈皮普洱茶、白扁豆粥",
        "少食肥甘厚味、甜食、油炸及酒类",
        "多食冬瓜、薏米、赤小豆、白萝卜等祛湿食物"
      ],
      "lifestyle": [
        "坚持运动，适度出汗有助祛湿（快走、慢跑）",
        "居住环境保持干燥通风，避免潮湿",
        "晚餐七分饱，忌夜宵"
      ],
      "acupoints": [
        "丰隆（化痰要穴）",
        "阴陵泉（健脾祛湿）",
        "中脘（和胃化湿）"
      ]
    }
  },
  "湿热质": {
    "features": [
      "口苦",
      "口臭",
      "面部油",
      "痤疮",
      "长痘",
      "大便黏滞",
      "小便黄",
      "舌苔黄腻",
      "身体困重",
      "易生疮疖"
    ],
    "description": "湿热内蕴，以面垢油光、口苦苔黄腻等湿热表现为主要特征。",
    "advice": {
      "diet": [
        "绿豆薏米汤、冬瓜汤、苦瓜、菊花茶",
        "忌油腻、甜食、煎炸、辛辣及酒类",
        "多食冬瓜、苦瓜、薏米、绿豆、赤小豆等清热利湿食物"
      ],
      "lifestyle": [
        "适当运动出汗有助于湿热排出",
        "避免长时间处于潮湿闷热环境，保持居室通风",
        "保证睡眠，避免熬夜生内热"
      ],
      "acupoints": [
        "曲池（清热）",
        "阴陵泉（利湿）",
        "丰隆（化痰祛湿）"
      ]
    }
  },
  "血瘀质": {
    "features": [
      "面色晦暗",
      "唇色紫暗",
      "皮肤瘀斑",
      "痛经",
      "舌紫暗",
      "身体局部刺痛",
      "固定刺痛",
      "面色暗沉",
      "易有黑眼圈"
    ],
    "description": "血行不畅，以肤色晦暗、舌质紫暗等血瘀表现为主要特征。",
    "advice": {
      "diet": [
        "山楂红糖水、三七煲汤、丹参茶、黑木耳",
        "多食山楂、黑木耳、洋葱、红糖等活血食物",
        "忌生冷寒凉，以免加重血凝"
      ],
      "lifestyle": [
        "坚持适度运动促进气血运行（散步、太极、八段锦）",
        "保持心情愉悦，避免久坐久卧",
        "注意保暖，避免受寒"
      ],
      "acupoints": [
        "血海（活血要穴）",
        "膈俞（活血化瘀）",
        "三阴交（调经活血）"
      ]
    }
  },
  "气郁质": {
    "features": [
      "情绪低落",
      "敏感多虑",
      "胁肋胀",
      "嗳气",
      "脉弦",
      "易怒",
      "叹气",
      "胸闷",
      "喜欢叹气",
      "咽部异物感"
    ],
    "description": "气机郁滞，以神情抑郁、忧虑脆弱等气郁表现为主要特征。",
    "advice": {
      "diet": [
        "玫瑰花茶、佛手柑茶、金桔柠檬茶、陈皮水",
        "多食行气解郁之品（玫瑰、佛手、金桔、薄荷）",
        "少食收敛酸涩及油腻碍气之物"
      ],
      "lifestyle": [
        "主动调节情绪，多倾诉、多社交",
        "练习八段锦、太极拳、瑜伽等舒展运动",
        "培养兴趣爱好，减少思虑压力"
      ],
      "acupoints": [
        "太冲（疏肝解郁要穴）",
        "期门（理气）",
        "内关（宽胸解郁）"
      ]
    }
  },
  "特禀质": {
    "features": [
      "过敏体质",
      "哮喘",
      "荨麻疹",
      "药物过敏",
      "鼻塞",
      "过敏性鼻炎",
      "皮肤瘙痒",
      "食物过敏",
      "花粉过敏"
    ],
    "description": "先天失常，以生理缺陷、过敏反应等为主要特征。",
    "advice": {
      "diet": [
        "玉屏风散（黄芪、白术、防风）调理，黄芪粥固表",
        "多食山药、大枣、灵芝等扶正食物",
        "避免已知过敏原，慎食海鲜、辛辣刺激食物"
      ],
      "lifestyle": [
        "保持居室清洁，避免尘螨、花粉等过敏原",
        "适度锻炼增强体质，注意保暖预防感冒",
        "外出可戴口罩，过敏季节减少外出"
      ],
      "acupoints": [
        "足三里（扶正固本）",
        "肺俞（固表）",
        "迎香（通鼻窍）"
      ]
    }
  }
};

// ─── 内嵌证型调理知识（来自 tiaoli.db，KV 回退数据） ───
const PATTERNS = {
  "ganyu": {
    "id": "ganyu",
    "name": "肝气郁结",
    "category": "情志",
    "description": "因情志不遂、压力过大导致肝失疏泄，气机郁滞。常见于现代工作压力大的人群。",
    "symptoms": [
      "胸胁胀痛",
      "情绪抑郁",
      "易怒",
      "叹气",
      "咽喉异物感",
      "月经不调",
      "乳房胀痛"
    ],
    "tongue": "舌质淡红,苔薄白",
    "pulse": "弦脉",
    "principle": "疏肝理气,解郁散结",
    "formulas": [
      {
        "name": "逍遥散",
        "source": "《太平惠民和剂局方》",
        "ingredients": "柴胡10g, 当归10g, 白芍10g, 白术10g, 茯苓10g, 炙甘草6g, 薄荷3g(后下), 煨生姜3片",
        "usage": "水煎服,每日1剂,分2次温服",
        "notes": "肝郁明显者可加郁金10g、香附10g"
      },
      {
        "name": "玫瑰花茶",
        "source": "经验方",
        "ingredients": "玫瑰花5g, 月季花3g, 冰糖适量",
        "usage": "沸水冲泡,代茶频饮",
        "notes": "经期慎用"
      }
    ],
    "diet": [
      {
        "name": "玫瑰花粥",
        "ingredients": "玫瑰花10g, 粳米100g, 冰糖适量",
        "method": "粳米煮粥,粥成后加入玫瑰花稍煮,调入冰糖",
        "efficacy": "疏肝理气解郁",
        "frequency": "每周2-3次"
      },
      {
        "name": "陈皮萝卜汤",
        "ingredients": "白萝卜200g, 陈皮10g, 排骨150g",
        "method": "排骨焯水,与陈皮同煮1小时,加入萝卜再煮30分钟",
        "efficacy": "行气消食化痰",
        "frequency": "每周1-2次"
      }
    ],
    "acupoints": [
      {
        "name": "太冲",
        "location": "足背,第1、2跖骨结合部之前凹陷中",
        "method": "用拇指按揉,以酸胀为度",
        "duration": "每侧3-5分钟,每日2次",
        "caution": "孕妇慎用"
      },
      {
        "name": "行间",
        "location": "足背,第1、2趾间,趾蹼缘后方赤白肉际处",
        "method": "拇指指腹按揉",
        "duration": "每侧2-3分钟",
        "caution": ""
      }
    ],
    "lifestyle": [
      {
        "category": "情志",
        "advice": "保持心情舒畅,可练习八段锦或太极拳,每天15-30分钟"
      },
      {
        "category": "运动",
        "advice": "规律有氧运动,如快走、慢跑,每周3-5次,每次30分钟"
      },
      {
        "category": "作息",
        "advice": "保证充足睡眠,避免熬夜(23点前入睡),午休15-30分钟"
      }
    ]
  },
  "pixu": {
    "id": "pixu",
    "name": "脾气虚弱",
    "category": "脾胃",
    "description": "饮食不节、思虑过度或久病体虚导致脾胃运化功能减退。",
    "symptoms": [
      "食欲不振",
      "饭后腹胀",
      "大便溏泄",
      "面色萎黄",
      "神疲乏力",
      "消瘦或虚胖"
    ],
    "tongue": "舌质淡,苔薄白,边有齿痕",
    "pulse": "缓弱脉",
    "principle": "健脾益气,和中养胃",
    "formulas": [
      {
        "name": "四君子汤",
        "source": "《太平惠民和剂局方》",
        "ingredients": "党参10g, 白术10g, 茯苓10g, 炙甘草6g",
        "usage": "水煎服,每日1剂",
        "notes": "腹胀明显者加陈皮10g、砂仁6g(后下)"
      },
      {
        "name": "山药薏米粥",
        "source": "经验方",
        "ingredients": "山药30g, 薏苡仁30g, 粳米100g, 大枣5枚",
        "usage": "煮粥,每日早餐食用",
        "notes": "大便溏泄严重者薏苡仁可炒用"
      }
    ],
    "diet": [
      {
        "name": "黄芪炖鸡汤",
        "ingredients": "黄芪30g, 母鸡半只, 生姜3片, 大枣5枚",
        "method": "鸡切块焯水,与黄芪、姜、枣同炖2小时",
        "efficacy": "补气健脾",
        "frequency": "每周1次"
      },
      {
        "name": "八宝健脾粥",
        "ingredients": "山药15g, 莲子10g, 芡实10g, 白扁豆10g, 薏苡仁10g, 大枣5枚, 粳米50g, 冰糖适量",
        "method": "所有食材洗净,加水煮粥",
        "efficacy": "健脾祛湿止泻",
        "frequency": "每周3-4次早餐食用"
      }
    ],
    "acupoints": [
      {
        "name": "足三里",
        "location": "外膝眼下3寸,胫骨前嵴外一横指",
        "method": "拇指按揉或艾条悬灸",
        "duration": "按揉每侧3-5分钟,艾灸10-15分钟",
        "caution": "饭后1小时内不宜按揉"
      },
      {
        "name": "中脘",
        "location": "上腹部,前正中线上,脐上4寸",
        "method": "手掌顺时针摩腹,或艾条悬灸",
        "duration": "摩腹5-10分钟,艾灸10-15分钟",
        "caution": "饱腹时不宜操作"
      }
    ],
    "lifestyle": [
      {
        "category": "饮食",
        "advice": "少食多餐,细嚼慢咽,禁生冷油腻。三餐定时定量,每餐七分饱"
      },
      {
        "category": "运动",
        "advice": "饭后散步15-20分钟,避免剧烈运动"
      },
      {
        "category": "作息",
        "advice": "规律作息,午间小憩20-30分钟以养脾气"
      }
    ]
  },
  "yinxu": {
    "id": "yinxu",
    "name": "阴虚火旺",
    "category": "阴虚",
    "description": "阴液亏虚,虚火内扰。多见于熬夜、过度劳累或久病伤阴。",
    "symptoms": [
      "五心烦热",
      "潮热盗汗",
      "口干咽燥",
      "失眠多梦",
      "头晕耳鸣",
      "腰膝酸软"
    ],
    "tongue": "舌质红,少苔或无苔",
    "pulse": "细数脉",
    "principle": "滋阴降火,养心安神",
    "formulas": [
      {
        "name": "六味地黄汤",
        "source": "《小儿药证直诀》",
        "ingredients": "熟地黄24g, 山萸肉12g, 山药12g, 泽泻9g, 牡丹皮9g, 茯苓9g",
        "usage": "水煎服,每日1剂",
        "notes": "虚火明显者加知母10g、黄柏10g"
      },
      {
        "name": "麦冬枸杞茶",
        "source": "经验方",
        "ingredients": "麦冬10g, 枸杞子10g, 菊花3g, 冰糖适量",
        "usage": "沸水冲泡,代茶频饮",
        "notes": "脾胃虚寒者慎用"
      }
    ],
    "diet": [
      {
        "name": "百合银耳羹",
        "ingredients": "百合30g, 银耳15g(泡发), 枸杞子10g, 冰糖适量",
        "method": "银耳撕碎,与百合同煮至粘稠,加冰糖、枸杞稍煮",
        "efficacy": "滋阴润肺安神",
        "frequency": "每周2-3次"
      },
      {
        "name": "生地麦冬炖鸭",
        "ingredients": "生地黄20g, 麦冬15g, 鸭肉200g, 生姜2片",
        "method": "鸭肉焯水,与药材同炖1.5小时",
        "efficacy": "滋阴清热",
        "frequency": "每周1次"
      }
    ],
    "acupoints": [
      {
        "name": "涌泉",
        "location": "足底部,卷足时足前部凹陷处,约第2、3趾趾缝纹头端与足跟连线的前1/3处",
        "method": "拇指按揉或艾条悬灸",
        "duration": "按揉每侧5分钟,睡前尤佳",
        "caution": "按揉力度适中"
      },
      {
        "name": "太溪",
        "location": "内踝后方,内踝尖与跟腱之间的凹陷中",
        "method": "拇指指腹按揉",
        "duration": "每侧3-5分钟",
        "caution": ""
      }
    ],
    "lifestyle": [
      {
        "category": "作息",
        "advice": "保证夜间睡眠,11点前入睡。避免熬夜和过度劳累"
      },
      {
        "category": "情志",
        "advice": "避免情绪波动过大,可练习静坐或冥想"
      },
      {
        "category": "饮食",
        "advice": "忌辛辣燥热之品(辣椒、羊肉、酒类),多食滋阴食材(银耳、百合、梨、莲藕)"
      }
    ]
  },
  "shire": {
    "id": "shire",
    "name": "湿热内蕴",
    "category": "湿热",
    "description": "脾胃湿热或肝胆湿热,多因饮食不节、过食肥甘厚味所致。",
    "symptoms": [
      "口苦口臭",
      "大便粘滞不爽",
      "小便黄",
      "面部出油长痘",
      "身体困重",
      "舌苔黄腻"
    ],
    "tongue": "舌质红,苔黄腻",
    "pulse": "滑数脉",
    "principle": "清热利湿,化浊解毒",
    "formulas": [
      {
        "name": "茵陈五苓散加减",
        "source": "《金匮要略》",
        "ingredients": "茵陈蒿15g, 茯苓15g, 猪苓10g, 泽泻10g, 白术10g, 栀子10g, 黄柏10g",
        "usage": "水煎服,每日1剂",
        "notes": "大便干结者加大黄6g(后下)"
      },
      {
        "name": "薏米绿豆汤",
        "source": "经验方",
        "ingredients": "薏苡仁50g, 绿豆50g, 冰糖适量",
        "usage": "煮汤,代茶频饮",
        "notes": "脾胃虚寒者不宜多服"
      }
    ],
    "diet": [
      {
        "name": "冬瓜薏米汤",
        "ingredients": "冬瓜200g(带皮), 薏苡仁30g, 赤小豆30g",
        "method": "薏苡仁、赤小豆先煮1小时,加入冬瓜再煮30分钟",
        "efficacy": "清热利湿消肿",
        "frequency": "每周2-3次"
      },
      {
        "name": "苦瓜炒蛋",
        "ingredients": "苦瓜1根, 鸡蛋2个, 盐少许",
        "method": "苦瓜切片焯水,与鸡蛋同炒",
        "efficacy": "清热祛火",
        "frequency": "每周1-2次"
      }
    ],
    "acupoints": [
      {
        "name": "阴陵泉",
        "location": "小腿内侧,胫骨内侧髁后下方凹陷中",
        "method": "拇指按揉,力度稍重",
        "duration": "每侧3-5分钟",
        "caution": ""
      },
      {
        "name": "曲池",
        "location": "屈肘成直角,肘横纹外侧端与肱骨外上髁连线中点",
        "method": "拇指按揉",
        "duration": "每侧2-3分钟",
        "caution": ""
      }
    ],
    "lifestyle": [
      {
        "category": "饮食",
        "advice": "清淡饮食,忌油腻、甜食、煎炸、辛辣。多食冬瓜、苦瓜、薏米、绿豆"
      },
      {
        "category": "运动",
        "advice": "适当运动出汗有助于湿热排出,如快走、慢跑、球类运动"
      },
      {
        "category": "情志",
        "advice": "避免长时间处于潮湿闷热环境,保持居室通风干燥"
      }
    ]
  },
  "qixu": {
    "id": "qixu",
    "name": "气虚血瘀",
    "category": "气血",
    "description": "气虚推动无力,导致血液运行不畅,瘀阻脉络。常见于中老年及久病体虚者。",
    "symptoms": [
      "神疲乏力",
      "气短懒言",
      "面色晦暗",
      "身体局部刺痛固定不移",
      "唇甲紫暗"
    ],
    "tongue": "舌质淡紫或紫暗,或有瘀斑",
    "pulse": "涩脉或细涩脉",
    "principle": "益气活血,化瘀通络",
    "formulas": [
      {
        "name": "补阳还五汤",
        "source": "《医林改错》",
        "ingredients": "生黄芪120g(重用), 当归尾10g, 赤芍10g, 地龙10g, 川芎10g, 红花10g, 桃仁10g",
        "usage": "水煎服,每日1剂",
        "notes": "黄芪用量可根据气虚程度调整,初用可从30g开始"
      },
      {
        "name": "西洋参田七茶",
        "source": "经验方",
        "ingredients": "西洋参5g, 田七(三七)粉3g",
        "usage": "沸水冲泡代茶,或参片含服+三七粉冲服",
        "notes": "孕妇忌用三七"
      }
    ],
    "diet": [
      {
        "name": "黄芪当归炖乌鸡",
        "ingredients": "黄芪30g, 当归10g, 乌鸡半只, 生姜3片",
        "method": "乌鸡焯水,与药材同炖2小时",
        "efficacy": "补气养血活血",
        "frequency": "每周1次"
      },
      {
        "name": "山楂红糖饮",
        "ingredients": "山楂15g, 红糖20g, 生姜3片",
        "method": "山楂与生姜煮水15分钟,调入红糖",
        "efficacy": "活血化瘀暖宫",
        "frequency": "每周2-3次"
      }
    ],
    "acupoints": [
      {
        "name": "血海",
        "location": "大腿内侧,髌底内侧端上2寸",
        "method": "拇指按揉",
        "duration": "每侧3-5分钟",
        "caution": ""
      },
      {
        "name": "气海",
        "location": "下腹部,前正中线上,脐下1.5寸",
        "method": "手掌顺时针摩揉,或艾条悬灸",
        "duration": "摩揉5-10分钟,艾灸10-15分钟",
        "caution": "孕妇禁灸"
      }
    ],
    "lifestyle": [
      {
        "category": "运动",
        "advice": "适度运动促进气血运行,如散步、太极拳、八段锦,避免过度消耗"
      },
      {
        "category": "情志",
        "advice": "保持心情愉悦,避免久坐、久卧伤气。注意保暖,避免受寒"
      },
      {
        "category": "饮食",
        "advice": "多食温补气血之品(红枣、桂圆、牛肉),忌生冷寒凉"
      }
    ]
  },
  "shihan": {
    "id": "shihan",
    "name": "寒湿困脾",
    "category": "脾胃",
    "description": "寒湿内侵或过食生冷,损伤脾阳,运化失常。",
    "symptoms": [
      "腹部冷痛喜按",
      "大便溏稀",
      "口淡不渴",
      "四肢不温",
      "身体困重",
      "浮肿"
    ],
    "tongue": "舌质淡胖,苔白滑腻",
    "pulse": "沉迟脉或濡缓脉",
    "principle": "温中散寒,健脾燥湿",
    "formulas": [
      {
        "name": "理中汤",
        "source": "《伤寒论》",
        "ingredients": "党参10g, 干姜10g, 白术10g, 炙甘草6g",
        "usage": "水煎服,每日1剂",
        "notes": "寒重者干姜可加至15g, 加附子6g"
      },
      {
        "name": "生姜红糖水",
        "source": "经验方",
        "ingredients": "生姜15g(切片), 红糖20g",
        "usage": "沸水冲泡或煮5分钟,趁热饮用",
        "notes": "受寒初期及经期腹痛尤宜"
      }
    ],
    "diet": [
      {
        "name": "胡椒猪肚汤",
        "ingredients": "猪肚1个(洗净), 白胡椒15g(打碎), 生姜5片, 红枣5枚",
        "method": "胡椒入猪肚,扎好后与姜枣同炖2小时",
        "efficacy": "温中散寒健脾",
        "frequency": "每周1次"
      },
      {
        "name": "姜枣糯米粥",
        "ingredients": "糯米100g, 生姜15g(切丝), 红枣10枚",
        "method": "糯米红枣煮粥,粥成时加入姜丝再煮5分钟",
        "efficacy": "温胃散寒止呕",
        "frequency": "早餐食用,每周3-4次"
      }
    ],
    "acupoints": [
      {
        "name": "关元",
        "location": "下腹部,前正中线上,脐下3寸",
        "method": "艾条悬灸",
        "duration": "10-20分钟",
        "caution": "孕妇禁灸"
      },
      {
        "name": "神阙",
        "location": "腹部,脐中央",
        "method": "隔姜灸或艾条悬灸",
        "duration": "10-15分钟",
        "caution": "不宜针刺,只可灸法"
      }
    ],
    "lifestyle": [
      {
        "category": "饮食",
        "advice": "忌生冷寒凉食物(冰品、凉茶、西瓜、螃蟹)。多食温热食物(生姜、羊肉、桂圆)"
      },
      {
        "category": "保暖",
        "advice": "注意腹部保暖,可用热水袋温敷。居住环境避免潮湿"
      },
      {
        "category": "运动",
        "advice": "适当运动助阳气升发,多晒太阳,特别是后背督脉"
      }
    ]
  },
  "feixu": {
    "id": "feixu",
    "name": "肺气虚弱",
    "category": "肺系",
    "description": "肺气不足,卫外不固。多见于久咳、反复感冒、体质虚弱人群。",
    "symptoms": [
      "气短喘息",
      "自汗怕风",
      "容易感冒",
      "声音低微",
      "面色恍白"
    ],
    "tongue": "舌质淡,苔薄白",
    "pulse": "虚弱脉",
    "principle": "补益肺气,固表止汗",
    "formulas": [
      {
        "name": "玉屏风散",
        "source": "《医方类聚》",
        "ingredients": "黄芪20g, 白术10g, 防风6g",
        "usage": "水煎服,每日1剂,连服2-4周",
        "notes": "可作为预防感冒的长期调理方"
      },
      {
        "name": "黄芪百合汤",
        "source": "经验方",
        "ingredients": "黄芪15g, 百合20g, 冰糖适量",
        "usage": "黄芪先煮20分钟,加入百合再煮10分钟",
        "notes": "有痰者加法半夏10g"
      }
    ],
    "diet": [
      {
        "name": "川贝雪梨炖猪肺",
        "ingredients": "猪肺1副(洗净), 雪梨2个, 川贝母10g(打碎)",
        "method": "猪肺焯水,与雪梨块、川贝同炖1.5小时",
        "efficacy": "润肺止咳化痰",
        "frequency": "每周1-2次"
      },
      {
        "name": "黄芪山药粥",
        "ingredients": "黄芪20g, 山药30g, 粳米100g",
        "method": "黄芪煮水去渣,用黄芪水煮山药粳米成粥",
        "efficacy": "补肺健脾益气",
        "frequency": "每周3-4次"
      }
    ],
    "acupoints": [
      {
        "name": "肺俞",
        "location": "背部,第3胸椎棘突下,旁开1.5寸",
        "method": "拇指按揉或艾条悬灸",
        "duration": "按揉3-5分钟,艾灸10分钟",
        "caution": "需有人协助操作"
      },
      {
        "name": "列缺",
        "location": "前臂桡侧缘,桡骨茎突上方,腕横纹上1.5寸",
        "method": "拇指按揉",
        "duration": "每侧2-3分钟",
        "caution": ""
      }
    ],
    "lifestyle": [
      {
        "category": "护肺",
        "advice": "避免受凉,注意保暖。出门戴口罩防风寒。每天深呼吸练习5-10分钟"
      },
      {
        "category": "运动",
        "advice": "八段锦、太极拳、慢走等温和运动,不宜剧烈运动大汗出。多到空气清新处活动"
      },
      {
        "category": "饮食",
        "advice": "忌辛辣燥热、生冷。多食白色入肺食材(银耳、百合、白萝卜、山药)"
      }
    ]
  },
  "tanre": {
    "id": "tanre",
    "name": "痰热壅肺",
    "category": "肺系",
    "description": "痰热互结,壅阻于肺。常见于外感后咳嗽不愈或热病恢复期。",
    "symptoms": [
      "咳嗽痰黄粘稠",
      "咽痛口渴",
      "发热",
      "胸闷气喘",
      "大便干结"
    ],
    "tongue": "舌质红,苔黄腻",
    "pulse": "滑数脉",
    "principle": "清热化痰,宣肺止咳",
    "formulas": [
      {
        "name": "清金化痰汤",
        "source": "《医方集解》",
        "ingredients": "黄芩10g, 栀子10g, 桔梗10g, 浙贝母10g, 麦冬10g, 知母10g, 桑白皮10g, 瓜蒌仁10g, 橘红6g, 甘草6g",
        "usage": "水煎服,每日1剂",
        "notes": "痰多者加竹沥水30ml"
      },
      {
        "name": "罗汉果茶",
        "source": "经验方",
        "ingredients": "罗汉果1/4个, 菊花5g, 冰糖适量",
        "usage": "沸水冲泡,代茶频饮",
        "notes": "糖尿病患者可去冰糖"
      }
    ],
    "diet": [
      {
        "name": "鱼腥草瘦肉汤",
        "ingredients": "鱼腥草(鲜品)50g或干品15g, 瘦肉150g",
        "method": "瘦肉焯水,与鱼腥草同煮1小时",
        "efficacy": "清热解毒化痰",
        "frequency": "症状期间每日1次"
      },
      {
        "name": "荸荠鲜藕汁",
        "ingredients": "荸荠100g, 鲜藕100g, 雪梨1个",
        "method": "榨汁,加少许蜂蜜调匀",
        "efficacy": "清热润肺化痰",
        "frequency": "每日1杯"
      }
    ],
    "acupoints": [
      {
        "name": "尺泽",
        "location": "肘横纹中,肱二头肌腱桡侧凹陷中",
        "method": "拇指按揉,可点刺放血(需专业人员)",
        "duration": "按揉每侧2-3分钟",
        "caution": "放血需由专业医师操作"
      },
      {
        "name": "合谷",
        "location": "手背,第1、2掌骨间,第2掌骨桡侧中点",
        "method": "拇指按揉,力度以酸胀为度",
        "duration": "每侧2-3分钟",
        "caution": "孕妇慎用"
      }
    ],
    "lifestyle": [
      {
        "category": "饮食",
        "advice": "忌辛辣、油腻、甜食。多喝水,多食清热化痰食物(梨、荸荠、萝卜、冬瓜)"
      },
      {
        "category": "起居",
        "advice": "保持室内空气流通,注意休息。痰多时注意排痰,拍背辅助"
      },
      {
        "category": "保暖",
        "advice": "避免受凉,以防复感外邪。出汗后及时擦干更衣"
      }
    ]
  },
  "xinxu": {
    "id": "xinxu",
    "name": "心脾两虚",
    "category": "心系",
    "description": "思虑过度、劳伤心脾导致气血不足,心神失养。",
    "symptoms": [
      "失眠多梦",
      "心悸健忘",
      "食欲不振",
      "面色萎黄",
      "神疲乏力",
      "月经量少色淡"
    ],
    "tongue": "舌质淡嫩,苔薄白",
    "pulse": "细弱脉",
    "principle": "补益心脾,养血安神",
    "formulas": [
      {
        "name": "归脾汤",
        "source": "《济生方》",
        "ingredients": "黄芪15g, 党参10g, 白术10g, 当归10g, 龙眼肉10g, 酸枣仁15g, 茯神10g, 远志6g, 木香6g, 炙甘草6g, 生姜3片, 大枣5枚",
        "usage": "水煎服,每日1剂",
        "notes": "失眠重者可加夜交藤30g、合欢皮15g"
      },
      {
        "name": "桂圆莲子安神汤",
        "source": "经验方",
        "ingredients": "龙眼肉15g, 莲子20g(去心), 红枣5枚, 冰糖适量",
        "usage": "煮汤,睡前1小时温服",
        "notes": "内有痰火者不宜"
      }
    ],
    "diet": [
      {
        "name": "龙眼糯米粥",
        "ingredients": "龙眼肉15g, 糯米100g, 红糖适量",
        "method": "糯米煮粥,粥成加入龙眼肉稍煮,调入红糖",
        "efficacy": "补心脾养血",
        "frequency": "早餐食用,每周3-4次"
      },
      {
        "name": "酸枣仁安神茶",
        "ingredients": "酸枣仁15g(打碎), 茯苓10g, 知母6g, 甘草3g",
        "method": "三碗水煮至一碗,睡前1小时温服",
        "efficacy": "养心安神助眠",
        "frequency": "每晚睡前1次"
      }
    ],
    "acupoints": [
      {
        "name": "神门",
        "location": "腕前区,腕掌侧横纹尺侧端,尺侧腕屈肌腱的桡侧凹陷中",
        "method": "拇指按揉,力度轻柔",
        "duration": "每侧2-3分钟,睡前加按",
        "caution": ""
      },
      {
        "name": "心俞",
        "location": "背部,第5胸椎棘突下,旁开1.5寸",
        "method": "拇指按揉或艾条悬灸",
        "duration": "按揉3-5分钟,艾灸10分钟",
        "caution": "需有人协助"
      }
    ],
    "lifestyle": [
      {
        "category": "作息",
        "advice": "规律作息,22:30前准备入睡。睡前一小时远离电子产品,可听轻音乐"
      },
      {
        "category": "情志",
        "advice": "减少思虑,适当倾诉。可练习正念冥想,每天10-15分钟"
      },
      {
        "category": "饮食",
        "advice": "忌浓茶咖啡等兴奋饮品,晚餐七分饱。睡前可以喝杯温牛奶或蜂蜜水"
      }
    ]
  },
  "shenxu": {
    "id": "shenxu",
    "name": "肾阳虚衰",
    "category": "肾系",
    "description": "肾阳不足,温煦失职。多见于年老、久病或房劳过度。",
    "symptoms": [
      "腰膝酸冷",
      "畏寒肢冷",
      "夜尿频多",
      "性欲减退",
      "精神萎靡",
      "水肿"
    ],
    "tongue": "舌质淡胖,苔白滑",
    "pulse": "沉迟脉,尺脉弱",
    "principle": "温补肾阳,填精益髓",
    "formulas": [
      {
        "name": "金匮肾气丸加减",
        "source": "《金匮要略》",
        "ingredients": "熟地黄24g, 山药12g, 山萸肉12g, 泽泻9g, 牡丹皮9g, 茯苓9g, 肉桂6g(后下), 制附子9g(先煎)",
        "usage": "制附子先煎30分钟,再入他药共煎,每日1剂",
        "notes": "需在医师指导下使用"
      },
      {
        "name": "韭菜籽核桃粥",
        "source": "经验方",
        "ingredients": "韭菜籽10g, 核桃仁30g, 粳米100g",
        "usage": "韭菜籽研末,与核桃仁、粳米同煮粥",
        "notes": "每周食用3-4次"
      }
    ],
    "diet": [
      {
        "name": "羊肉当归生姜汤",
        "ingredients": "羊肉250g, 当归10g, 生姜15g, 枸杞10g",
        "method": "羊肉焯水,与当归、姜同炖2小时,枸杞最后10分钟放入",
        "efficacy": "温阳散寒养血",
        "frequency": "每周1-2次"
      },
      {
        "name": "核桃黑芝麻糊",
        "ingredients": "核桃仁50g, 黑芝麻50g, 糯米粉30g, 冰糖适量",
        "method": "核桃、芝麻打粉,糯米粉调糊,加入粉和冰糖搅匀",
        "efficacy": "补肾益精乌发",
        "frequency": "早餐食用,每周3-4次"
      }
    ],
    "acupoints": [
      {
        "name": "肾俞",
        "location": "腰部,第2腰椎棘突下,旁开1.5寸",
        "method": "艾条悬灸或双手搓热后按揉",
        "duration": "艾灸15-20分钟,按揉每侧3-5分钟",
        "caution": "腰部保暖"
      },
      {
        "name": "命门",
        "location": "腰部,后正中线上,第2腰椎棘突下凹陷中",
        "method": "艾条悬灸或手掌搓热后摩揉",
        "duration": "艾灸15分钟",
        "caution": ""
      }
    ],
    "lifestyle": [
      {
        "category": "保暖",
        "advice": "特别注意腰背和下肢保暖,避免坐卧湿地。每晚热水泡脚20分钟"
      },
      {
        "category": "房事",
        "advice": "节制房事,养精固肾。适度运动以助阳气生发"
      },
      {
        "category": "运动",
        "advice": "练习太极拳、八段锦、站桩等固本培元的运动。避免大汗淋漓的剧烈运动"
      }
    ]
  }
};

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
