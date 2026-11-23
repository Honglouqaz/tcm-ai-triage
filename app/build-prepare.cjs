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
                'family.js', 'family-ui.js', 'settings.js', 'triage.js', 'triage-ui.js',
              'engine/tcm-engine.js', 'engine/rules-bundle.js'];
const missing = must.filter(f => !fs.existsSync(path.join(web, f)));
console.log(missing.length ? '❌ 缺失: ' + missing.join(', ') : '✅ web 资源齐备 (' + must.length + ' 项)');
// ── 把 package.json 版本号注入 index.html footer ──
// 必须在 process.exit 之前执行（此前放在末尾被 exit 挡掉，成死代码）。
// 版本写死在 HTML 里，每次发版都会忘记改，导致包显示 v1.1 实际是 1.3.x。
{
  const pkg = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'package.json'), 'utf8'));
  const idxPath = require('path').join(__dirname, 'web', 'index.html');
  if (require('fs').existsSync(idxPath)) {
    let html = require('fs').readFileSync(idxPath, 'utf8');
    // 幂等：无论当前是 __VERSION__ 占位符还是旧版本号 v1.2.3，都换成 package.json 的版本。
    // 只判占位符的话，第一次替换后占位符就没了，后续构建不再更新版本号。
    const before = html;
    html = html.replace(/本地规则引擎 (__VERSION__|v\d+\.\d+(?:\.\d+)?)/,
                        '本地规则引擎 v' + pkg.version);
    if (html !== before) {
      require('fs').writeFileSync(idxPath, html, 'utf8');
      console.log('  ✅ footer 版本注入: v' + pkg.version);
    } else {
      console.log('  ⚠ footer 版本标记未找到，跳过注入');
    }
  }
}

process.exit(missing.length ? 1 : 0);
