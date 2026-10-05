/**
 * 子代理强制映射器：包装 ctx.subagents.start / startContinuable，
 * 让【一切路径】派发的子代理（dsh 原生 subagent 工具、Agent teams、本插件 team_spawn）
 * 都套用当前模式的模型映射；完成后异步跑验证员并把结论写进面板动态。
 */
import type { ModeDefinition } from './types'

interface SubagentRuntimeLike {
  start: (provider: string, req: Record<string, unknown>) => Promise<{ result?: Promise<{ output?: { text?: string }[]; stopReason?: string }> }>
  startContinuable?: (spec: Record<string, unknown>) => Promise<unknown>
  list?: () => string[]
}

export interface EnforcerOpts {
  getMode: () => ModeDefinition
  log: (text: string) => void
  verify: (text: string) => Promise<string>
}

export class SubagentEnforcer {
  constructor(private ctx: unknown, private opts: EnforcerOpts) {}

  /** 等服务就绪后包装（幂等） */
  attach(poll = 20): void {
    const attempt = (left: number): void => {
      try {
        const reflect = (this.ctx as { reflect?: { get?: (name: string, strict?: boolean) => unknown } }).reflect
        const rt = reflect?.get?.('subagents', false) as (SubagentRuntimeLike & { __amWrapped?: boolean }) | undefined
        if (!rt?.start) {
          if (left > 0) setTimeout(() => attempt(left - 1), 500)
          return
        }
        if (rt.__amWrapped) return
        this.wrap(rt)
      } catch (err) {
        (this.ctx as { logger?: { warn?: (m: string) => void } }).logger?.warn?.(`[agent-modes] 子代理映射器挂载失败：${(err as Error).message}`)
      }
    }
    attempt(poll)
  }

  private wrap(rt: SubagentRuntimeLike & { __amWrapped?: boolean }) {
    const self = this
    const origStart = rt.start.bind(rt)
    rt.start = async function (provider: string, req: Record<string, unknown>) {
      const req2 = self.override(req, 'start')
      const run = await origStart(provider, req2)
      // 异步自动验证：不阻塞派发方，结论进面板动态
      try {
        void Promise.resolve(run.result)?.then?.(async (res) => {
          const text = (res?.output ?? []).map((b: { text?: string }) => b?.text ?? '').join('\n').trim()
          if (!text) return
          const verdict = await self.opts.verify(text)
          self.opts.log(`🔍 自动验证 → ${verdict.slice(0, 160)}`)
        }).catch(() => {})
      } catch {}
      return run
    }
    if (rt.startContinuable) {
      const origCont = rt.startContinuable.bind(rt)
      rt.startContinuable = async function (spec: Record<string, unknown>) {
        return origCont(self.override(spec, 'continuable'))
      }
    }
    rt.__amWrapped = true
    ;(self.ctx as { logger?: { info?: (m: string) => void } }).logger?.info?.('[agent-modes] 子代理强制映射已挂载（一切派发路径生效）')
  }

  /** 按当前模式覆盖子代理的 provider/model */
  private override(req: Record<string, unknown>, via: string): Record<string, unknown> {
    const mode = this.opts.getMode()
    if (mode.enforceSubagents === false) return req
    const w = mode.workers.find(x => x.role === mode.subagentWorker) ?? mode.workers[0] ?? null
    if (!w) return req
    const ao = { ...((req.agentOptions as Record<string, unknown>) ?? {}), provider: w.provider, model: w.model }
    this.opts.log(`🧩 子代理已映射（${via}）→ ${w.role} · ${w.provider}/${w.model}`)
    return { ...req, agentOptions: ao }
  }
}
