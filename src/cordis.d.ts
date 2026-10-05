import type { Context } from '@deepseek-ai/cordis'

// 运行时自带的 tools 服务的最小类型面（原本由 @deepseek-ai/dsh-tools 的类型增强提供，
// 该依赖已移除以避免与 dsh 运行时版本冲突）
declare module '@deepseek-ai/cordis' {
  interface Context {
    tools: {
      register: (definition: unknown) => () => void
    }
  }
}

export type {}
