import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot,
  UserCircle,
  PauseCircle,
  PlayCircle,
  FlaskConical,
  FlaskConicalOff,
  Send,
  MessageSquare,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  X,
  Trash2,
  Wrench,
  Check,
  Lightbulb,
  Eye,
  Tag,
  ChevronRight,
  ChevronDown,
  Loader2,
  Sparkles,
  Search,
  Filter,
  ShieldCheck,
  ShieldAlert,
  ThumbsUp,
  ThumbsDown,
  RotateCcw,
  Brain,
  CheckSquare,
  Square,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  type MetaChatItem,
  type MetaMessageRow,
  type MetaStatusResponse,
  type MetaBotState,
  type AutoEval,
  type AutoEvalStats,
  type AutoEvalCategory,
  metaAutoEvalList,
  metaAutoEvalGet,
} from '@/lib/api'
import { useMetaCrmStore } from '@/store/useMetaCrmStore'

type CrmChatsViewProps = {
  status: MetaStatusResponse | null
  loadingStatus: boolean
  errorStatus: string
  chats: MetaChatItem[]
  loadingChats: boolean
  errorChats: string
  selectedPSID: string | null
  selectedMessages: MetaMessageRow[]
  loadingDetail: boolean
  errorDetail: string
  onRefreshStatus: () => Promise<void>
  onRefreshChats: (opts?: { silent?: boolean }) => Promise<void>
  onSelectChat: (psid: string | null, opts?: { silent?: boolean }) => Promise<void>
  onSetState: (next: { state?: MetaBotState; testMode?: boolean }) => Promise<any>
  onSendManual: (psid: string, text: string) => Promise<any>
  onMarkAsRead: (psid: string) => Promise<void>
  onDeleteChat: (psid: string) => Promise<void>
}

function chatDisplayName(c: MetaChatItem): string {
  if (c.firstName || c.lastName) {
    return [c.firstName, c.lastName].filter(Boolean).join(' ').trim()
  }
  return `Cliente ${c.psid.slice(-6)}`
}

function formatTime(iso?: string) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toLocaleString('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: 'short',
    })
  } catch {
    return ''
  }
}

export default function CrmChatsView(props: CrmChatsViewProps) {
  const {
    status,
    loadingStatus,
    errorStatus,
    chats,
    loadingChats,
    errorChats,
    selectedPSID,
    selectedMessages,
    loadingDetail,
    errorDetail,
    onRefreshStatus,
    onRefreshChats,
    onSelectChat,
    onSetState,
    onSendManual,
    onMarkAsRead,
    onDeleteChat,
  } = props

  const setState = useMetaCrmStore((s) => s.setState)
  const [manualText, setManualText] = useState('')
  const [sending, setSending] = useState(false)
  const chatScrollRef = useRef<HTMLDivElement | null>(null)

  type ContextMenuState = { x: number; y: number; psid: string; chatName: string } | null
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState>(null)
  const ctxMenuRef = useRef<HTMLDivElement | null>(null)
  const [confirmDeletePSID, setConfirmDeletePSID] = useState<string | null>(null)

  type ViewMode = 'conversations' | 'autocuration'
  const [viewMode, setViewMode] = useState<ViewMode>('conversations')

  // ===== AUTO-EVALS · estado del panel =====
  const [aeCategory, setAeCategory] = useState<AutoEvalCategory | 'all'>('all')
  const [aeSearch, setAeSearch] = useState('')
  const [aePage, setAePage] = useState(0)
  const AE_PAGE_SIZE = 50
  const [aeLoading, setAeLoading] = useState(false)
  const [aeError, setAeError] = useState('')
  const [aeItems, setAeItems] = useState<AutoEval[]>([])
  const [aeStats, setAeStats] = useState<AutoEvalStats | null>(null)
  const [aeTotal, setAeTotal] = useState(0)
  const [aeOpenDetail, setAeOpenDetail] = useState<AutoEval | null>(null)
  const [aeDetailLoading, setAeDetailLoading] = useState(false)

  const loadAutoEvals = async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setAeLoading(true)
    setAeError('')
    try {
      const resp = await metaAutoEvalList({
        category: aeCategory,
        search: aeSearch.trim() || undefined,
        limit: AE_PAGE_SIZE,
        offset: aePage * AE_PAGE_SIZE,
      })
      setAeItems(resp.items)
      setAeStats(resp.stats)
      setAeTotal(resp.total)
    } catch (e: any) {
      setAeError(e?.message || 'Error cargando evaluaciones de auto-curado')
    } finally {
      if (!opts?.silent) setAeLoading(false)
    }
  }

  useEffect(() => {
    if (viewMode === 'autocuration') {
      void loadAutoEvals()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, aeCategory, aePage])

  async function aeOpenOne(id: string) {
    setAeDetailLoading(true)
    try {
      const full = await metaAutoEvalGet(id)
      setAeOpenDetail(full)
    } catch (e: any) {
      setAeError(e?.message || 'Error cargando detalle')
    } finally {
      setAeDetailLoading(false)
    }
  }

  const sortedChats = useMemo(
    () =>
      [...chats].sort((a, b) =>
        (b.lastActivityAt || '').localeCompare(a.lastActivityAt || ''),
      ),
    [chats],
  )

  const selectedChatMeta = chats.find((c) => c.psid === selectedPSID) || null

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
    }
  }, [selectedMessages.length, selectedPSID])

  const POLL_VISIBLE_MS = 2000
  const POLL_HIDDEN_MS = 10000
  const pollIntervalRef = useRef<number | null>(null)

  function stopPollInterval() {
    if (pollIntervalRef.current !== null) {
      window.clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
  }

  function startPollInterval() {
    stopPollInterval()
    const ms = typeof document !== 'undefined' && document.visibilityState === 'visible'
      ? POLL_VISIBLE_MS
      : POLL_HIDDEN_MS
    pollIntervalRef.current = window.setInterval(async () => {
      try {
        // Poll SILENCIOSO: NO activar spinners ni mensajes "cargando"
        await onRefreshChats({ silent: true })
        if (selectedPSID) await onSelectChat(selectedPSID, { silent: true })
      } catch {}
    }, ms)
  }

  useEffect(() => {
    startPollInterval()
    const onVisibilityChange = () => { startPollInterval() }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange)
    }
    return () => {
      stopPollInterval()
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onRefreshChats, onSelectChat, selectedPSID])

  useEffect(() => {
    if (selectedPSID) {
      void (async () => {
        try {
          // Seleccion NUEVA = primera carga = SI mostrar loading/spinner
          await Promise.allSettled([onRefreshChats({ silent: true }), onSelectChat(selectedPSID)])
        } catch {}
      })()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPSID])

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!ctxMenu) return
      const el = ctxMenuRef.current
      if (el && !el.contains(e.target as Node)) setCtxMenu(null)
    }
    function onDocKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setCtxMenu(null)
        setConfirmDeletePSID(null)
      }
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('mousedown', onDocClick)
      document.addEventListener('keydown', onDocKey)
      document.addEventListener('scroll', () => setCtxMenu(null), true)
    }
    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('mousedown', onDocClick)
        document.removeEventListener('keydown', onDocKey)
      }
    }
  }, [ctxMenu])

  function openChatContextMenu(e: React.MouseEvent, c: MetaChatItem) {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      psid: c.psid,
      chatName: chatDisplayName(c),
    })
  }

  async function handleConfirmDelete() {
    if (!confirmDeletePSID) return
    const psid = confirmDeletePSID
    setConfirmDeletePSID(null)
    try {
      await onDeleteChat(psid)
    } catch {}
  }

  async function handleToggleBotState() {
    if (!status) return
    const nextState: MetaBotState = status.state === 'START' ? 'PAUSE' : 'START'
    await setState(onSetState, { state: nextState })
    stopPollInterval()
    startPollInterval()
  }

  async function handleToggleTestMode() {
    if (!status) return
    const next = !status.testMode
    await setState(onSetState, { testMode: next })
    stopPollInterval()
    startPollInterval()
  }

  async function handleSendManual() {
    if (!selectedPSID || !manualText.trim() || sending) return
    setSending(true)
    try {
      await onSendManual(selectedPSID, manualText.trim())
      setManualText('')
      await Promise.allSettled([onRefreshChats(), onSelectChat(selectedPSID)])
      // Post-send: autorefresh acelerado: proximo tick
      stopPollInterval()
      startPollInterval()
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="relative flex h-screen min-h-0 w-full flex-col overflow-hidden bg-[#0c2a47] text-white">
      {/* Header controles: barra herramientas 3X + botones + TABS Conversaciones / Auto-curado */}
      <header className="flex items-center justify-between gap-2.5 border-b border-[#1a3a5a] bg-[#0f3151] px-5 py-2.5">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            title="Herramienta 1 (próximamente)"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-slate-400 transition hover:border-[#1a3a5a] hover:bg-[#123659]/60 hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Herramienta 2 (próximamente)"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-slate-400 transition hover:border-[#1a3a5a] hover:bg-[#123659]/60 hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Herramienta 3 (próximamente)"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-slate-400 transition hover:border-[#1a3a5a] hover:bg-[#123659]/60 hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
          {/* ===== TABS MODO VISTA ===== */}
          <div className="ml-3 flex items-center gap-1 rounded-full border border-[#1a3a5a] bg-[#0c2a47] p-1">
            <button
              type="button"
              onClick={() => setViewMode('conversations')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] transition',
                viewMode === 'conversations'
                  ? 'bg-[#1090D0] text-white shadow shadow-[#1090D0]/20'
                  : 'text-slate-300 hover:text-white hover:bg-white/[0.04]',
              )}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Conversaciones
            </button>
            <button
              type="button"
              onClick={() => setViewMode('autocuration')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] transition',
                viewMode === 'autocuration'
                  ? 'bg-gradient-to-r from-purple-500 to-[#1090D0] text-white shadow shadow-purple-500/20'
                  : 'text-slate-300 hover:text-white hover:bg-white/[0.04]',
              )}
            >
              <Brain className="h-3.5 w-3.5" />
              Auto-curado
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {errorStatus ? (
            <div className="flex items-center gap-2 rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-1.5 text-[11px] text-rose-200">
              <AlertCircle className="h-3.5 w-3.5" />
              {errorStatus}
            </div>
          ) : null}

          <button
            type="button"
            disabled={loadingStatus}
            onClick={() => {
              void onRefreshStatus()
              void onRefreshChats()
              if (selectedPSID) void onSelectChat(selectedPSID)
            }}
            className="flex items-center gap-2 rounded-xl border border-[#1a3a5a] bg-[#11375a] px-3.5 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:border-[#1090D0]/50 hover:bg-[#143f67] disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loadingStatus && 'animate-spin')} />
            Refrescar
          </button>

          {/* START / PAUSE */}
        <button
          type="button"
          disabled={!status?.linked || loadingStatus}
          onClick={handleToggleBotState}
          className={cn(
            'group flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-[12px] font-semibold text-white transition disabled:opacity-50',
            status?.state === 'START'
              ? 'border border-emerald-400/30 bg-emerald-500/85 hover:bg-emerald-500'
              : 'border border-rose-400/30 bg-rose-500/85 hover:bg-rose-500',
          )}
          title={
            status?.state === 'START'
              ? 'Cambiar bot a PAUSE (solo humano)'
              : 'Cambiar bot a START (contestar automaticamente)'
          }
        >
          {status?.state === 'START' ? (
            <PauseCircle className="h-4 w-4" />
          ) : (
            <PlayCircle className="h-4 w-4" />
          )}
          <span className="tracking-wide">
            {status?.state === 'START' ? 'PAUSE' : 'START'}
          </span>
        </button>

        {/* TEST MODE on/off toggle naranja */}
        <button
          type="button"
          disabled={!status?.linked || loadingStatus}
          onClick={handleToggleTestMode}
          className={cn(
            'group flex items-center gap-2 rounded-xl border px-3.5 py-1.5 text-[12px] font-semibold transition disabled:opacity-50',
            status?.testMode
              ? 'border-amber-300/40 bg-amber-400/85 text-amber-950 hover:bg-amber-300'
              : 'border-[#1a3a5a] bg-[#11375a] text-slate-200 hover:border-amber-300/40 hover:bg-amber-300/10 hover:text-amber-200',
          )}
          title={
            status?.testMode
              ? '[TEST MODE ON] El bot genera respuesta PERO NO LA ENVIA al cliente (solo aparece aqui en el CRM para revision)'
              : 'Modo normal: las respuestas del bot se envian DIRECTAMENTE al cliente de Messenger.'
          }
        >
          {status?.testMode ? (
            <>
              <FlaskConical className="h-4 w-4" />
              <span className="tracking-wide">TEST MODE: ON</span>
            </>
          ) : (
            <>
              <FlaskConicalOff className="h-4 w-4" />
              <span className="tracking-wide">TEST MODE: OFF</span>
            </>
          )}
        </button>
        </div>
      </header>

      {/* Cuerpo condicional: Conversaciones o Auto-curado */}
      {viewMode === 'conversations' ? (
        <div className="grid h-screen min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-[minmax(280px,360px)_1fr]">
          {/* Lista chats */}
          <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden border-r border-[#1a3a5a] bg-[#0e2d4c]">
          <div className="flex items-center justify-between border-b border-[#1a3a5a] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-300">
            <span>Conversaciones ({sortedChats.length})</span>
            {loadingChats ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin text-[#1090D0]" />
            ) : null}
          </div>
          <div className="min-h-0 h-full flex-1 overflow-y-auto px-2 py-2 tech-scrollbar">
            {errorChats ? (
              <div className="m-2 flex items-start gap-2 rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-[11px] text-rose-200">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5" />
                {errorChats}
              </div>
            ) : null}
            {sortedChats.length === 0 && !loadingChats ? (
              <div className="mx-2 mt-3 rounded-xl border border-dashed border-[#25507c] bg-white/[0.02] px-4 py-6 text-center text-[11px] text-slate-400">
                Aún no hay chats de Messenger.
                <br />
                Envía un mensaje a tu página Facebook para que aparezca aquí.
              </div>
            ) : null}
            <ul className="space-y-1">
              {sortedChats.map((c) => {
                const active = c.psid === selectedPSID
                const name = chatDisplayName(c)
                return (
                  <li key={c.psid}>
                    <button
                      type="button"
                      onClick={() => onSelectChat(c.psid)}
                      onContextMenu={(e) => openChatContextMenu(e, c)}
                      className={cn(
                        'flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition',
                        active
                          ? 'border-[#1090D0]/45 bg-[#1090D0]/12'
                          : 'border-transparent bg-transparent hover:border-[#1a3a5a] hover:bg-[#123659]/60',
                      )}
                    >
                      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#11375a] text-slate-300">
                        {c.profilePic ? (
                          <img
                            src={c.profilePic}
                            alt=""
                            className="h-9 w-9 rounded-full object-cover"
                          />
                        ) : (
                          <UserCircle className="h-5 w-5" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p
                            className={cn(
                              'truncate text-[13px] font-semibold',
                              active ? 'text-white' : 'text-slate-100',
                            )}
                          >
                            {name}
                          </p>
                          <span className="shrink-0 text-[10px] font-medium text-slate-400">
                            {formatTime(c.lastActivityAt)}
                          </span>
                        </div>
                        <p
                          className={cn(
                            'mt-0.5 line-clamp-2 text-[12px]',
                            c.unreadCount > 0 ? 'text-slate-100' : 'text-slate-400',
                          )}
                        >
                          {c.lastMessage || '(Sin mensaje)'}
                        </p>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <p className="truncate text-[10px] font-mono text-slate-500">
                            PSID {c.psid.slice(0, 6)}…{c.psid.slice(-4)}
                          </p>
                          {c.unreadCount > 0 ? (
                            <span className="rounded-full bg-[#1090D0]/90 px-2 py-0.5 text-[10px] font-bold text-white">
                              {c.unreadCount}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </aside>

        {/* Detalle conversación */}
        <section className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#0c2a47]">
          {selectedPSID && selectedChatMeta ? (
            <>
              <div className="flex items-center justify-between gap-3 border-b border-[#1a3a5a] bg-[#0f3151] px-5 py-2.5">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#11375a] text-slate-300">
                    {selectedChatMeta.profilePic ? (
                      <img
                        src={selectedChatMeta.profilePic}
                        alt=""
                        className="h-9 w-9 rounded-full object-cover"
                      />
                    ) : (
                      <UserCircle className="h-5 w-5" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-white">
                      {chatDisplayName(selectedChatMeta)}
                    </p>
                    <p className="truncate text-[11px] font-mono text-slate-400">
                      PSID: {selectedPSID}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[10px]">
                  {status?.testMode ? (
                    <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-2.5 py-1 font-semibold uppercase tracking-[0.2em] text-amber-200">
                      🧪 test mode activo
                    </span>
                  ) : null}
                  {status?.state === 'START' ? (
                    <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 font-semibold uppercase tracking-[0.2em] text-emerald-300">
                      bot start
                    </span>
                  ) : (
                    <span className="rounded-full border border-rose-400/20 bg-rose-400/10 px-2.5 py-1 font-semibold uppercase tracking-[0.2em] text-rose-300">
                      bot pause
                    </span>
                  )}
                </div>
              </div>

              <div
                ref={chatScrollRef}
                className="min-h-0 h-full flex-1 overflow-y-auto px-5 py-4 space-y-3 tech-scrollbar"
              >
                {loadingDetail ? (
                  <div className="flex items-center justify-center py-8 text-[11px] text-slate-400">
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin text-[#1090D0]" />
                    Cargando conversación...
                  </div>
                ) : null}
                {errorDetail ? (
                  <div className="m-2 flex items-start gap-2 rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-[11px] text-rose-200">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5" />
                    {errorDetail}
                  </div>
                ) : null}
                {selectedMessages.map((m) => (
                  <MessageBubble
                    key={m.id}
                    msg={m}
                  />
                ))}
                {selectedMessages.length === 0 && !loadingDetail ? (
                  <div className="mx-auto max-w-md rounded-xl border border-dashed border-[#25507c] bg-white/[0.02] px-4 py-6 text-center text-[11px] text-slate-400">
                    Aún no hay mensajes con este cliente.
                    <br />
                    Cuando envíe un mensaje a tu página Facebook aparecerá aquí.
                  </div>
                ) : null}
              </div>

              {/* Input manual */}
              <div className="border-t border-[#1a3a5a] bg-[#0f3151] p-3">
                <div className="flex items-center gap-2 rounded-xl border border-[#1a3a5a] bg-[#0b2641] px-3 py-2 focus-within:border-[#1090D0]/50 focus-within:bg-[#0c2c4c]">
                  <textarea
                    rows={1}
                    value={manualText}
                    onChange={(e) => setManualText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        void handleSendManual()
                      }
                    }}
                    placeholder="Escribe un mensaje manual para el cliente..."
                    className="max-h-32 min-h-[28px] flex-1 resize-none bg-transparent text-[13px] text-slate-100 placeholder:text-slate-400 focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={!manualText.trim() || sending}
                    onClick={handleSendManual}
                    className="flex items-center gap-2 rounded-xl bg-[#1090D0] px-4 py-1.5 text-[11px] font-bold text-white transition hover:bg-[#0c79ae] disabled:opacity-50"
                  >
                    <Send className="h-3.5 w-3.5" />
                    {sending ? 'Enviando' : 'Enviar'}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex min-h-0 h-full w-full flex-1 flex-col items-center justify-center gap-3 px-6 py-8 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full border border-[#1a3a5a] bg-[#0f3151] text-slate-400">
                <MessageSquare className="h-8 w-8" />
              </div>
              <h3 className="text-[15px] font-semibold text-white">
                Selecciona una conversación
              </h3>
              <p className="max-w-md text-[12px] leading-relaxed text-slate-300/90">
                En el panel izquierdo verás las conversaciones de Messenger ordenadas por la última
                actividad. Haz clic en una para ver el historial real entre el cliente y el bot, y
                contestar manualmente si así lo deseas.
              </p>
            </div>
          )}
        </section>
      </div>
      ) : null}

      {ctxMenu ? (
        <div
          ref={ctxMenuRef}
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          className="fixed z-[9999] min-w-[180px] overflow-hidden rounded-xl border border-[#1a3a5a] bg-[#11375a] py-1 shadow-2xl shadow-black/40"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              setCtxMenu(null)
              try { void onMarkAsRead(ctxMenu.psid) } catch {}
            }}
            className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[12px] text-slate-200 transition hover:bg-[#1090D0]/15 hover:text-white"
          >
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
            Marcar como leído
          </button>
          <div className="my-1 h-px bg-[#1a3a5a]" />
          <button
            type="button"
            onClick={() => {
              setCtxMenu(null)
              setConfirmDeletePSID(ctxMenu.psid)
            }}
            className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[12px] text-rose-200 transition hover:bg-rose-500/10 hover:text-rose-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Eliminar conversación
          </button>
        </div>
      ) : null}

      {confirmDeletePSID ? (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/55 backdrop-blur-[2px]">
          <div className="w-[min(92vw,420px)] overflow-hidden rounded-2xl border border-[#1a3a5a] bg-[#0f3151] p-5 shadow-2xl shadow-black/50">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 text-rose-300">
                <Trash2 className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="text-[15px] font-semibold text-white">
                  Eliminar conversación
                </h4>
                <p className="mt-1 text-[12px] leading-relaxed text-slate-300">
                  Se eliminará permanentemente el historial de{' '}
                  <span className="font-semibold text-white">
                    {chats.find((c) => c.psid === confirmDeletePSID)
                      ? chatDisplayName(chats.find((c) => c.psid === confirmDeletePSID)!)
                      : 'esta conversación'}
                  </span>
                  . Esta acción no se puede deshacer.
                </p>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeletePSID(null)}
                className="rounded-xl border border-[#1a3a5a] bg-[#11375a] px-4 py-2 text-[12px] font-semibold text-slate-200 transition hover:border-[#1090D0]/40 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDelete()}
                className="rounded-xl border border-rose-500/30 bg-rose-500 px-4 py-2 text-[12px] font-bold text-white transition hover:bg-rose-600"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Trash2 className="h-3.5 w-3.5" />
                  Eliminar
                </span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ========== MODO AUTO-CURACIÓN ========== */}
      {viewMode === 'autocuration' ? (
        <div className="grid h-screen min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-[minmax(440px,560px)_1fr]">
          <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden border-r border-[#1a3a5a] bg-[#0e2d4c]">
            <div className="border-b border-[#1a3a5a] bg-[#0f3151] px-5 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500/20 to-[#1090D0]/20 text-purple-300 ring-1 ring-purple-400/20">
                    <Brain className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-[14px] font-extrabold text-white tracking-tight">Panel de Auto-curado</h3>
                    <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">Juez-LLM síncrono: solo las respuestas Correct pasan al cliente.</p>
                  </div>
                </div>
                <button type="button" disabled={aeLoading} onClick={() => { setAePage(0); void loadAutoEvals() }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-[#1a3a5a] bg-[#11375a] px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-200 hover:border-[#1090D0]/40 hover:text-white disabled:opacity-50">
                  <RefreshCw className={cn('h-3.5 w-3.5', aeLoading && 'animate-spin')} />
                  Refrescar
                </button>
              </div>
            </div>

            {aeStats ? (
              <div className="grid grid-cols-2 gap-2 border-b border-[#1a3a5a] bg-[#0c2a47] p-3 sm:grid-cols-4">
                <AeStatChip icon={<ShieldCheck className="h-4 w-4 text-emerald-300" />} label="Correct" value={aeStats.correct} tone="emerald" sub="Enviadas al cliente" />
                <AeStatChip icon={<ShieldAlert className="h-4 w-4 text-rose-300" />} label="Error" value={aeStats.error} tone="rose" sub="Info en docs, mal usada" />
                <AeStatChip icon={<AlertCircle className="h-4 w-4 text-amber-300" />} label="NoInfo" value={aeStats.noinfo} tone="amber" sub="Sin info en docs" />
                <AeStatChip icon={<Sparkles className="h-4 w-4 text-[#5bbfe5]" />} label="Juez Falló" value={aeStats.judge_failed} tone="blue" sub={`Total: ${aeStats.total}`} />
              </div>
            ) : null}

            <div className="space-y-2.5 border-b border-[#1a3a5a] bg-[#0f3151]/60 px-4 py-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input value={aeSearch} onChange={(e) => setAeSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setAePage(0); void loadAutoEvals() } }}
                  placeholder="Buscar por pregunta, respuesta o razón del juez…"
                  className="w-full rounded-xl border border-[#1a3a5a] bg-[#0c2a47] pl-9 pr-10 py-2 text-[12px] text-white placeholder:text-slate-500 focus:border-[#1090D0]/60 focus:outline-none" />
                {aeSearch ? (
                  <button type="button" onClick={() => { setAeSearch(''); setAePage(0); void loadAutoEvals() }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md border border-transparent px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-white hover:border-[#1a3a5a] hover:bg-white/[0.04]">
                    Limpiar
                  </button>
                ) : null}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="min-w-0">
                  <label className="block mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1">
                    <Filter className="h-3.5 w-3.5" /> Categoría
                  </label>
                  <select value={aeCategory} onChange={(e) => { setAeCategory(e.target.value as any); setAePage(0) }}
                    className="w-full rounded-xl border border-[#1a3a5a] bg-[#0c2a47] px-2 py-2 text-[11px] text-white focus:border-[#1090D0]/60 focus:outline-none">
                    <option value="all">Todas</option>
                    <option value="correct">🟢 Correct</option>
                    <option value="error">🔴 Error</option>
                    <option value="noinfo">🟡 NoInfo</option>
                    <option value="judge_failed">🔵 Juez falló</option>
                  </select>
                </div>
                <div className="col-span-2 flex items-end gap-1.5">
                  <div className="min-w-0 flex-1">
                    <label className="block mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-400">Página</label>
                    <div className="flex items-center gap-1">
                      <button type="button" disabled={aePage <= 0} onClick={() => setAePage(p => Math.max(0, p - 1))}
                        className="rounded-lg border border-[#1a3a5a] bg-[#0c2a47] px-2 py-1.5 text-[11px] font-bold text-slate-200 hover:text-white disabled:opacity-40">◀</button>
                      <div className="flex-1 text-center text-[11px] font-mono text-slate-300 py-1.5 rounded-lg bg-white/[0.02] border border-[#1a3a5a]">
                        Pg {aePage + 1} · {Math.ceil(aeTotal / AE_PAGE_SIZE) || 1}
                      </div>
                      <button type="button" disabled={aePage + 1 >= Math.ceil(aeTotal / AE_PAGE_SIZE)} onClick={() => setAePage(p => p + 1)}
                        className="rounded-lg border border-[#1a3a5a] bg-[#0c2a47] px-2 py-1.5 text-[11px] font-bold text-slate-200 hover:text-white disabled:opacity-40">▶</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="min-h-0 h-full flex-1 overflow-y-auto px-2 py-2 tech-scrollbar">
              {aeError ? (
                <div className="m-2 flex items-start gap-2 rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-[11px] text-rose-200">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5" />{aeError}
                </div>
              ) : null}
              {aeLoading ? (
                <div className="mx-2 mt-4 flex items-center justify-center gap-2 rounded-xl border border-dashed border-[#25507c] bg-white/[0.02] px-4 py-6 text-[11px] text-slate-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[#1090D0]" />
                  Cargando evaluaciones…
                </div>
              ) : aeItems.length === 0 ? (
                <div className="mx-2 mt-4 rounded-xl border border-dashed border-[#25507c] bg-white/[0.02] px-4 py-10 text-center">
                  <Brain className="mx-auto h-8 w-8 text-slate-500 opacity-60 mb-2" />
                  <p className="text-[12px] text-slate-300 font-semibold mb-1">Aún no hay evaluaciones.</p>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    A partir de ahora, cada vez que el bot responda a un usuario, el Juez-LLM clasificará la respuesta y aparecerá aquí. Solo las respuestas Correct se enviarán al cliente; el resto se bloquean en silencio y requieren atención humana.
                  </p>
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {aeItems.map((d) => (
                    <li key={d.id}>
                      <button type="button" onClick={() => void aeOpenOne(d.id)}
                        className={cn(
                          'flex w-full items-start gap-2 rounded-2xl border px-3 py-2.5 text-left transition',
                          aeOpenDetail?.id === d.id ? 'border-purple-400/40 bg-purple-500/8 ring-1 ring-purple-400/20' : 'border-transparent bg-transparent hover:border-[#1a3a5a] hover:bg-[#123659]/60',
                        )}>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap mb-1">
                            <AeCategoryBadge category={d.category} />
                            <span className="ml-auto text-[10px] font-mono text-slate-500">
                              {new Date(d.createdAt).toLocaleString('es-MX', { hour12: false })}
                            </span>
                          </div>
                          <p className="truncate text-[12px] font-semibold text-slate-100 leading-tight">
                            <span className="text-slate-400 mr-1.5">Q:</span>{d.triggerMessageText || '(sin pregunta)'}
                          </p>
                          <p className="mt-0.5 truncate text-[11px] text-slate-400 leading-snug">
                            <span className="text-slate-500 mr-1.5">A:</span>{d.botAnswerText || '(sin respuesta)'}
                          </p>
                          {d.judgeReason ? (
                            <p className="mt-1 truncate text-[10px] text-slate-500 leading-snug italic">Juez: {d.judgeReason}</p>
                          ) : null}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>

          <section className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#0c2a47]">
            {!aeOpenDetail ? (
              <div className="h-full w-full flex items-center justify-center px-8">
                <div className="max-w-lg text-center">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-purple-400/20 bg-gradient-to-br from-purple-500/15 to-[#1090D0]/15 text-purple-300 shadow-inner">
                    <Eye className="h-6 w-6" />
                  </div>
                  <h3 className="text-[15px] font-extrabold text-white mb-1.5 tracking-tight">Selecciona una evaluación de la lista</h3>
                  <p className="text-[12px] leading-relaxed text-slate-400 mb-5">
                    Aquí verás el análisis completo: pregunta original, respuesta del bot, razón del Juez-LLM, categoría y los documentos RAG que recuperó. Si la respuesta fue bloqueada (Error / NoInfo / Juez falló), esta respuesta NUNCA llegó al cliente.
                  </p>
                  <div className="grid grid-cols-1 gap-2 text-[11px] text-left sm:grid-cols-3">
                    <AeLegendCard icon={<ShieldCheck className="h-3.5 w-3.5 text-emerald-300" />} title="🟢 Correct" desc="La respuesta usó bien la info de docs. SÍ se envió al cliente." />
                    <AeLegendCard icon={<ShieldAlert className="h-3.5 w-3.5 text-rose-300" />} title="🔴 Error" desc="Info sí estaba en docs pero el bot falló. NO se envió." />
                    <AeLegendCard icon={<AlertCircle className="h-3.5 w-3.5 text-amber-300" />} title="🟡 NoInfo / 🔵 Juez falló" desc="No había info o el juez falló. NO se envió." />
                  </div>
                </div>
              </div>
            ) : (
              <AeDetailPanel d={aeOpenDetail} onJumpChat={(psid) => {
                if (!psid) return
                setViewMode('conversations')
                void onSelectChat(psid)
              }} />
            )}
          </section>
        </div>
      ) : null}

    </section>
  )
}

// ============================================================
// AYUDA · Auto-curado (subcomponentes, categorías, detalle…)
// ============================================================

function AeCategoryBadge({ category }: { category: AutoEvalCategory }) {
  switch (category) {
    case 'correct':
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-200">
          <CheckCircle2 className="h-3 w-3" /> Correct
        </span>
      )
    case 'error':
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-rose-400/30 bg-rose-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-200">
          <XCircle className="h-3 w-3" /> Error
        </span>
      )
    case 'noinfo':
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-200">
          <AlertCircle className="h-3 w-3" /> NoInfo
        </span>
      )
    case 'judge_failed':
    default:
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-[#4a6b8c]/40 bg-[#163554] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-200">
          <Wrench className="h-3 w-3" /> Juez falló
        </span>
      )
  }
}

function AeStatChip({
  icon, label, value, tone, sub,
}: {
  icon: React.ReactNode
  label: string
  value: number
  tone: 'emerald' | 'rose' | 'amber' | 'blue'
  sub?: string
}) {
  const bg: Record<string, string> = {
    emerald: 'bg-emerald-400/8 ring-emerald-400/20 text-emerald-200 border-emerald-400/25',
    rose: 'bg-rose-400/8 ring-rose-400/20 text-rose-200 border-rose-400/25',
    amber: 'bg-amber-400/8 ring-amber-400/20 text-amber-200 border-amber-400/25',
    blue: 'bg-[#1090D0]/8 ring-[#1090D0]/20 text-[#7fd2ff] border-[#1090D0]/25',
  }
  return (
    <div className={cn('flex items-center gap-2.5 rounded-2xl border p-2.5 ring-1 backdrop-blur', bg[tone])}>
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0c2a47]/40 border border-white/5">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className="text-[10px] font-extrabold uppercase tracking-wider opacity-80">{label}</p>
          <p className="font-mono text-[16px] font-extrabold">{value}</p>
        </div>
        {sub ? <p className="mt-0.5 truncate text-[10px] opacity-70 leading-tight">{sub}</p> : null}
      </div>
    </div>
  )
}

function AeLegendCard({
  icon, title, desc,
}: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="rounded-2xl border border-[#1a3a5a] bg-[#0e2d4c]/80 p-3">
      <div className="flex items-center gap-2 mb-1">
        <div className="flex h-6 w-6 items-center justify-center rounded-lg border border-white/10 bg-[#0c2a47]">{icon}</div>
        <p className="text-[11px] font-extrabold text-white">{title}</p>
      </div>
      <p className="text-[10.5px] leading-snug text-slate-400">{desc}</p>
    </div>
  )
}

function AeDetailPanel({ d, onJumpChat }: { d: AutoEval; onJumpChat: (psid: string) => void }) {
  const isBlocked = d.category !== 'correct'
  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#1a3a5a] bg-[#0f3151]/80 px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <AeCategoryBadge category={d.category} />
            {isBlocked ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-rose-400/30 bg-rose-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-200">
                <ShieldAlert className="h-3 w-3" /> Bloqueado (sin envío a cliente)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-200">
                <ShieldCheck className="h-3 w-3" /> Enviada al cliente
              </span>
            )}
          </div>
          <p className="truncate text-[11px] font-mono text-slate-400">
            ID: {d.id} · {new Date(d.createdAt).toLocaleString('es-MX', { hour12: false })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {d.psid ? (
            <button type="button" onClick={() => onJumpChat(d.psid!)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#1090D0]/40 bg-[#1090D0]/10 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-[#7fd2ff] hover:bg-[#1090D0]/20">
              <MessageSquare className="h-3.5 w-3.5" /> Ir a conversación
            </button>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 h-full w-full flex-1 overflow-y-auto px-5 py-4 space-y-4 tech-scrollbar">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <MetaKv label="PSID" value={d.psid || '—'} />
          <MetaKv label="Message ID trigger" value={d.triggerMessageId || '—'} />
          <MetaKv label="Message ID bot" value={d.botMessageId || '—'} />
          <MetaKv label="Docs RAG matched" value={`${d.matchedBlocks?.length || 0}`} />
        </div>

        <div className="rounded-2xl border border-[#1a3a5a] bg-[#0e2d4c] p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-sky-500/15 border border-sky-400/20 text-sky-200">
              <UserCircle className="h-3.5 w-3.5" />
            </div>
            <h4 className="text-[11px] font-extrabold uppercase tracking-widest text-slate-300">Pregunta del cliente</h4>
          </div>
          <p className="text-[13px] leading-relaxed text-slate-100 whitespace-pre-wrap break-words">
            {d.triggerMessageText || '(pregunta vacía)'}
          </p>
        </div>

        <div className={cn('rounded-2xl border p-4',
          isBlocked
            ? 'border-rose-400/25 bg-rose-500/[0.04]'
            : 'border-emerald-400/25 bg-emerald-500/[0.04]')}>
          <div className="flex items-center gap-2 mb-2">
            <div className={cn('flex h-7 w-7 items-center justify-center rounded-xl border',
              isBlocked ? 'bg-rose-500/15 border-rose-400/20 text-rose-200' : 'bg-emerald-500/15 border-emerald-400/20 text-emerald-200')}>
              <Bot className="h-3.5 w-3.5" />
            </div>
            <h4 className="text-[11px] font-extrabold uppercase tracking-widest text-slate-300">
              Respuesta del bot {isBlocked ? '(bloqueada antes de enviar)' : '(enviada al cliente)'}
            </h4>
          </div>
          <p className="text-[13px] leading-relaxed text-slate-100 whitespace-pre-wrap break-words">
            {d.botAnswerText || '(respuesta vacía)'}
          </p>
        </div>

        <div className="rounded-2xl border border-purple-400/25 bg-purple-500/[0.04] p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-purple-500/15 border border-purple-400/20 text-purple-200">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
            <h4 className="text-[11px] font-extrabold uppercase tracking-widest text-slate-300">Razón del Juez-LLM</h4>
          </div>
          <p className="text-[13px] leading-relaxed text-purple-100/90 whitespace-pre-wrap break-words">
            {d.judgeReason || '(sin razón)'}
          </p>
        </div>

        <div className="rounded-2xl border border-[#1a3a5a] bg-[#0e2d4c] p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-[#1090D0]/15 border border-[#1090D0]/25 text-[#7fd2ff]">
              <Tag className="h-3.5 w-3.5" />
            </div>
            <h4 className="text-[11px] font-extrabold uppercase tracking-widest text-slate-300">Documentos RAG recuperados</h4>
          </div>
          {(!d.matchedBlocks || d.matchedBlocks.length === 0) ? (
            <div className="rounded-xl border border-dashed border-[#25507c] bg-white/[0.02] px-3 py-4 text-center text-[11px] text-slate-400">
              No hubo documentos RAG recuperados para esta consulta.
            </div>
          ) : (
            <ul className="space-y-2">
              {d.matchedBlocks.map((b, idx) => (
                <li key={`${b.hash}-${idx}`} className="rounded-xl border border-[#1a3a5a] bg-[#0c2a47] p-3">
                  <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <CheckSquare className="h-3 w-3 text-[#7fd2ff] shrink-0" />
                      <p className="truncate text-[11.5px] font-semibold text-slate-100">
                        {b.title || '(sin título)'}
                        {b.section ? <span className="text-slate-500 mx-1">·</span> : null}
                        <span className="text-[10.5px] text-slate-400 font-medium">{b.section || ''}</span>
                      </p>
                    </div>
                    <p className="text-[9.5px] font-mono text-slate-500 shrink-0">{b.hash.slice(0, 10)}…</p>
                  </div>
                  {b.snippet ? (
                    <p className="rounded-lg bg-white/[0.02] border border-white/5 px-2.5 py-2 text-[11px] leading-snug text-slate-300 whitespace-pre-wrap break-words">
                      {b.snippet}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}


function MetaKv({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#1a3a5a] bg-[#0c2a47]/60 px-3 py-2">
      <p className="text-[9px] font-extrabold uppercase tracking-[0.22em] text-slate-400">{label}</p>
      <p className="mt-0.5 truncate text-[11px] font-mono text-slate-200">{value || '—'}</p>
    </div>
  )
}

type MessageBubbleProps = {
  msg: MetaMessageRow
}
function MessageBubble(props: MessageBubbleProps) {
  const {
    msg,
  } = props
  const isIn = msg.direction === 'IN'
  const isBot = msg.direction === 'OUT_BOT'
  const isHuman = msg.direction === 'OUT_HUMAN'
  const [hovered, setHovered] = useState(false)

  return (
    <div
      className={cn(
        'group/msg flex items-end gap-2 relative',
        isIn ? 'justify-start' : 'justify-end',
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className={cn(
          'relative max-w-[82%] rounded-[20px] px-4 py-2.5 text-[13px] shadow-sm transition-all',
          isIn &&
            'rounded-tl-[4px] border border-[#1f4878] bg-[#11375a] text-slate-50',
          isBot &&
            'rounded-tr-[4px] border border-[#0c79ae] bg-[#133d61] text-slate-50',
          isHuman &&
            'rounded-tr-[4px] border border-[#1090D0] bg-[#1090D0] text-white',
        )}
      >
        <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em]">
          {isIn ? (
            <span className="text-slate-300">👤 Cliente</span>
          ) : isBot ? (
            <>
              <Bot className="h-3 w-3 text-[#5bbfe5]" />
              <span className="text-[#bfe6f5]">Bot</span>
              {msg.testMode ? (
                <span className="rounded-full bg-amber-300/20 px-2 py-0.5 text-amber-200">
                  🧪 NO ENVIADO
                </span>
              ) : msg.sentToUser ? (
                <span className="flex items-center gap-0.5 text-emerald-300">
                  <CheckCircle2 className="h-3 w-3" />
                  entregado
                </span>
              ) : (
                <span className="flex items-center gap-0.5 text-rose-300">
                  <XCircle className="h-3 w-3" />
                  {msg.blockedByAutocurator ? 'bloqueado por autocurador' : 'no entregado'}
                </span>
              )}
            </>
          ) : (
            <>
              <span className="text-slate-50/90">Tu (humano)</span>
              {msg.sentToUser ? (
                <span className="flex items-center gap-0.5 text-emerald-100">
                  <CheckCircle2 className="h-3 w-3" />
                  enviado
                </span>
              ) : null}
            </>
          )}
          <span className="ml-auto text-slate-300/80 normal-case tracking-normal">
            {formatTime(msg.createdAt)}
          </span>
        </div>
        <p
          className="whitespace-pre-wrap break-words leading-relaxed select-text"
        >
          {msg.content}
        </p>
        {msg.referral ? (
          <div className="mt-2 rounded-lg border border-sky-300/20 bg-sky-300/5 px-2 py-1 text-[10px] leading-snug text-sky-100/80">
            <span className="font-bold uppercase tracking-wide">Origen referido{msg.referral.source === 'ADS' ? ' · anuncio' : ''}</span>
            {msg.referral.ads_context_data?.ad_title ? ` · ${msg.referral.ads_context_data.ad_title}` : ''}
            {msg.referral.ads_context_data?.product_id ? ` · Producto ${msg.referral.ads_context_data.product_id}` : ''}
            {!msg.referral.ads_context_data?.ad_title && !msg.referral.ads_context_data?.product_id && msg.referral.ad_id ? ` · ID ${msg.referral.ad_id}` : ''}
          </div>
        ) : null}
        {msg.sendError ? (
          <p className="mt-1 border-t border-rose-300/15 pt-1 text-[10px] leading-snug text-rose-200/80">
            Error de envío: {msg.sendError}
          </p>
        ) : null}
      </div>
    </div>
  )
}
