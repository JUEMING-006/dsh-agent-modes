import type { AgentModesConfig } from './config'
import type { ModeDefinition, RuntimeState, WorkerSpec } from './types'

export const BUILT_IN_MODES: ModeDefinition[] = [
  {
    id: 'gpt-lead',
    name: 'GPT 主控模式',
    description: '主控 GPT-5.1，执行 GPT-5-mini + Gemini Flash-Lite，DeepSeek 验证收尾',
    lead: { provider: 'openai', model: 'gpt-5.1' },
    leadSource: 'session',
    workers: [
      { role: '通用执行', provider: 'openai', model: 'gpt-5-mini', note: '均衡的通用子任务' },
      { role: '廉价批量', provider: 'google', model: 'gemini-2.5-flash-lite', note: '大批量、低价值密度的子任务' },
    ],
    verifier: { provider: 'deepseek', model: 'deepseek-v4-pro' },
    memory: { shared: true, digestMaxChars: 6000 },
    budget: { monthlyCapUsd: 20, onExceed: 'warn' },
    enforceSubagents: true,
  },
  {
    id: 'deepseek-lead',
    name: 'DeepSeek 主控模式（省钱）',
    description: '主控 DeepSeek-V4-Pro，执行全用最便宜的模型，DeepSeek-Flash 验证',
    lead: { provider: 'deepseek', model: 'deepseek-v4-pro' },
    leadSource: 'session',
    workers: [
      { role: '通用执行', provider: 'deepseek', model: 'deepseek-flash', note: 'DeepSeek 轻量档' },
      { role: '廉价批量', provider: 'google', model: 'gemini-2.5-flash-lite' },
    ],
    verifier: { provider: 'deepseek', model: 'deepseek-flash' },
    memory: { shared: true, digestMaxChars: 6000 },
    budget: { monthlyCapUsd: 10, onExceed: 'warn' },
    enforceSubagents: true,
  },
  {
    id: 'mini-max-mix',
    name: 'MiniMax 混编模式',
    description: '主控 GPT-5.1，MiniMax-M3 承担重执行，Nano 做轻执行，DeepSeek 验证',
    lead: { provider: 'openai', model: 'gpt-5.1' },
    leadSource: 'session',
    workers: [
      { role: '重执行', provider: 'minimax', model: 'MiniMax-M3', note: '长文与复杂改写' },
      { role: '轻执行', provider: 'openai', model: 'gpt-5-nano', note: '格式化、抽取、分类' },
    ],
    verifier: { provider: 'deepseek', model: 'deepseek-v4-pro' },
    memory: { shared: true, digestMaxChars: 6000 },
    budget: { monthlyCapUsd: 15, onExceed: 'warn' },
    enforceSubagents: true,
  },
]

export const MOCK_MODE: ModeDefinition = {
  id: 'mock-test',
  name: '模拟自测模式（零 API）',
  description: '全部角色使用内置 mock 适配器，无需任何 API Key 即可跑通整条流水线',
  lead: { provider: 'mock', model: 'mock-smart' },
  leadSource: 'mode',
  workers: [
    { role: '通用执行', provider: 'mock', model: 'mock-fast', note: '模拟执行' },
    { role: '廉价批量', provider: 'mock', model: 'mock-fast', note: '模拟执行' },
  ],
  verifier: { provider: 'mock', model: 'mock-smart' },
  memory: { shared: true, digestMaxChars: 6000 },
  budget: { monthlyCapUsd: 0, onExceed: 'warn' },
  enforceSubagents: true,
}

/** 模式合并：内置 + 用户配置（同 id 覆盖）+ 运行时角色覆盖 */
export class ModeRegistry {
  private activeId: string
  private roleOverrides: Record<string, { provider: string; model: string }> = {}
  private modes = new Map<string, ModeDefinition>()

  constructor(private config: AgentModesConfig, private persist: (data: PersistData) => void, saved?: PersistData) {
    this.reload()
    this.activeId = saved?.activeModeId || config.activeMode || 'gpt-lead'
    this.roleOverrides = saved?.roleOverrides ?? {}
    if (!this.modes.has(this.activeId)) this.activeId = this.modes.keys().next().value ?? 'gpt-lead'
  }

  reload() {
    this.modes = new Map()
    for (const m of BUILT_IN_MODES) this.modes.set(m.id, structuredClone(m))
    if (this.config.mock?.enabled) this.modes.set(MOCK_MODE.id, structuredClone(MOCK_MODE))
    for (const m of this.config.modes ?? []) this.modes.set(m.id, structuredClone(m))
  }

  list(): ModeDefinition[] {
    return [...this.modes.values()]
  }

  get active(): ModeDefinition {
    return this.modes.get(this.activeId) ?? BUILT_IN_MODES[0]
  }

  switch(id: string): ModeDefinition {
    if (!this.modes.has(id)) throw new Error(`模式 "${id}" 不存在。可用：${[...this.modes.keys()].join(', ')}`)
    this.activeId = id
    this.roleOverrides = {}
    this.persist(this.snapshot())
    return this.active
  }

  /** 面板/工具里微调某个角色的模型（运行时覆盖，切模式后还原） */
  setRole(role: string, provider: string, model: string): ModeDefinition {
    const mode = this.active
    const target =
      role === 'lead' ? mode.lead : role === 'verifier' ? mode.verifier : mode.workers.find(w => w.role === role)
    if (!target) throw new Error(`角色 "${role}" 不存在。可用：lead, verifier, ${mode.workers.map(w => w.role).join(', ')}`)
    target.provider = provider
    target.model = model
    this.roleOverrides[role] = { provider, model }
    this.persist(this.snapshot())
    return mode
  }

  roles(): RuntimeState['roles'] {
    const mode = this.active
    return [
      { role: 'lead', provider: mode.lead.provider, model: mode.lead.model, kind: 'lead' as const },
      ...mode.workers.map((w: WorkerSpec) => ({ role: w.role, provider: w.provider, model: w.model, kind: 'worker' as const })),
      { role: 'verifier', provider: mode.verifier.provider, model: mode.verifier.model, kind: 'verifier' as const },
    ]
  }

  snapshot(): PersistData {
    return { activeModeId: this.activeId, roleOverrides: this.roleOverrides }
  }
}

export interface PersistData {
  activeModeId: string
  roleOverrides: Record<string, { provider: string; model: string }>
}
