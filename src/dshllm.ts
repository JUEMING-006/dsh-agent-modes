/**
 * dsh LLM 运行时桥接：让插件复用 dsh 设置里已配置的 provider/模型与凭据。
 * - listProviderModels(): 汇总 ctx.llm.listProviders() × listModels(p) 供面板下拉选择
 * - call(): 通过 ctx.llm.stream() 一次性调用（密钥由 dsh credentials 提供，无需插件配置）
 * 服务未就绪时返回 unavailable，网关自动回落到直连/LiteLLM。
 */
export interface DshProviderModels {
  id: string
  name: string
  models: { id: string; name: string }[]
}

interface LlmRuntimeLike {
  listProviders(): { id: string; name: string }[]
  listModels(provider: string): Promise<{ provider: string; id: string; name: string }[]>
  stream(options: Record<string, unknown>): AsyncIterable<{ type: string; text?: string; usage?: { inputTokens: number; outputTokens: number } }>
}

export class DshLlm {
  private cache: DshProviderModels[] | null = null

  constructor(private ctx: unknown) {}

  private runtime(): LlmRuntimeLike | undefined {
    const reflect = (this.ctx as { reflect?: { get?: (name: string, strict?: boolean) => unknown } }).reflect
    try {
      return reflect?.get?.('llm', false) as LlmRuntimeLike | undefined
    } catch {
      return undefined
    }
  }

  available(): boolean {
    return !!this.runtime()
  }

  /** 该 provider 是否由 dsh 运行时接管（是则可用 dsh 凭据调用） */
  knows(provider: string): boolean {
    if (!this.available()) return false
    if (!this.cache) return false // 仅在目录已拉取后判断，避免激活期阻塞
    return this.cache.some(p => p.id === provider)
  }

  async listProviderModels(force = false): Promise<DshProviderModels[]> {
    if (this.cache && !force) return this.cache
    const rt = this.runtime()
    if (!rt) return []
    const out: DshProviderModels[] = []
    for (const p of rt.listProviders()) {
      try {
        const models = (await rt.listModels(p.id)) ?? []
        out.push({
          id: p.id,
          name: p.name || p.id,
          models: models.map(m => ({ id: m.id, name: m.name || m.id })),
        })
      } catch {
        out.push({ id: p.id, name: p.name || p.id, models: [] })
      }
    }
    this.cache = out
    return out
  }

  /** 经 dsh 运行时一次性调用，usage 换算为 OpenAI 口径字段 */
  async call(opts: {
    provider: string
    model: string
    system?: string
    prompt: string
    temperature?: number
    maxTokens?: number
    signal?: AbortSignal
  }): Promise<{ text: string; usage: { prompt_tokens: number; completion_tokens: number } }> {
    const rt = this.runtime()
    if (!rt) throw new Error('dsh llm 服务不可用')
    const options: Record<string, unknown> = {
      provider: opts.provider,
      model: opts.model,
      messages: [{ role: 'user', content: [{ type: 'text', text: opts.prompt }] }],
      temperature: opts.temperature ?? 0.4,
      maxTokens: opts.maxTokens ?? 4096,
    }
    if (opts.system) options.system = opts.system
    if (opts.signal) options.signal = opts.signal

    let text = ''
    let usage = { prompt_tokens: 0, completion_tokens: 0 }
    for await (const chunk of rt.stream(options)) {
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
      else if (chunk.type === 'usage' && chunk.usage) {
        usage = {
          prompt_tokens: chunk.usage.inputTokens ?? 0,
          completion_tokens: chunk.usage.outputTokens ?? 0,
        }
      }
    }
    return { text, usage }
  }
}
