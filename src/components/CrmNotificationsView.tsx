import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bell,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Server,
  Database,
  BrainCircuit,
  Facebook,
  ShoppingCart,
  Container,
  Bot,
  ChevronDown,
  ChevronUp,
  Activity,
  MessageCircle,
  Users,
  FileText,
  ScrollText,
  ShieldAlert,
  BarChart3,
  Sparkles,
  BadgeCheck,
  Store,
  CalendarDays,
  Eye,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  systemStatusOverview,
  systemStatusDashboard,
  type SystemStatusOverview,
  type SystemStatusCheck,
  type SystemStatusDashboard,
} from '@/lib/api'
import { toast } from 'sonner'

function currency(v: number) {
  try {
    return '$' + Number(v || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  } catch {
    return '$' + Number(v || 0).toFixed(2)
  }
}
function fmtCount(v: number) {
  const n = Number(v || 0)
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(n)
}

function iconFor(label: string) {
  const L = label.toLowerCase()
  if (/groq|llm|proveedor/i.test(L)) return BrainCircuit
  if (/meta|facebook|messenger|graph/i.test(L)) return Facebook
  if (/supabase|base de datos|database/i.test(L)) return Database
  if (/pos|turno|venta|caja|cobro/i.test(L)) return ShoppingCart
  if (/docker|contenedor|container/i.test(L)) return Container
  if (/autocurador|prompt|docs|documento/i.test(L)) return Bot
  if (/api|servidor|backend|server/i.test(L)) return Server
  return Activity
}

function StatusDot({ ok, warn }: { ok?: boolean; warn?: boolean }) {
  if (ok) {
    return (
      <span className="relative inline-flex h-3 w-3 items-center justify-center">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/40" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.18)]" />
      </span>
    )
  }
  if (warn) {
    return (
      <span className="relative inline-flex h-3 w-3 items-center justify-center">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400/40" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-400 shadow-[0_0_0_3px_rgba(251,191,36,0.18)]" />
      </span>
    )
  }
  return (
    <span className="relative inline-flex h-3 w-3 items-center justify-center">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500/40" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500 shadow-[0_0_0_3px_rgba(244,63,94,0.18)]" />
    </span>
  )
}

function toneBox(tone?: 'ok' | 'warn' | 'error' | 'info') {
  switch (tone) {
    case 'ok':
      return 'border-emerald-400/20 bg-emerald-500/[0.06]'
    case 'warn':
      return 'border-amber-400/25 bg-amber-400/[0.07]'
    case 'error':
      return 'border-rose-500/30 bg-rose-500/[0.08]'
    default:
      return 'border-[#1a3a5a] bg-[#0f3151]'
  }
}
function toneText(tone?: 'ok' | 'warn' | 'error' | 'info') {
  switch (tone) {
    case 'ok': return 'text-emerald-200'
    case 'warn': return 'text-amber-100'
    case 'error': return 'text-rose-100'
    default: return 'text-slate-100'
  }
}

function KpiCard(props: {
  title: string
  value: string | number
  hint?: string
  tone?: 'ok' | 'warn' | 'error' | 'info'
  Icon?: any
  badge?: string
}) {
  const { title, value, hint, tone = 'info', Icon = BarChart3, badge } = props
  return (
    <div className={cn('rounded-[22px] border p-5 shadow-[0_10px_30px_-18px_rgba(0,0,0,0.65)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_40px_-16px_rgba(0,0,0,0.7)]', toneBox(tone))}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <p className="text-[10.5px] font-extrabold uppercase tracking-[0.22em] text-slate-300">{title}</p>
            {badge ? (
              <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wider', toneBox(tone), toneText(tone))}>
                {badge}
              </span>
            ) : null}
          </div>
          <div className="min-w-0">
            <p className={cn('truncate font-mono text-[30px] font-black leading-none tracking-tight', toneText(tone))}>
              {value}
            </p>
          </div>
          {hint ? (
            <p className="truncate text-[11px] text-slate-300">{hint}</p>
          ) : null}
        </div>
        <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]',
          tone === 'ok' ? 'bg-emerald-500/15 text-emerald-300'
          : tone === 'warn' ? 'bg-amber-400/15 text-amber-200'
          : tone === 'error' ? 'bg-rose-500/15 text-rose-200'
          : 'bg-[#1090D0]/15 text-[#7fd2f2]'
        )}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  )
}

function Stat(props: { label: string; value: string | number; tone?: 'ok' | 'warn' | 'error' | 'info' }) {
  const { label, value, tone = 'info' } = props
  return (
    <div className={cn('rounded-xl border px-3 py-2.5', toneBox(tone))}>
      <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className={cn('mt-1 truncate font-mono text-[14.5px] font-bold leading-tight', toneText(tone))}>{value}</p>
    </div>
  )
}

function SectionTitle({ icon: Icon, title, hint, action }: { icon: any; title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-[#1090D0]/15 text-[#7fd2f2] shadow-[inset_0_0_0_1px_rgba(16,144,208,0.25)]">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h3 className="text-[15px] font-extrabold tracking-tight text-slate-50">{title}</h3>
          {hint ? <p className="truncate text-[11.5px] text-slate-300">{hint}</p> : null}
        </div>
      </div>
      {action || null}
    </div>
  )
}

function CheckRow({ c, index }: { c: SystemStatusCheck; index: number }) {
  const [open, setOpen] = useState(false)
  const Icon = iconFor(c.label)
  const tone =
    c.ok ? 'emerald' :
    c.warn ? 'amber' : 'rose'
  const palette = {
    emerald: {
      border: 'border-emerald-500/15',
      bg: 'bg-emerald-500/[0.04] hover:bg-emerald-500/[0.08]',
      label: 'text-emerald-300',
      statusText: 'text-emerald-200',
      iconBox: 'bg-emerald-500/15 text-emerald-300',
    },
    amber: {
      border: 'border-amber-400/20',
      bg: 'bg-amber-400/[0.05] hover:bg-amber-400/[0.09]',
      label: 'text-amber-200',
      statusText: 'text-amber-100',
      iconBox: 'bg-amber-400/15 text-amber-200',
    },
    rose: {
      border: 'border-rose-500/20',
      bg: 'bg-rose-500/[0.05] hover:bg-rose-500/[0.09]',
      label: 'text-rose-200',
      statusText: 'text-rose-100',
      iconBox: 'bg-rose-500/15 text-rose-200',
    },
  }[tone]
  const hasDetail = c.detail && c.detail.trim().length > 0
  const showChevron = hasDetail || c.raw !== undefined

  return (
    <div
      key={index}
      className={cn(
        'rounded-2xl border p-4 transition',
        palette.border,
        palette.bg,
      )}
    >
      <div className="flex items-start gap-4">
        <div className={cn('mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]', palette.iconBox)}>
          <Icon className="h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-3">
            <StatusDot ok={c.ok} warn={c.warn} />
            <p className="truncate text-[14px] font-bold text-slate-50">{c.label}</p>
            {c.latencyMs !== undefined ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-black/25 px-2 py-0.5 font-mono text-[10.5px] text-slate-300">
                <Clock className="h-3 w-3" /> {c.latencyMs} ms
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('inline-flex items-center gap-1.5 rounded-full bg-black/25 px-2.5 py-1 text-[11px] font-semibold', palette.statusText)}>
              {c.ok ? (
                <><CheckCircle2 className="h-3.5 w-3.5" /> {c.status || 'Operativo'}</>
              ) : c.warn ? (
                <><AlertTriangle className="h-3.5 w-3.5" /> {c.status || 'Advertencia'}</>
              ) : (
                <><XCircle className="h-3.5 w-3.5" /> {c.status || 'Fallo'}</>
              )}
            </span>
            {hasDetail ? (
              <p className="truncate text-[11.5px] leading-snug text-slate-300 max-w-full">
                {c.detail}
              </p>
            ) : null}
          </div>
        </div>

        {showChevron ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#1a3a5a] bg-[#0b2641] text-slate-300 transition hover:border-[#1090D0]/40 hover:text-[#5bbfe5]"
            title="Ver detalle"
          >
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        ) : null}
      </div>

      {open && showChevron ? (
        <div className="mt-3 rounded-xl border border-[#1a3a5a] bg-[#0b2641]/70 p-3.5 font-mono text-[11.5px] leading-relaxed text-slate-200">
          {hasDetail ? (
            <div className="mb-2">
              <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 mb-1">Detalle</p>
              <p className="whitespace-pre-wrap break-words">{c.detail}</p>
            </div>
          ) : null}
          {c.raw !== undefined ? (
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 mb-1">Raw</p>
              <pre className="whitespace-pre-wrap break-words text-[11px]">{JSON.stringify(c.raw, null, 2)}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export default function CrmNotificationsView() {
  const [overview, setOverview] = useState<SystemStatusOverview | null>(null)
  const [dash, setDash] = useState<SystemStatusDashboard | null>(null)
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string>('')
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true)

  const load = useCallback(async ({ silent }: { silent: boolean } = { silent: false }) => {
    if (!silent) setLoading(true)
    setError('')
    try {
      const [o, d] = await Promise.all([
        systemStatusOverview(),
        systemStatusDashboard(),
      ])
      setOverview(o)
      setDash(d)
    } catch (e: any) {
      const msg = String(e?.message || e || 'Error al cargar el estado del sistema').slice(0, 300)
      setError(msg)
      if (!silent) toast.error('No se pudo cargar Estado del Sistema', { description: msg })
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!autoRefresh) return
    const id = window.setInterval(() => void load({ silent: true }), 30_000)
    return () => window.clearInterval(id)
  }, [autoRefresh, load])

  const fatalCount = overview?.summary.error ?? 0
  const warnCount = overview?.summary.warn ?? 0
  const okCount = overview?.summary.ok ?? 0
  const totalCount = overview?.summary.total ?? 0
  const overall = fatalCount > 0 ? 'fatal' : warnCount > 0 ? 'warn' : 'ok'

  const banner = useMemo(() => (
    overall === 'ok'
      ? {
          border: 'border-emerald-500/20',
          bg: 'bg-emerald-500/[0.07]',
          chip: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200',
          title: 'Todo operativo',
          desc: 'Todos los sistemas revisados pasaron los checks. Sigue monitoreando aquí cualquier cambio.',
        }
      : overall === 'warn'
      ? {
          border: 'border-amber-400/30',
          bg: 'bg-amber-400/[0.08]',
          chip: 'border-amber-400/35 bg-amber-400/10 text-amber-100',
          title: 'Algunos sistemas requieren atención',
          desc: 'No hay fallos críticos, pero revisa los ítems marcados en ámbar para evitar interrupciones.',
        }
      : {
          border: 'border-rose-500/35',
          bg: 'bg-rose-500/[0.09]',
          chip: 'border-rose-500/40 bg-rose-500/10 text-rose-100',
          title: 'Hay fallos críticos',
          desc: 'Uno o más servicios están caídos o inaccesibles. Revisa los ítems en rojo y reintenta después.',
        }
  ), [overall])

  const s = dash?.stats
  const metaTone: 'ok' | 'warn' | 'error' =
    s?.meta.linked ? (s.meta.botState ? 'ok' : 'warn') : 'error'
  const workspaceTone: 'ok' | 'warn' = s?.workspace.hasPrompt ? 'ok' : 'warn'

  const autoCuratorTotal = s?.autocurador.total || 0
  const autoRatio = s?.autocurador.ratioCorrect ?? 0
  const autoTone: 'ok' | 'warn' | 'error' =
    !autoCuratorTotal ? 'warn'
    : autoRatio >= 90 ? 'ok'
    : autoRatio >= 70 ? 'warn'
    : 'error'

  return (
    <section className="flex h-full w-full min-h-0 flex-col overflow-auto bg-[#0c2a47] px-5 py-6 text-white">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#1090D0]/15 text-[#5bbfe5] shadow-[inset_0_0_0_1px_rgba(16,144,208,0.25)]">
            <Bell className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-[22px] font-bold tracking-tight text-slate-50">
              Estado del Sistema
            </h2>
            <p className="text-[12.5px] leading-snug text-slate-300 max-w-3xl">
              Visión general del estado del sistema: mensajería Meta, chats, ventas POS, autocurador, workspace y
              los 6 checks técnicos.
              {dash?.generatedAt ? (
                <> Última actualización: {new Date(dash.generatedAt).toLocaleString('es-MX')}</>
              ) : null}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-[#1a3a5a] bg-[#0b2641] px-3 py-1.5 text-[11.5px] font-semibold text-slate-200 transition hover:border-[#1090D0]/40">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-[#1090D0]"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto-refresh 30s
          </label>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className={cn(
              'inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-[12px] font-bold text-white transition',
              loading
                ? 'border-[#1a3a5a] bg-[#0b2641] text-slate-400'
                : 'border-[#1090D0]/40 bg-[#1090D0]/15 hover:bg-[#1090D0]/25 text-[#7fd2f2]',
            )}
          >
            <RefreshCw className={cn('h-4 w-4', loading ? 'animate-spin' : '')} />
            {loading ? 'Revisando…' : 'Revisar ahora'}
          </button>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl space-y-7">
        <div className={cn('rounded-[22px] border p-5 shadow-lg shadow-black/20', banner.border, banner.bg)}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0 flex-1 max-w-2xl">
              <span className={cn('mb-2 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] font-extrabold uppercase tracking-widest', banner.chip)}>
                <Activity className="h-3 w-3" /> Estado general
              </span>
              <h3 className="text-[19px] font-extrabold text-slate-50">{banner.title}</h3>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-200">{banner.desc}</p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/5 px-4 py-2.5 text-center">
                <p className="font-mono text-[22px] font-extrabold text-emerald-300">{okCount}</p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-200/80">OK</p>
              </div>
              <div className="rounded-xl border border-amber-400/25 bg-amber-400/5 px-4 py-2.5 text-center">
                <p className="font-mono text-[22px] font-extrabold text-amber-200">{warnCount}</p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-amber-100/80">WARN</p>
              </div>
              <div className="rounded-xl border border-rose-500/25 bg-rose-500/5 px-4 py-2.5 text-center">
                <p className="font-mono text-[22px] font-extrabold text-rose-200">{fatalCount}</p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-rose-100/80">ERROR</p>
              </div>
              <div className="rounded-xl border border-slate-400/20 bg-white/[0.03] px-4 py-2.5 text-center">
                <p className="font-mono text-[22px] font-extrabold text-slate-100">{totalCount}</p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-300/80">TOTAL</p>
              </div>
            </div>
          </div>
        </div>

        {error ? (
          <div className="rounded-2xl border border-rose-500/25 bg-rose-500/[0.06] p-4">
            <div className="flex items-start gap-3">
              <XCircle className="mt-0.5 h-5 w-5 text-rose-300" />
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-bold text-rose-100">No se pudo consultar el API de estado</p>
                <p className="mt-1 break-all text-[12px] leading-relaxed text-rose-200">{error}</p>
                <button
                  type="button"
                  onClick={() => void load()}
                  className="mt-3 inline-flex items-center gap-2 rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-[11.5px] font-bold text-rose-100 transition hover:bg-rose-500/15"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Reintentar
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* KPIs Quick row */}
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            title="Mensajes hoy"
            value={dash ? fmtCount(dash.stats.messages.today) : '—'}
            hint="Entrantes + salientes en las últimas 24h naturales"
            Icon={MessageCircle}
            tone="info"
            badge="CRM"
          />
          <KpiCard
            title="Chats sin leer"
            value={dash ? fmtCount(dash.stats.chats.unread) : '—'}
            hint="Conversaciones con al menos 1 mensaje nuevo"
            Icon={Eye}
            tone={dash && dash.stats.chats.unread > 0 ? 'warn' : 'ok'}
            badge={dash && dash.stats.chats.unread > 0 ? 'Pendientes' : 'Al día'}
          />
          <KpiCard
            title="Ventas hoy"
            value={dash ? currency(dash.stats.pos.salesToday) : '—'}
            hint={dash ? `${dash.stats.pos.salesCountToday} venta(s) · ${currency(dash.stats.pos.salesMonth)} mes` : ''}
            Icon={ShoppingCart}
            tone="ok"
            badge="POS"
          />
          <KpiCard
            title={dash?.stats.pos.openShiftId ? 'Turno abierto' : 'Sin turno abierto'}
            value={dash?.stats.pos.openShiftId ? fmtCount(dash.stats.pos.openShiftSalesCount) + ' ventas' : '—'}
            hint={dash?.stats.pos.openShiftId ? currency(dash.stats.pos.openShiftSalesTotal) : 'Abre caja para empezar operaciones'}
            Icon={Store}
            tone={dash?.stats.pos.openShiftId ? 'ok' : 'warn'}
            badge={dash?.stats.pos.branches ? dash.stats.pos.branches + ' sucursal(es)' : 'POS'}
          />
        </div>

        {/* Messenger stats */}
        <div className="rounded-[22px] border border-[#1a3a5a] bg-[#0f3151] p-5 shadow-lg shadow-black/15">
          <SectionTitle
            icon={Facebook}
            title="Messenger · Chats y mensajería"
            hint="Estado general de la conexión Facebook y métricas mensajes recibidos/enviados, chats activos."
          />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
            <div className={cn('rounded-[18px] border p-4', toneBox(metaTone))}>
              <div className="flex items-center justify-between">
                <p className="text-[10.5px] font-extrabold uppercase tracking-[0.2em] text-slate-300">Página Facebook</p>
                <StatusDot ok={s?.meta.linked && !s.meta.testMode} warn={!s?.meta.linked} />
              </div>
              <p className={cn('mt-2 truncate text-[15px] font-extrabold leading-tight', toneText(metaTone))}>
                {s?.meta.pageName || 'Sin vincular'}
              </p>
              <p className="mt-1 truncate font-mono text-[10.5px] text-slate-300">
                {s?.meta.linked ? `pageId ${s.meta.pageId || '—'}` : 'Abre Conectar Messenger para vincular'}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Stat label="Estado bot" value={s?.meta.botState ? 'RUNNING' : (s?.meta.linked ? 'PAUSA' : '—')} tone={s?.meta.botState ? 'ok' : (s?.meta.linked ? 'warn' : 'error')} />
                <Stat label="Test Mode" value={s?.meta.testMode ? 'ON' : 'OFF'} tone={s?.meta.testMode ? 'warn' : 'ok'} />
              </div>
            </div>
            <KpiCard title="Mensajes total" value={s ? fmtCount(s.messages.total) : '—'} hint="Histórico completo (todos los chats)" Icon={MessageCircle} tone="info" />
            <KpiCard title="Recibidos · Hoy" value={s ? fmtCount(s.messages.todayReceived) : '—'} hint={`Total recibidos ${fmtCount(s?.messages.receivedTotal || 0)}`} Icon={Users} tone="info" />
            <KpiCard title="Enviados · Hoy" value={s ? fmtCount(s.messages.todaySent) : '—'} hint={`Total enviados ${fmtCount(s?.messages.sentTotal || 0)}`} Icon={BadgeCheck} tone="ok" />
          </div>
          <div className="mt-3.5 grid grid-cols-1 gap-3 md:grid-cols-3">
            <Stat label="Chats total" value={s ? fmtCount(s.chats.total) : '—'} tone="info" />
            <Stat label="Chats activos 24h" value={s ? fmtCount(s.chats.active24h) : '—'} tone={s && s.chats.active24h > 0 ? 'ok' : 'warn'} />
            <Stat label="Bloqueados por Autocurador" value={s ? fmtCount(s.messages.blockedByAutocurador) : '—'} tone={s && s.messages.blockedByAutocurador > 0 ? 'warn' : 'ok'} />
          </div>
        </div>

        {/* POS */}
        <div className="rounded-[22px] border border-[#1a3a5a] bg-[#0f3151] p-5 shadow-lg shadow-black/15">
          <SectionTitle
            icon={ShoppingCart}
            title="POS · Ventas y turnos"
            hint="Métricas de ventas históricas, mes, hoy y estado actual de caja."
          />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
            <KpiCard title="Ventas total histórico" value={s ? currency(s.pos.salesTotal) : '—'} hint={`${fmtCount(s?.pos.salesCount || 0)} operaciones registradas`} Icon={ShoppingCart} tone="ok" />
            <KpiCard title="Ventas del mes" value={s ? currency(s.pos.salesMonth) : '—'} hint={`${fmtCount(s?.pos.salesCountMonth || 0)} ticket(s)`} Icon={CalendarDays} tone="info" />
            <KpiCard title="Ventas de hoy" value={s ? currency(s.pos.salesToday) : '—'} hint={`${fmtCount(s?.pos.salesCountToday || 0)} ticket(s)`} Icon={Sparkles} tone="ok" />
            <KpiCard title="Turno actual" value={s?.pos.openShiftId ? 'ABIERTO' : 'CERRADO'} hint={s?.pos.openShiftId ? `${fmtCount(s.pos.openShiftSalesCount)} ven · ${currency(s.pos.openShiftSalesTotal)}` : `Sucursales: ${s?.pos.branches || 0}`} Icon={Store} tone={s?.pos.openShiftId ? 'ok' : 'warn'} />
          </div>
        </div>

        {/* Autocurador + Workspace + Auditoría */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="rounded-[22px] border border-[#1a3a5a] bg-[#0f3151] p-5 shadow-lg shadow-black/15">
            <SectionTitle
              icon={Bot}
              title="Autocurador · Calidad"
              hint="Categorías de las últimas 500 evaluaciones del Juez LLM y ratio de respuestas correctas."
            />
            <div className="space-y-4">
              <div className={cn('rounded-[18px] border p-4', toneBox(autoTone))}>
                <div className="flex items-center justify-between">
                  <p className="text-[10.5px] font-extrabold uppercase tracking-[0.2em] text-slate-300">
                    Respuestas correctas
                  </p>
                  <ShieldAlert className={cn('h-4 w-4', autoTone === 'ok' ? 'text-emerald-300' : autoTone === 'warn' ? 'text-amber-200' : 'text-rose-200')} />
                </div>
                <p className={cn('mt-1 font-mono text-[28px] font-black leading-tight', toneText(autoTone))}>
                  {autoCuratorTotal ? autoRatio + '%' : '—'}
                </p>
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-black/25">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all duration-500',
                      autoTone === 'ok' ? 'bg-emerald-500/80' : autoTone === 'warn' ? 'bg-amber-400/80' : 'bg-rose-500/80',
                    )}
                    style={{ width: `${Math.max(0, Math.min(100, autoCuratorTotal ? autoRatio : 0))}%` }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Evaluaciones" value={s ? fmtCount(s.autocurador.total) : '—'} tone="info" />
                <Stat label="Correctas" value={s ? fmtCount(s.autocurador.correct) : '—'} tone="ok" />
                <Stat label="En error" value={s ? fmtCount(s.autocurador.error) : '—'} tone={s && s.autocurador.error > 0 ? 'error' : 'ok'} />
                <Stat label="Sin info" value={s ? fmtCount(s.autocurador.noinfo) : '—'} tone="warn" />
              </div>
              <Stat
                label="Juez LLM falló (no parse)"
                value={s ? fmtCount(s.autocurador.judgeFailed) : '—'}
                tone={s && s.autocurador.judgeFailed > 0 ? 'warn' : 'ok'}
              />
            </div>
          </div>

          <div className="space-y-5">
            <div className="rounded-[22px] border border-[#1a3a5a] bg-[#0f3151] p-5 shadow-lg shadow-black/15">
              <SectionTitle
                icon={FileText}
                title="Workspace · Prompt y documentos"
                hint="Conocimiento base del bot: prompt system y documentos RAG activos."
              />
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <KpiCard
                  title="Prompt chars"
                  value={s ? fmtCount(s.workspace.promptChars) : '—'}
                  hint={s?.workspace.hasPrompt ? 'Prompt configurado OK' : 'Muy corto / sin prompt'}
                  Icon={Sparkles}
                  tone={workspaceTone}
                  badge="System"
                />
                <KpiCard
                  title="Documentos RAG"
                  value={s ? fmtCount(s.workspace.documentsCount) : '—'}
                  hint="Fuentes de conocimiento usadas por el bot"
                  Icon={FileText}
                  tone={s && s.workspace.documentsCount > 0 ? 'ok' : 'warn'}
                  badge="Docs"
                />
              </div>
            </div>

            <div className="rounded-[22px] border border-[#1a3a5a] bg-[#0f3151] p-5 shadow-lg shadow-black/15">
              <SectionTitle
                icon={ScrollText}
                title="Auditoría · Actividad"
                hint="Actividad observada en las últimas 2000 líneas de auditoría."
              />
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Inicios sesión 24h" value={s ? fmtCount(s.audit.logins24h) : '—'} tone="info" />
                <Stat label="Ventas creadas" value={s ? fmtCount(s.audit.salesCreated) : '—'} tone="ok" />
                <Stat label="Turnos abiertos" value={s ? fmtCount(s.audit.shiftsOpened) : '—'} tone="info" />
                <Stat label="Turnos cerrados" value={s ? fmtCount(s.audit.shiftsClosed) : '—'} tone="ok" />
                <Stat label="Retiros caja" value={s ? fmtCount(s.audit.withdrawals) : '—'} tone={s && s.audit.withdrawals > 0 ? 'warn' : 'ok'} />
                <Stat label="Auditoría líneas" value={s ? fmtCount(s.audit.last2000) : '—'} tone="info" />
              </div>
            </div>
          </div>
        </div>

        {/* Checks del sistema (expandibles) */}
        <div className="rounded-[22px] border border-[#1a3a5a] bg-[#0f3151] p-5 shadow-lg shadow-black/15">
          <SectionTitle
            icon={Server}
            title="Checks técnicos · Estado servicios"
            hint="Revisión en tiempo real de los 6 servicios críticos. Cada tarjeta se puede expandir para ver detalle y raw JSON."
          />
          {!overview && loading ? (
            <div className="space-y-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="animate-pulse rounded-2xl border border-[#1a3a5a] bg-[#0b2641]/70 p-4"
                >
                  <div className="flex items-start gap-4">
                    <div className="h-11 w-11 rounded-[14px] bg-[#1a3a5a]" />
                    <div className="min-w-0 flex-1 space-y-2.5">
                      <div className="h-3 w-1/3 rounded bg-[#1a3a5a]" />
                      <div className="h-2.5 w-1/2 rounded bg-[#1a3a5a]/80" />
                      <div className="h-2.5 w-2/3 rounded bg-[#1a3a5a]/60" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {overview?.checks.map((c, i) => <CheckRow c={c} key={i} index={i} />)}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="rounded-2xl border border-[#1a3a5a] bg-[#0f3151] p-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-slate-300">
            <p className="font-semibold text-slate-100">Cómo leer los checks:</p>
            <p>🟢 Todo operativo · Sin errores.</p>
            <p>🟡 Advertencia · No bloqueante pero requiere atención.</p>
            <p>🔴 Error crítico · Servicio caído, sin configurar o no alcanzable.</p>
            <p className="ml-auto text-slate-400">
              Actualización automática cada 30s si la opción está activa · Panel hecho con Express + Zustand + Lucide.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
