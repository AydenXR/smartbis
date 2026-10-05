import { useEffect, useMemo, useState } from 'react'
import { LogOut, Info, ChevronDown, Download, PackageCheck } from 'lucide-react'
import CrmPosView from '@/components/CrmPosView'
import AuthPanel from '@/components/AuthPanel'
import type { AuthUser, WorkspacePayload } from '@/types/app'
import { saveStoredToken, clearStoredToken, resolveApiUrl } from '@/lib/api'

type DesktopPosShellProps = {
  user: AuthUser
  workspace: WorkspacePayload
  onLogout: () => Promise<void>
  onSavePrompt: (prompt: string) => Promise<void>
  onCreateDocument: (input: { fileName: string; content: string }) => Promise<unknown>
  onUpdateDocument: (currentFileName: string, input: { fileName: string; content: string }) => Promise<unknown>
  onDeleteDocument: (fileName: string) => Promise<void>
  onSendChatMessage: (message: string, history: Array<{ role: 'user' | 'assistant'; content: string }>) => Promise<string>
}

function DesktopPosShell({ user, onLogout }: DesktopPosShellProps) {
  const [loginMode, setLoginMode] = useState<'login' | 'register'>('login')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [authError, setAuthError] = useState('')
  const [isReady, setIsReady] = useState(false)
  const [desktopRuntime, setDesktopRuntime] = useState<{ isDesktop?: boolean; apiBase?: string; isDev?: boolean } | null>(null)
  const [updateAvailable, setUpdateAvailable] = useState<{ version?: string; downloaded?: boolean } | null>(null)
  const [updateDownloaded, setUpdateDownloaded] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null)
  const [showUpdateDialog, setShowUpdateDialog] = useState(false)
  const [showPatchNotes, setShowPatchNotes] = useState(false)
  const [isActingOnUpdate, setIsActingOnUpdate] = useState(false)

  const patchNotesDefault = `Smartbis POS v0.55.0

- Bot Salubel: nueva lógica de validación de ubicación obligatoria (México vs Internacional). Clientes en México: Santander, OXXO, Banamex. Internacionales: solo Stripe y PayPal (nunca cuentas mexicanas).
- Enlaces Stripe dinámicos según precio del curso: $895 MXN y $595 MXN.
- Listados de productos simplificados: solo NOMBRE y PRECIO al principio. El bot ya no entrega SKU, Unidad ni Categoría a menos que el cliente lo pida explícitamente.
- Conciencia temporal: inyección de fecha/hora actual en zona Sonora/Arizona para que el bot nunca ofrezca cursos de fechas pasadas.
- Información de pagos y productos centralizada en código como "verdad absoluta" para coherencia total.
- Todas las respuestas de pago cierran invitando a enviar comprobante al WhatsApp +52 1 662 335 8779.
- Piso #6 Actualizaciones rediseñado: 3 botones paso a paso (1. Verificar, 2. Descargar, 3. Instalar y reiniciar) con barra de progreso y estado en tiempo real. Ya no hace falta cerrar y abrir solo para actualizar: cliente entra al piso #6 y pulsa los botones.
- Instalador install-smartbis.bat actualizado: ahora lee latest.yml de forma dinámica y siempre descarga la versión más reciente (ya no trae URL hardcodeada).

Smartbis POS v0.50.0

- FIX CRITICO: modal ya NO aparece cuando version feed == version instalada. Se compara semver major.minor.patch (0.49.0 vs 0.49.0 = NO mostrar). Antes marcaba updateAvailable=true siempre que el server devolviera updateInfo, lo que repetia el modal al abrir cada 3s aunque no hubiera actualizacion nueva.
- FIX CRITICO: cuando el usuario pulsa "No, continuar" se guarda en la sesion la version declinada. El safety polling deja de reabrir el mismo modal por esta sesion (la proxima vez que cierres y abras volvera a preguntar, como dice el texto).
- FIX CRITICO: descarga "0% para siempre" arreglada. Antes se intentaba descargar la MISMA version; electron-updater cancelaba. Ahora el handler app:download-update devuelve error inmediato si no hay version mayor que la instalada.
- FIX CRITICO: semver compare implementado en BOTH renderer + main process como doble capa de proteccion. Nunca mas modal de misma version.
- Nuevo ipc app:decline-update en preload.js + DesktopPosShell call al pulsar No, continuar.

Smartbis POS v0.49.0

- FIX CRITICO SyntaxError main.js: eliminadas anotaciones TypeScript inline (channel: string, error: any, latestUpdateInfo: any) de electron/main.js (archivo .js Puro ESM sin transpilacion). En 0.48.0 esto rompia el arranque por completo (Error Unexpected token ':' en main process).
- FIX CRITICO eliminados handlers duplicados (ipcMain.handle check / restart / download y autoUpdater.on check/update-available) que aparecian 2 veces al final del main.js y causaban doble envio de eventos.
- Validacion extra: main.js ahora carga sin errores de parseo Node ESM.

Smartbis POS v0.48.0

- FIX CRITICO Updater: eliminada funcion nativa checkForUpdatesAndNotify() que abria notificaciones Windows y no mostraba modal. Ahora el flujo es 100% manual: modal Si / Mas tarde DENTRO de la app.
- FIX CRITICO Race condition: toda la configuracion de autoUpdater (autoDownload=false, setFeedURL, listeners) se ejecuta ANTES de crear la ventana para nunca perder eventos IPC. Nunca más fallo silencioso al abrir.
- FIX CRITICO Safety Polling: primer check de actualizaciones INMEDIATO al abrir (0 ms) + reintento cada 3s durante 60s. El modal aparece garantizado sin excepciones aunque el renderer no escapa el primer evento.
- Logs detallados al actualizar en el archivo session log del escritorio: ver intentos y resultados en el archivo smartbis-session-*.log en la carpeta de instalacion.

Smartbis POS v0.45.0

- Actualizaciones OTA: ahora el modal aparece DENTRO de la app al abrir (no como notificacion nativa de Windows). El usuario decide Si / No antes de descargar. Se reintenta automaticamente hasta que el modal aparezca.
- Mecanismo anti-silencio: nunca mas se descarga a espaldas del usuario. Se pregunta explicitamente primero.
- Feed URL oficial actualizado a updates.smartbis.ai para las proximas compilaciones.

Smartbis POS v0.44.0

- Ajuste altura en escritorio: la barra superior ya no corta los botones Cobrar, Cotizacion, Promociones y Retiro del fondo.

Smartbis POS v0.43.0

- IVA condicional por Factura: el IVA solo se cobra cuando la casilla Factura esta marcada. Si no esta marcada no hay impuestos.
- Turno obligatorio: se quito el boton Cancelar del modal Abrir turno. Hay que abrir turno para usar el POS.
- Boton Salir y Desktop PROD movidos a la barra superior integrada (no se sobreponen con la sucursal / IVA).
- Barra superior de 32px arrastrable para mover la ventana de escritorio.
- Actualizaciones OTA (Over-the-Air): al abrir la app aparece ventana Si / No. Si = actualiza, No = continuar en version actual.
- Boton abajo-derecha: Notas de version (detalles del parche).
- Piso #6 Configuracion: cambio de icono a Descarga, muestra version instalada y changelog.
- Escritorio ahora es thin-client y se conecta al mismo backend que la web (datos iguales en ambas plataformas).`
  const [patchNotes] = useState(patchNotesDefault)
  const [installedVersionState, setInstalledVersionState] = useState<string | null>(null)

  function parseSemver(v: unknown): [number, number, number] {
    if (!v || typeof v !== 'string') return [-1, -1, -1]
    const parts = String(v).split(/[.-]/).slice(0, 3).map((x) => parseInt(String(x || '0'), 10) || 0)
    while (parts.length < 3) parts.push(0)
    return [parts[0], parts[1], parts[2]]
  }

  function isVersionGreater(remote: unknown, local: unknown): boolean {
    const r = parseSemver(remote)
    const l = parseSemver(local)
    for (let i = 0; i < 3; i += 1) {
      if (r[i] > l[i]) return true
      if (r[i] < l[i]) return false
    }
    return false
  }

  function resolveInstalledVersion(desktopR: any, envVersion: string): string {
    const runtime = desktopR?.installedVersion
    if (runtime && typeof runtime === 'string' && runtime.length > 0) return runtime
    return envVersion
  }

  useEffect(() => {
    const anyWindow = window as Window & {
      smartbisDesktop?: {
        onRuntime?: (handler: (data: any) => void) => void
        onUpdateAvailable?: (handler: (data: any) => void) => void
        onUpdateDownloaded?: (handler: () => void) => void
        onUpdateProgress?: (handler: (data: any) => void) => void
        onUpdateError?: (handler: (data: any) => void) => void
        onUpdateNotAvailable?: (handler: () => void) => void
        onClearSession?: (handler: () => void) => void
        checkForUpdates?: () => Promise<any>
        downloadUpdate?: () => Promise<any>
        restartAndInstall?: () => Promise<any>
        declineUpdate?: (version?: string | null) => Promise<any>
        log?: (message: string) => void
      }
      __SMARTBIS_DESKTOP__?: boolean
      __API_BASE__?: string
    }

    let localInstalledVersion: string | null = null
    let declinedSessionVersion: string | null = null
    let pollCleared = false
    let pollIntervalId: number | null = null

    function clearPollIfAny() {
      if (pollIntervalId !== null) {
        try { window.clearInterval(pollIntervalId) } catch (_) {}
        pollIntervalId = null
      }
    }

    function shouldOpenModalForVersion(remoteVersion: unknown, log?: (msg: string) => void): boolean {
      if (!remoteVersion || typeof remoteVersion !== 'string') {
        if (log) log('[OTA-gate] no remote version, skip modal')
        return false
      }
      if (declinedSessionVersion === remoteVersion) {
        if (log) log(`[OTA-gate] version ${remoteVersion} declinada en esta sesion; skip modal`)
        return false
      }
      const installed = localInstalledVersion || (import.meta.env.VITE_APP_VERSION as string) || '0.0.0'
      const ok = isVersionGreater(remoteVersion, installed)
      if (log) log(`[OTA-gate] remota=${remoteVersion} instalada=${installed} isGreater=${ok}`)
      if (!ok) return false
      return true
    }

    if (anyWindow.smartbisDesktop?.onRuntime) {
      anyWindow.smartbisDesktop.onRuntime((data) => {
        setDesktopRuntime(data)
        setIsReady(true)
        if (data?.installedVersion && typeof data.installedVersion === 'string') {
          localInstalledVersion = data.installedVersion
          setInstalledVersionState(data.installedVersion)
        }
        if (data?.apiBase) {
          ;(window as any).__API_BASE__ = data.apiBase
        }
      })
    }

    if (anyWindow.smartbisDesktop?.onClearSession) {
      anyWindow.smartbisDesktop.onClearSession(() => {
        try { anyWindow.smartbisDesktop?.log?.('[renderer] clear-session recibido, borrando token y cerrando sesion') } catch (_) {}
        clearStoredToken()
      })
    }

    function handleDesktopBeforeUnload() {
      clearStoredToken()
    }
    window.addEventListener('beforeunload', handleDesktopBeforeUnload)

    if (anyWindow.smartbisDesktop?.onUpdateAvailable) {
      anyWindow.smartbisDesktop.onUpdateAvailable((data) => {
        const remote = data?.version
        if (typeof anyWindow.smartbisDesktop?.log === 'function') {
          anyWindow.smartbisDesktop.log(`[renderer] update-available remota=${remote || '?'} downloaded=${data?.downloaded}`)
        }
        if (!shouldOpenModalForVersion(remote, anyWindow.smartbisDesktop?.log)) return
        setUpdateAvailable({ version: String(remote || ''), downloaded: !!data?.downloaded })
        if (data?.downloaded) setUpdateDownloaded(true)
        setShowUpdateDialog(true)
        clearPollIfAny()
      })
    }

    if (anyWindow.smartbisDesktop?.onUpdateDownloaded) {
      anyWindow.smartbisDesktop.onUpdateDownloaded(() => {
        setUpdateDownloaded(true)
        setUpdateAvailable((prev) => prev ? { ...prev, downloaded: true } : prev)
      })
    }

    if (anyWindow.smartbisDesktop?.onUpdateProgress) {
      anyWindow.smartbisDesktop.onUpdateProgress((data) => {
        const pct = typeof data?.percent === 'number' ? data.percent : null
        setDownloadProgress(pct)
      })
    }

    if (anyWindow.smartbisDesktop?.onUpdateError) {
      anyWindow.smartbisDesktop.onUpdateError((data) => {
        console.warn('Desktop update error', data)
        setIsActingOnUpdate(false)
      })
    }

    ;(window as any).__SMARTBIS_DESKTOP__ = true
    setIsReady(true)

    const anyWindowForPoll = anyWindow
    async function tryCheckOnce(): Promise<boolean> {
      const updater = anyWindowForPoll.smartbisDesktop
      if (!updater?.checkForUpdates) return false
      try {
        if (updater?.log) updater.log(`[SafetyPoll] intentando check remoto...`)
        const res = await updater.checkForUpdates()
        if (updater?.log) updater.log(`[SafetyPoll] ok=${res?.ok} available=${res?.updateAvailable} v=${res?.version || 'null'} installed=${res?.installed || localInstalledVersion}`)
        if (res?.installed && typeof res.installed === 'string') {
          localInstalledVersion = res.installed
          setInstalledVersionState(res.installed)
        }
        if (res?.ok && res?.updateAvailable && res?.version && shouldOpenModalForVersion(res.version, updater?.log)) {
          setUpdateAvailable({ version: String(res.version), downloaded: !!res.downloaded })
          if (res.downloaded) setUpdateDownloaded(true)
          setShowUpdateDialog(true)
          return true
        }
      } catch (e: any) {
        if (updater?.log) updater.log(`[SafetyPoll] fallo: ${e?.message || e}`)
      }
      return false
    }

    // Primer check INMEDIATO
    tryCheckOnce().then(() => { if (pollCleared) return })

    // Safety polling: cada 3s hasta 20 intentos (60s)
    let attempts = 0
    pollIntervalId = window.setInterval(async () => {
      attempts += 1
      if (attempts > 20 || pollCleared) {
        clearPollIfAny()
        return
      }
      const found = await tryCheckOnce()
      if (found) clearPollIfAny()
    }, 3000) as unknown as number

    ;(window as any).__smartbisPollControl__ = {
      stopPoll: clearPollIfAny,
      setDeclined: (v: string | null) => { declinedSessionVersion = v || null },
    }

    return () => {
      pollCleared = true
      clearPollIfAny()
      try { window.removeEventListener('beforeunload', handleDesktopBeforeUnload) } catch (_) {}
    }
  }, [])

  const canAccessPos = useMemo(() => user.posRole === 'owner' || user.posRole === 'admin' || user.posRole === 'cashier', [user.posRole])

  async function handleDesktopLogin(input: { email: string; password: string }) {
    setIsSubmitting(true)
    setAuthError('')

    try {
      const response = await fetch(resolveApiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload?.error || 'No se pudo iniciar sesión')
      }

      if (payload?.token) {
        saveStoredToken(payload.token)
        window.location.reload()
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'No se pudo iniciar sesión')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleDesktopRegister(input: { email: string; password: string }) {
    setIsSubmitting(true)
    setAuthError('')

    try {
      const response = await fetch(resolveApiUrl('/api/auth/register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload?.error || 'No se pudo crear la cuenta')
      }

      if (payload?.token) {
        saveStoredToken(payload.token)
        window.location.reload()
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'No se pudo crear la cuenta')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleDesktopLogout() {
    const safetyTimeout = setTimeout(() => {
      clearStoredToken()
      window.location.reload()
    }, 3000)

    try {
      await onLogout()
    } catch (error) {
      clearStoredToken()
      setAuthError(error instanceof Error ? error.message : 'No se pudo cerrar sesión')
    } finally {
      clearTimeout(safetyTimeout)
      clearStoredToken()
      window.location.reload()
    }
  }

  if (!canAccessPos) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#0c2a47] px-6 text-slate-100">
        <div className="max-w-md rounded-[22px] border border-[#1a3a5a] bg-[#0f3151] p-8 text-center">
          <h1 className="text-2xl font-bold text-[#1090D0]">Acceso restringido</h1>
          <p className="mt-3 text-sm text-slate-300">Este escritorio solo permite acceso a usuarios del POS. Contacta al administrador.</p>
          <button
            type="button"
            onClick={async () => { try { await onLogout() } catch (error) { clearStoredToken() } }}
            className="mt-6 rounded-xl bg-[#1090D0] px-4 py-2.5 text-sm font-bold text-white"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    )
  }

  if (!isReady) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#0c2a47] text-slate-100">
        <div className="rounded-[20px] border border-[#1a3a5a] bg-[#0f3151] px-8 py-6 text-sm text-slate-200">
          Iniciando Smartbis POS...
        </div>
      </div>
    )
  }

  const currentVersion = installedVersionState || ((import.meta.env.VITE_APP_VERSION as string) || '0.42.0')
  const nextVersion = updateAvailable?.version || ''
  const installedForHeader = currentVersion

  return (
    <main className="flex h-screen w-screen flex-col overflow-hidden bg-[#0c2a47] text-slate-100">
      {/* Top bar: draggable window + Desktop PROD indicator + Salir button (no overlap!) */}
      <div
        className="flex h-[32px] shrink-0 items-center justify-between border-b border-[#1a3a5a] bg-[#0b243c]/90 px-3 text-[11px] select-none"
        style={{ WebkitAppRegion: 'drag' } as Record<string, string>}
      >
        <div className="flex items-center gap-2 text-slate-400">
          <PackageCheck className="h-3.5 w-3.5 text-[#5bbfe5]" />
          <span className="font-bold tracking-wide text-slate-200">Smartbis POS</span>
          <span className="rounded-full border border-[#1a3a5a] bg-[#0f3151] px-1.5 py-0.5 font-mono text-[9.5px] text-slate-400">
            v{installedForHeader}
          </span>
        </div>

        <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as Record<string, string>}>
          <div className="flex items-center gap-1.5 rounded-full border border-[#1a3a5a] bg-[#0f3151] px-2 py-0.5">
            <span className={
              'inline-block h-2 w-2 rounded-full ' +
              (desktopRuntime?.isDev
                ? 'bg-amber-400 shadow-[0_0_0_3px_rgba(251,191,36,0.15)]'
                : 'bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.15)]')
            } />
            <span className="font-semibold text-slate-200">
              {desktopRuntime?.isDev ? 'Desktop DEV' : 'Desktop PROD'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void handleDesktopLogout()}
            className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/10 px-2.5 py-0.5 font-bold text-rose-100 transition hover:bg-rose-500/25 hover:text-white"
            title="Cerrar sesión"
            aria-label="Cerrar sesión"
          >
            <LogOut className="h-3 w-3" />
            <span>Salir</span>
          </button>
        </div>
      </div>

      {/* POS view takes the remaining space, guaranteed overlap-free below 32px top bar.
          Tailwind arbitrary variant [&>section]:!h-full overrides POS root's "h-screen"
          ONLY in desktop context, so POS height becomes (100vh - topBar) exactly. */}
      <div className="min-h-0 flex-1 overflow-hidden [&>section]:!h-full">
        <CrmPosView />
      </div>

      {/* Bottom-right: Detalles del Parche floating button */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50">
        <div className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-[#1a3a5a] bg-[#0f3151]/95 px-2.5 py-1 shadow-[0_8px_24px_-10px_rgba(0,0,0,0.7)] backdrop-blur-md">
          <button
            type="button"
            onClick={() => setShowPatchNotes(true)}
            className="inline-flex items-center gap-1 rounded-full px-1.5 py-1 text-[10.5px] font-semibold text-slate-300 transition hover:text-[#5bbfe5]"
            title="Detalles del parche"
          >
            <Info className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Notas de versión</span>
          </button>
          {updateAvailable?.version ? (
            <button
              type="button"
              onClick={() => setShowUpdateDialog(true)}
              className="inline-flex items-center gap-1 rounded-full bg-[#1090D0] px-2 py-0.5 text-[10px] font-bold text-white shadow-[0_4px_14px_-6px_rgba(16,144,208,0.8)]"
              title="Actualizar ahora"
            >
              <Download className="h-3 w-3" />
              <span>v{nextVersion}</span>
            </button>
          ) : null}
        </div>
      </div>

      {/* Update dialog (Sí / No) — non-blocking, dismissible */}
      {showUpdateDialog ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-[#1a3a5a] bg-[#0f3151] shadow-2xl shadow-black/60">
            <div className="border-b border-[#1a3a5a] bg-gradient-to-r from-[#1090D0]/15 via-transparent to-transparent px-5 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1090D0]/20 text-[#5bbfe5]">
                  <Download className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-[15px] font-extrabold text-slate-50">Actualización disponible</h3>
                  <p className="text-[11px] text-slate-400">
                    Nueva versión <span className="font-mono font-bold text-[#5bbfe5]">v{nextVersion || 'reciente'}</span> · actual instalada v{currentVersion}
                  </p>
                </div>
              </div>
            </div>
            <div className="px-5 py-4 text-[12px] leading-relaxed text-slate-300">
              <p>¿Deseas actualizar Smartbis POS ahora?</p>
              <ul className="mt-3 space-y-1.5 text-slate-400">
                <li>• <b>Sí</b>: se instala la actualización y se reinicia la aplicación.</li>
                <li>• <b>No</b>: continuarás usando la versión actual; se volverá a preguntar la próxima vez que abras la app.</li>
              </ul>
              {downloadProgress !== null && isFinite(downloadProgress) ? (
                <div className="mt-4">
                  <div className="mb-1.5 flex items-center justify-between text-[10.5px] text-slate-400">
                    <span>Descargando actualización...</span>
                    <span className="font-mono font-bold">{downloadProgress.toFixed(0)}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[#0b2641]">
                    <div
                      className="h-full rounded-full bg-[#1090D0] transition-all duration-300"
                      style={{ width: `${Math.min(100, Math.max(0, downloadProgress))}%` }}
                    />
                  </div>
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-1.5 border-t border-[#1a3a5a] px-5 py-3">
              <button
                type="button"
                onClick={async () => {
                  const api = (window as any).smartbisDesktop
                  try {
                    const ctrl = (window as any).__smartbisPollControl__
                    if (ctrl && typeof ctrl.setDeclined === 'function') {
                      ctrl.setDeclined(nextVersion || null)
                    }
                    if (ctrl && typeof ctrl.stopPoll === 'function') {
                      ctrl.stopPoll()
                    }
                    if (api && typeof api.declineUpdate === 'function' && nextVersion) {
                      try { await api.declineUpdate(nextVersion) } catch (_) {}
                    }
                    if (api && typeof api.log === 'function') {
                      api.log(`[OTA-No] usuario declino version ${nextVersion} por esta sesion; polling detenido`)
                    }
                  } catch (_) {
                  } finally {
                    setShowUpdateDialog(false)
                  }
                }}
                disabled={isActingOnUpdate && !updateDownloaded}
                className="rounded-lg border border-[#1a3a5a] bg-[#11375a] px-3.5 py-1.5 text-[11.5px] font-semibold text-slate-200 transition hover:border-[#1090D0]/40 hover:text-white disabled:opacity-60"
              >
                No, continuar
              </button>
              <button
                type="button"
                disabled={isActingOnUpdate && !updateDownloaded}
                onClick={async () => {
                  const api = (window as any).smartbisDesktop
                  if (!api) return
                  if (updateDownloaded) {
                    if (api.restartAndInstall) {
                      setIsActingOnUpdate(true)
                      await api.restartAndInstall()
                    }
                    return
                  }
                  setIsActingOnUpdate(true)
                  setDownloadProgress(0)
                  try {
                    if (api.downloadUpdate) {
                      const res = await api.downloadUpdate()
                      if (res?.ok) {
                        setUpdateDownloaded(true)
                      }
                    } else if (api.checkForUpdates) {
                      await api.checkForUpdates()
                    }
                  } catch (_) {
                  } finally {
                    setIsActingOnUpdate(false)
                  }
                }}
                className="rounded-lg bg-[#1090D0] px-4 py-1.5 text-[11.5px] font-bold text-white transition hover:bg-[#0c79ae] shadow-[0_4px_14px_-4px_rgba(16,144,208,0.8)] disabled:opacity-70"
              >
                {isActingOnUpdate && !updateDownloaded
                  ? 'Iniciando descarga...'
                  : updateDownloaded
                  ? 'Instalar y reiniciar'
                  : 'Sí, actualizar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Patch notes modal */}
      {showPatchNotes ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#1a3a5a] bg-[#0f3151] shadow-2xl shadow-black/60" style={{ maxHeight: '82vh' }}>
            <div className="flex items-center justify-between border-b border-[#1a3a5a] bg-gradient-to-r from-[#1090D0]/15 via-transparent to-transparent px-5 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1090D0]/20 text-[#5bbfe5]">
                  <PackageCheck className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-[15px] font-extrabold text-slate-50">Detalles del parche</h3>
                  <p className="text-[11px] text-slate-400">Versión instalada <span className="font-mono font-bold text-[#5bbfe5]">v{currentVersion}</span></p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPatchNotes(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-[#0b2641] hover:text-slate-100"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </div>
            <div className="tech-scrollbar overflow-y-auto px-5 py-4 text-[12.5px] leading-relaxed text-slate-300">
              <pre className="whitespace-pre-wrap font-sans">{patchNotes}</pre>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-1.5 border-t border-[#1a3a5a] px-5 py-3">
              <button
                type="button"
                onClick={() => setShowPatchNotes(false)}
                className="rounded-lg bg-[#1090D0] px-4 py-1.5 text-[11.5px] font-bold text-white transition hover:bg-[#0c79ae] shadow-[0_4px_14px_-4px_rgba(16,144,208,0.8)]"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}

export default DesktopPosShell
