import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { CrmPage } from '@/store/useMetaCrmStore'
import {
  MessageCircle,
  FileText,
  Settings2,
  LogOut,
  User2,
  ChevronUp,
  UserCircle2,
  Users,
  ShoppingCart,
  ScrollText,
} from 'lucide-react'
import type { MetaStatusResponse } from '@/lib/api'
import LogoSb from '../assets/logosb.png'

type CrmSidebarProps = {
  active: CrmPage
  onChange: (p: CrmPage) => void
  status: MetaStatusResponse | null
  userEmail: string
  onLogout: () => void
  workspaceName?: string
}

const items: Array<{
  id: CrmPage
  label: string
  icon: typeof Settings2
  hint?: string
}> = [
  { id: 'chats', label: 'Chats', icon: MessageCircle, hint: 'Messenger Facebook' },
  { id: 'docs', label: 'Prompt y Documentos', icon: FileText, hint: 'Prompts, MD' },
  { id: 'settings', label: 'Conectar Messenger', icon: Settings2, hint: 'Facebook login' },
  { id: 'operations', label: 'Operaciones', icon: ShoppingCart, hint: 'Punto de Venta · Inventario' },
]

type Props = CrmSidebarProps & {
  onGoAccounts?: () => void
  onGoRecords?: () => void
  onGoProfile?: () => void
}
type CrmSidebarProps_Actual = Props

export default function CrmSidebar({
  active,
  onChange,
  status,
  userEmail,
  onLogout,
  onGoAccounts,
  onGoRecords,
  onGoProfile,
}: CrmSidebarProps_Actual) {
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  // Cerrar dropdown al hacer click afuera
  useEffect(() => {
    if (!userMenuOpen) return
    function onDocClick(ev: MouseEvent) {
      if (!menuRef.current) return
      if (menuRef.current.contains(ev.target as Node)) return
      setUserMenuOpen(false)
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') setUserMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [userMenuOpen])

  return (
    <aside className="flex h-screen min-h-0 w-full max-w-[260px] shrink-0 flex-col overflow-hidden border-r border-[#1a3a5a] bg-[#0b2540] px-5 py-5 text-white">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Logo Smartbis + texto */}
        <div className="mb-5 flex flex-col items-center justify-center gap-1 pb-3 text-center">
          <img
            src={LogoSb}
            alt="Smartbis"
            className="h-16 w-16 shrink-0 object-contain drop-shadow-[0_0_0_rgba(16,144,208,0.25)]"
          />
          <p className="text-[18px] font-extrabold tracking-[0.22em] text-[#1090D0]">
            SMARTBIS
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-0.5 tech-scrollbar space-y-5">
          <nav className="space-y-2.5">
            {items.map((item) => {
              const Icon = item.icon
              const isActive = active === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onChange(item.id)}
                  className={cn(
                    'group flex w-full items-center gap-3 rounded-[18px] border px-4 py-3 text-left text-[13px] font-semibold transition',
                    isActive
                      ? 'border-[#1090D0]/60 bg-[#1090D0]/15 text-white shadow-[inset_0_0_0_1px_rgba(16,144,208,0.25)]'
                      : 'border-[#1e3e64]/70 bg-[#133558]/40 text-slate-200 hover:border-[#2a5589] hover:bg-[#173c66]/60',
                  )}
                >
                  <Icon
                    className={cn(
                      'h-4 w-4',
                      isActive ? 'text-[#1090D0]' : 'text-slate-300',
                    )}
                  />
                  <div className="min-w-0 flex flex-col">
                    <span>{item.label}</span>
                    {item.hint ? (
                      <span
                        className={cn(
                          'text-[11px] font-normal',
                          isActive ? 'text-[#5bbfe5]' : 'text-slate-400',
                        )}
                      >
                        {item.hint}
                      </span>
                    ) : null}
                  </div>
                </button>
              )
            })}
          </nav>
        </div>
      </div>

      {/* Usuario + dropdown HACIA ARRIBA */}
      <div className="relative mt-auto border-t border-[#1a3a5a] pt-4" ref={menuRef}>
        {/* Dropdown — abre HACIA ARRIBA */}
        {userMenuOpen ? (
          <div className="absolute bottom-[calc(100%-8px)] left-0 right-0 z-50 mb-2 overflow-hidden rounded-[18px] border border-[#1a3a5a] bg-[#0d2a48] shadow-[0_-6px_30px_-10px_rgba(0,0,0,0.55)]">
            <ul className="flex flex-col">
              <li>
                <button
                  type="button"
                  onClick={() => {
                    setUserMenuOpen(false)
                    onGoProfile?.()
                  }}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[12.5px] font-semibold text-slate-100 transition hover:bg-[#1090D0]/10"
                >
                  <UserCircle2 className="h-4 w-4 text-[#6bb8dd]" />
                  Mi perfil
                </button>
              </li>
              <li className="h-px bg-[#1a3a5a]" />
              <li>
                <button
                  type="button"
                  onClick={() => {
                    setUserMenuOpen(false)
                    onGoAccounts?.()
                  }}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[12.5px] font-semibold text-slate-100 transition hover:bg-[#1090D0]/10"
                >
                  <Users className="h-4 w-4 text-[#6bb8dd]" />
                  Cuentas
                </button>
              </li>
              <li className="h-px bg-[#1a3a5a]" />
              <li>
                <button
                  type="button"
                  onClick={() => {
                    setUserMenuOpen(false)
                    onGoRecords?.()
                  }}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[12.5px] font-semibold text-slate-100 transition hover:bg-[#1090D0]/10"
                >
                  <ScrollText className="h-4 w-4 text-[#6bb8dd]" />
                  Registros
                </button>
              </li>
            </ul>
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => setUserMenuOpen((v) => !v)}
          className="flex w-full items-center gap-3 rounded-[18px] border border-[#1a3a5a] bg-[#0d2a48]/70 px-3 py-3 text-left transition hover:border-[#1090D0]/40 hover:bg-[#10304e]"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#1090D0]/15 text-[#1090D0]">
            <User2 className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">
              {userEmail?.split('@')[0] || 'Usuario'}
            </p>
            <p className="truncate text-xs text-slate-300">{userEmail}</p>
          </div>
          <ChevronUp
            className={cn(
              'h-4 w-4 shrink-0 text-slate-300 transition-transform',
              userMenuOpen ? 'rotate-180 text-[#1090D0]' : '',
            )}
          />
        </button>

        {/* Logout botón separado */}
        <button
          type="button"
          title="Cerrar sesión"
          onClick={onLogout}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-[16px] border border-[#1a3a5a] bg-transparent px-3 py-2 text-[11.5px] font-semibold text-slate-200 transition hover:border-rose-400/30 hover:bg-rose-400/10 hover:text-rose-200"
        >
          <LogOut className="h-3.5 w-3.5" />
          Cerrar sesión
        </button>
      </div>
    </aside>
  )
}
