export interface RoleModel {
  provider: string
  model: string
}

export interface WorkerSpec extends RoleModel {
  role: string
  note?: string
}

export interface ModeDefinition {
  id: string
  name: string
  description?: string
  /** 主控（lead）使用的模型。leadSource=session 时该值仅作展示/建议，实际主控=会话当前模型 */
  lead: RoleModel
  leadSource: 'session' | 'mode'
  workers: WorkerSpec[]
  verifier: RoleModel
  memory: { shared: boolean; digestMaxChars: number }
  budget: { monthlyCapUsd: number; onExceed: 'warn' | 'block' }
  /** 原生/一切路径派发的子代理是否强制套用本模式的模型映射（缺省视为 true） */
  enforceSubagents?: boolean
  /** 原生子代理映射到哪个执行角色（缺省取第一个 worker） */
  subagentWorker?: string
}

export interface ProviderConfig {
  baseUrl?: string
  apiKey?: string
}

export interface CallUsage {
  prompt_tokens: number
  completion_tokens: number
}

export interface CallResult {
  text: string
  usage: CallUsage
  costUsd: number
  provider: string
  model: string
  role: string
  durationMs: number
}

export interface UsageEntry {
  ts: number
  role: string
  provider: string
  model: string
  promptTokens: number
  completionTokens: number
  costUsd: number
  durationMs: number
  kind: string
}

export interface RuntimeState {
  activeModeId: string
  running: boolean
  currentTask?: string
  activity: string
  lastUpdate: number
  roles: { role: string; provider: string; model: string; kind: 'lead' | 'worker' | 'verifier' }[]
}
