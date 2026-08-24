import {
  RefreshCw,
  ShoppingCart,
  Package,
  ArrowRightLeft,
  MapPin,
  Settings,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

export type OperationsPage =
  | 'refresh'
  | 'pos'
  | 'inventory'
  | 'purchases'
  | 'branches'
  | 'dashboard'
  | 'settings'

type NavItem = {
  id: OperationsPage
  num: number
  label: string
  icon: typeof RefreshCw
  title: string
}

const navItems: NavItem[] = [
  { id: 'refresh', num: 1, label: '', icon: RefreshCw, title: 'Refrescar' },
  { id: 'pos', num: 2, label: '#1 Punto de Venta', icon: ShoppingCart, title: '#1 Punto de Venta' },
  { id: 'inventory', num: 3, label: '#2 Inventario', icon: Package, title: '#2 Inventario' },
  { id: 'purchases', num: 4, label: '#3 Ventas', icon: ArrowRightLeft, title: '#3 Ventas' },
  { id: 'branches', num: 5, label: '#4 Sucursales', icon: MapPin, title: '#4 Sucursales' },
  { id: 'settings', num: 6, label: '#5 Configuración', icon: Settings, title: '#5 Configuración' },
]

type CrmOperationsLayoutProps = {
  active: OperationsPage
  setActive: (p: OperationsPage) => void
  userEmail: string
  branchId?: string
  branchName?: string
  children: ReactNode
  onRefresh?: () => void
  isCashier?: boolean
}

export default function CrmOperationsLayout(props: CrmOperationsLayoutProps) {
  const { active, setActive, children, onRefresh, isCashier = false } = props

  function handleItemClick(item: NavItem) {
    if (item.id === 'refresh') {
      onRefresh?.()
      return
    }
    setActive(item.id)
  }

  const visibleNavItems = isCashier
    ? navItems.filter(i => ['refresh', 'pos', 'inventory'].includes(i.id))
    : navItems

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#0c2a47] text-white">
      <aside className="flex w-[88px] shrink-0 flex-col items-center border-r border-[#1a3a5a] bg-[#0b2540] px-3 py-5">
        <nav className="flex flex-1 flex-col items-center gap-3">
          {visibleNavItems.map((item) => {
            const Icon = item.icon
            const isActive = active === item.id
            const isRefresh = item.id === 'refresh'
            return (
              <button
                key={item.id}
                type="button"
                title={item.title}
                onClick={() => handleItemClick(item)}
                className={cn(
                  'group relative flex h-[54px] w-[54px] shrink-0 items-center justify-center rounded-[18px] border transition',
                  isRefresh
                    ? isActive
                      ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                      : 'border-[#1a3a5a] bg-[#0f3151] text-slate-300 hover:border-emerald-400/30 hover:text-emerald-200'
                    : isActive
                      ? 'border-[#1090D0]/60 bg-[#1090D0]/18 text-[#5bbfe5] shadow-[inset_0_0_0_1px_rgba(16,144,208,0.28)]'
                      : 'border-[#1a3a5a] bg-[#0f3151] text-slate-300 hover:border-[#2a5589] hover:bg-[#173c66]/70 hover:text-slate-100',
                )}
              >
                <Icon
                  className={cn(
                    'h-5 w-5',
                    isActive && !isRefresh ? 'text-[#1090D0]' : '',
                  )}
                />

                {item.label ? (
                  <div className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded-[12px] border border-[#1a3a5a] bg-[#0f3151] px-2.5 py-1.5 text-[11px] font-semibold text-slate-100 opacity-0 shadow-lg shadow-black/40 transition group-hover:opacity-100">
                    {item.label}
                  </div>
                ) : null}
              </button>
            )
          })}
        </nav>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  )
}
