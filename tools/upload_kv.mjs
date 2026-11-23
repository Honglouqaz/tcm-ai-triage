#!/usr/bin/env node
/**
 * upload_kv.mjs — 把知识库灌进 Cloudflare KV
 *
 * ── 为什么要这个脚本 ─────────────────────────────────────────
 * 仓库里的知识库分两类，放的地方不一样：
 *
 *   1) 结构化规则（rules/patterns|herbs|formulas|...，约 160KB）
 *      → 已经编译进 Worker（build-prepare 生成 rules-bundle.js）。
 *        体积小、每次辨证都要用，进内存最划算，不需要 KV。
 *
 *   2) 古籍全文（rules/classics/，73 万字 / 2.1MB）
 *      → 走 KV。它体积大、几乎不更新、只有「查古籍」时才读。
 *        塞进 Worker 只会让每次冷启动背 2MB。
 *
 * ── KV key 命名（与 Worker 侧约定一致）──────────────────────
 *   tcm:classic:index          古籍总索引（书名/条数/字数）
 *   tcm:classic:<book>         某部古籍的全部条目（JSON 数组）
 *   tcm:pattern:<证型名>       单条证型（规则降级路径用）
 *   tcm:config:llm             用户自带的 LLM 配置（BYOK，不在 git 里）
 *
 * ── 用法 ────────────────────────────────────────────────────
 *   node tools/upload_kv.mjs --dry-run        # 只看会写什么，不联网
 *   node tools/upload_kv.mjs                  # 真上传
 *   node tools/upload_kv.mjs --only classics  # 只传古籍
 *   node tools/upload_kv.mjs --only patterns  # 只传证型
 *   node tools/upload_kv.mjs --prefix my-tcm  # 自定义 key 前缀（多环境隔离）
 *
 * 前置：wrangler 已安装且已 login，wrangler.toml 里填了 TCM_KV 的 id。
 * 大文件按 20MB 上限切块（KV 单值上限 25MB，留余量）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RULES = path.join(ROOT, 'rules');
const CLASSICS = path.join(RULES, 'classics');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d = null) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const DRY = has('--dry-run');
const ONLY = val('--only', 'all');
const PREFIX = val('--prefix', 'tcm');
const KV_BINDING = 'TCM_KV';

/* ── 收集要写的 key ───────────────────────────────────────── */
const jobs = [];

function addJob(key, value, note) {
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  jobs.push({ key, body, note, bytes: Buffer.byteLength(body, 'utf8') });
}

const wantClassics = ONLY === 'all' || ONLY === 'classics';
const wantPatterns = ONLY === 'all' || ONLY === 'patterns';

if (wantClassics && fs.existsSync(CLASSICS)) {
  const idxPath = path.join(CLASSICS, '_index.json');
  if (fs.existsSync(idxPath)) {
    addJob(`${PREFIX}:classic:index`, fs.readFileSync(idxPath, 'utf8'), '古籍总索引');
  }
  for (const f of fs.readdirSync(CLASSICS).filter((x) => x.endsWith('.json') && x !== '_index.json')) {
    const book = f.replace(/\.json$/, '');
    const raw = fs.readFileSync(path.join(CLASSICS, f), 'utf8');
    const parsed = JSON.parse(raw);
    // 只存条目本身，元信息已在 index 里，省一半冗余
    addJob(`${PREFIX}:classic:${book}`, JSON.stringify(parsed.items || parsed), `${book} (${parsed.count || '?'} 条)`);
  }
}

if (wantPatterns) {
  const pf = path.join(RULES, 'patterns.json');
  if (fs.existsSync(pf)) {
    const patterns = JSON.parse(fs.readFileSync(pf, 'utf8'));
    for (const [name, body] of Object.entries(patterns)) {
      addJob(`${PREFIX}:pattern:${name}`, JSON.stringify(body), `证型 ${name}`);
    }
  }
}

/* ── 汇报 ─────────────────────────────────────────────────── */
const totalBytes = jobs.reduce((n, j) => n + j.bytes, 0);
console.log(`\n待写入 ${jobs.length} 个 key，共 ${(totalBytes / 1024 / 1024).toFixed(2)} MB\n`);

const over = jobs.filter((j) => j.bytes > 20 * 1024 * 1024);
if (over.length) {
  console.error('❌ 以下 key 超过 20MB，KV 单值上限 25MB，需要先切块：');
  for (const j of over) console.error(`   ${j.key}  ${(j.bytes / 1024 / 1024).toFixed(1)} MB`);
  process.exit(1);
}

for (const j of jobs.slice(0, 200)) {
  console.log(`  ${j.key.padEnd(46)} ${(j.bytes / 1024).toFixed(0).padStart(7)} KB   ${j.note}`);
}
if (jobs.length > 200) console.log(`  … 另有 ${jobs.length - 200} 个`);

if (DRY) {
  console.log('\n(--dry-run，未联网写入)');
  console.log(`\n真上传请执行： node tools/upload_kv.mjs${ONLY !== 'all' ? ' --only ' + ONLY : ''}`);
  process.exit(0);
}

/* ── 真上传：走 wrangler kv key put ───────────────────────── */
let ok = 0, fail = 0;
const failed = [];

for (let i = 0; i < jobs.length; i++) {
  const j = jobs[i];
  const tmp = path.join(ROOT, '.kv-tmp-value.json');
  fs.writeFileSync(tmp, j.body, 'utf8');
  try {
    execFileSync('npx', [
      '--yes', 'wrangler', 'kv', 'key', 'put',
      '--binding', KV_BINDING,
      j.key,
      '--path', tmp,
      '--remote',
    ], { stdio: 'pipe', cwd: ROOT, timeout: 120000 });
    ok++;
    process.stdout.write(`\r  已写入 ${ok}/${jobs.length}  ${j.key.slice(0, 40).padEnd(42)}`);
  } catch (e) {
    fail++;
    failed.push(j.key);
    process.stdout.write(`\r  ❌ ${j.key.slice(0, 50)}\n`);
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

console.log(`\n\n完成：成功 ${ok}，失败 ${fail}`);
if (failed.length) {
  console.log('失败的 key（可直接重跑本脚本，会覆盖写，幂等）：');
  for (const k of failed.slice(0, 20)) console.log('  ' + k);
  process.exit(1);
}
console.log('\n别忘了：用户自带的模型 key 这样存，不要写进 git：');
console.log(`  npx wrangler kv key put --binding=${KV_BINDING} "${PREFIX}:config:llm" \\`);
console.log('    \'{"provider":"external","external_base":"https://api.deepseek.com/v1",');
console.log('      "external_key":"sk-你的key","external_model":"deepseek-chat"}\' --remote');
