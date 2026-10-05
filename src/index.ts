import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { Config, normalizeConfig, type AgentModesConfig } from './config'
import { DshLlm } from './dshllm'
import { SubagentEnforcer } from './enforce'
import { Gateway } from './gateway'
import { registerMockAdapter } from './mockllm'
import { cheapest, formatVerdict, registerTools, verifyWithMode } from './orchestrator'
import { makeSummarizer, TeamMemory } from './memory'
import { ModeRegistry, type PersistData } from './modes'
import { DashboardServer } from './server'
import { SessionReader } from './sessions'
import { Store } from './store'
import { UsageLedger } from './usage'

export { Config }
export { Gateway } from './gateway'
export { DshLlm } from './dshllm'
export { MockAdapter, MOCK_PROVIDER } from './mockllm'
export const name = 'dsh-agent-modes'

// tools 为硬依赖。slots 不在此声明（cordis 的 inject 无可选语义，声明了会阻塞激活），
// 改用 ctx.reflect.get('slots') 动态读取，服务未就绪时短暂轮询、拿不到就降级为本地看板。
export const inject = ['tools']

export function apply(ctx: Context, rawConfig: AgentModesConfig) {
  const config = normalizeConfig(rawConfig)
  const dataDir = join(process.cwd(), '.dsh-agent-modes')
  mkdirSync(dataDir, { recursive: true })
  const persistFile = join(dataDir, 'state.json')
  const loadPersist = (): PersistData | undefined => {
    try { return JSON.parse(readFileSync(persistFile, 'utf8')) as PersistData } catch { return undefined }
  }
  const persist = (d: PersistData) => {
    try { writeFileSync(persistFile, JSON.stringify(d)) } catch {}
  }

  const modes = new ModeRegistry(config, persist, loadPersist())
  const ledger = new UsageLedger(config, dataDir)
  const dsh = new DshLlm(ctx)
  if (config.mock.enabled) registerMockAdapter(ctx)
  const gateway = new Gateway(config, r =>
    ledger.record({
      ts: Date.now(),
      role: r.role,
      provider: r.provider,
      model: r.model,
      promptTokens: r.usage.prompt_tokens,
      completionTokens: r.usage.completion_tokens,
      costUsd: r.costUsd,
      durationMs: r.durationMs,
      kind: 'api',
    }), dsh)
  const memory = new TeamMemory(
    { digestMaxChars: config.memory.digestMaxChars, summarizeOverChars: config.memory.summarizeOverChars },
    makeSummarizer(gateway, () => cheapest(modes.active)),
  )
  const store = new Store(modes.active.id, modes.roles())
  const sessions = new SessionReader()

  registerTools(ctx, { modes, gateway, ledger, memory, store, config, recentMemory: (n) => sessions.recentMemory(n) })

  // 首次使用：按 dsh 设置里的真实模型目录生成初始编队（不内置任何过时预设）
  if (modes.needsBootstrap()) {
    void dsh.listProviderModels().then(providers => {
      if (providers.length && modes.bootstrapFromCatalog(providers)) {
        store.setRoles(modes.roles())
        ctx.logger?.info?.('[agent-modes] 已按 dsh 模型目录生成初始编队，展开面板可调整并保存为你的模式')
      }
    }).catch(() => {})
  }

  // 一切路径派发的子代理（原生 subagent 工具 / Agent teams / team_spawn）强制套用模式映射 + 异步自动验证
  if (config.verifySubagents) {
    new SubagentEnforcer(ctx, {
      getMode: () => modes.active,
      log: (text) => store.pushLog(text),
      verify: async (text) => {
        try {
          return formatVerdict(await verifyWithMode({ modes, gateway, memory, store }, text))
        } catch (err) {
          return `验证执行失败：${(err as Error).message}`
        }
      },
    }).attach()
  }

  if (!config.ui.enabled) return

  const dash = new DashboardServer({
    config,
    modes,
    store,
    ledger,
    dsh,
    sessions,
    onSwitch: id => {
      const m = modes.switch(id)
      store.setActiveMode(m.id)
      store.setRoles(modes.roles())
      memory.clear()
    },
    onSaveMode: (name, id) => {
      const m = modes.saveMode({ name, id })
      store.setActiveMode(m.id)
      store.setRoles(modes.roles())
    },
    onRemoveMode: id => {
      modes.removeMode(id)
      store.setActiveMode(modes.active.id)
      store.setRoles(modes.roles())
      memory.clear()
    },
    onSetRole: (role, provider, model) => {
      modes.setRole(role, provider, model)
      store.setRoles(modes.roles())
    },
  })
  ctx.effect(() => {
    void dash.start().then(port => {
      if (dash.isReused()) {
        ctx.logger?.info?.(`[agent-modes] 复用已运行的看板 http://127.0.0.1:${port}`)
        return
      }
      ctx.logger?.info?.(`[agent-modes] 看板已启动 http://127.0.0.1:${port}（界面底部横条可展开；登录页打不开就用浏览器访问）`)
      if (port !== config.ui.dashboardPort) {
        ctx.logger?.warn?.(`[agent-modes] 端口 ${config.ui.dashboardPort} 被占用，看板已改用 ${port}`)
      }
    }).catch(err => {
      ctx.logger?.warn?.(`[agent-modes] 看板启动失败（不影响编排功能）：${(err as Error).message}`)
    })
    return () => dash.stop()
  })

  // 悬浮横条的 UI 注册在客户端入口 client/index.js（渲染进程）完成；
  // 宿主侧只负责看板 HTTP 服务。slots 服务不可用等客户端情况不影响本插件激活。
}
