import type { Gateway, ChatMessage } from './gateway'

export interface MemoryEntry {
  ts: number
  kind: 'task' | 'plan' | 'worker' | 'verifier' | 'assembly'
  role: string
  content: string
}

/**
 * 团队共享记忆：一次编队运行内，主控/执行/验证都从这里读写上下文。
 * 超过阈值时把较旧的部分压缩成摘要（用当前编城里最便宜的 worker 模型），
 * 各家模型 tokenizer 不同，因此以字符数做工程估算、以各家返回的 usage 计费。
 */
export class TeamMemory {
  private entries: MemoryEntry[] = []
  private summary = ''

  constructor(
    private opts: { digestMaxChars: number; summarizeOverChars: number },
    private summarizer?: (prompt: string) => Promise<string>,
  ) {}

  add(kind: MemoryEntry['kind'], role: string, content: string) {
    this.entries.push({ ts: Date.now(), kind, role, content })
  }

  async digest(): Promise<string> {
    const total = this.entries.reduce((s, e) => s + e.content.length, 0)
    if (total > this.opts.summarizeOverChars && this.summarizer) {
      await this.compress()
    }
    const parts: string[] = []
    if (this.summary) parts.push(`[先前摘要]\n${this.summary}`)
    let budget = this.opts.digestMaxChars - (this.summary?.length ?? 0)
    const recent: string[] = []
    for (let i = this.entries.length - 1; i >= 0 && budget > 200; i--) {
      const e = this.entries[i]
      const piece = e.content.length > budget ? e.content.slice(0, budget) + '…(截断)' : e.content
      recent.unshift(`[${e.kind}/${e.role}] ${piece}`)
      budget -= piece.length + 20
    }
    parts.push(recent.join('\n\n'))
    return parts.join('\n\n')
  }

  private async compress() {
    if (!this.summarizer) return
    const keepFrom = Math.floor(this.entries.length / 2)
    const old = this.entries.slice(0, keepFrom)
    if (!old.length) return
    const prompt = old.map(e => `[${e.kind}/${e.role}] ${e.content}`).join('\n\n')
    try {
      this.summary = await this.summarizer(
        `请把以下多智能体协作记录压缩成要点摘要（保留任务目标、已确定的事实、各角色产出位置、未决问题），不超过 800 字：\n\n${prompt.slice(0, 20000)}`,
      )
      this.entries = this.entries.slice(keepFrom)
    } catch {
      // 摘要失败不阻塞主流程，下次再压
    }
  }

  snapshot() {
    return { summary: this.summary, entries: [...this.entries] }
  }

  clear() {
    this.entries = []
    this.summary = ''
  }

  get size() {
    return this.entries.length
  }
}

export function makeSummarizer(gateway: Gateway, pickTarget: () => { provider: string; model: string }) {
  return async (prompt: string) => {
    const messages: ChatMessage[] = [
      { role: 'system', content: '你是多智能体团队的记录员，负责压缩上下文。只输出摘要本身。' },
      { role: 'user', content: prompt },
    ]
    const r = await gateway.call({ role: 'memory', kind: 'summarize', target: pickTarget(), messages, maxTokens: 1200 })
    return r.text
  }
}
