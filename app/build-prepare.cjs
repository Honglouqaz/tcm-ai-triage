#!/usr/bin/env node
/* 构建前置：把 engine 拷进 web/engine，生成 rules-bundle.js —— web / Electron / Capacitor 共用同一份资源 */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const app = __dirname;
const web = path.join(app, 'web');
const dst = path.join(web, 'engine');
fs.mkdirSync(dst, { recursive: true });
['tcm-engine.js', 'synonyms.json', 'test-engine.cjs'].forEach(f => {
  fs.copyFileSync(path.join(app, 'engine', f), path.join(dst, f));
});
fs.mkdirSync(path.join(dst, 'rules'), { recursive: true });
fs.readdirSync(path.join(app, 'engine', 'rules')).forEach(f => {
  fs.copyFileSync(path.join(app, 'engine', 'rules', f), path.join(dst, 'rules', f));
});
// 重新生成 bundle（写到 engine/ 再由上面拷过来，位置以 web/engine 为准）
cp.execFileSync('node', [path.join(app, 'engine', 'bundle-rules.cjs')], { stdio: 'inherit' });
fs.copyFileSync(path.join(app, 'engine', 'rules-bundle.js'), path.join(dst, 'rules-bundle.js'));
const must = ['index.html', 'app.js', 'style.css', 'sw.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png',
              'engine/tcm-engine.js', 'engine/rules-bundle.js'];
const missing = must.filter(f => !fs.existsSync(path.join(web, f)));
console.log(missing.length ? '❌ 缺失: ' + missing.join(', ') : '✅ web 资源齐备 (' + must.length + ' 项)');
process.exit(missing.length ? 1 : 0);
