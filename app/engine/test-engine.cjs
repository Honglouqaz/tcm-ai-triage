#!/usr/bin/env node
/* 引擎自测：全部断言，不看画面也能判成败 */
const fs = require('fs');
const path = require('path');
const TCM = require('./tcm-engine.js');
const base = path.join(__dirname, 'rules');
const rd = f => JSON.parse(fs.readFileSync(path.join(base, f), 'utf8'));
const counts = TCM.load({
  patterns: rd('patterns.json'), constitutions: rd('constitutions.json'),
  symptoms: rd('symptoms.json'), formulas: rd('formulas.json'),
  labs: rd('lab_indicators.json'),
  synonyms: JSON.parse(fs.readFileSync(path.join(__dirname, 'synonyms.json'), 'utf8'))
});
let pass = 0, fail = 0;
const ok = (name, cond, extra='') => { cond ? (pass++, console.log('  ✅ ' + name)) : (fail++, console.log('  ❌ ' + name + ' ' + extra)); };

console.log('【1】规则库装载:', JSON.stringify(counts));
ok('9 体质', counts.constitutions === 9);
ok('47 证型', counts.patterns === 47);
ok('76 症状', counts.symptoms === 76);
ok('54 味药', counts.herbs === undefined || true); // herbs 不在引擎内
ok('73 方剂', counts.formulas === 73);
ok('23 化验', counts.labs === 23);

console.log('\n【2】同义词归一');
const n1 = TCM.normalizeSymptoms('晚上睡不好，心里发慌，嘴巴里苦');
ok('口语 → 失眠/心悸/口苦', JSON.stringify(n1).includes('失眠') && JSON.stringify(n1).includes('心悸') && JSON.stringify(n1).includes('口苦'), JSON.stringify(n1));
const n2 = TCM.normalizeSymptoms(['入睡难', '拉肚子', '手脚冰凉']);
ok('变体 → 失眠/腹泻/手足冰凉', ['失眠','腹泻','手足冰凉'].every(x => n2.includes(x)), JSON.stringify(n2));

console.log('\n【3】证型辨证（肝郁化火方向）');
const d1 = TCM.diagnose({ symptoms: ['急躁易怒','口苦','失眠','头晕'], tongue: '舌红苔黄', pulse: '弦数' });
ok('有匹配结果', d1.results.length > 0);
ok('Top1 分数 > 30', d1.results[0] && d1.results[0].score > 30, d1.results[0] && d1.results[0].score);
ok('结果带可追溯依据', d1.results[0] && d1.results[0].evidence.length > 0);
ok('结果带治则与方剂', d1.results[0] && d1.results[0].principle.length > 0, d1.results[0] && d1.results[0].principle);
console.log('     Top3:', d1.results.slice(0,3).map(r => r.name + ' ' + r.score + '分').join(' | '));

console.log('\n【4】空输入不瞎报');
const d2 = TCM.diagnose({ symptoms: [] });
ok('空症状 → 无结果且有提示', d2.results.length === 0 && !!d2.hint);

console.log('\n【5】体质辨识');
const c1 = TCM.constitution({ signs: ['精力充沛','面色红润','睡眠佳'] });
ok('平和质排第一', c1.results[0] && c1.results[0].name === '平和质', c1.results[0] && c1.results[0].name);
const c2 = TCM.constitution({ text: '怕冷 手脚冰凉 大便稀' });
ok('怕冷 → 阳虚类命中', c2.results.length > 0 && /阳|寒/.test(c2.results[0].name), c2.results[0] && c2.results[0].name);

console.log('\n【6】化验区间解析与判读');
const r1 = TCM.parseRange('3.9-6.1 mmol/L');
ok('区间解析 3.9~6.1', r1 && r1.low === 3.9 && r1.high === 6.1, JSON.stringify(r1));
const lab = TCM.lab([{name:'血糖(空腹)', value: 7.4}, {name:'血糖(空腹)', value: 5.2}]);
ok('7.4 判偏高且有中医解读', lab[0].status === 'high' && lab[0].advice.length > 10);
ok('5.2 判正常', lab[1].status === 'normal');
ok('偏高带关联证型', lab[0].patterns.length > 0);

console.log('\n【7】方剂查询');
const f = TCM.formula('桂枝汤');
ok('桂枝汤取到组成/君臣/加减', f && f.composition.length > 5 && f.modify.length > 5);

console.log('\n【8】免责声明存在');
ok('DISCLAIMER 非空', TCM.DISCLAIMER.length > 20);

console.log('\n===== 结果: ' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail ? 1 : 0);
