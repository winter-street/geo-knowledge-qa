import { execFile } from 'node:child_process'
import os from 'node:os'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface ProcessTarget {
  name: string
  pid: number
}

export interface ProcessResourceSample {
  name: string
  pid: number
  sampledAtMs: number
  available: boolean
  workingSetBytes?: number
  cpuTimeMs?: number
  cpuPercent?: number
}

type CommandRunner = (pids: number[]) => Promise<Array<{ Id: number; WorkingSet64: number; TotalProcessorTimeMs: number }>>

async function runPowerShell(pids: number[]): Promise<Array<{ Id: number; WorkingSet64: number; TotalProcessorTimeMs: number }>> {
  if (pids.length === 0) return []
  const safePids = pids.map((pid) => {
    if (!Number.isInteger(pid) || pid <= 0) throw new RangeError('PID must be a positive integer')
    return pid
  })
  const script = `$items = @(${safePids.join(',')}) | ForEach-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue } | ForEach-Object { [pscustomobject]@{ Id=$_.Id; WorkingSet64=$_.WorkingSet64; TotalProcessorTimeMs=$_.TotalProcessorTime.TotalMilliseconds } }; @($items) | ConvertTo-Json -Compress`
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true })
  if (!stdout.trim()) return []
  const parsed = JSON.parse(stdout) as unknown
  return Array.isArray(parsed) ? parsed as Array<{ Id: number; WorkingSet64: number; TotalProcessorTimeMs: number }> : [parsed as { Id: number; WorkingSet64: number; TotalProcessorTimeMs: number }]
}

export function createWindowsProcessSampler(
  targets: ProcessTarget[],
  options: { now?: () => number; logicalProcessors?: number; commandRunner?: CommandRunner } = {},
): { sample(): Promise<ProcessResourceSample[]> } {
  const now = options.now ?? Date.now
  const logicalProcessors = Math.max(1, options.logicalProcessors ?? os.cpus().length)
  const commandRunner = options.commandRunner ?? runPowerShell
  const previous = new Map<number, { sampledAtMs: number; cpuTimeMs: number }>()
  return {
    async sample() {
      const sampledAtMs = now()
      let rows: Awaited<ReturnType<CommandRunner>> = []
      try { rows = await commandRunner(targets.map((target) => target.pid)) } catch { rows = [] }
      const byPid = new Map(rows.map((row) => [Number(row.Id), row]))
      return targets.map((target) => {
        const row = byPid.get(target.pid)
        if (!row) return { ...target, sampledAtMs, available: false }
        const cpuTimeMs = Number(row.TotalProcessorTimeMs)
        const prior = previous.get(target.pid)
        previous.set(target.pid, { sampledAtMs, cpuTimeMs })
        const elapsed = prior ? sampledAtMs - prior.sampledAtMs : 0
        const cpuDelta = prior ? cpuTimeMs - prior.cpuTimeMs : 0
        return {
          ...target,
          sampledAtMs,
          available: true,
          workingSetBytes: Number(row.WorkingSet64),
          cpuTimeMs,
          ...(elapsed > 0 && cpuDelta >= 0
            ? { cpuPercent: Number(((cpuDelta / elapsed / logicalProcessors) * 100).toFixed(2)) }
            : {}),
        }
      })
    },
  }
}
