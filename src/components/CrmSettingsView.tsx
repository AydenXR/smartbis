import { useEffect, useState } from 'react'
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
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MetaBotState, MetaStatusResponse } from '@/lib/api'

type CrmSettingsViewProps = {
  status: MetaStatusResponse | null
  loadingStatus: boolean
  errorStatus: string
  onRefresh: () => Promise<void>
  onGetOAuthUrl: () => Promise<string>
  onLinkManual: (input: { pageId: string; pageName?: string; pageAccessToken: string }) => Promise<{ success: boolean; subscribed: boolean; pageId: string; pageName: string }>
  onSetState: (next: { state?: MetaBotState; testMode?: boolean }) => Promise<any>
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
    onLinkManual,
    onSetState,
    APP_ID,
    graphVersion,
  } = props

  const [fbLoginUrl, setFbLoginUrl] = useState<string>('')
  const [loadingLoginUrl, setLoadingLoginUrl] = useState(false)
  const [form, setForm] = useState({ pageId: '', pageName: '', pageAccessToken: '' })
  const [loadingSave, setLoadingSave] = useState(false)
  const [lastSaved, setLastSaved] = useState<{ ok: boolean; text: string } | null>(null)
  const [fbPagesFetched, setFBPagesFetched] = useState<any[] | null>(null)
  const [fbPageSelectedIdx, setFBPageSelectedIdx] = useState<number | null>(null)

  useEffect(() => {
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
        setLastSaved({
          ok: true,
          text: 'Conectado. Volviendo a Meta Developers para validar suscripcion webhook o ve directo a Chats.',
        })
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
        setLastSaved({
          ok: false,
          text: '⚠️ Error de Facebook al consultar tus páginas. Detalle: ' + pagesErr,
        })
        return
      }
      if (pagesEmpty) {
        setLastSaved({
          ok: false,
          text: '⚠️ Tu cuenta Facebook NO tiene páginas seleccionadas para esta App. En el diálogo de inicio de sesión asegúrate de MARCAR al menos una página y autorizar los 3 permisos (Mostrar lista de páginas, Administrar páginas, Gestionar mensajes).',
        })
        return
      }
      if (lltOk === '1' && pagesB64) {
        try {
          const pages = decodeBase64urlJson<any[]>(pagesB64)
          if (Array.isArray(pages) && pages.length > 0) {
            setFBPagesFetched(pages)
            if (pages.length === 1) {
              const only = pages[0] as any
              setFBPageSelectedIdx(0)
              setForm({
                pageId: only?.id || '',
                pageName: only?.name || '',
                pageAccessToken: only?.access_token || '',
              })
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
              const first = pages[0] as any
              setForm({
                pageId: first?.id || '',
                pageName: first?.name || '',
                pageAccessToken: first?.access_token || '',
              })
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
  }, [onLinkManual, onRefresh, onSetState])

  function handleSelectFetchedPage(i: number) {
    if (!fbPagesFetched) return
    setFBPageSelectedIdx(i)
    const p: any = fbPagesFetched[i]
    setForm({
      pageId: p?.id || '',
      pageName: p?.name || '',
      pageAccessToken: p?.access_token || '',
    })
  }

  async function handleOAuthUrlClick() {
    setLoadingLoginUrl(true)
    try {
      const url = await onGetOAuthUrl()
      setFbLoginUrl(url)
      window.open(
        url,
        'smartbis_fb_oauth_popup',
        'width=880,height=760,resizable=yes,scrollbars=yes,status=no,menubar=no,toolbar=no',
      )
    } finally {
      setLoadingLoginUrl(false)
    }
  }

  return (
    <section className="flex h-full w-full min-h-0 flex-col gap-4 overflow-hidden bg-[#0c2a47] px-4 py-4">
      <div className="min-h-0 flex-1 overflow-y-auto pr-1 tech-scrollbar">
        <div className="space-y-4">
          {/* Header título sin botón refrescar (estado se actualiza auto) */}
          <header className="rounded-[20px] border border-[#1a3a5a] bg-[#0f3151] px-5 py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1877F2]/20 text-[#60A5FA]">
                <Facebook className="h-4.5 w-4.5" />
              </div>
              <div>
                <h2 className="text-[15px] font-semibold text-white">
                  Conectar Facebook Messenger
                </h2>
                <p className="max-w-2xl text-[11px] text-slate-300/90">
                  Vincula tu página para que el bot responda automáticamente. El estado se
                  actualiza en tiempo real.
                </p>
              </div>
            </div>
          </header>

          {errorStatus ? (
            <div className="flex items-start gap-2 rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-[11px] text-rose-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-semibold">Error cargando estado del bot</p>
                <p>{errorStatus}</p>
              </div>
            </div>
          ) : null}

          {/* 1. Estados arriba */}
          <StatusSummaryCard status={status} />

          {/* 1.5 Controles rápidos (no requieren OAuth) */}
          <QuickControls status={status} onSetState={onSetState} />

          {/* 2. Sección Conectar página Facebook DEBAJO de los estados */}
          <div className="rounded-[20px] border border-[#1a3a5a] bg-[#0f3151] p-4">
            <h3 className="mb-3 text-[13px] font-semibold text-white">
              Conectar página Facebook
            </h3>

            {lastSaved ? (
              <div
                className={cn(
                  'mb-3 flex items-start gap-2 rounded-xl border px-3 py-2 text-[11px]',
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

            <div className="space-y-3.5">
              {/* Selector de páginas OAuth (solo aparece tras login exitoso y hay 1+ páginas) */}
              {fbPagesFetched && fbPagesFetched.length > 0 ? (
                <div className="rounded-xl border border-[#1090D0]/30 bg-[#1090D0]/10 px-4 py-3">
                  <p className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.2em] text-[#6bb8dd]">
                    Selecciona la página que quieres conectar
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {fbPagesFetched.map((p: any, i: number) => (
                      <button
                        type="button"
                        key={p.id || String(i)}
                        onClick={() => handleSelectFetchedPage(i)}
                        className={cn(
                          'flex items-center gap-3 rounded-xl border px-3 py-2 text-left transition',
                          fbPageSelectedIdx === i
                            ? 'border-[#1090D0]/50 bg-[#1090D0]/15 text-white'
                            : 'border-[#1a3a5a] bg-[#11375a] text-slate-200 hover:border-[#1090D0]/40 hover:bg-[#133d61]',
                        )}
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/30 text-slate-400 overflow-hidden">
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
                            <p className="truncate text-[10px] font-mono text-slate-400/80">
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
                      className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[#1090D0] px-4 py-2.5 text-[13px] font-semibold text-white shadow-lg transition hover:bg-[#0c79ae] disabled:opacity-50"
                    >
                      {loadingSave ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                      Conectar página seleccionada
                    </button>
                  ) : null}
                </div>
              ) : null}

              {/* Botón de Iniciar Sesión con Facebook (OAuth) */}
              <button
                type="button"
                onClick={handleOAuthUrlClick}
                disabled={loadingLoginUrl}
                className="group flex w-full items-center justify-center gap-3 rounded-xl bg-[#1877F2] px-5 py-3 text-[13px] font-semibold text-white shadow-lg transition hover:bg-[#166FE5] disabled:opacity-50"
              >
                <Facebook className="h-4 w-4" />
                {loadingLoginUrl ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {fbPagesFetched && fbPagesFetched.length > 0 ? 'Volver a iniciar sesión con Facebook' : 'Iniciar sesión con Facebook'}
              </button>

              {fbLoginUrl ? (
                <p className="break-all rounded-xl border border-[#1a3a5a] bg-[#0b2540] px-3 py-2 font-mono text-[10px] text-slate-400">
                  Login URL: <span className="text-[#6bb8dd]">{fbLoginUrl.slice(0, 140)}</span>…
                </p>
              ) : null}
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
      label: 'Página Facebook',
      value: linked ? 'Conectado' : 'No conectado',
      ok: linked,
      warn: !linked,
    },
    {
      label: 'Estado del bot',
      value: linked ? 'Conectado' : 'No conectado',
      ok: linked,
      warn: !linked,
    },
    {
      label: 'Test Mode',
      value: testMode ? 'ON' : 'OFF',
      ok: !testMode,
      warn: testMode,
    },
  ]
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((r) => (
        <div
          key={r.label}
          className={cn(
            'rounded-[16px] border p-3.5',
            r.ok
              ? 'border-emerald-400/25 bg-emerald-400/10'
              : r.warn
                ? 'border-amber-400/25 bg-amber-400/10'
                : 'border-[#1a3a5a] bg-[#0f3151]',
          )}
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300/80">
            {r.label}
          </p>
          <p
            className={cn(
              'mt-1 text-[13px] font-semibold leading-snug',
              r.ok
                ? 'text-emerald-200'
                : r.warn
                  ? 'text-amber-200'
                  : 'text-slate-100',
            )}
          >
            {r.value}
          </p>
        </div>
      ))}
    </div>
  )
}

function QuickControls({
  status,
  onSetState,
}: {
  status: MetaStatusResponse | null
  onSetState: (next: { state?: MetaBotState; testMode?: boolean }) => Promise<any>
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={!status?.linked}
          onClick={() => onSetState({ state: status?.state === 'START' ? 'PAUSE' : 'START' })}
          className={cn(
            'flex flex-col items-start gap-1 rounded-[16px] border p-3.5 text-left transition disabled:opacity-50',
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
              ? 'Dejar de contestar automáticamente'
              : 'Empezar a contestar automáticamente'}
          </p>
        </button>
        <button
          type="button"
          disabled={!status?.linked}
          onClick={() => onSetState({ testMode: !status?.testMode })}
          className={cn(
            'flex flex-col items-start gap-1 rounded-[16px] border p-3.5 text-left transition disabled:opacity-50',
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
      </div>
    </div>
  )
}
