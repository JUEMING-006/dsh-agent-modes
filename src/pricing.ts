import type { ProviderConfig } from './types'

/** 内置价格表：USD / 每百万 token（in=输入未命中缓存，out=输出）。可被 config.pricing 覆盖 */
export const PRICE_TABLE: Record<string, Record<string, { in: number; out: number }>> = {
  deepseek: {
    'deepseek-flash': { in: 0.3, out: 1.2 },
    'deepseek-v4-pro': { in: 1.32, out: 3.96 },
  },
  openai: {
    'gpt-5.1': { in: 1.25, out: 10 },
    'gpt-5-mini': { in: 0.25, out: 2 },
    'gpt-5-nano': { in: 0.05, out: 0.4 },
    'gpt-4o-mini': { in: 0.15, out: 0.6 },
  },
  google: {
    'gemini-2.5-flash-lite': { in: 0.1, out: 0.4 },
    'gemini-3.1-flash-lite': { in: 0.25, out: 1.5 },
  },
  minimax: {
    'MiniMax-M3': { in: 0.3, out: 1.2 },
    'MiniMax-M2.7': { in: 0.3, out: 1.2 },
  },
  mock: {
    'mock-fast': { in: 0, out: 0 },
    'mock-smart': { in: 0, out: 0 },
  },
}

export type PricingOverrides = Record<string, Record<string, { in: number; out: number }>>

export function lookupPrice(
  provider: string,
  model: string,
  overrides?: PricingOverrides,
): { in: number; out: number } {
  const hit = overrides?.[provider]?.[model] ?? PRICE_TABLE[provider]?.[model]
  // 未收录的模型按保守中间价估算，避免记账中断；用户可在配置里补准确价
  return hit ?? { in: 0.5, out: 2 }
}

export function calcCost(
  provider: string,
  model: string,
  promptTokens: number,
  completionTokens: number,
  overrides?: PricingOverrides,
): number {
  const p = lookupPrice(provider, model, overrides)
  return (promptTokens / 1e6) * p.in + (completionTokens / 1e6) * p.out
}

export const PROVIDER_BASE_URLS: Record<string, string> = {
  deepseek: 'https://api.deepseek.com',
  openai: 'https://api.openai.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai',
  minimax: 'https://api.minimax.io/v1',
}

export function resolveEndpoint(provider: string, providers: Record<string, ProviderConfig>) {
  const cfg = providers[provider]
  const baseUrl = cfg?.baseUrl || PROVIDER_BASE_URLS[provider]
  if (!baseUrl) throw new Error(`未知的 provider "${provider}"，请在插件配置的 providers 中补充 baseUrl 与 apiKey`)
  let apiKey = cfg?.apiKey || ''
  // 支持 ${ENV_NAME} 形式引用环境变量，密钥不落盘
  const envRef = apiKey.match(/^\$\{(\w+)\}$/)
  if (envRef) apiKey = process.env[envRef[1]] ?? ''
  if (!apiKey) throw new Error(`provider "${provider}" 缺少 apiKey（可在配置中直接填，或用 "\${ENV_NAME}" 引用环境变量）`)
  return { baseUrl: baseUrl.replace(/\/$/, ''), apiKey }
}
