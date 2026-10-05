import Schema from '@deepseek-ai/schemastery'
import type { ModeDefinition, ProviderConfig } from './types'

export interface GatewayConfig {
  /** direct=直连各家 OpenAI 兼容端点；litellm=全部经本地 LiteLLM 网关（记账/预算由网关强化） */
  mode: 'direct' | 'litellm'
  baseUrl: string
  apiKey: string
}

export interface UiConfig {
  enabled: boolean
  bottomBar: boolean
  overlayPanel: boolean
  dashboardPort: number
  /** 横条注册到的 slot 席位，逗号分隔按序尝试。0.2.0-rc.2 客户端可用：shell.overlay */
  slotNames: string
}

export interface AgentModesConfig {
  activeMode: string
  modes: ModeDefinition[]
  providers: Record<string, ProviderConfig>
  gateway: GatewayConfig
  pricing: Record<string, Record<string, { in: number; out: number }>>
  ui: UiConfig
  memory: { digestMaxChars: number; summarizeOverChars: number; injectRecentSessions: number }
  budget: { monthlyCapUsd: number; onExceed: 'warn' | 'block' }
  /** team_spawn 完成后是否自动用验证模型审查子代理产出 */
  verifySubagents: boolean
  /** 注册内置模拟适配器（provider=mock），零 API Key 跑通流水线 */
  mock: { enabled: boolean }
}

const roleModel = Schema.object({
  provider: Schema.string().required().description('提供方：deepseek / openai / google / minimax / 自定义'),
  model: Schema.string().required().description('模型 ID，如 gpt-5-mini'),
})

const workerSchema = Schema.object({
  role: Schema.string().required().description('执行角色名，如「通用执行」「廉价批量」'),
  provider: Schema.string().required(),
  model: Schema.string().required(),
  note: Schema.string().description('该角色擅长什么，会写进派发提示'),
})

const modeSchema = Schema.object({
  id: Schema.string().required().description('模式 ID（英文，用于切换）'),
  name: Schema.string().required().description('模式显示名'),
  description: Schema.string(),
  lead: roleModel,
  leadSource: Schema.union(['session', 'mode'] as const).default('session')
    .description('session=主控用会话当前选的模型；mode=主控固定用下面 lead 指定的模型'),
  workers: Schema.array(workerSchema).default([]),
  verifier: roleModel,
  memory: Schema.object({
    shared: Schema.boolean().default(true),
    digestMaxChars: Schema.number().default(6000),
  }),
  budget: Schema.object({
    monthlyCapUsd: Schema.number().default(20),
    onExceed: Schema.union(['warn', 'block'] as const).default('warn'),
  }),
  enforceSubagents: Schema.boolean().default(true).description('一切路径派发的子代理是否强制套用本模式的模型映射'),
  subagentWorker: Schema.string().description('原生子代理映射到哪个执行角色（缺省取第一个 worker）'),
}) as Schema<ModeDefinition>

const providerSchema = Schema.object({
  baseUrl: Schema.string().description('留空则用该 provider 的官方 OpenAI 兼容端点'),
  apiKey: Schema.string().description('API Key，支持 "${ENV_NAME}" 形式引用环境变量'),
})

export const Config: Schema<AgentModesConfig> = Schema.intersect([
  Schema.object({
    activeMode: Schema.string().default('gpt-lead').description('启动时使用的编队模式 ID'),
    modes: Schema.array(modeSchema).default([]).description('自定义编队模式，会与内置模式合并（同 id 覆盖）'),
    providers: Schema.dict(providerSchema).default({}).description('各家 API Key；也可在 LiteLLM 网关模式下留空'),
    gateway: Schema.object({
      mode: Schema.union(['direct', 'litellm'] as const).default('direct'),
      baseUrl: Schema.string().default('http://127.0.0.1:4141'),
      apiKey: Schema.string().default(''),
    }).description('LiteLLM 网关（完整版记账/预算），直连模式可忽略'),
    pricing: Schema.dict(Schema.dict(Schema.object({
      in: Schema.number(),
      out: Schema.number(),
    }))).default({}).description('价格表覆盖：USD/每百万 token'),
    ui: Schema.object({
      enabled: Schema.boolean().default(true),
      bottomBar: Schema.boolean().default(true).description('悬浮横状条（点击展开面板）'),
      overlayPanel: Schema.boolean().default(true),
      dashboardPort: Schema.number().default(3117).description('本地看板端口（浏览器直接打开的兜底界面）'),
      slotNames: Schema.string().default('shell.overlay,shell.bottom').description('横条注册的 slot 席位，逗号分隔按序尝试'),
    }),
    memory: Schema.object({
      digestMaxChars: Schema.number().default(6000),
      summarizeOverChars: Schema.number().default(24000),
      injectRecentSessions: Schema.number().default(0).description('团队记忆开头注入最近 N 个 dsh 会话的摘要（跨会话记忆映射，0=关闭）'),
    }),
    budget: Schema.object({
      monthlyCapUsd: Schema.number().default(20),
      onExceed: Schema.union(['warn', 'block'] as const).default('warn'),
    }),
    verifySubagents: Schema.boolean().default(true).description('team_spawn 的真实子代理完成后自动验证'),
    mock: Schema.object({
      enabled: Schema.boolean().default(false).description('注册内置模拟适配器（provider=mock），零 API Key 自测流水线'),
    }),
  }),
  Schema.object({}),
]) as Schema<AgentModesConfig>

/** 兜底：dsh 以 bundle patch 安装、未显式传配置时，保证 apply 拿到完整结构 */
export function normalizeConfig(raw?: Partial<AgentModesConfig> | null): AgentModesConfig {
  const d = (raw ?? {}) as Partial<AgentModesConfig>
  return {
    activeMode: d.activeMode ?? 'gpt-lead',
    modes: d.modes ?? [],
    providers: d.providers ?? {},
    gateway: {
      mode: d.gateway?.mode ?? 'direct',
      baseUrl: d.gateway?.baseUrl || 'http://127.0.0.1:4141',
      apiKey: d.gateway?.apiKey ?? '',
    },
    pricing: d.pricing ?? {},
    ui: {
      enabled: d.ui?.enabled ?? true,
      bottomBar: d.ui?.bottomBar ?? true,
      overlayPanel: d.ui?.overlayPanel ?? true,
      dashboardPort: d.ui?.dashboardPort ?? 3117,
      slotNames: d.ui?.slotNames ?? 'shell.overlay,shell.bottom',
    },
    memory: {
      digestMaxChars: d.memory?.digestMaxChars ?? 6000,
      summarizeOverChars: d.memory?.summarizeOverChars ?? 24000,
      injectRecentSessions: d.memory?.injectRecentSessions ?? 0,
    },
    budget: {
      monthlyCapUsd: d.budget?.monthlyCapUsd ?? 20,
      onExceed: d.budget?.onExceed ?? 'warn',
    },
    verifySubagents: d.verifySubagents ?? true,
    mock: { enabled: d.mock?.enabled ?? false },
  }
}
