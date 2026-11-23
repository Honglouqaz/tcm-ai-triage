#!/usr/bin/env node
/* 把 rules/*.json 打成一个 rules-bundle.js —— file:// / Android assets / 静态站都能直接加载，无需 fetch */
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, 'rules');
const rd = f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const bundle = {
  patterns: rd('patterns.json'),
  constitutions: rd('constitutions.json'),
  symptoms: rd('symptoms.json'),
  formulas: rd('formulas.json'),
  labs: rd('lab_indicators.json'),
  synonyms: JSON.parse(fs.readFileSync(path.join(__dirname, 'synonyms.json'), 'utf8')),
  builtAt: new Date().toISOString().slice(0, 19).replace('T', ' ')
};
const out = path.join(__dirname, 'rules-bundle.js');
const counts = Object.keys(bundle).filter(k => typeof bundle[k] === 'object').map(k => k + '=' + Object.keys(bundle[k]).length).join(' ');
fs.writeFileSync(out,
  '/* 自动生成，勿手改。源：rules/*.json + synonyms.json */\n' +
  'window.TCM_RULES=' + JSON.stringify(bundle) + ';\n' +
  'if(typeof module==="object"&&module.exports)module.exports=window.TCM_RULES;\n');
console.log('✅ rules-bundle.js ' + (fs.statSync(out).size / 1024).toFixed(0) + 'KB  ' + counts);
