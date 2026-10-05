import type { RuntimeState } from './types'

/** 面板/横条所需的运行时状态（经本地看板 HTTP API 暴露给 UI 轮询） */
export class Store {
  private state: RuntimeState
  private log: { ts: number; text: string }[] = []

  constructor(activeModeId: string, roles: RuntimeState['roles']) {
    this.state = { activeModeId, running: false, activity: '空闲', lastUpdate: Date.now(), roles }
  }

  get(): RuntimeState {
    return { ...this.state, lastUpdate: Date.now() }
  }

  logLines() {
    return this.log.slice(-50)
  }

  setRoles(roles: RuntimeState['roles']) {
    this.state.roles = roles
    this.touch()
  }

  setActiveMode(id: string) {
    this.state.activeModeId = id
    this.touch()
  }

  setRunning(running: boolean, task?: string) {
    this.state.running = running
    this.state.currentTask = task
    if (!running) this.state.activity = '空闲'
    this.touch()
  }

  setActivity(activity: string) {
    this.state.activity = activity
    this.touch()
  }

  pushLog(text: string) {
    this.log.push({ ts: Date.now(), text })
    if (this.log.length > 100) this.log = this.log.slice(-80)
    this.touch()
  }

  private touch() {
    this.state.lastUpdate = Date.now()
  }
}
