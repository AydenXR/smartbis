import { useEffect, useRef, useState } from 'react'
import {
  Facebook,
  Plug,
  PlugZap,
  HandCoins,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  Megaphone,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MetaBotState, MetaStatusResponse } from '@/lib/api'

type CrmSettingsViewProps = {
  status: MetaStatusResponse | null
  loadingStatus: boolean
  errorStatus: string
  onRefresh: () => Promise<void>
  onGetOAuthUrl: () => Promise<string>
  onRetryPages: () => Promise<{ pages: any[] }>
  onLinkManual: (input: { pageId: string; pageName?: string; pageAccessToken: string }) => Promise<{ success: boolean; subscribed: boolean; pageId: string; pageName: string }>
  onSetState: (next: { state?: MetaBotState; testMode?: boolean; autocuratorEnabled?: boolean }) => Promise<any>
  onSyncAds: () => Promise<{ ads: number; accountsChecked: number }>
  APP_ID: string
  graphVersion?: string
}

/**
 * Decode base64url (RFC 4648 §5) JSON string → any[].
 * Browser-safe, NO usa Buffer.from(..., 'base64url') porque ese encoding
 * NO existe en el Buffer polyfill del SPA (era la causa del error rojo
 * "No se pudo decodificar el listado de páginas FB").
 *
 * Transforma: - → +, _ → /, padding = agregado automático, decodifica UTF-8
 */
function decodeBase64urlJson<T = any>(input: string): T {
  let b64 = String(input || '').trim()
  if (!b64) throw new Error('fbpages vacío')
  b64 = b64.replace(/-/g, '+').replace(/_/g, '/')
  while (b64.length % 4 !== 0) b64 += '='
  const binary: string = (typeof globalThis !== 'undefined' && typeof (globalThis as any).atob === 'function')
    ? (globalThis as any).atob(b64)
    : Buffer.from(b64, 'base64').toString('binary')
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const utf8 = new TextDecoder('utf-8').decode(bytes)
  return JSON.parse(utf8) as T
}

export default function CrmSettingsView(props: CrmSettingsViewProps) {
  const {
    status,
    loadingStatus,
    errorStatus,
    onRefresh,
    onGetOAuthUrl,
    onRetryPages,
    onLinkManual,
    onSetState,
    onSyncAds,
    APP_ID,
    graphVersion,
  } = props

  const [loadingLoginUrl, setLoadingLoginUrl] = useState(false)
  const [loadingSave, setLoadingSave] = useState(false)
  const [lastSaved, setLastSaved] = useState<{ ok: boolean; text: string } | null>(null)
  const [fbPagesFetched, setFBPagesFetched] = useState<any[] | null>(null)
  const [fbPageSelectedIdx, setFBPageSelectedIdx] = useState<number | null>(null)
  const [canRetryPages, setCanRetryPages] = useState(false)
  const [retryingPages, setRetryingPages] = useState(false)
  const [syncingAds, setSyncingAds] = useState(false)
  const [adsSyncStatus, setAdsSyncStatus] = useState<{ ok: boolean; text: string } | null>(null)

  const callbacksRef = useRef({ onLinkManual, onRefresh, onSetState })
  callbacksRef.current = { onLinkManual, onRefresh, onSetState }

  useEffect(() => {
    const onLinkManual: typeof callbacksRef.current.onLinkManual = (inp) => callbacksRef.current.onLinkManual(inp)
    const onRefresh = () => callbacksRef.current.onRefresh().catch(() => {})
    const onSetState: typeof callbacksRef.current.onSetState = (inp) => callbacksRef.current.onSetState(inp)

    let mounted = true
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null

    const applyOAuthPayload = async (raw: {
      fbpages?: string | null
      pages?: string | null
      llt_ok?: string | null
      stateSaved?: string | null
      sel_ok?: string | null
      error?: string | null
      pages_error?: string | null
      pages_empty?: string | null
    }) => {
      if (!mounted) return
      const pagesB64 = raw.fbpages || raw.pages || null
      const lltOk = raw.llt_ok || null
      const stateSaved = raw.stateSaved || null
      const selOk = raw.sel_ok || null
      const pagesErr = raw.pages_error ? decodeURIComponent(String(raw.pages_error)) : null
      const pagesEmpty = raw.pages_empty === '1'

      if (stateSaved === '1' || selOk === '1') {
        setLastSaved({ ok: true, text: 'Página conectada.' })
        return
      }
      const err = raw.error
      if (err) {
        let pretty = err
        try { pretty = decodeURIComponent(err) } catch {}
        setLastSaved({
          ok: false,
          text: 'OAuth FB cancelado o con error: ' + pretty,
        })
        return
      }
      if (pagesErr) {
        setCanRetryPages(lltOk === '1')
        setLastSaved({
          ok: false,
          text: '⚠️ Error de Facebook al consultar tus páginas. Detalle: ' + pagesErr,
        })
        return
      }
      if (pagesEmpty) {
        setCanRetryPages(false)
        setLastSaved({
          ok: false,
          text: '⚠️ Tu cuenta Facebook no devolvió páginas para esta App. Revisa que el perfil tenga acceso a la página y autoriza los permisos solicitados, incluido ads_management.',
        })
        return
      }
      if (lltOk === '1' && pagesB64) {
        try {
          const pages = decodeBase64urlJson<any[]>(pagesB64)
          if (Array.isArray(pages) && pages.length > 0) {
            setCanRetryPages(false)
            setFBPagesFetched(pages)
            if (pages.length === 1) {
              const only = pages[0] as any
              setFBPageSelectedIdx(0)
              setLoadingSave(true)
              setLastSaved(null)
              try {
                const r = await onLinkManual({
                  pageId: only.id,
                  pageName: only.name,
                  pageAccessToken: only.access_token,
                })
                setLastSaved({
                  ok: r.success,
                  text: r.success
                    ? `✅ Página ${r.pageName} conectada y webhook suscrito.`
                    : 'Error guardando la página.',
                })
                if (r.success) {
                  try { await onSetState({ state: 'START' }) } catch (_) {}
                  try { await onRefresh() } catch (_) {}
                  const u = new URL(window.location.href)
                  u.searchParams.set('sel_ok', '1')
                  window.history.replaceState({}, '', u.toString())
                }
              } catch (e: any) {
                setLastSaved({ ok: false, text: e?.message || 'Error al guardar.' })
              } finally {
                setLoadingSave(false)
              }
            } else {
              setFBPageSelectedIdx(0)
            }
          } else {
            setLastSaved({
              ok: false,
              text: '⚠️ No se encontraron páginas. Abre Facebook, revisa en Configuración → Integraciones → Smartbis, y asegúrate de haber otorgado permiso sobre al menos una página. Luego vuelve a iniciar sesión.',
            })
          }
        } catch (e: any) {
          const why = e?.message ? ` (${e.message.replace(/base64|utf|atob|json/gi, (m: string) => m.toUpperCase()).slice(0, 80)})` : ''
          setLastSaved({ ok: false, text: 'No se pudo decodificar el listado de páginas FB.' + why })
        }
      }
    }

    void onRefresh()

    const tick = () => {
      if (cancelled) return
      try { void onRefresh() } catch {}
    }
    timer = setInterval(tick, 8000)

    const q = new URLSearchParams(window.location.search)
    void applyOAuthPayload({
      fbpages: q.get('fbpages'),
      pages: q.get('pages'),
      llt_ok: q.get('llt_ok'),
      stateSaved: q.get('stateSaved'),
      sel_ok: q.get('sel_ok'),
      error: q.get('error'),
      pages_error: q.get('pages_error'),
      pages_empty: q.get('pages_empty'),
    })
    const url = new URL(window.location.href)
    const hadQuery =
      url.searchParams.has('fbpages') ||
      url.searchParams.has('pages') ||
      url.searchParams.has('llt_ok') ||
      url.searchParams.has('stateSaved') ||
      url.searchParams.has('error') ||
      url.searchParams.has('sel_ok') ||
      url.searchParams.has('pages_error') ||
      url.searchParams.has('pages_empty')
    if (hadQuery) {
      url.searchParams.delete('fbpages')
      url.searchParams.delete('pages')
      url.searchParams.delete('llt_ok')
      url.searchParams.delete('stateSaved')
      url.searchParams.delete('error')
      url.searchParams.delete('sel_ok')
      url.searchParams.delete('pages_error')
      url.searchParams.delete('pages_empty')
      window.history.replaceState({}, '', url.toString())
    }

    function onMessage(ev: MessageEvent) {
      if (!ev || !ev.data || typeof ev.data !== 'object') return
      const d = ev.data as any
      if (d?.source !== 'smartbis_fb_oauth') return
      void applyOAuthPayload({
        fbpages: d.fbpages || null,
        pages: d.pages || null,
        llt_ok: d.llt_ok || null,
        stateSaved: d.stateSaved || null,
        sel_ok: d.sel_ok || null,
        error: d.error || null,
        pages_error: d.pages_error || null,
        pages_empty: d.pages_empty || null,
      })
    }
    window.addEventListener('message', onMessage)
    return () => {
      mounted = false
      cancelled = true
      if (timer) clearInterval(timer)
      window.removeEventListener('message', onMessage)
    }
  }, [])

  function handleSelectFetchedPage(i: number) {
    if (!fbPagesFetched) return
    setFBPageSelectedIdx(i)
  }

  async function handleOAuthUrlClick() {
    setLoadingLoginUrl(true)
    try {
      const url = await onGetOAuthUrl()
      window.open(
        url,
        'smartbis_fb_oauth_popup',
        'width=880,height=760,resizable=yes,scrollbars=yes,status=no,menubar=no,toolbar=no',
      )
    } catch (e: any) {
      setLastSaved({ ok: false, text: e?.message || 'No se pudo iniciar la conexión con Facebook.' })
    } finally {
      setLoadingLoginUrl(false)
    }
  }

  async function handleRetryPages() {
    setRetryingPages(true)
    try {
      const result = await onRetryPages()
      const pages = Array.isArray(result.pages) ? result.pages : []
      if (pages.length === 0) {
        setLastSaved({ ok: false, text: 'Facebook no devolvió páginas para esta cuenta. Revisa que el perfil tenga acceso a la página.' })
        return
      }
      setFBPagesFetched(pages)
      setFBPageSelectedIdx(0)
      setCanRetryPages(false)
      setLastSaved({ ok: true, text: `Facebook devolvió ${pages.length} página(s). Confirma la página seleccionada para conectarla.` })
    } catch (e: any) {
      setLastSaved({ ok: false, text: e?.message || 'No se pudieron volver a consultar las páginas.' })
    } finally {
      setRetryingPages(false)
    }
  }

  return (
    <section className="h-full w-full overflow-y-auto bg-[radial-gradient(ellipse_at_top,_#123c61_0%,_#0c2a47_55%)] px-4 py-6 tech-scrollbar sm:px-6">
      <div className="mx-auto w-full max-w-5xl space-y-5">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#1877F2]/25 bg-[#1877F2]/10 text-[#60A5FA]">
              <Facebook className="h-5 w-5" />
            </div>
            <h2 className="text-lg font-semibold tracking-tight text-white">Conectar Messenger</h2>
          </div>
          <span className={cn(
            'shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-semibold',
            status?.linked
              ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200'
              : 'border-slate-400/20 bg-slate-400/5 text-slate-300',
          )}>
            {status?.linked ? 'Conectada' : 'Sin conectar'}
          </span>
        </header>

        {errorStatus ? (
          <div className="flex items-start gap-2 rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-[12px] text-rose-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">Error cargando estado del bot</p>
              <p>{errorStatus}</p>
            </div>
          </div>
        ) : null}

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.85fr)]">
          <div className="rounded-3xl border border-[#255078] bg-[#0f3151]/90 p-5 shadow-xl shadow-black/10 sm:p-7">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-white">Página de Facebook</h3>
                {status?.linked && status.pageName ? (
                  <p className="mt-1.5 text-sm text-slate-300">{status.pageName}</p>
                ) : null}
              </div>
              <span className={cn(
                'shrink-0 rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-wide',
                status?.linked
                  ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
                  : 'border-amber-400/30 bg-amber-400/10 text-amber-200',
              )}>
                {status?.linked ? 'Conectada' : 'Sin conectar'}
              </span>
            </div>

            {lastSaved ? (
              <div
                role="status"
                className={cn(
                  'mb-4 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-[12px]',
                  lastSaved.ok
                    ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200'
                    : 'border-rose-400/20 bg-rose-400/10 text-rose-200',
                )}
              >
                {lastSaved.ok ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <span>{lastSaved.text}</span>
              </div>
            ) : null}

            {canRetryPages ? (
              <button
                type="button"
                onClick={() => void handleRetryPages()}
                disabled={retryingPages}
                className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl border border-[#1090D0]/40 bg-[#1090D0]/10 px-4 py-2.5 text-[12px] font-semibold text-[#9bd8f5] transition hover:bg-[#1090D0]/20 disabled:opacity-50"
              >
                {retryingPages ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
                Reintentar consulta de páginas
              </button>
            ) : null}

            <div className="space-y-4">
              {fbPagesFetched && fbPagesFetched.length > 0 ? (
                <div className="rounded-2xl border border-[#255078] bg-[#0b2945]/60 p-4">
                  <p className="mb-3 text-[11px] font-semibold text-slate-300">
                    Selecciona la página que quieres conectar
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {fbPagesFetched.map((p: any, i: number) => (
                      <button
                        type="button"
                        key={p.id || String(i)}
                        aria-pressed={fbPageSelectedIdx === i}
                        onClick={() => handleSelectFetchedPage(i)}
                        className={cn(
                          'flex min-w-0 items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition',
                          fbPageSelectedIdx === i
                            ? 'border-[#1090D0]/50 bg-[#1090D0]/15 text-white'
                            : 'border-[#1a3a5a] bg-[#11375a] text-slate-200 hover:border-[#1090D0]/40 hover:bg-[#133d61]',
                        )}
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-black/30 text-slate-400">
                          {p?.picture?.data?.url ? (
                            <img
                              src={p.picture.data.url as string}
                              alt=""
                              className="h-9 w-9 rounded-full object-cover"
                            />
                          ) : (
                            <Facebook className="h-4 w-4" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-semibold">{p?.name || `Página ${i + 1}`}</p>
                          {p?.id ? (
                            <p className="truncate font-mono text-[10px] text-slate-400/80">
                              ID {String(p.id).slice(0, 8)}…
                            </p>
                          ) : null}
                        </div>
                        {fbPageSelectedIdx === i ? (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-[#1090D0]" />
                        ) : null}
                      </button>
                    ))}
                  </div>
                  {fbPageSelectedIdx !== null ? (
                    <button
                      type="button"
                      onClick={() => void (async () => {
                        const p: any = fbPagesFetched[fbPageSelectedIdx as number]
                        if (!p) return
                        setLoadingSave(true)
                        setLastSaved(null)
                        try {
                          const r = await onLinkManual({
                            pageId: p.id,
                            pageName: p.name,
                            pageAccessToken: p.access_token,
                          })
                          setLastSaved({
                            ok: r.success,
                            text: r.success
                              ? `✅ Página ${r.pageName} conectada correctamente.`
                              : 'Error guardando la página.',
                          })
                          if (r.success) {
                            try { await onSetState({ state: 'START' }) } catch (_) {}
                            try { await onRefresh() } catch (_) {}
                            const u = new URL(window.location.href)
                            u.searchParams.set('sel_ok', '1')
                            window.history.replaceState({}, '', u.toString())
                          }
                        } catch (e: any) {
                          setLastSaved({ ok: false, text: e?.message || 'Error al guardar.' })
                        } finally {
                          setLoadingSave(false)
                        }
                      })()}
                      disabled={loadingSave}
                      className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[#1090D0] px-4 py-3 text-[13px] font-semibold text-white shadow-lg shadow-[#1090D0]/15 transition hover:bg-[#0c79ae] disabled:opacity-50"
                    >
                      {loadingSave ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                      Conectar página seleccionada
                    </button>
                  ) : null}
                </div>
              ) : null}

              <button
                type="button"
                onClick={handleOAuthUrlClick}
                disabled={loadingLoginUrl}
                className="group flex w-full items-center justify-center gap-3 rounded-xl bg-[#1877F2] px-5 py-3.5 text-[13px] font-semibold text-white shadow-lg shadow-[#1877F2]/20 transition hover:bg-[#166FE5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f3151] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Facebook className="h-4 w-4" />
                {loadingLoginUrl ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {fbPagesFetched && fbPagesFetched.length > 0 ? 'Volver a iniciar sesión con Facebook' : 'Iniciar sesión con Facebook'}
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <StatusSummaryCard status={status} />
            <QuickControls status={status} onSetState={onSetState} />

            <div className="rounded-2xl border border-[#1a3a5a] bg-[#0f3151]/80 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between lg:flex-col lg:items-stretch">
                <div>
                  <h3 className="text-[13px] font-semibold text-white">Anuncios</h3>
                  <p className="mt-1 text-[11px] text-slate-300/90">
                    Sincroniza los anuncios de la cuenta conectada.
                  </p>
                  {adsSyncStatus ? (
                    <p role="status" className={cn('mt-2 text-[11px]', adsSyncStatus.ok ? 'text-emerald-200' : 'text-rose-200')}>
                      {adsSyncStatus.text}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  disabled={!status?.linked || syncingAds}
                  onClick={() => void (async () => {
                    setSyncingAds(true)
                    setAdsSyncStatus(null)
                    try {
                      const result = await onSyncAds()
                      setAdsSyncStatus({ ok: true, text: `✅ ${result.ads} anuncios sincronizados de ${result.accountsChecked} cuentas publicitarias. El documento anuncios.md ya está indexado.` })
                    } catch (error: any) {
                      setAdsSyncStatus({ ok: false, text: error?.message || 'No se pudieron sincronizar los anuncios.' })
                    } finally {
                      setSyncingAds(false)
                    }
                  })()}
                  className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[#1090D0] px-4 py-2.5 text-[12px] font-semibold text-white transition hover:bg-[#0c79ae] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {syncingAds ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
                  {syncingAds ? 'Sincronizando…' : 'Sincronizar anuncios'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function StatusSummaryCard({ status }: { status: MetaStatusResponse | null }) {
  const linked = !!status?.linked
  const testMode = !!status?.testMode
  const rows = [
    {
      label: 'Facebook',
      value: linked ? 'Conectada' : 'Sin conectar',
      ok: linked,
      warn: !linked,
    },
    {
      label: 'Bot',
      value: status?.state === 'START' ? 'Activo' : linked ? 'Pausado' : 'Sin conectar',
      ok: linked && status?.state === 'START',
      warn: !linked || status?.state !== 'START',
    },
    {
      label: 'Modo de prueba',
      value: testMode ? 'Activado' : 'Desactivado',
      ok: !testMode,
      warn: testMode,
    },
    {
      label: 'Autocurador',
      value: status?.autocuratorEnabled ? 'Activado' : 'Desactivado',
      ok: !status?.autocuratorEnabled,
      warn: status?.autocuratorEnabled,
    },
  ]
  return (
    <div className="rounded-2xl border border-[#1a3a5a] bg-[#0f3151]/80 p-4">
      <h3 className="mb-3 text-[13px] font-semibold text-white">Estado de conexión</h3>
      <div className="space-y-2">
        {rows.map((r) => (
          <div
            key={r.label}
            className="flex items-center justify-between gap-3 rounded-xl border border-[#1a3a5a]/70 bg-[#0b2945]/50 px-3 py-2.5"
          >
            <p className="text-[11px] font-medium text-slate-300">{r.label}</p>
            <p
              className={cn(
                'text-[11px] font-semibold',
                r.ok ? 'text-emerald-200' : r.warn ? 'text-amber-200' : 'text-slate-100',
              )}
            >
              {r.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

function QuickControls({
  status,
  onSetState,
}: {
  status: MetaStatusResponse | null
  onSetState: (next: { state?: MetaBotState; testMode?: boolean; autocuratorEnabled?: boolean }) => Promise<any>
}) {
  return (
    <div className="rounded-2xl border border-[#1a3a5a] bg-[#0f3151]/80 p-4">
      <h3 className="mb-3 text-[13px] font-semibold text-white">Automatización</h3>
      <div className="grid grid-cols-1 gap-2">
        <button
          type="button"
          disabled={!status?.linked}
          onClick={() => onSetState({ state: status?.state === 'START' ? 'PAUSE' : 'START' })}
          className={cn(
            'flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition disabled:opacity-50',
            status?.state === 'START'
              ? 'border-emerald-400/30 bg-emerald-400/10 hover:bg-emerald-400/15'
              : 'border-rose-400/30 bg-rose-400/10 hover:bg-rose-400/15',
          )}
        >
          <div className="flex w-full items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/90">
              {status?.state === 'START' ? 'PAUSE BOT' : 'START BOT'}
            </span>
            {status?.state === 'START' ? (
              <Plug className="h-4 w-4 text-emerald-200" />
            ) : (
              <PlugZap className="h-4 w-4 text-rose-200" />
            )}
          </div>
          <p className="text-[11px] text-white/75">
            {status?.state === 'START'
              ? '              Dejar de responder automáticamente'
              : '              Empezar a responder automáticamente'}
          </p>
        </button>
        <button
          type="button"
          disabled={!status?.linked}
          onClick={() => onSetState({ testMode: !status?.testMode })}
          className={cn(
            'flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition disabled:opacity-50',
            status?.testMode
              ? 'border-amber-400/30 bg-amber-400/10 hover:bg-amber-400/15'
              : 'border-[#1a3a5a] bg-[#11375a] hover:bg-[#143f67]',
          )}
        >
          <div className="flex w-full items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/90">
              {status?.testMode ? 'DESACTIVAR TEST' : 'ACTIVAR TEST'}
            </span>
            <HandCoins
              className={cn(
                'h-4 w-4',
                status?.testMode ? 'text-amber-200' : 'text-slate-300',
              )}
            />
          </div>
          <p className="text-[11px] text-white/75">
            {status?.testMode
              ? 'Volver a enviar respuestas a clientes'
              : 'No enviar respuestas, solo revisar en CRM'}
          </p>
        </button>
        <button
          type="button"
          disabled={!status?.linked}
          onClick={() => onSetState({ autocuratorEnabled: !status?.autocuratorEnabled })}
          className={cn(
            'flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition disabled:opacity-50',
            status?.autocuratorEnabled
              ? 'border-violet-400/30 bg-violet-400/10 hover:bg-violet-400/15'
              : 'border-[#1a3a5a] bg-[#11375a] hover:bg-[#143f67]',
          )}
          title={status?.autocuratorEnabled ? 'Desactivar la evaluación automática de las respuestas' : 'Activar la evaluación automática de las respuestas'}
        >
          <div className="flex w-full items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/90">
              {status?.autocuratorEnabled ? 'DESACTIVAR AUTOCURADOR' : 'ACTIVAR AUTOCURADOR'}
            </span>
          </div>
          <p className="text-[11px] text-white/75">
            {status?.autocuratorEnabled
              ? 'Omitir el juez automático antes de responder'
              : 'Revisar automáticamente las respuestas'}
          </p>
        </button>
      </div>
    </div>
  )
}
