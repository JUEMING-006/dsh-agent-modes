/**
 * dsh 会话读取器：解析 ~/.dsh/sessions/<workspace>/<session-id>/session.v4.jsonl.zstd。
 * 文件为多帧 zstd 追加写入（帧魔数 28 B5 2F FD），逐帧解压后是 JSONL 事件流：
 *   session / user/message / assistant/message(含 usage) / tool/call / tool/result /
 *   session/title / turn|step 边界等。本模块只读取，不写入。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { zstdDecompressSync } from 'node:zlib'

export interface SessionSummary {
  key: string            // <workspace>/<sessionId>
  sessionId: string
  workspace: string
  title: string
  createdAt: number
  updatedAt: number
  usage: { inputTokens: number; outputTokens: number; totalTokens: number }
  preview: string        // 最后一条真实用户输入
  models: string[]       // 本会话用过的 provider/model（按首次出现顺序）
}

export interface FeedEntry {
  ts: number
  kind: 'user' | 'assistant' | 'tool'
  text: string
  tool?: string
  error?: boolean
  usage?: { inputTokens: number; outputTokens: number }
  model?: string         // 该轮请求使用的 provider/model
}

const FRAME_MAGIC = [0x28, 0xb5, 0x2f, 0xfd]
const AUTO_INJECT_PREFIXES = ['<system-reminder>', 'Current runtime context', 'A skill is a reusable']

const home = () => process.env.DSH_HOME || join(homedir(), '.dsh')
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s)

function decodeFile(file: string): { ts: number; type: string; data: any }[] {
  const buf = readFileSync(file)
  const offsets: number[] = []
  for (let i = 0; i <= buf.length - 4; i++) {
    if (buf[i] === FRAME_MAGIC[0] && buf[i + 1] === FRAME_MAGIC[1] && buf[i + 2] === FRAME_MAGIC[2] && buf[i + 3] === FRAME_MAGIC[3]) offsets.push(i)
  }
  offsets.push(buf.length)
  let text = ''
  for (let f = 0; f < offsets.length - 1; f++) {
    try {
      text += zstdDecompressSync(buf.subarray(offsets[f], offsets[f + 1])).toString('utf8')
      if (!text.endsWith('\n')) text += '\n'
    } catch { /* 误判的伪帧或损坏段，跳过 */ }
  }
  const out: { ts: number; type: string; data: any }[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const o = JSON.parse(line)
      out.push({ ts: o.time ?? 0, type: o.type ?? '', data: typeof o.data === 'string' ? JSON.parse(o.data) : (o.data ?? {}) })
    } catch { /* 容错跳过 */ }
  }
  return out
}

const blocksText = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((b: any) => (typeof b === 'string' ? b : b?.type === 'text' ? b.text : '')).filter(Boolean).join('\n').trim()
}
const isAutoInject = (t: string) => AUTO_INJECT_PREFIXES.some(p => t.startsWith(p))

export class SessionReader {
  private cache = new Map<string, { mtime: number; size: number; events: ReturnType<typeof decodeFile> }>()

  private sessionsRoot(): string | null {
    const root = join(home(), 'sessions')
    return existsSync(root) ? root : null
  }

  /** 列出最近更新的会话（按文件 mtime 倒序） */
  list(limit = 12): SessionSummary[] {
    const root = this.sessionsRoot()
    if (!root) return []
    const candidates: { key: string; file: string; mtime: number }[] = []
    for (const ws of readdirSync(root)) {
      const wsDir = join(root, ws)
      let sessionDirs: string[]
      try { sessionDirs = readdirSync(wsDir) } catch { continue }
      for (const sid of sessionDirs) {
        if (!sid.startsWith('session-')) continue
        const file = join(wsDir, sid, 'session.v4.jsonl.zstd')
        if (!existsSync(file)) continue
        try {
          const st = statSync(file)
          candidates.push({ key: ws + '/' + sid, file, mtime: st.mtimeMs })
        } catch {}
      }
    }
    candidates.sort((a, b) => b.mtime - a.mtime)
    const out: SessionSummary[] = []
    for (const c of candidates.slice(0, limit)) {
      try {
        const events = this.events(c.file)
        let title = ''
        let usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
        let preview = ''
        let updatedAt = 0
        const models: string[] = []
        for (const ev of events) {
          updatedAt = Math.max(updatedAt, ev.ts)
          if (ev.type === 'request/context') {
            const route = (ev.data?.provider ?? '') + '/' + (ev.data?.model ?? '')
            if (route !== '/' && !models.includes(route)) models.push(route)
          } else if (ev.type === 'session/title') {
            const t = String(ev.data?.title ?? '')
            if (t && t !== 'Session title generator') title = title || t
          } else if (ev.type === 'assistant/message') {
            const u = ev.data?.usage
            if (u) {
              usage.inputTokens += u.inputTokens ?? 0
              usage.outputTokens += u.outputTokens ?? 0
              usage.totalTokens += u.totalTokens ?? 0
            }
          } else if (ev.type === 'user/message' && !preview) {
            const t = blocksText(ev.data?.content)
            if (t && !isAutoInject(t)) preview = cut(t.replace(/\s+/g, ' '), 60)
          }
        }
        out.push({
          key: c.key,
          sessionId: c.key.split('/').pop()?.replace('session-', '') ?? '',
          workspace: c.key.split('/')[0].replace(/^-+|-+$/g, '').replace(/~0020/g, ' '),
          title: title || preview || c.key.split('/').pop() || '未命名会话',
          createdAt: events[0]?.ts ?? 0,
          updatedAt,
          usage,
          preview,
          models,
        })
      } catch { /* 单个会话损坏不影响整体 */ }
    }
    return out
  }

  /** 跨会话记忆映射：把最近 N 个会话的标题与最后用户输入，压缩成团队记忆可注入的块 */
  recentMemory(n = 2): string {
    if (n <= 0) return ''
    const blocks = this.list(Math.max(n, 3))
      .slice(0, n)
      .map(ss => {
        const last = ss.preview ? `用户最后说「${ss.preview}」` : '（无用户输入记录）'
        return `- [${ss.title}]（${ss.workspace}）${last}`
      })
    return blocks.length ? blocks.join('\n') : ''
  }

  /** 一个会话的对话/命令动态（按时间序，默认最后 40 条） */
  feed(key: string, limit = 40): { title: string; entries: FeedEntry[] } {    const root = this.sessionsRoot()
    if (!root) return { title: '', entries: [] }
    const [ws, sid] = key.split('/')
    if (!ws || !sid || ws.includes('..') || sid.includes('..')) return { title: '', entries: [] }
    const file = join(root, ws, sid, 'session.v4.jsonl.zstd')
    if (!existsSync(file)) return { title: '', entries: [] }
    const events = this.events(file)
    let title = ''
    let lastRoute = ''
    const entries: FeedEntry[] = []
    const openCalls = new Map<string, { name: string; args: string; ts: number }>()
    for (const ev of events) {
      if (ev.type === 'request/context') {
        lastRoute = (ev.data?.provider ?? '') + '/' + (ev.data?.model ?? '')
        continue
      }
      if (ev.type === 'session/title') {
        const t = String(ev.data?.title ?? '')
        if (t && t !== 'Session title generator') title = title || t
        continue
      }
      if (ev.type === 'user/message') {
        const t = blocksText(ev.data?.content)
        if (!t || isAutoInject(t)) continue
        entries.push({ ts: ev.ts, kind: 'user', text: cut(t.replace(/\s+/g, ' '), 300) })
        continue
      }
      if (ev.type === 'assistant/message') {
        const u = ev.data?.usage
        const text = blocksText(ev.data?.message?.content) || blocksText(ev.data?.content)
        entries.push({
          ts: ev.ts, kind: 'assistant',
          text: cut(text || '（本轮为工具调用）', 300),
          usage: u ? { inputTokens: u.inputTokens ?? 0, outputTokens: u.outputTokens ?? 0 } : undefined,
          model: lastRoute || undefined,
        })
        continue
      }
      if (ev.type === 'tool/call') {
        openCalls.set(String(ev.data?.callId ?? ''), { name: String(ev.data?.name ?? '?'), args: String(ev.data?.arguments ?? ''), ts: ev.ts })
        continue
      }
      if (ev.type === 'tool/result') {
        const callId = String(ev.data?.message?.toolCallId ?? '')
        const call = openCalls.get(callId) ?? { name: '?', args: '', ts: ev.ts }
        openCalls.delete(callId)
        const isError = !!ev.data?.message?.isError
        let argText = call.args
        try {
          const a = JSON.parse(call.args)
          const q = Array.isArray(a.questions) && a.questions[0]
          argText = a.command ?? a.prompt ?? a.question ?? q?.question ?? a.path ?? cut(call.args, 120)
        } catch {}
        entries.push({
          ts: ev.ts, kind: 'tool', tool: call.name,
          text: cut(String(argText).replace(/\s+/g, ' '), 220),
          error: isError,
        })
        continue
      }
    }
    return { title, entries: entries.slice(-limit) }
  }

  private events(file: string) {
    const st = statSync(file)
    const ck = file + '|' + st.mtimeMs + '|' + st.size
    const hit = this.cache.get(file)
    if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit.events
    const events = decodeFile(file)
    this.cache.set(file, { mtime: st.mtimeMs, size: st.size, events })
    if (this.cache.size > 40) {
      for (const k of this.cache.keys()) { if (this.cache.size <= 40) break; this.cache.delete(k) }
    }
    void ck
    return events
  }
}
