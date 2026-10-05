# dsh-agent-modes · 智能体编队插件 — 完整报告

> 版本 v1.0.9 · 报告日期 2026-10-04 · 平台 DeepSeek Harness (dsh) 插件体系
> 工程位置 `C:\Users\jueming\.zcode\workspace\default\dsh-agent-modes\`（TypeScript 约 2400 行 + 客户端 365 行）

---

## 一、插件是什么

一句话：**在 DeepSeek Harness 里把"多模型分工的多智能体编队"做成可配置、可切换、可观测的一套产品**。

你设想的形态它都覆盖了：

| 你的需求 | 插件实现 |
|---|---|
| 选一个"模式"，模式下固定调用一组智能体 | 3 个内置模式 + 1 个零 API 模拟模式 + 自定义模式，切换即换编队 |
| 主智能体不锁定 GPT，执行智能体各用各的模型 | 每个角色（主控/每个执行/验证）独立绑定 provider+model，改完立即生效 |
| 子代理直接被设定为其他大模型 | `team_spawn` 派发真·dsh 子代理时强制注入模式映射的 `agentOptions.provider/model` |
| 有验证代理 | 验证员是编队的固定角色；流水线不合格自动返修一轮；真实子代理完成后自动审查 |
| 上下文记忆并存 | 团队共享记忆（所有角色读写），超长自动摘要压缩，跨模型以字符数工程估算 |
| 知道各 API 调用与额度 | 双口径记账：编队调用按角色计 token+美元（预算可拦截）；dsh 原生会话的真实 token 从会话文件解析 |
| 知道智能体对话了什么、执行了什么命令 | 面板"会话与损耗"区：最近 12 个会话，逐条显示用户/智能体/命令（工具名+参数摘要+是否出错+每轮用的模型+token） |

---

## 二、架构与执行逻辑

### 2.1 进程结构（这是理解一切的关键）

```
┌─ dsh 桌面应用 / CLI ──────────────────────────────────────────┐
│                                                              │
│  宿主进程 (Node)                       渲染进程 (浏览器)        │
│  ┌──────────────────────────┐        ┌─────────────────────┐ │
│  │ dsh-agent-modes 宿主侧    │        │ dsh-agent-modes      │ │
│  │ · 10 个 team_* 工具       │  HTTP  │ 客户端（shell.overlay │ │
│  │ · 看板服务器 :3117        │←轮询3s─│ 悬浮横条+面板）       │ │
│  │ · 会话读取器(zstd 解析)    │        │ 拖拽/下拉/切换        │ │
│  │ · 记账台账/共享记忆        │        └─────────────────────┘ │
│  │ · mock 适配器(可选)        │                                │
│  └──────────────────────────┘                                 │
│  dsh 原生服务: ctx.tools / ctx.llm / ctx.subagents / slots     │
└──────────────────────────────────────────────────────────────┘
```

UI 组件注册在渲染进程（`window.__ModuleLoader__` 约定 + `ctx.slots.inject("shell.overlay")`）；数据由宿主侧看板 HTTP API 提供，两者通过每 3 秒轮询解耦。这个"HTTP 解耦"是插件能在不依赖任何 dsh 内部私有 API 的情况下稳定工作的核心设计。

### 2.2 两层执行逻辑（务必分清）

**第一层：插件流水线（`team_auto` / `team_dispatch` / `team_verify`）**

```
你在对话里说"用 team_auto 做X"
  → 会话主智能体调用 team_auto 工具
  → [主控] 模式里的 lead 模型产出 JSON 拆解计划（子任务→角色分配）
  → [执行] 每个 worker 用自己绑定的模型并行执行（纯文本单次调用，无工具）
  → [验证] verifier 模型逐项审查，输出 pass/issues/revised
  → 不合格 → 自动返修一轮（把问题清单塞回子任务重跑）→ 再验证
  → [汇总] leadSource=mode 时由 lead 汇总，否则原样返回给会话主控定稿
```
执行者不是真代理，是宿主进程发起的 LLM 调用序列。适合写作/分析/翻译/整理类纯内容任务。

**第二层：真实子代理（`team_spawn`）**

```
主智能体调用 team_spawn(worker, task)
  → ctx.subagents.start(provider, { prompt, parent: exec.agent,
       agentOptions: { provider, model } })   ← 模式映射在这里强制注入
  → 生成一个【真·dsh 子代理】：拥有终端/文件/联网全部工具，多步自主执行，
    界面里可见独立会话，token 计入 dsh 原生用量统计
  → 完成后插件自动用验证模型审查其产出，结论+修正版附在返回里给主控复核
```

**原生多代理的模型选择（dsh 自带能力）**：设置 → Subagent → "Allow agents to choose models for Subagents"，开启后 dsh 原生的 `subagent` 派发工具允许主代理每次派发时显式选子模型（候选=你勾选的 AllowedModels）。这条对插件之外的真实多代理运行同样生效。

### 2.3 三级模型调用路由（gateway）

每次角色调用的选路顺序：

1. **dsh 路由**：目标 provider 在 dsh 运行时已注册（你在 dsh 设置里配过）→ 走 `ctx.llm.stream()`，**密钥复用 dsh 的凭据，插件里不用再填**；
2. **litellm 路由**：网关模式开启 → 全部经本地 LiteLLM，按角色虚拟 key 记账/预算；
3. **direct 路由**：直连各家 OpenAI 兼容端点（deepseek/openai/google/minimax 已核实，含内置价格表；MiniMax 忽略参数等差异已容错）。

---

## 三、功能清单与实际效果

### 3.1 面板（悬浮横条 + 展开面板）

| 元素 | 实际效果 |
|---|---|
| 悬浮横条 | 屏幕底部居中胶囊条（`position:fixed`，滚动不消失）：状态点（绿=空闲/黄闪=执行中）+ 编队名 + 当前活动 + 今日花费·次数 + 展开箭头 |
| 拖拽 | 长按 0.3s 起拖（pointer capture 全程跟手、边框变绿、边界钳制），位置存 localStorage，重启保留；短按=开合面板 |
| 编队模式区 | 胶囊按钮组，一键切换，切换即重载角色映射并清空团队记忆 |
| 角色与模型区 | 每行：SVG 角色图标（旗=主控/层=执行/盾=验证）+ 角色名 + 模型下拉（**列表来自 dsh 设置里配置的全部模型**，按提供方分组）+ 应用按钮，改完立即生效 |
| 本月预算 | 美元进度条，超限 warn 提示或 block 拦截（可配） |
| 动态 | 插件流水线的实时事件（计划/完成/返修/结束） |
| 会话与损耗区 | 最近 12 个会话下拉（标题+时间）+ 选中会话的逐条动态：用户输入 / 智能体回复（带**每轮用的模型徽章** + token）/ 执行的命令（工具名+参数摘要+错误标红）/ 真实 token 汇总 |
| 浏览器看板 | `http://127.0.0.1:3117` 同数据兜底页面（横条万一不可用时始终可用） |

### 3.2 十个对话工具（主智能体可直接调用）

`team_mode_list` / `team_mode_switch` / `team_set_role` / `team_dispatch`（文本派发）/ `team_dispatch_many`（并行派发）/ **`team_spawn`（真实子代理+自动验证）** / `team_verify`（独立审查）/ `team_status` / `team_usage` / `team_auto`（一套式流水线）。

### 3.3 内置模式

| 模式 | 主控 | 执行 | 验证 |
|---|---|---|---|
| gpt-lead GPT 主控 | GPT-5.1（建议） | GPT-5-mini + Gemini-2.5-Flash-Lite | DeepSeek-V4-Pro |
| deepseek-lead 省钱 | DeepSeek-V4-Pro | DeepSeek-Flash + Gemini Flash-Lite | DeepSeek-Flash |
| mini-max-mix 混编 | GPT-5.1（建议） | MiniMax-M3 + GPT-5-nano | DeepSeek-V4-Pro |
| mock-test 模拟自测 | 全部走内置 mock 适配器，**零 API Key** | | |

---

## 四、实测验证状态（截至 v1.0.9）

### 已验证（有实测证据）

| 项 | 证据 |
|---|---|
| 在真实 dsh 运行时（0.2.0-rc.2）零警告激活 | CLI + 桌面应用宿主各验证一轮，启动日志无任何 warning/error；9→10 个工具全部注册 |
| 桌面应用内横条渲染 | 观测到渲染进程每 3 秒精确轮询看板接口；你本人确认可见 |
| 模型目录接口 | `/api/models` 实测返回你配置的 4 个 provider（fenno/GPT/DeepSeek×2）与全部模型 |
| 会话读取器 | 用你机器真实数据验证：8 个会话标题/时间正确；"n's's"乱码会话完整还原（含 dsh 反问澄清的 ask_user_question 命令）；大项目会话真实 token 入 1,087,303 / 出 323,885 |
| 页面对话的模型归属 | 会话 `request/context` 实测：`deepseek-account / deepseek-flash`，逐轮可解析 |
| 离线流水线 | dsh 路由（mock 适配器流式调用，用量/成本正确）+ direct 路由（本地模拟 OpenAI 服务器）两条自动化测试通过 |
| 类型与构建 | tsc --noEmit 零错误；esbuild 双产物（lib/ + client/）；npm 包符合官方 `dsh.bundle.patch` 发布格式 |
| 跨形态安装 | desktop profile 与 web profile（源码启动）均已登记；desktop 由 Electron 独占管理已实测确认 |

### 待你重启应用后确认（本轮新功能）

面板"会话与损耗"区的实际渲染效果、模型下拉的目录显示（理论依据均已实测，但 UI 层需重启后目验）。

### 诚实的边界

1. **原生多代理的自动验证**：dsh 自派的子代理（不经 team_spawn）目前不会自动触发验证员——需要挂 `subagent/end` 事件提取产出，v1.1 第一项；
2. **dsh 原生用量只有 token 没有美元**：会话区的 token 是 dsh 权威数据，美元估算只对编队插件自己的调用成立（价格表是 2026-10 快照，DeepSeek 峰谷/Gemini 促销需自行维护 `pricing` 配置）；
3. **team_spawn 依赖 exec.agent**：必须由会话主智能体调用（正常使用就是如此）；
4. **团队记忆是运行内存活**：会话间长期记忆（mem0 方案）在路线图；
5. **会话解析只读尾部**：超长会话默认展示最后 40 条动态（文件级缓存，重开面板不重复解析）。

---

## 五、实际使用指南

### 安装（本机已完成，换机器时）

- **CLI**：`dsh plugin --profile <名字> add <tarball>`（会自动创建 profile）
- **桌面版**：Plugins 面板 Add，或把 tarball `pnpm add` 进 `%USERPROFILE%\.dsh\profiles\desktop` 并把 `"dsh-agent-modes"` 加进该 package.json 的 `dsh.profile.bundles`，然后重启应用

### 配置（插件面板 → dsh-agent-modes → 配置）

- `providers.*.apiKey`：只填 dsh 设置里**没有**的 provider（dsh 已配的直接复用）；支持 `"${ENV_NAME}"` 引用环境变量
- `mock.enabled`：打开后出现"模拟自测模式"，零 API 跑通全流程
- `budget.monthlyCapUsd` + `onExceed`：月度预算
- `gateway.mode`：直连（默认）或 LiteLLM 网关（`gateway/litellm.config.yaml` 已备好 7 个模型的配置）

### 典型场景

| 场景 | 你说 | 发生什么 |
|---|---|---|
| 一套式交付 | 「用 team_auto 把这份提纲写成报告」 | 主控拆解→并行执行→验证→自动返修→交付，横条实时显示阶段与花费 |
| 真代理干活 | 「用 team_spawn 让 通用执行 去查一下这个仓库的结构」 | 真子代理用终端/文件工具多步执行，完成后自动附验证结论 |
| 换编队 | 「切换到 DeepSeek 主控模式」 | 全部角色立即换成新模式映射 |
| 微调角色 | 面板里把验证员下拉换成别的模型→应用 | 立即生效，本会话内持久 |
| 查损耗 | 「今天花了多少」/ 面板 | 按角色/模型的调用数、token、美元；会话区看 dsh 原生用量 |
| 零成本自测 | 开 `mock.enabled` → 「用模拟模式跑一遍 team_auto」 | 全流程无 API 演示 |

---

## 六、版本史（每版的真实问题与修复）

| 版本 | 内容 |
|---|---|
| 1.0.0 | 初版：模式编队/编排器/网关/看板/冒烟+端到端测试 |
| 1.0.1-1.0.2 | （排查期）配置兜底 normalize、看板端口占用探测、复用语义 |
| 1.0.3 | **实机暴露三个问题并修复**：① 打包携带的 dsh-tools 与运行时版本冲突，被禁用并连累 19 个官方插件 → 移除全部 @deepseek-ai 运行时依赖，改原生协议手写工具定义；② ctx.slots 访问需 inject 声明 → 改 `ctx.reflect.get` 动态读取；③ 首次在真实运行时确认零警告激活 |
| 1.0.4 | **横条不显示的根因**：宿主侧注册组件无法跨进程渲染 → 按官方约定实现客户端入口（`exports["./client"]` + `__ModuleLoader__`）；0.2.0-rc.2 无 `shell.bottom` 席位 → 改 `shell.overlay`（实测确认席位清单） |
| 1.0.5 | 横条 `absolute` 定位随内容滚动消失 → 改 `fixed`；用真机会话数据修正对齐 |
| 1.0.6 | 新增 team_spawn 真实子代理+自动验证；拖拽 pointer capture；SVG 图标+布局精修；刷新反馈 |
| 1.0.7 | **点一下开合两次**：pointerup 与 lostpointercapture 双触发 → 手势去重 |
| 1.0.8 | 新增会话读取器：多帧 zstd 解析、会话列表/动态/真实 token；面板"会话与损耗"区 |
| 1.0.9 | 面板逐轮显示所用模型（request/context 解析）；内置 mock 适配器+模拟自测模式；离线双路由自动化测试 |
| 1.1.0 | **原生子代理强制映射**：包装 `ctx.subagents.start/startContinuable`，dsh 自派子代理（原生工具/Agent teams）一律套用模式模型映射并异步自动验证；**记账去美元化**：全 UI 只计 token（入/出）；**跨会话记忆映射**：`memory.injectRecentSessions` 把最近 N 个 dsh 会话摘要注入团队共享上下文（不引入 mem0，直接引用 dsh 已有记录） |
| 1.2.0 | **去掉全部内置模式**（过时硬编码型号）：编队完全由用户保存/切换/删除；首次使用按 dsh 模型目录自动生成初始编队；面板新增"输入名称→保存为新模式"与模式删除；服务端新增 `/api/mode/save`、`/api/mode/remove`，模式持久化到 state.json |

---

## 七、质量保障体系（持续可用）

- `npm run typecheck`：TypeScript 严格类型检查（当前零错误）
- `test/smoke.ts`：记账/价格/模式/看板接口/预算拦截 5 组单元冒烟
- `test/e2e.mjs`：构建产物端到端——插件激活、10 工具注册、看板 API+页面、**两条离线模型路由**（mock 适配器 + 本地模拟 OpenAI 服务器）
- 会话读取器用真实数据（你机器 8 个会话）验证过解析正确性
- 每次发版跑全套后打 tarball，再部署 desktop/web 两个 profile

## 八、路线图（按优先级）

1. **原生子代理自动验证**：挂 `subagent/end` 事件提取产出 → 验证员自动介入 dsh 自派子代理
2. **模式策略同步**：把模式的模型路由自动写入 dsh 原生 `subagentModelSelection` 允许清单（现需在设置里手动勾选）
3. **跨会话长期记忆**：mem0 接入，记忆跨编队运行持久化
4. **成本感知调度**：按"任务难度 × 角色 × 剩余额度"自动升降模型
5. **上架**：GitHub topic `dsh-plugin` + 第三方市场（dsh-plugin.org 等）

---

*报告由实际开发与实测过程生成；所有"已验证"条目均对应真实执行证据，"待确认/边界"条目为诚实声明而非遗漏。*
