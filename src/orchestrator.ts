import type { Context } from '@deepseek-ai/cordis'
import { defineTool, params, textOutput } from './definetool'
import type { Gateway, ChatMessage } from './gateway'
import { Gateway as GatewayUtil } from './gateway'
import type { TeamMemory } from './memory'
import type { ModeRegistry } from './modes'
import type { Store } from './store'
import type { UsageLedger } from './usage'
import type { AgentModesConfig } from './config'
import type { ModeDefinition, WorkerSpec } from './types'

interface Deps {
  modes: ModeRegistry
  gateway: Gateway
  ledger: UsageLedger
  memory: TeamMemory
  store: Store
  config: AgentModesConfig
  /** 跨会话记忆映射：最近 N 个 dsh 会话的摘要块 */
  recentMemory: (n: number) => string
}

export function registerTools(ctx: Context, deps: Deps) {
  const { modes, gateway, ledger, memory, store, config } = deps

  /** 子代理运行时（ctx.subagents），未就绪返回 undefined */
  const subagents = (): {
    start: (provider: string, req: Record<string, unknown>) => Promise<{ result: Promise<{ output?: { text?: string }[]; stopReason?: string }> }>
    getProvider: (name: string) => unknown
    list: () => string[]
  } | undefined => {
    try {
      const reflect = (ctx as unknown as { reflect?: { get?: (name: string, strict?: boolean) => unknown } }).reflect
      return reflect?.get?.('subagents', false) as never
    } catch {
      return undefined
    }
  }

  const guard = () => {
    if (store.get().running) throw new Error('已有编队任务在执行中，请先用 team_status 查看，完成后再派新任务')
    const budgetMsg = ledger.checkBudget()
    if (!budgetMsg) return null
    if (budgetMsg.includes('warn 模式继续执行')) return budgetMsg
    throw new Error(budgetMsg)
  }

  async function runWorker(w: WorkerSpec, task: string, extraContext?: string): Promise<string> {
    store.setActivity(`执行中：${w.role}（${w.provider}/${w.model}）`)
    const digest = await memory.digest()
    const recent = config.memory.injectRecentSessions > 0
      ? `\n# 近期会话记忆（来自 dsh 会话记录）\n${deps.recentMemory(config.memory.injectRecentSessions)}\n`
      : ''
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: [
          `你是多智能体团队中的执行成员，角色：${w.role}。`,
          w.note ? `你的专长：${w.note}` : '',
          '只完成分配给你的子任务，输出结果本体，不要寒暄；如果信息不足，在开头用「需要补充：」列出。',
        ].filter(Boolean).join('\n'),
      },
      {
        role: 'user',
        content: [
          `${recent}# 团队共享上下文\n${digest || '（无）'}`,
          extraContext ? `# 补充背景\n${extraContext}` : '',
          `# 你的子任务\n${task}`,
        ].filter(Boolean).join('\n\n'),
      },
    ]
    const r = await gateway.call({ role: w.role, kind: 'worker', target: w, messages, temperature: 0.5 })
    memory.add('worker', w.role, r.text)
    store.pushLog(`✅ ${w.role} 完成（${r.usage.completion_tokens} tok，$${r.costUsd.toFixed(4)}）`)
    return r.text
  }

  async function runVerifier(content: string, criteria?: string) {
    return verifyWithMode(deps, content, criteria)
  }

  async function planWithLead(task: string): Promise<{ subtasks: { worker: string; task: string }[]; note?: string }> {
    const mode = modes.active
    store.setActivity(`主控规划中：${mode.lead.provider}/${mode.lead.model}`)
    const roster = mode.workers.map(w => `- ${w.role}（${w.provider}/${w.model}${w.note ? '，擅长：' + w.note : ''}）`).join('\n')
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          '你是多智能体团队的主控。把用户任务拆解为可并行/串行的子任务，分配给合适的执行角色。输出 JSON：{"subtasks": [{"worker": string, "task": string}], "note": string?}。worker 必须从角色名单里选；task 要自包含（执行者看不到原始对话）。',
      },
      { role: 'user', content: `# 可用执行角色\n${roster}\n\n# 任务\n${task}` },
    ]
    const r = await gateway.call({ role: 'lead', kind: 'plan', target: mode.lead, messages, json: true, temperature: 0.3 })
    memory.add('plan', 'lead', r.text)
    return GatewayUtil.parseJson(r.text)
  }

  async function assembleWithLead(task: string, outputs: string): Promise<string> {
    const mode = modes.active
    store.setActivity(`主控汇总中：${mode.lead.provider}/${mode.lead.model}`)
    const messages: ChatMessage[] = [
      { role: 'system', content: '你是多智能体团队的主控。基于执行与验证结果输出最终交付内容；保留验证员修正过的问题；语言与用户任务一致。' },
      { role: 'user', content: `# 原始任务\n${task}\n\n# 团队产出\n${outputs.slice(0, 40000)}` },
    ]
    const r = await gateway.call({ role: 'lead', kind: 'assemble', target: mode.lead, messages, temperature: 0.4 })
    memory.add('assembly', 'lead', r.text)
    return r.text
  }

  const usageLine = () => {
    const t = ledger.today().total
    return `（今日 ${t.calls} 次调用，$${t.costUsd}）`
  }

  const tools = [
    defineTool({
      name: 'team_mode_list',
      description: '列出所有可用的智能体编队模式及当前激活模式',
      parameters: params({}),
      output: textOutput,
      execute: async () => {
        return modes.list().map(m => `${m.id === modes.active.id ? '→' : ' '} ${m.id}｜${m.name}｜主控 ${m.lead.provider}/${m.lead.model}，执行 ${m.workers.map(w => `${w.role}:${w.model}`).join('、')}，验证 ${m.verifier.model}`).join('\n')
      },
    }),

    defineTool({
      name: 'team_mode_switch',
      description: '切换当前编队模式（主控/执行/验证的模型组合随之改变）',
      parameters: params({ mode: { type: 'string', required: true, description: '要切换到的模式 ID，见 team_mode_list' } }),
      output: textOutput,
      execute: async (args: { mode: string }) => {
        const m = modes.switch(args.mode)
        store.setActiveMode(m.id)
        store.setRoles(modes.roles())
        memory.clear()
        return `已切换到「${m.name}」。编队：主控 ${m.lead.provider}/${m.lead.model}；执行 ${m.workers.map(w => `${w.role}=${w.provider}/${w.model}`).join('、')}；验证 ${m.verifier.provider}/${m.verifier.model}`
      },
    }),

    defineTool({
      name: 'team_set_role',
      description: '微调当前模式下某个角色使用的模型（role 可为 lead / verifier / 某个执行角色名）',
      parameters: params({
        role: { type: 'string', required: true, description: 'lead | verifier | 执行角色名' },
        provider: { type: 'string', required: true, description: '提供方：deepseek / openai / google / minimax' },
        model: { type: 'string', required: true, description: '模型 ID' },
      }),
      output: textOutput,
      execute: async (args: { role: string; provider: string; model: string }) => {
        const m = modes.setRole(args.role, args.provider, args.model)
        store.setRoles(modes.roles())
        return `已把 ${args.role} 调整为 ${args.provider}/${args.model}（模式：${m.name}）`
      },
    }),

    defineTool({
      name: 'team_dispatch',
      description: '把一个子任务派给当前模式下的指定执行角色（用该角色配置的模型执行，共享团队记忆）',
      parameters: params({
        worker: { type: 'string', required: true, description: '执行角色名（见 team_status）' },
        task: { type: 'string', required: true, description: '子任务描述，需自包含' },
        context: { type: 'string', description: '可选补充背景' },
      }),
      output: textOutput,
      execute: async (args: { worker: string; task: string; context?: string }) => {
        const budgetWarn = guard()
        const w = modes.active.workers.find(x => x.role === args.worker)
        if (!w) throw new Error(`执行角色 "${args.worker}" 不存在。可用：${modes.active.workers.map(x => x.role).join('、')}`)
        store.setRunning(true, args.task)
        try {
          memory.add('task', 'lead', args.task)
          const out = await runWorker(w, args.task, args.context)
          return `${budgetWarn ?? ''}[${w.role} · ${w.provider}/${w.model}] 完成${usageLine()}\n\n${out}`
        } finally {
          store.setRunning(false)
        }
      },
    }),

    defineTool({
      name: 'team_dispatch_many',
      description: '并行派发多个子任务给不同执行角色。tasksJson 格式：[{"worker":"角色名","task":"子任务"}]',
      parameters: params({ tasksJson: { type: 'string', required: true, description: 'JSON 数组字符串' } }),
      output: textOutput,
      execute: async (args: { tasksJson: string }) => {
        const budgetWarn = guard()
        const tasks = GatewayUtil.parseJson<{ worker: string; task: string; context?: string }[]>(args.tasksJson)
        const ws = modes.active.workers
        const jobs = tasks.map(t => {
          const w = ws.find(x => x.role === t.worker)
          if (!w) throw new Error(`执行角色 "${t.worker}" 不存在。可用：${ws.map(x => x.role).join('、')}`)
          return { w, t }
        })
        store.setRunning(true, `${jobs.length} 个并行子任务`)
        try {
          memory.add('task', 'lead', tasks.map(t => `[${t.worker}] ${t.task}`).join('\n'))
          const outs = await Promise.all(jobs.map(({ w, t }) => runWorker(w, t.task, t.context).catch(e => `❌ ${w.role} 失败：${(e as Error).message}`)))
          const body = jobs.map(({ w }, i) => `## [${w.role} · ${w.provider}/${w.model}]\n${outs[i]}`).join('\n\n')
          return `${budgetWarn ?? ''}全部完成${usageLine()}\n\n${body}`
        } finally {
          store.setRunning(false)
        }
      },
    }),

    defineTool({
      name: 'team_spawn',
      description: '派发一个【真实子代理】(拥有 dsh 全部工具:终端/文件/联网等),用当前模式里该角色配置的模型执行。与 team_dispatch 的区别:那个是纯文本单次调用,这个是真代理,能自主使用工具完成多步任务;子代理用量计入 dsh 用量统计',
      parameters: params({
        worker: { type: 'string', description: '执行角色名(见 team_status);省略则自动匹配' },
        task: { type: 'string', required: true, description: '子任务描述,需自包含' },
        context: { type: 'string', description: '可选补充背景' },
        verify: { type: 'boolean', description: '完成后是否用验证模型审查,默认 true' },
      }),
      output: textOutput,
      execute: async (args: { worker?: string; task: string; context?: string; verify?: boolean }, exec?: unknown) => {
        const rt = subagents()
        if (!rt) throw new Error('子代理运行时(ctx.subagents)不可用')
        const names = rt.list?.() ?? []
        const pick = ['spawn', 'spawn-in-process'].find(n => names.includes(n)) ?? names.find(n => n.includes('spawn'))
        if (!pick) throw new Error(`未找到 spawn 类子代理提供方。可用: ${names.join(', ')}`)
        const parent = (exec as { agent?: unknown })?.agent
        if (!parent) throw new Error('无法确定调用者代理(exec.agent 为空),请改用 team_dispatch')
        let w: WorkerSpec
        if (args.worker) {
          const hit = modes.active.workers.find(x => x.role === args.worker)
          if (!hit) throw new Error(`执行角色 "${args.worker}" 不存在。可用: ${modes.active.workers.map(x => x.role).join('、')}`)
          w = hit
        } else {
          w = modes.active.workers.find(x => x.note?.includes('通用')) ?? modes.active.workers[0]
        }
        if (!w) throw new Error('当前模式没有配置任何执行角色')
        const budgetWarn = guard()
        store.setRunning(true, args.task)
        try {
          memory.add('task', 'lead', `[spawn/${w.role}] ${args.task}`)
          store.setActivity(`真实子代理执行中：${w.role}（${w.provider}/${w.model}）`)
          const digest = await memory.digest()
          const prompt = [
            `你是多智能体团队中的执行成员，角色：${w.role}。`,
            w.note ? `你的专长：${w.note}` : '',
            '请使用你拥有的工具（终端/文件/联网等）完成子任务；只输出结果本体，不要寒暄；信息不足时在开头用「需要补充：」列出。',
            '',
            `# 团队共享上下文\n${digest || '（无）'}`,
            args.context ? `# 补充背景\n${args.context}` : '',
            `# 你的子任务\n${args.task}`,
          ].filter(Boolean).join('\n')
          const run = await rt.start(pick, {
            label: `[${w.role}] ${args.task.slice(0, 60)}`,
            prompt: [{ type: 'text', text: prompt }],
            parent,
            agentOptions: { provider: w.provider, model: w.model },
            signal: (exec as { signal?: AbortSignal })?.signal,
          })
          const result = await run.result
          const out = (result.output ?? []).map((b: { text?: string }) => b?.text ?? '').join('\n').trim() || '（子代理无文本输出）'
          memory.add('worker', w.role, out)
          store.pushLog(`🧩 ${w.role} 子代理完成（${result.stopReason ?? '?'}）`)
          let verdict = ''
          if (args.verify !== false && config.verifySubagents) {
            try {
              const v = await runVerifier(out)
              verdict = v.pass
                ? '\n\n[验证] ✅ 通过'
                : `\n\n[验证] ⚠️ ${v.issues.length} 个问题\n${v.issues.map(i => `  · [${i.severity}] ${i.where}：${i.what}`).join('\n')}${v.revised ? `\n修正版：\n${v.revised}` : ''}`
            } catch (err) {
              verdict = `\n\n[验证] 执行失败：${(err as Error).message}`
            }
          }
          return `🧩 真实子代理完成 · ${w.role} · ${w.provider}/${w.model} · stopReason=${result.stopReason ?? '?'}（用量计入 dsh 用量统计）${budgetWarn ? '\n' + budgetWarn : ''}\n\n${out}${verdict}`
        } finally {
          store.setRunning(false)
        }
      },
    }),

    defineTool({
      name: 'team_verify',
      description: '用当前模式的验证模型独立审查内容，返回结构化结论（pass/issues/revised）',
      parameters: params({
        content: { type: 'string', required: true, description: '待审查内容' },
        criteria: { type: 'string', description: '可选验收标准' },
      }),
      output: textOutput,
      execute: async (args: { content: string; criteria?: string }) => {
        guard()
        store.setRunning(true, '验证')
        try {
          const v = await runVerifier(args.content, args.criteria)
          const head = v.pass ? '✅ 验证通过' : `⚠️ 发现 ${v.issues.length} 个问题`
          const issues = v.issues.map(i => `  · [${i.severity}] ${i.where}：${i.what}`).join('\n')
          return `${head}${usageLine()}\n${issues}\n${v.revised ? `\n修正版：\n${v.revised}` : ''}`
        } finally {
          store.setRunning(false)
        }
      },
    }),

    defineTool({
      name: 'team_status',
      description: '查看当前编队、各角色模型与运行状态',
      parameters: params({}),
      output: textOutput,
      execute: async () => {
        const m = modes.active
        const s = store.get()
        return [
          `当前模式：${m.name}（${m.id}）｜状态：${s.running ? s.activity : '空闲'}`,
          `主控：${m.lead.provider}/${m.lead.model}${m.leadSource === 'session' ? '（leadSource=session：实际主控=会话当前模型，此为建议值）' : ''}`,
          ...m.workers.map(w => `执行｜${w.role}：${w.provider}/${w.model}${w.note ? '｜' + w.note : ''}`),
          `验证：${m.verifier.provider}/${m.verifier.model}`,
          `团队记忆：${memory.size} 条`,
        ].join('\n')
      },
    }),

    defineTool({
      name: 'team_usage',
      description: '查看各角色/各模型的 API 调用与花费（今天/本月/全部）',
      parameters: params({ period: { type: 'string', description: 'today | month | all，默认 today' } }),
      output: textOutput,
      execute: async (args: { period?: string }) => {
        const map: Record<string, number | undefined> = { today: 24 * 3600 * 1000, month: 30 * 24 * 3600 * 1000, all: undefined }
        return ledger.reportText(map[args.period ?? 'today'] ?? 24 * 3600 * 1000)
      },
    }),

    defineTool({
      name: 'team_auto',
      description: '一套式自动流水线：主控拆解派发 → 各执行角色并行执行 → 验证员审查（不合格自动返修一轮）→ 汇总交付。只需给出任务即可',
      parameters: params({
        task: { type: 'string', required: true, description: '完整任务描述' },
        criteria: { type: 'string', description: '可选验收标准' },
        planJson: { type: 'string', description: '可选：主控已想好的计划 [{"worker":"角色名","task":"子任务"}]，省去规划调用' },
      }),
      output: textOutput,
      execute: async (args: { task: string; criteria?: string; planJson?: string }) => {
        const budgetWarn = guard()
        const mode: ModeDefinition = modes.active
        store.setRunning(true, args.task)
        memory.clear()
        memory.add('task', 'lead', args.task)
        const costBefore = ledger.today().total.costUsd
        try {
          const plan = args.planJson
            ? GatewayUtil.parseJson<{ subtasks: { worker: string; task: string }[] }>(args.planJson)
            : await planWithLead(args.task)
          store.pushLog(`📋 计划：${plan.subtasks.length} 个子任务`)

          const dispatch = async (subtasks: { worker: string; task: string }[]) => {
            const jobs = subtasks.map(st => {
              const w = mode.workers.find(x => x.role === st.worker)
                ?? mode.workers.find(x => x.note?.includes('通用'))
                ?? mode.workers[0]
              if (!w) throw new Error('当前模式没有配置任何执行角色')
              return { w, st }
            })
            store.setActivity(`并行执行 ${jobs.length} 个子任务`)
            return Promise.all(jobs.map(({ w, st }) => runWorker(w, st.task).catch(e => `❌ ${w.role} 失败：${(e as Error).message}`)))
          }

          let outputs = await dispatch(plan.subtasks)
          let collected = plan.subtasks.map((st, i) => `## [${st.worker}] ${st.task}\n${outputs[i]}`).join('\n\n')

          let verdict = await runVerifier(collected, args.criteria)
          if (!verdict.pass) {
            store.pushLog('🔁 验证未通过，自动返修一轮')
            const failedIdx = verdict.issues.map(i => i.where).join('；')
            const reTasks = plan.subtasks.map(st => ({
              worker: st.worker,
              task: `${st.task}\n\n（返修要求：验证员指出的问题——${failedIdx}。请针对性修正。）`,
            }))
            const reOut = await dispatch(reTasks)
            collected = plan.subtasks.map((st, i) => `## [${st.worker}] ${st.task}\n${reOut[i]}`).join('\n\n')
            verdict = await runVerifier(collected, args.criteria)
          }

          const finalText = mode.leadSource === 'mode'
            ? await assembleWithLead(args.task, collected)
            : `${collected}\n\n（验证结论：${verdict.pass ? '通过' : '仍有问题，见 issues'}${verdict.revised ? '，已附修正版' : ''}）`

          const delta = Math.round((ledger.today().total.costUsd - costBefore) * 10000) / 10000
          store.pushLog('🏁 流水线完成')
          return `${budgetWarn ?? ''}✅ 编队流水线完成${usageLine()}（本次 $${delta}）\n\n${finalText}`
        } finally {
          store.setRunning(false)
        }
      },
    }),
  ]

  for (const t of tools) ctx.tools.register(t)
}

export function cheapest(mode: ModeDefinition) {
  return mode.workers.reduce((a, b) => (a.model < b.model ? a : b), mode.workers[0] ?? mode.lead)
}

/** 独立验证（供流水线与子代理自动验证共用） */
export async function verifyWithMode(
  deps: { modes: ModeRegistry; gateway: Gateway; memory: TeamMemory; store: Store },
  content: string,
  criteria?: string,
) {
  const { modes, gateway, memory, store } = deps
  const v = modes.active.verifier
  store.setActivity(`验证中：${v.provider}/${v.model}`)
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        '你是团队的独立验证员（不参与产出），负责审查执行成员的成果。' +
        '输出 JSON：{"pass": boolean, "issues": [{"where": string, "what": string, "severity": "low"|"high"}], "revised": string|null}。' +
        'issues 为空数组表示通过；轻微问题可自行在 revised 中给出修正版本；严重问题 pass=false 并指明位置。',
    },
    {
      role: 'user',
      content: [
        criteria ? `# 验收标准\n${criteria}` : '# 验收标准\n与任务要求一致、无事实矛盾、无缺漏、可直接交付',
        `# 待审内容\n${content}`,
      ].filter(Boolean).join('\n\n'),
    },
  ]
  const r = await gateway.call({ role: 'verifier', kind: 'verify', target: v, messages, json: true, temperature: 0.2 })
  memory.add('verifier', 'verifier', r.text)
  return GatewayUtil.parseJson<{ pass: boolean; issues: { where: string; what: string; severity: string }[]; revised: string | null }>(r.text)
}

/** 验证结论的紧凑文本（面板动态/子代理验证用） */
export function formatVerdict(v: { pass: boolean; issues: { where: string; what: string; severity: string }[]; revised: string | null }): string {
  if (v.pass) return '✅ 通过'
  const issues = v.issues.map(i => `[${i.severity}] ${i.where}：${i.what}`).join('；')
  return `⚠️ ${v.issues.length} 个问题：${issues}${v.revised ? '（已附修正版）' : ''}`
}
