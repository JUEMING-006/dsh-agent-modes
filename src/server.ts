import { createServer, type Server } from 'node:http'
import type { AgentModesConfig } from './config'
import type { DshLlm } from './dshllm'
import type { ModeRegistry } from './modes'
import type { SessionReader } from './sessions'
import type { Store } from './store'
import type { UsageLedger } from './usage'

export interface DashboardDeps {
  config: AgentModesConfig
  modes: ModeRegistry
  store: Store
  ledger: UsageLedger
  dsh: DshLlm
  sessions: SessionReader
  onSwitch: (id: string) => void
  onSetRole: (role: string, provider: string, model: string) => void
}

/** 本地看板：http://127.0.0.1:<port>/ ——横条展开面板的数据源，也是浏览器兜底界面 */
export class DashboardServer {
  private server: Server | null = null

  constructor(private deps: DashboardDeps) {}

  start(): Promise<number> {
    const preferred = this.deps.config.ui.dashboardPort
    const ports = [preferred, ...Array.from({ length: 10 }, (_, i) => preferred + 1 + i)]
    return (async () => {
      for (const port of ports) {
        const r = await this.tryListen(port)
        if (r !== 'busy') {
          this.reused = r === 'reused'
          return port
        }
      }
      throw new Error(`看板端口分配失败（${ports[0]}-${ports[ports.length - 1]} 全部不可用）`)
    })()
  }

  /** start() 返回的端口是否复用了别的进程里的 agent-modes 看板 */
  isReused() {
    return this.reused
  }

  private reused = false

  private tryListen(port: number): Promise<'listening' | 'reused' | 'busy'> {
    return new Promise(resolve => {
      const s = createServer((req, res) => { void this.route(req, res) })
      s.on('error', async (err: NodeJS.ErrnoException) => {
        if (err.code !== 'EADDRINUSE') return resolve('busy')
        try {
          const r = await fetch(`http://127.0.0.1:${port}/api/status`)
          const j = await r.json() as { activeModeId?: unknown }
          resolve(typeof j.activeModeId === 'string' ? 'reused' : 'busy')
        } catch {
          resolve('busy')
        }
      })
      s.listen(port, '127.0.0.1', () => {
        this.server = s
        resolve('listening')
      })
    })
  }

  stop() {
    if (!this.server) return
    this.server.close()
    this.server.closeAllConnections()
    this.server = null
  }

  private async route(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) {
    const url = (req.url ?? '/').split('?')[0]
    try {
      if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(dashboardHtml())
        return
      }
      if (req.method === 'POST') {
        const body = await readBody(req)
        if (url === '/api/mode/switch') {
          this.deps.onSwitch(String(body.id))
        } else if (url === '/api/role') {
          this.deps.onSetRole(String(body.role), String(body.provider), String(body.model))
        } else {
          throw new Error(`未知接口 ${url}`)
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...cors() })
        res.end(JSON.stringify({ ok: true }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...cors() })
      switch (url) {
        case '/api/status': {
          const b = this.deps.ledger.budgetStatus()
          const m = this.deps.ledger.month()
          res.end(JSON.stringify({
            ...this.deps.store.get(),
            today: this.deps.ledger.today(),
            monthTok: { promptTokens: m.promptTokens, completionTokens: m.completionTokens, calls: m.calls },
            budget: b,
            log: this.deps.store.logLines(),
          }))
          break
        }
        case '/api/modes':
          res.end(JSON.stringify(this.deps.modes.list().map(m => ({
            id: m.id, name: m.name, description: m.description,
            roles: [
              { role: 'lead', provider: m.lead.provider, model: m.lead.model },
              ...m.workers.map(w => ({ role: w.role, provider: w.provider, model: w.model })),
              { role: 'verifier', provider: m.verifier.provider, model: m.verifier.model },
            ],
          }))))
          break
        case '/api/models': {
          try {
            const providers = await this.deps.dsh.listProviderModels()
            res.end(JSON.stringify({ available: providers.length > 0, providers }))
          } catch (err) {
            res.end(JSON.stringify({ available: false, providers: [], error: (err as Error).message }))
          }
          break
        }
        case '/api/sessions':
          res.end(JSON.stringify(this.deps.sessions.list(12)))
          break
        case '/api/session-feed': {
          const url = new URL(req.url ?? '/', 'http://x')
          const key = url.searchParams.get('key') ?? ''
          res.end(JSON.stringify(this.deps.sessions.feed(key, 40)))
          break
        }
        case '/api/usage':
          res.end(JSON.stringify({ text: this.deps.ledger.reportText(), today: this.deps.ledger.today(), month: this.deps.ledger.budgetStatus() }))
          break
        default:
          throw new Error(`未知接口 ${url}`)
      }
    } catch (err) {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', ...cors() })
      res.end(JSON.stringify({ error: (err as Error).message }))
    }
  }
}

const cors = () => ({ 'Access-Control-Allow-Origin': '*' })

function readBody(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', c => (data += c))
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}) } catch (e) { reject(e as Error) }
    })
  })
}

function dashboardHtml() {
  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>智能体编队 · Agent Modes</title>
<style>
  :root { color-scheme: dark; }
  body { font: 14px/1.6 system-ui, "Microsoft YaHei", sans-serif; background:#111418; color:#d7dde3; margin:0; padding:24px; }
  .bar { display:flex; align-items:center; gap:12px; background:#1a1f26; border:1px solid #2a313b; border-radius:12px; padding:10px 16px; cursor:pointer; user-select:none; }
  .bar:hover { border-color:#3fa66a; }
  .dot { width:10px; height:10px; border-radius:50%; background:#3fa66a; }
  .dot.busy { background:#e0a63f; animation:pulse 1s infinite; }
  @keyframes pulse { 50% { opacity:.4; } }
  .panel { display:none; margin-top:12px; background:#161b21; border:1px solid #2a313b; border-radius:12px; padding:16px 20px; }
  h2 { font-size:13px; color:#8b949e; margin:18px 0 8px; font-weight:600; }
  table { width:100%; border-collapse:collapse; }
  td, th { padding:6px 8px; border-bottom:1px solid #232a33; text-align:left; }
  select, input { background:#1e242c; color:#d7dde3; border:1px solid #2a313b; border-radius:6px; padding:3px 6px; }
  .tag { font-size:12px; padding:1px 8px; border-radius:10px; background:#23303a; color:#7ec9a0; }
  .meter { height:6px; background:#232a33; border-radius:3px; overflow:hidden; }
  .meter i { display:block; height:100%; background:#3fa66a; }
  #log { font-family:ui-monospace,monospace; font-size:12px; color:#9aa4af; white-space:pre-wrap; }
  button { background:#24483a; color:#9fe0bb; border:none; border-radius:6px; padding:4px 12px; cursor:pointer; }
</style></head><body>
<div class="bar" id="bar"><span class="dot" id="dot"></span><b id="mode">—</b><span id="act" style="color:#8b949e">…</span>
  <span style="margin-left:auto" class="tag" id="cost">$0.00</span><span class="tag" id="calls">0 次</span></div>
<div class="panel" id="panel">
  <h2>编队角色（点击切换模型，立即生效）</h2><table id="roles"></table>
  <h2>模式</h2><div id="modes"></div>
  <h2>本月预算</h2><div class="meter"><i id="bud" style="width:0"></i></div><span id="budtext"></span>
  <h2>今日用量（按角色）</h2><table id="usage"></table>
  <h2>动态</h2><div id="log">—</div>
</div>
<script>
const $ = id => document.getElementById(id)
const fmtK = n => (n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(n ?? 0))
const api = p => fetch(p).then(r => r.json())
$('bar').onclick = () => { const p = $('panel'); p.style.display = p.style.display === 'block' ? 'none' : 'block' }
async function refresh() {
  try {
    const s = await api('/api/status')
    $('mode').textContent = '编队：' + (s.activeModeId || '—')
    $('act').textContent = s.running ? s.activity : '空闲'
    $('dot').className = 'dot' + (s.running ? ' busy' : '')
    $('cost').textContent = '↑' + fmtK(s.today?.total?.promptTokens ?? 0) + ' ↓' + fmtK(s.today?.total?.completionTokens ?? 0)
    $('calls').textContent = (s.today?.total?.calls ?? 0) + ' 次'
    $('roles').innerHTML = (s.roles || []).map((r, i) =>
      '<tr><td>' + (r.kind === 'lead' ? '🧠 主控' : r.kind === 'verifier' ? '🔍 验证' : '⚙️ 执行') + '</td><td><b>' + r.role + '</b></td>' +
      '<td><input id="p' + i + '" value="' + r.provider + '" size="9"></td>' +
      '<td><input id="m' + i + '" value="' + r.model + '" size="22"></td>' +
      '<td><button onclick="setRole(' + i + ')">应用</button></td></tr>').join('')
    window._roles = s.roles
    const ms = await api('/api/modes')
    $('modes').innerHTML = ms.map(m => '<button style="margin:2px' + (m.id === s.activeModeId ? ';background:#3fa66a;color:#0d1117' : '') +
      '" onclick="switchMode(\\'' + m.id + '\\')">' + m.name + '</button>').join(' ')
    const b = s.budget || {}
    $('bud').style.width = Math.round((b.ratio || 0) * 100) + '%'
    $('budtext').textContent = '本月 ↑' + fmtK(s.monthTok?.promptTokens ?? 0) + ' ↓' + fmtK(s.monthTok?.completionTokens ?? 0) + ' tokens · ' + (s.monthTok?.calls ?? 0) + ' 次调用'
    $('usage').innerHTML = Object.entries(s.today?.byRole || {}).map(([k, v]) =>
      '<tr><td>' + k + '</td><td>' + v.calls + ' 次</td><td>↑' + fmtK(v.promptTokens) + ' ↓' + fmtK(v.completionTokens) + '</td></tr>').join('') || '<tr><td>暂无</td></tr>'
    $('log').textContent = (s.log || []).map(l => new Date(l.ts).toLocaleTimeString() + '  ' + l.text).join('\\n') || '—'
  } catch (e) { $('act').textContent = '看板服务未响应：' + e.message }
}
async function setRole(i) {
  const r = window._roles[i]
  await fetch('/api/role', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: r.role, provider: $('p' + i).value, model: $('m' + i).value }) })
  refresh()
}
async function switchMode(id) {
  await fetch('/api/mode/switch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
  refresh()
}
refresh(); setInterval(refresh, 3000)
</script></body></html>`
}
