import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { CrmPage } from '@/store/useMetaCrmStore'
import {
  MessageCircle,
  FileText,
  Settings2,
  LogOut,
  UserCircle2,
  Users,
  ShoppingCart,
  ScrollText,
  ChevronLeft,
  ChevronRight,
  Menu,
  ChevronUp,
  Sparkles,
  Bot,
} from 'lucide-react'
import type { MetaStatusResponse } from '@/lib/api'
import LogoSb from '../assets/logosb.png'

type Props = {
  active: CrmPage
  onChange: (p: CrmPage) => void
  status: MetaStatusResponse | null
  userEmail: string
  onLogout: () => void
  onGoAccounts?: () => void
  onGoRecords?: () => void
  onGoProfile?: () => void
  onOpenDocsWithTab?: (tab: 'prompt' | 'documents' | 'chat') => void
  activeDocsTab?: 'chat' | 'prompt' | 'documents'
  isCashier?: boolean
}

type WorkspaceTab = 'chat' | 'prompt' | 'documents'

type RadialItem = {
  key: string
  label: string
  description?: string
  Icon: typeof Settings2
  isActive: () => boolean
  run: () => void
  danger?: boolean
  hide?: boolean
}

const ANGLES_PER_SLOT = [270, 210, 150, 90, 30, -30] as const

const NAV_STORAGE_POS = 'sb-floatnav-pos-v1'

type PosXY = { x: number; y: number }

type Stage = 'closed' | 'toCenter' | 'open' | 'toOrigin'

function defaultPos(): PosXY {
  if (typeof window === 'undefined') return { x: 28, y: 28 }
  return {
    x: 28,
    y: Math.max(28, window.innerHeight - 140),
  }
}

export default function CrmFloatingNav(props: Props) {
  const {
    active,
    onChange,
    userEmail,
    onLogout,
    onGoAccounts,
    onGoRecords,
    onGoProfile,
    onOpenDocsWithTab,
    activeDocsTab,
    isCashier,
  } = props

  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(0)
  const [pos, setPos] = useState<PosXY>(defaultPos)
  const [posBeforeOpen, setPosBeforeOpen] = useState<PosXY | null>(null)
  const [stage, setStage] = useState<Stage>('closed')
  const [isDragging, setIsDragging] = useState(false)
  const [dragMoved, setDragMoved] = useState(false)
  const dragStart = useRef<{ clientX: number; clientY: number; offsetX: number; offsetY: number } | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)

  const [animDirection, setAnimDirection] = useState<'idle' | 'left' | 'right'>('idle')
  const [animPhase, setAnimPhase] = useState<'enter' | 'leave' | 'idle'>('idle')
  const [displayedPage, setDisplayedPage] = useState(0)

  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const toastTimer = useRef<number | null>(null)
  const stageTimer = useRef<number | null>(null)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(NAV_STORAGE_POS)
      if (!raw) return
      const p = JSON.parse(raw) as Partial<PosXY>
      if (typeof p.x === 'number' && typeof p.y === 'number') {
        setPos({ x: p.x, y: p.y })
      }
    } catch (_) {}
  }, [])

  useEffect(() => {
    if (isDragging) return
    try {
      localStorage.setItem(NAV_STORAGE_POS, JSON.stringify(pos))
    } catch (_) {}
  }, [pos, isDragging])

  useEffect(() => {
    if (!open) return
    function onDoc(ev: MouseEvent) {
      if (!rootRef.current) return
      if (rootRef.current.contains(ev.target as Node)) return
      handleCoreClick()
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') handleCoreClick()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, stage])

  useEffect(() => {
    if (!isDragging) return
    if (stage !== 'closed') return
    if (open) {
      setOpen(false)
      setTimeout(() => {
        if (stageTimer.current) window.clearTimeout(stageTimer.current)
        setStage('toOrigin')
        if (posBeforeOpen) setPos(posBeforeOpen)
        stageTimer.current = window.setTimeout(() => {
          setStage('closed')
          setPosBeforeOpen(null)
          stageTimer.current = null
        }, 290)
      }, 320)
    }
    function onMove(ev: MouseEvent) {
      if (!dragStart.current) return
      const dx = ev.clientX - dragStart.current.clientX
      const dy = ev.clientY - dragStart.current.clientY
      if (Math.abs(dx) + Math.abs(dy) > 4) setDragMoved(true)
      const vw = typeof window !== 'undefined' ? window.innerWidth : 1440
      const vh = typeof window !== 'undefined' ? window.innerHeight : 900
      const size = 64
      let nx = ev.clientX - dragStart.current.offsetX
      let ny = ev.clientY - dragStart.current.offsetY
      nx = Math.max(12, Math.min(vw - size - 12, nx))
      ny = Math.max(12, Math.min(vh - size - 12, ny))
      setPos({ x: nx, y: ny })
    }
    function onUp() {
      setIsDragging(false)
      setTimeout(() => setDragMoved(false), 30)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [isDragging, open, stage, posBeforeOpen])

  const navPages = useMemo<Array<Array<RadialItem | null>>>(() => {
    const base: RadialItem[] = [
      {
        key: 'chats',
        label: 'Chats',
        description: 'Messenger Facebook',
        Icon: MessageCircle,
        isActive: () => active === 'chats',
        run: () => onChange('chats'),
        hide: !!isCashier,
      },
      {
        key: 'prompt',
        label: 'Prompt',
        description: 'prompt.md',
        Icon: Sparkles,
        isActive: () => active === 'docs' && activeDocsTab === 'prompt',
        run: () => {
          onOpenDocsWithTab?.('prompt')
          onChange('docs')
        },
        hide: !!isCashier,
      },
      {
        key: 'documents',
        label: 'Documentos',
        description: 'Archivos .md',
        Icon: FileText,
        isActive: () => active === 'docs' && activeDocsTab === 'documents',
        run: () => {
          onOpenDocsWithTab?.('documents')
          onChange('docs')
        },
        hide: !!isCashier,
      },
      {
        key: 'pruebas',
        label: 'Pruebas',
        description: 'Chat interno',
        Icon: Bot,
        isActive: () => active === 'docs' && activeDocsTab === 'chat',
        run: () => {
          onOpenDocsWithTab?.('chat')
          onChange('docs')
        },
        hide: !!isCashier,
      },
      {
        key: 'settings',
        label: 'Conectar',
        description: 'Messenger',
        Icon: MessageCircle,
        isActive: () => active === 'settings',
        run: () => onChange('settings'),
        hide: !!isCashier,
      },
      {
        key: 'operations',
        label: 'Ventas',
        description: 'POS · Inventario',
        Icon: ShoppingCart,
        isActive: () => active === 'operations',
        run: () => onChange('operations'),
      },
      {
        key: 'accounts',
        label: 'Cuentas',
        description: 'Sub-usuarios',
        Icon: Users,
        isActive: () => active === 'accounts',
        run: () => onGoAccounts?.(),
        hide: !!isCashier,
      },
      {
        key: 'records',
        label: 'Registros',
        description: 'Movimientos POS',
        Icon: ScrollText,
        isActive: () => active === 'records',
        run: () => onGoRecords?.(),
        hide: !!isCashier,
      },
      {
        key: 'myprofile',
        label: 'Mi perfil',
        description: 'Tus datos',
        Icon: UserCircle2,
        isActive: () => active === 'myprofile',
        run: () => onGoProfile?.(),
      },
      {
        key: 'logout',
        label: 'Cerrar sesión',
        description: '',
        Icon: LogOut,
        isActive: () => false,
        run: () => onLogout(),
        danger: true,
      },
    ]
    const filtered = base.filter(it => !it.hide)
    const pages: Array<Array<RadialItem | null>> = []
    for (let i = 0; i < filtered.length; i += 6) {
      const slice = filtered.slice(i, i + 6)
      while (slice.length < 6) slice.push(null)
      pages.push(slice)
    }
    if (pages.length === 0) pages.push([null, null, null, null, null, null])
    return pages
  }, [active, onChange, onGoAccounts, onGoRecords, onGoProfile, onLogout, activeDocsTab, onOpenDocsWithTab, isCashier])

  const totalPages = navPages.length

  function handleCoreMouseDown(ev: React.MouseEvent<HTMLButtonElement>) {
    if (stage !== 'closed') return
    if (open) return
    dragStart.current = {
      clientX: ev.clientX,
      clientY: ev.clientY,
      offsetX: ev.clientX - pos.x,
      offsetY: ev.clientY - pos.y,
    }
    setDragMoved(false)
    setIsDragging(true)
  }

  function handleCoreClick() {
    if (dragMoved) return
    if (stage === 'toCenter' || stage === 'toOrigin') return

    if (stage === 'closed') {
      setPosBeforeOpen({ ...pos })
      const vw = typeof window !== 'undefined' ? window.innerWidth : 1440
      const vh = typeof window !== 'undefined' ? window.innerHeight : 900
      const centerX = vw / 2 - 32
      const centerY = vh / 2 - 32
      setStage('toCenter')
      setPos({ x: centerX, y: centerY })
      if (stageTimer.current) window.clearTimeout(stageTimer.current)
      stageTimer.current = window.setTimeout(() => {
        setStage('open')
        setOpen(true)
        stageTimer.current = null
      }, 290)
    } else if (stage === 'open') {
      setOpen(false)
      if (stageTimer.current) window.clearTimeout(stageTimer.current)
      stageTimer.current = window.setTimeout(() => {
        setStage('toOrigin')
        if (posBeforeOpen) setPos(posBeforeOpen)
        stageTimer.current = window.setTimeout(() => {
          setStage('closed')
          setPosBeforeOpen(null)
          stageTimer.current = null
        }, 290)
      }, 320)
    }
  }

  function showToast(label: string) {
    if (toastTimer.current) {
      window.clearTimeout(toastTimer.current)
    }
    setToastMsg(label)
    toastTimer.current = window.setTimeout(() => {
      setToastMsg(null)
      toastTimer.current = null
    }, 1400)
  }

  function handleRun(item: RadialItem | null) {
    if (!item) return
    showToast(item.label)
    if (stageTimer.current) window.clearTimeout(stageTimer.current)
    setOpen(false)
    stageTimer.current = window.setTimeout(() => {
      setStage('toOrigin')
      if (posBeforeOpen) setPos(posBeforeOpen)
      stageTimer.current = window.setTimeout(() => {
        setStage('closed')
        setPosBeforeOpen(null)
        stageTimer.current = null
      }, 290)
    }, 320)
    requestAnimationFrame(() => item.run())
  }

  function handleChangePage(next: number) {
    if (next === page || animPhase !== 'idle') return
    if (next < 0 || next >= totalPages) return
    const dir: 'left' | 'right' = next > page ? 'right' : 'left'
    setAnimDirection(dir)
    setAnimPhase('leave')
    window.setTimeout(() => {
      setDisplayedPage(next)
      setPage(next)
      setAnimPhase('enter')
      window.setTimeout(() => {
        setAnimPhase('idle')
        setAnimDirection('idle')
      }, 220)
    }, 190)
  }

  function clampPosInsideBounds(x: number, y: number): PosXY {
    if (typeof window === 'undefined') return { x, y }
    const size = 64
    return {
      x: Math.max(12, Math.min(window.innerWidth - size - 12, x)),
      y: Math.max(12, Math.min(window.innerHeight - size - 12, y)),
    }
  }

  useEffect(() => {
    function onResize() {
      setPos((p) => clampPosInsideBounds(p.x, p.y))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const displayedItems = navPages[displayedPage] || []

  const radius = 136

  const showRadial = stage === 'open' || stage === 'toOrigin'

  return (
    <div
      ref={rootRef}
      className={cn('pointer-events-none fixed z-[80] select-none')}
      style={{ left: 0, top: 0, width: '100%', height: '100%' }}
    >
      <div
        className={cn(
          'pointer-events-auto absolute inset-0 -z-10 bg-[#081b2e]/45 backdrop-blur-[2px] transition-opacity duration-[220ms]',
          showRadial && open ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
        onClick={() => handleCoreClick()}
      />

      <div
        className={cn(
          'pointer-events-auto absolute',
          stage !== 'closed' && 'transition-[left,top] duration-[280ms]',
        )}
        style={{
          left: pos.x,
          top: pos.y,
          width: 0,
          height: 0,
          transitionTimingFunction: stage !== 'closed' ? 'cubic-bezier(0.16, 1, 0.3, 1)' : undefined,
        }}
      >
        <div
          className={cn(
            'absolute -translate-x-1/2 -translate-y-1/2',
            showRadial && open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
          )}
          style={{
            left: 0,
            top: 0,
            transition: 'opacity 260ms ease',
          }}
        >
          {displayedItems.map((item, idx) => {
            const angle = ANGLES_PER_SLOT[idx]
            if (angle === undefined) return null
            const rad = (angle * Math.PI) / 180
            const cx = Math.cos(rad) * radius
            const cy = Math.sin(rad) * radius
            const empty = !item
            const activeSlot = item?.isActive?.()
            const delay = idx * 40
            const staggerDelay = open ? delay : 200 - delay
            const sign = animDirection === 'right' ? 1 : -1
            let pageOffsetX = 0
            let pageScale = 1
            let pageOpacity = 1
            if (animPhase === 'leave') {
              pageOffsetX = -sign * 18
              pageScale = 0.92
              pageOpacity = 0
            } else if (animPhase === 'enter') {
              pageOffsetX = sign * 18
              pageScale = 1
              pageOpacity = 1
            }
            const baseScale = open ? 1 : 0.55
            return (
              <div
                key={`${displayedPage}-${idx}`}
                className="absolute"
                style={{
                  left: cx,
                  top: cy,
                  transform: `translate(calc(-50% + ${pageOffsetX}px), -50%) scale(${baseScale * pageScale})`,
                  opacity: open ? pageOpacity : 0,
                  transition:
                    animPhase !== 'idle'
                      ? `opacity 220ms ease, transform 220ms cubic-bezier(0.16, 1, 0.3, 1)`
                      : `opacity 280ms cubic-bezier(0.16, 1, 0.3, 1) ${staggerDelay}ms, transform 300ms cubic-bezier(0.16, 1, 0.3, 1) ${staggerDelay}ms`,
                  transformOrigin: 'center',
                }}
              >
                {empty ? (
                  <div className="pointer-events-none flex h-[78px] w-[78px] items-center justify-center">
                    <div className="relative flex h-5 w-5 items-center justify-center">
                      <div className="absolute inset-0 rounded-full bg-[#1090D0]/10 blur-md" />
                      <div className="h-3 w-3 rounded-full bg-[#1a3a5a] ring-1 ring-[#1090D0]/20" />
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleRun(item)}
                    className={cn(
                      'group relative flex h-[78px] w-[78px] flex-col items-center justify-center gap-0.5 rounded-[16px] border text-[10.5px] font-semibold shadow-[0_8px_26px_-12px_rgba(0,0,0,0.55)] backdrop-blur-md transition-all duration-200',
                      item?.danger
                        ? 'border-rose-400/25 bg-rose-500/10 text-rose-200 hover:border-rose-400/70 hover:bg-rose-500/20 hover:text-white hover:scale-105'
                        : activeSlot
                          ? 'border-[#1090D0] bg-[#1090D0]/22 text-white shadow-[inset_0_0_0_1px_rgba(16,144,208,0.4),0_8px_18px_-8px_rgba(16,144,208,0.5)]'
                          : 'border-[#1a3a5a] bg-[#0f3151]/92 text-slate-200 hover:border-[#1090D0]/50 hover:bg-[#143a60]/95 hover:text-white hover:scale-105',
                    )}
                    title={`${item.label}${item.description ? ` · ${item.description}` : ''}`}
                  >
                    <>
                      <item.Icon
                        className={cn(
                          'h-5 w-5',
                          activeSlot
                            ? 'text-[#5bbfe5]'
                            : item?.danger
                              ? 'text-rose-300 group-hover:text-rose-200'
                              : 'text-slate-300 group-hover:text-white',
                        )}
                      />
                      <span className="max-w-[70px] truncate leading-tight">{item.label}</span>
                    </>
                    {activeSlot ? (
                      <span className="pointer-events-none absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-[#1090D0] px-2 py-0.5 text-[8.5px] font-extrabold tracking-[0.25em] text-[#03111d] shadow">
                        ACTIVO
                      </span>
                    ) : null}
                  </button>
                )}
              </div>
            )
          })}

          <div
            className={cn(
              'absolute left-1/2 z-40 flex items-center gap-1 rounded-full bg-[#1090D0] px-2.5 py-1 text-[10px] font-bold text-[#03111d] shadow-lg transition-all duration-200',
              toastMsg ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2 pointer-events-none',
            )}
            style={{ top: -(radius + 92), transform: 'translateX(-50%)' }}
          >
            <ChevronUp className="h-2.5 w-2.5" />
            <span>Yendo a {toastMsg}</span>
          </div>

          <div
            className={cn(
              'absolute left-1/2 flex w-[240px] -translate-x-1/2 items-center justify-between gap-2 transition-all duration-200',
              open ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none',
            )}
            style={{
              top: radius + 58,
              transitionDelay: open ? '180ms' : '0ms',
            }}
          >
            <button
              type="button"
              disabled={page === 0 || animPhase !== 'idle'}
              onClick={() => handleChangePage(page - 1)}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-full border transition-all duration-200',
                page === 0 || animPhase !== 'idle'
                  ? 'cursor-not-allowed border-white/10 bg-white/[0.03] text-white/20'
                  : 'border-[#1a3a5a] bg-[#0b2641] text-slate-200 hover:border-[#1090D0]/50 hover:text-white hover:scale-110 shadow-[0_6px_18px_-10px_rgba(0,0,0,0.6)]',
              )}
              title="Página anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-1.5 rounded-full border border-[#1a3a5a] bg-[#0b2641]/85 px-3 py-1 shadow-[0_6px_18px_-10px_rgba(0,0,0,0.6)] backdrop-blur">
              {Array.from({ length: Math.max(totalPages, 1) }).map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    'h-1.5 rounded-full transition-all duration-200',
                    i === page
                      ? 'w-4 bg-[#1090D0]'
                      : 'w-1.5 bg-[#1a3a5a] hover:bg-[#1090D0]/50',
                  )}
                />
              ))}
            </div>
            <button
              type="button"
              disabled={page >= totalPages - 1 || animPhase !== 'idle'}
              onClick={() => handleChangePage(page + 1)}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-full border transition-all duration-200',
                page >= totalPages - 1 || animPhase !== 'idle'
                  ? 'cursor-not-allowed border-white/10 bg-white/[0.03] text-white/20'
                  : 'border-[#1a3a5a] bg-[#0b2641] text-slate-200 hover:border-[#1090D0]/50 hover:text-white hover:scale-110 shadow-[0_6px_18px_-10px_rgba(0,0,0,0.6)]',
              )}
              title="Siguiente página"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <button
          type="button"
          onMouseDown={handleCoreMouseDown}
          onClick={handleCoreClick}
          disabled={stage === 'toCenter' || stage === 'toOrigin'}
          className={cn(
            'absolute z-30 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border transition-transform duration-200',
            stage === 'toCenter' || stage === 'toOrigin' ? 'pointer-events-none' : '',
            isDragging ? 'cursor-grabbing scale-95' : 'cursor-grab hover:scale-105',
            open
              ? 'border-[#ff6b6b]/60 bg-gradient-to-br from-rose-500/90 to-orange-500/90 shadow-[0_18px_45px_-10px_rgba(244,63,94,0.55)]'
              : 'border-[#1090D0]/70 bg-gradient-to-br from-[#0c2a47] via-[#0d3257] to-[#1090D0]/60 shadow-[0_14px_40px_-10px_rgba(16,144,208,0.55)]',
          )}
          title={open ? 'Cerrar menú' : 'Abrir menú · arrastra para mover'}
        >
          {!open && stage === 'closed' && (
            <>
              <div
                className="pointer-events-none absolute inset-0 -z-10 rounded-full border border-[#1090D0]/30"
                style={{ animation: 'sb-pulse-ring-1 3s ease-out infinite' }}
              />
              <div
                className="pointer-events-none absolute inset-0 -z-10 rounded-full border border-[#1090D0]/20"
                style={{ animation: 'sb-pulse-ring-2 3s ease-out infinite' }}
              />
            </>
          )}
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#0b2641]/70 backdrop-blur">
            {open ? (
              <img src={LogoSb} alt="Smartbis" className="h-7 w-7 object-contain" />
            ) : (
              <div className="flex flex-col items-center gap-0.5">
                <Menu className="h-6 w-6 text-[#9ed9f0]" strokeWidth={2.25} />
                <span className="text-[9px] font-extrabold tracking-[0.3em] text-[#6ec5e6]">SB</span>
              </div>
            )}
          </div>
        </button>
      </div>

      <style>{`
        @keyframes sb-pulse-ring-1 {
          0% { transform: scale(1); opacity: 0.7; }
          70% { transform: scale(1.55); opacity: 0; }
          100% { transform: scale(1.55); opacity: 0; }
        }
        @keyframes sb-pulse-ring-2 {
          0% { transform: scale(1); opacity: 0.5; animation-delay: 1.5s; }
          70% { transform: scale(1.85); opacity: 0; }
          100% { transform: scale(1.85); opacity: 0; }
        }
      `}</style>
    </div>
  )
}
