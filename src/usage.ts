import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentModesConfig } from './config'
import type { UsageEntry } from './types'

const DAY = 24 * 3600 * 1000

/** 记账台账：每次 API 调用一条记录，落盘 JSON，供看板与预算控制使用 */
export class UsageLedger {
  private entries: UsageEntry[] = []
  private file: string

  constructor(private config: AgentModesConfig, dataDir: string) {
    this.file = join(dataDir, 'usage.json')
    mkdirSync(dataDir, { recursive: true })
    try {
      this.entries = JSON.parse(readFileSync(this.file, 'utf8')) as UsageEntry[]
    } catch {
      this.entries = []
    }
  }

  record(entry: UsageEntry) {
    this.entries.push(entry)
    if (this.entries.length > 5000) this.entries = this.entries.slice(-4000)
    this.flush()
  }

  private flush() {
    try {
      writeFileSync(this.file, JSON.stringify(this.entries))
    } catch {}
  }

  private monthStart(now = Date.now()) {
    const d = new Date(now)
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  }

  summary(windowMs?: number) {
    const since = windowMs ? Date.now() - windowMs : 0
    const rows = this.entries.filter(e => e.ts >= since)
    const total = {
      calls: rows.length,
      promptTokens: rows.reduce((s, e) => s + e.promptTokens, 0),
      completionTokens: rows.reduce((s, e) => s + e.completionTokens, 0),
      costUsd: round4(rows.reduce((s, e) => s + e.costUsd, 0)),
    }
    const byRole: Record<string, { calls: number; costUsd: number; promptTokens: number; completionTokens: number }> = {}
    for (const e of rows) {
      byRole[e.role] ??= { calls: 0, costUsd: 0, promptTokens: 0, completionTokens: 0 }
      const r = byRole[e.role]
      r.calls++
      r.costUsd = round4(r.costUsd + e.costUsd)
      r.promptTokens += e.promptTokens
      r.completionTokens += e.completionTokens
    }
    const byModel: Record<string, { calls: number; costUsd: number }> = {}
    for (const e of rows) {
      const key = `${e.provider}/${e.model}`
      byModel[key] ??= { calls: 0, costUsd: 0 }
      byModel[key].calls++
      byModel[key].costUsd = round4(byModel[key].costUsd + e.costUsd)
    }
    return { total, byRole, byModel }
  }

  today() {
    return this.summary(DAY)
  }

  month() {
    const since = this.monthStart()
    const rows = this.entries.filter(e => e.ts >= since)
    return {
      costUsd: round4(rows.reduce((s, e) => s + e.costUsd, 0)),
      calls: rows.length,
      promptTokens: rows.reduce((s, e) => s + e.promptTokens, 0),
      completionTokens: rows.reduce((s, e) => s + e.completionTokens, 0),
    }
  }

  budgetStatus() {
    const cap = this.config.budget.monthlyCapUsd
    const m = this.month()
    const exceeded = cap > 0 && m.costUsd >= cap
    const ratio = cap > 0 ? Math.min(1, m.costUsd / cap) : 0
    return { cap, ...m, exceeded, ratio }
  }

  /** 预算拦截判断：block 模式下超预算抛错，warn 模式返回提示语 */
  checkBudget(): string | null {
    const st = this.budgetStatus()
    if (!st.exceeded) return null
    const msg = `本月已消费 $${st.costUsd}，达到预算上限 $${st.cap}`
    return this.config.budget.onExceed === 'block' ? msg : `${msg}（warn 模式继续执行）`
  }

  reportText(windowMs?: number) {
    const s = this.summary(windowMs)
    const scope = windowMs === DAY ? '今天' : windowMs ? `最近 ${Math.round(windowMs / DAY)} 天` : '全部'
    const lines = [
      `用量报告（${scope}）：共 ${s.total.calls} 次调用，入 ${s.total.promptTokens} / 出 ${s.total.completionTokens} tokens`,
      ...Object.entries(s.byRole).map(([role, r]) => `  · ${role}：${r.calls} 次，入 ${r.promptTokens} / 出 ${r.completionTokens}`),
      ...Object.entries(s.byModel).map(([m, r]) => `  · ${m}：${r.calls} 次`),
    ]
    const m = this.month()
    lines.push(`本月：${m.calls} 次调用，入 ${m.promptTokens} / 出 ${m.completionTokens} tokens`)
    return lines.join('\n')
  }
}

function round4(n: number) {
  return Math.round(n * 10000) / 10000
}
