import type { AgentModesConfig } from './config'
import type { DshProviderModels } from './dshllm'
import type { ModeDefinition, RuntimeState, WorkerSpec } from './types'

/** 模拟自测模式：仅在 config.mock.enabled 时出现，不占用户模式位 */
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

export interface PersistData {
  activeModeId: string
  savedModes: ModeDefinition[]
}

const PLACEHOLDER_ID = 'custom'

function placeholderMode(): ModeDefinition {
  return {
    id: PLACEHOLDER_ID,
    name: '我的编队',
    description: '首次使用自动生成，展开面板挑选模型后保存即可',
    lead: { provider: 'deepseek', model: 'deepseek-chat' },
    leadSource: 'session',
    workers: [{ role: '通用执行', provider: 'deepseek', model: 'deepseek-chat', note: '通用子任务' }],
    verifier: { provider: 'deepseek', model: 'deepseek-chat' },
    memory: { shared: true, digestMaxChars: 6000 },
    budget: { monthlyCapUsd: 0, onExceed: 'warn' },
    enforceSubagents: true,
  }
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '') || 'mode'

/**
 * 模式注册器：没有内置预设。
 * 模式来源 = 用户在面板里保存的（saved，持久化到 state.json）+ 插件配置里的（config，进阶用法）
 * + 模拟自测（mock，仅 config.mock.enabled）。首次使用自动按 dsh 模型目录生成一份初始编队。
 */
export class ModeRegistry {
  private entries = new Map<string, { mode: ModeDefinition; origin: 'saved' | 'config' | 'mock' | 'placeholder' }>()
  private activeId = ''

  constructor(private config: AgentModesConfig, private persist: (d: PersistData) => void, saved?: PersistData) {
    if (saved?.savedModes?.length) {
      for (const m of saved.savedModes) this.entries.set(m.id, { mode: structuredClone(m), origin: 'saved' })
    }
    if (this.config.mock?.enabled) this.entries.set(MOCK_MODE.id, { mode: structuredClone(MOCK_MODE), origin: 'mock' })
    for (const m of this.config.modes ?? []) {
      if (!this.entries.has(m.id)) this.entries.set(m.id, { mode: structuredClone(m), origin: 'config' })
    }
    if (this.entries.size === 0) this.entries.set(PLACEHOLDER_ID, { mode: placeholderMode(), origin: 'placeholder' })
    this.activeId = saved?.activeModeId && this.entries.has(saved.activeModeId) ? saved.activeModeId : this.entries.keys().next().value as string
  }

  /** dsh 模型目录就绪后，把占位编队的角色替换成用户真实配置的模型（仅一次） */
  bootstrapFromCatalog(providers: DshProviderModels[]): ModeDefinition | null {
    const entry = this.entries.get(this.activeId)
    if (!entry || entry.origin !== 'placeholder') return null
    const flat = providers.flatMap(p => p.models.map(m => ({ provider: p.id, model: m.id, name: m.name })))
    if (!flat.length) return null
    const pick = (want: RegExp, avoid: string) =>
      flat.find(m => want.test(m.provider + '/' + m.model) && m.model !== avoid)?.model ?? flat.find(m => m.model !== avoid)?.model ?? flat[0].model
    const lead = flat.find(m => /pro|smart|flash/i.test(m.model)) ?? flat[0]
    const leadModel = pick(/pro|smart|flash/i, '')
    const workModel = pick(/flash|mini|lite|fast/i, leadModel)
    const verifyModel = pick(/pro|smart/i, workModel)
    entry.mode = {
      ...entry.mode,
      lead: { provider: lead.provider, model: leadModel },
      workers: [{ role: '通用执行', provider: lead.provider, model: workModel, note: '通用子任务' }],
      verifier: { provider: lead.provider, model: verifyModel },
    }
    entry.origin = 'saved'
    this.persistSaved()
    return entry.mode
  }

  /** 占位编队待引导 */
  needsBootstrap(): boolean {
    return this.entries.get(this.activeId)?.origin === 'placeholder'
  }

  list(): ModeDefinition[] {
    return [...this.entries.values()].map(x => x.mode)
  }

  get active(): ModeDefinition {
    return (this.entries.get(this.activeId) ?? this.entries.values().next().value as { mode: ModeDefinition }).mode
  }

  switch(id: string): ModeDefinition {
    if (!this.entries.has(id)) throw new Error(`模式 "${id}" 不存在。可用：${[...this.entries.keys()].join(', ')}`)
    this.activeId = id
    this.persistSaved()
    return this.active
  }

  /** 把当前激活模式的某角色改成指定模型（直接保存在该模式里） */
  setRole(role: string, provider: string, model: string): ModeDefinition {
    const mode = this.active
    const target =
      role === 'lead' ? mode.lead : role === 'verifier' ? mode.verifier : mode.workers.find(w => w.role === role)
    if (!target) throw new Error(`角色 "${role}" 不存在。可用：lead, verifier, ${mode.workers.map(w => w.role).join(', ')}`)
    target.provider = provider
    target.model = model
    this.markSaved()
    this.persistSaved()
    return mode
  }

  /** 保存当前编队为新模式（或覆盖指定 id 的模式），并切换过去 */
  saveMode(input: { id?: string; name: string }): ModeDefinition {
    const current = this.active
    const id = input.id || (this.entries.has(slug(input.name)) && this.entries.get(slug(input.name))!.mode.name === input.name ? slug(input.name) : this.uniqueSlug(input.name))
    const mode: ModeDefinition = {
      ...structuredClone(current),
      id,
      name: input.name || current.name,
    }
    this.entries.set(id, { mode, origin: 'saved' })
    this.activeId = id
    this.persistSaved()
    return mode
  }

  removeMode(id: string): void {
    if (this.entries.size <= 1) throw new Error('至少保留一个模式')
    const entry = this.entries.get(id)
    if (!entry) throw new Error(`模式 "${id}" 不存在`)
    this.entries.delete(id)
    if (this.activeId === id) this.activeId = this.entries.keys().next().value as string
    this.persistSaved()
  }

  private markSaved() {
    const e = this.entries.get(this.activeId)
    if (e && e.origin === 'placeholder') e.origin = 'saved'
  }

  private uniqueSlug(name: string): string {
    const base = slug(name)
    let id = base
    let i = 2
    while (this.entries.has(id)) id = `${base}-${i++}`
    return id
  }

  private persistSaved() {
    const savedModes = [...this.entries.values()]
      .filter(x => x.origin === 'saved')
      .map(x => x.mode)
    this.persist({ activeModeId: this.activeId, savedModes })
  }

  roles(): RuntimeState['roles'] {
    const mode = this.active
    return [
      { role: 'lead', provider: mode.lead.provider, model: mode.lead.model, kind: 'lead' as const },
      ...mode.workers.map((w: WorkerSpec) => ({ role: w.role, provider: w.provider, model: w.model, kind: 'worker' as const })),
      { role: 'verifier', provider: mode.verifier.provider, model: mode.verifier.model, kind: 'verifier' as const },
    ]
  }
}
