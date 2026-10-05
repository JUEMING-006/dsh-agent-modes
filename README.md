# dsh-agent-modes · 智能体编队

> **Agent squad modes for DeepSeek Harness** — configurable multi-model agent teams with real subagents, auto verification, shared memory, token accounting and a live floating panel.
>
> ![dsh](https://img.shields.io/badge/DeepSeek%20Harness-0.2.0--rc.2%20verified-3fa66a) ![license](https://img.shields.io/badge/license-MIT-blue) ![topic](https://img.shields.io/badge/GitHub%20topic-dsh--plugin-2a313b)

DeepSeek Harness (dsh) 插件：**模式化的多智能体编队**。选择一个"模式"，该模式下固定编队协作——

```
主控(可换任意模型) → 拆解派发 → 多个执行智能体(各用各的模型,并行) → 验证员独立审查
     ↑ 不合格自动返修一轮 ←──── 验证结论 ────┘ → 汇总交付
```

> **实机验证状态**（v1.0.3）：已在 DeepSeek 桌面应用（运行时 0.2.0-rc.2）与 CLI 宿主上验证——
> 插件零警告激活、9 个 team_* 工具全部注册、悬浮横条在界面底部渲染并每 3 秒实时轮询、
> 看板 http://127.0.0.1:3117 正常服务。兼容性关键点：
> ① 本插件**不携带任何 @deepseek-ai 运行时依赖**（dsh-tools 等 npm 包版本滞后于运行时，混装会被
> 运行时当作不兼容插件行禁用，连累其他插件），全部走运行时自带服务协议；
> ② UI 注册在**客户端入口**（exports["./client"] + `dsh.client.platform:"web"`，渲染进程
> `window.__ModuleLoader__` 模块内 `ctx.slots.inject("shell.overlay", ...)`）完成——宿主侧注册
> 组件无法跨进程渲染；0.2.0-rc.2 客户端可用席位：`sidebar / main / rightbar / shell.overlay / shell.leading`。

- **编队全可调**：主控不锁定 GPT、执行不锁定任何模型。每个角色都能换成 deepseek / openai / google / minimax 上的任意模型，改完立即生效。
- **一套式**：`team_auto` 一个工具跑完整流水线；或用分步工具让会话里的主控自己编排。
- **共享记忆**：团队记忆在一次运行内主控/执行/验证共用，超长自动摘要压缩。
- **额度可见**：每次 API 调用按角色记账（token 与美元），横条/看板实时显示，支持月度预算拦截。
- **UI**：界面底部横状条，点击展开面板（角色改模型、切模式、看花费）；另有浏览器看板兜底 `http://127.0.0.1:3117`。

## 安装

### 形态一：CLI / 本地（`npx @deepseek-ai/dsh web`）

```bash
# 方式 A：从本地目录安装（推荐先用这个）
dsh plugin --profile default add C:/path/to/dsh-agent-modes

# 方式 B：npm 包 / GitHub
dsh plugin --profile default add ./dsh-agent-modes-1.0.0.tgz
```

开发调试（热加载源码）：

```bash
dsh web --patch ./examples/dev.patch.yml   # 先把 dev.patch.yml 里的路径改成绝对路径
```

### 形态二：桌面应用安装包（Windows .exe / macOS .dmg）

桌面 profile 由 Electron 应用独占管理（CLI 操作它会报 `profile "desktop" is managed exclusively by the Electron application`）。两条路：

1. **推荐**：桌面版内 Plugins 面板 → Add → 选本地目录或 tarball；
2. **手动**（本机已验证可用）：把 tarball `pnpm add` 进 `%USERPROFILE%\.dsh\profiles\desktop`，并把 `"dsh-agent-modes"` 加入该 `package.json` 的 `dsh.profile.bundles` 数组，然后**重启桌面应用**。

### 配置 API Key

插件配置（插件面板 → dsh-agent-modes → 配置）里填 `providers`：

| 字段 | 说明 |
|---|---|
| `providers.deepseek.apiKey` | 支持 `"sk-..."` 或 `"${DEEPSEEK_API_KEY}"` 引用环境变量 |
| `providers.openai.apiKey` | 主控/执行用 OpenAI 模型时需要 |
| `providers.google.apiKey` | Gemini 系列 |
| `providers.minimax.apiKey` | MiniMax 系列 |

只填你要用到的即可；`baseUrl` 留空走官方 OpenAI 兼容端点。

## 内置模式

| 模式 | 主控 | 执行 | 验证 |
|---|---|---|---|
| `gpt-lead` GPT 主控模式 | GPT-5.1（建议） | GPT-5-mini（通用）、Gemini-2.5-Flash-Lite（廉价批量） | DeepSeek-V4-Pro |
| `deepseek-lead` DeepSeek 主控（省钱） | DeepSeek-V4-Pro | DeepSeek-Flash、Gemini Flash-Lite | DeepSeek-Flash |
| `mini-max-mix` MiniMax 混编 | GPT-5.1（建议） | MiniMax-M3（重执行）、GPT-5-nano（轻执行） | DeepSeek-V4-Pro |

自定义模式：在插件配置的 `modes` 数组里加同结构对象（同 `id` 覆盖内置）。

## 用法（对话里说人话即可）

- 「用 team_auto 把这份调研提纲做成报告」→ 自动：拆解 → 并行执行 → 验证 → 返修 → 交付
- 「用 team_spawn 把这个子任务交给 通用执行」→ **真实子代理**（拥有 dsh 全部工具），按模式映射的模型运行，完成后自动验证
- 「切换到 DeepSeek 主控模式」→ 调 `team_mode_switch`
- 「把验证员换成 gemini-2.5-flash-lite」→ 调 `team_set_role`
- 「今天花了多少」→ 调 `team_usage`

### 执行逻辑（两层，务必分清）

```
【第一层：插件流水线】team_auto / team_dispatch / team_verify
  宿主进程内的 LLM 调用序列（无真实子代理会话，执行者为纯文本模型调用）：
  主控规划(JSON) → 并行派发 workers → 验证员审查 → 不合格返修一轮 → 汇总
  适合：写作/分析/翻译/整理等纯内容任务；完全按"模式"的模型映射执行。

【第二层：真实子代理】team_spawn
  调 ctx.subagents.start() 派发【真·dsh 子代理】——拥有终端/文件/联网等全部工具，
  能多步自主执行，界面里能看到独立会话；provider/model 由当前模式的角色映射
  通过 agentOptions 强制指定；完成后插件自动跑验证员并把结论附在结果里。
  子代理的 token 用量计入 dsh 原生用量统计。

【原生多代理的模型映射】Settings → Subagent → "Allow agents to choose models for Subagents"
  开启后，dsh 原生的 subagent 派发工具允许主代理在每次派发时显式选择子模型
  （候选 = 你在设置里勾选的 AllowedModels；把模式里的路由填进去即可）。
  这条是 dsh 原生能力，对本插件之外的真实多代理运行同样生效。
```

工具清单：`team_mode_list` / `team_mode_switch` / `team_set_role` / `team_dispatch` / `team_dispatch_many` / `team_spawn` / `team_verify` / `team_status` / `team_usage` / `team_auto`。

**主控说明**：模式里 `leadSource: session`（默认）时，主控=你在会话模型选择器里选的模型（模式里的 lead 仅作建议展示）；`leadSource: mode` 时，规划与汇总固定走模式里配置的 lead 模型（会话只当入口）。

## 额度与预算

- 记账：每次调用读各家返回的 `usage`，按内置价格表折算美元（可在 `pricing` 配置覆盖；未收录模型按保守中间价估算）。
- 预算：`budget.monthlyCapUsd` + `onExceed: warn | block`。
- **LiteLLM 网关强化（可选）**：`gateway.mode: litellm` 后所有调用经本地网关，获得虚拟 key、硬预算、限速、官方成本核算。启动方法见 `gateway/litellm.config.yaml` 头部注释。

## 已知边界（务必阅读）

1. **底部横条（shell.bottom slot）需在 dsh 实机验证**：slot 席位与组件注入按官方文档实现（v0.2.0-rc 文档口径），但不同版本 slot 命名可能调整。注册失败只影响横条，**不影响任何编排功能**，浏览器看板 `http://127.0.0.1:3117` 始终可用（横条展开面板与看板同源同数据）。
2. **各家兼容层差异**：MiniMax 忽略部分采样参数、DeepSeek JSON mode 偶发空内容——已在提示与解析层做容错，遇到空返回重试即可。
3. **DeepSeek 峰谷计价 / 各家价格变动**：价格表是静态快照（2026-10），以 `pricing` 配置为准维护。
4. **团队记忆持久化**：数据写在启动目录 `.dsh-agent-modes/`（用量台账 + 模式选择），会话记忆为运行内存活。

## 开发

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run build       # esbuild → lib/ + client/
node .tmp/smoke.mjs # 或: npx esbuild test/smoke.ts --bundle --platform=node --format=esm --outfile=.tmp/smoke.mjs --external:@deepseek-ai/* && node .tmp/smoke.mjs
node test/e2e.mjs   # 构建产物端到端（模拟 ctx 激活 + 看板接口）
npm pack            # 出可安装 tarball
```

## 许可

MIT
