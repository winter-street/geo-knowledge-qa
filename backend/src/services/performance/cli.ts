export type PerformanceCommand = 'smoke' | 'local' | 'real' | 'report' | 'help'

export interface PerformanceCliOptions {
  command: PerformanceCommand
  label: string
  profile: 'smoke' | 'quick' | 'formal'
  suite?: string
  run?: string
  confirmRealApi: boolean
}

export function parsePerformanceArgs(argv: string[]): PerformanceCliOptions {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    return { command: 'help', label: 'baseline-v1', profile: 'quick', confirmRealApi: false }
  }
  const command = argv[0] as PerformanceCommand
  if (!['smoke', 'local', 'real', 'report'].includes(command)) throw new Error(`Unknown performance command: ${argv[0]}`)
  const value = (name: string): string | undefined => {
    const index = argv.indexOf(name)
    return index >= 0 ? argv[index + 1] : undefined
  }
  const profile = (value('--profile') ?? (command === 'smoke' ? 'smoke' : 'quick')) as PerformanceCliOptions['profile']
  if (!['smoke', 'quick', 'formal'].includes(profile)) throw new Error(`Invalid performance profile: ${profile}`)
  const options: PerformanceCliOptions = {
    command,
    label: value('--label') ?? 'baseline-v1',
    profile,
    suite: value('--suite'),
    run: value('--run'),
    confirmRealApi: argv.includes('--confirm-real-api'),
  }
  if (command === 'real') {
    if (!options.suite) throw new Error('Real API evaluation requires --suite')
    if (!options.confirmRealApi) throw new Error('Real API evaluation requires --confirm-real-api')
  }
  if (command === 'report' && !options.run) throw new Error('Report generation requires --run')
  return options
}

export const PERFORMANCE_HELP = `Performance evaluation commands:
  smoke [--label smoke]                       Synthetic end-to-end smoke run
  local [--profile quick|formal] [--label X] Private retrieval + local LLM stub
  real --suite PATH --confirm-real-api        Paid Hybrid/Agent endpoint sample
  report --run PATH                           Regenerate sanitized reports
`
