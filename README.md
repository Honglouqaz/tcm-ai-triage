# 中医智能辨证与调理 · 知识库 + 规则引擎

> 把中医的「四诊 → 辨证 → 调理」做成一套**可跑、可读、可改**的开源规则系统：
> 体质辨识、证型匹配、化验指标解读、方剂与穴位建议，全部规则透明、可溯源，不做黑箱。

一套自用的中医数字化实践，整理成开源形态分享出来。**规则数据全部是可读 JSON**，
换成你自己的教材口径、加上你自己的证型，都不需要改代码。

## 它包含什么

| 模块 | 规模（真实计数） | 说明 |
|---|---|---|
| 体质辨识 | **9 种体质** | 九种体质框架；按「表现命中数」排序，可同时看兼夹（前三名）|
| 证型匹配 | **47 个证型** | 症状命中→证型得分，支持主症/次症/舌脉分层权重 |
| 症状词表 | **76 个症状** | 含同义词归一（"睡不好/入睡难/失眠"归一到同一节点） |
| 中药 | **54 味** | 性味归经、功效、常用量、配伍禁忌提示 |
| 方剂 | **73 首** | 组成、君臣佐使、加减法、适用证型 |
| 化验指标 | **23 项** | 参考区间 + 中医视角的关联提示（不做西医诊断） |

## 架构

```
用户主诉 / 问卷
      │
      ▼
[症状归一] ── 同义词词表 ──► 标准症状节点
      │
      ├─► [体质打分] 9 种体质加权 → 主质 + 兼夹
      ├─► [证型匹配] 主症/次症/舌脉分层 → 证型 Top-N
      └─► [化验提示] 指标 → 参考区间 → 关联证型线索
      │
      ▼
[调理方案]  方剂加减 + 穴位 + 起居饮食宜忌
      │
      ▼
单页前端（src/web/index.html，零依赖，双击即开）
```

- **推理全部在本地/边缘完成**：规则引擎是纯 JS，可跑在 Cloudflare Worker（`src/worker/`），
  也可直接放浏览器里跑；LLM 只在「自然语言 → 结构化主诉」这一步可选接入。
- **不绑定任何模型厂商**：`base_url + api_key + model` 从环境变量读，你可以接任意 OpenAI 兼容接口，
  也可以完全不用 LLM（纯规则模式照样出结果）。

## 快速开始

```bash
git clone <this-repo>
cd tcm-ai-triage
# 1) 纯前端试用（不需要任何后端）
python3 -m http.server 8080 -d src/web
# 打开 http://localhost:8080
# 2) 应用版（Android/Windows/Linux，离线跑）
cd app && npm install && npm run prepare:web && npm start
```

Worker 部署（可选）：

```bash
npm i -g wrangler
wrangler kv namespace create TCM_KV      # 把返回的 id 填进 wrangler.toml
wrangler deploy
# 可选：接一家 OpenAI 兼容的模型
wrangler secret put TCM_LLM_API_KEY
```

## 三平台应用（Android / Windows / Linux）

`app/` 目录是同一套规则引擎的**离线应用版**：Electron 打包 Windows / Linux，Capacitor 打包 Android，
外加可「添加到主屏幕」的 PWA。三个平台**共用同一份 `app/web/` 资源**，不存在多套代码漂移。

**装好即用，全程不联网、不调用大模型** —— 输入勾选/口语症状，推理在本地完成，结果确定且可复现。

| 平台 | 产物 | 怎么装 |
|---|---|---|
| Android | `app-debug.apk` | 手机直接安装（debug 签名，自用/测试）|
| Windows | `*.exe`（NSIS 安装版 / portable 免安装版）| 双击 |
| Linux | `*.AppImage` / `*.deb` | `chmod +x *.AppImage && ./*.AppImage` |
| PWA | `app/web/` 任意静态托管 | 浏览器「添加到主屏幕」|

产物由 GitHub Actions 在三平台 runner 上云端构建（`.github/workflows/build-apps.yml`），
本机不需要 Android SDK / JDK / Wine；打 `v*` 标签会自动建 Release 并附上三个安装包。

### 本地开发 / 自己打包

```bash
cd app
npm install
npm run test:engine      # 引擎 21 项断言（规则装载/同义词/辨证/体质/化验/方剂）
npm start                # 起桌面应用（Electron）
npm run dist:linux       # 出 AppImage + deb
npm run dist:win         # 出 exe（需在 Windows 上跑）
npx cap add android && npx cap sync android   # 生成/同步安卓工程，再用 Android Studio 或 gradlew 打包
```

### 本地推理的权重口径（写在代码里，可改）

- 证型「典型症状」列表的前 **40%**（至少 2 条）记为主症，权重 `1.0`；其余记次症 `0.6`
- 舌象命中 `+0.8`，脉象命中 `+0.8`
- 归一分 = 实际得分 ÷ 该证型上限 × 100（所以是「相对适配度」，不是概率）
- 体质按「表现命中数」排序，**不是**标准量表加权

⚠️ 这是可解释的启发式权重，不是某本教材的原始量表。换成你自己的权重表只需改
`app/engine/tcm-engine.js` 里的 `WEIGHTS` 常量 —— 改完全局生效，UI 不用动。

## 为什么开源

中医的数字化最容易走两条歪路：一条是把教材抄成网页，另一条是拿个大模型胡编。
这个项目想试第三条：**把中医的知识结构显式写出来**，让每一步推理都能被追问「依据是什么」。

### 家庭健康档案（v1.1 新增）

应用会**记住每一位家庭成员**。体检、化验、症状、用药按时间线累积，同一指标
自动成趋势（比如尿酸 486 → 420 → 405）。

所有数据只存在你自己设备的 IndexedDB 里，不经过任何服务器；随时可导出成
JSON + 纯文本，不依赖本应用也能打开。

规则和数据都在 `rules/*.json` 里，欢迎按你自己的教材版本改。**改完 PR 回来更好。**

## 免责

**这不是医疗器械，也不提供任何医疗建议。** 详见 [DISCLAIMER.md](DISCLAIMER.md)。
方剂与用药必须由执业中医师面诊后决定。

## License

MIT
