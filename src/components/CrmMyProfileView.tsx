import { useState } from 'react'
import { User, Mail, Building2, Shield, Calendar, Key, Pencil, X, Check, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'

type CrmMyProfileViewProps = {
  userEmail: string
  userName?: string
  displayName?: string
  userRole?: 'owner' | 'admin' | 'admin_pv' | 'admin_cs' | 'cashier' | 'cs_agent'
  branchName?: string
  memberSince?: string
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Propietario',
  admin: 'Administrador',
  admin_pv: 'Admin PV',
  admin_cs: 'Admin CS',
  cashier: 'Caja',
  cs_agent: 'Agente CS',
}

export default function CrmMyProfileView(props: CrmMyProfileViewProps) {
  const {
    userEmail,
    userName: initialName,
    displayName,
    userRole = 'admin',
    branchName = 'Sucursal Principal',
    memberSince = '01/01/2025',
  } = props
  const defaultName = displayName || userEmail?.split('@')[0] || 'Usuario'
  const nameSource = typeof initialName === 'string' && initialName.length ? initialName : defaultName

  const [editingName, setEditingName] = useState(false)
  const [name, setName] = useState(nameSource)
  const [tempName, setTempName] = useState(nameSource)
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const initials = (name || userEmail || 'U')
    .split(' ')
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()

  function startEditName() {
    setTempName(name)
    setEditingName(true)
  }

  function cancelEditName() {
    setTempName(name)
    setEditingName(false)
  }

  function saveName() {
    if (tempName.trim()) {
      setName(tempName.trim())
    }
    setEditingName(false)
  }

  function closePasswordModal() {
    setShowPasswordModal(false)
    setNewPassword('')
    setConfirmPassword('')
  }

  return (
    <section className="flex min-h-0 w-full flex-col overflow-auto bg-[#0c2a47] px-6 py-6 text-white">
      <header className="mb-6 flex items-center justify-between">
        <h2 className="text-[22px] font-bold tracking-tight text-slate-50">Mi perfil</h2>
      </header>

      <div className="mx-auto w-full max-w-3xl">
        <div className="rounded-[20px] border border-[#1a3a5a] bg-[#0f3151] p-6 shadow-lg shadow-black/20">
          <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
            <div className="relative flex h-24 w-24 shrink-0 items-center justify-center rounded-full border-2 border-[#1090D0]/40 bg-gradient-to-br from-[#1090D0]/20 to-[#0c2a47] text-[28px] font-bold text-[#5bbfe5]">
              {initials}
            </div>

            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                {editingName ? (
                  <div className="flex items-center gap-2 rounded-[14px] border border-[#1090D0]/40 bg-[#0b2641] px-3 py-1.5">
                    <User className="h-4 w-4 text-slate-300" />
                    <input
                      type="text"
                      value={tempName}
                      onChange={(e) => setTempName(e.target.value)}
                      className="w-48 bg-transparent text-[15px] font-semibold text-slate-50 placeholder:text-slate-500 focus:outline-none"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={saveName}
                      className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/80 text-white transition hover:bg-emerald-500"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={cancelEditName}
                      className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-500/60 text-white transition hover:bg-slate-500"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <h3 className="text-[20px] font-bold text-slate-50">{name}</h3>
                    <button
                      type="button"
                      onClick={startEditName}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#1a3a5a] bg-[#0b2641] text-slate-300 transition hover:border-[#1090D0]/40 hover:text-[#5bbfe5]"
                      title="Editar nombre"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 rounded-[14px] border border-[#1a3a5a] bg-[#0b2641]/60 px-3 py-2">
                <Mail className="h-4 w-4 text-slate-400" />
                <span className="text-[13px] text-slate-200">{userEmail}</span>
              </div>

              <div className="flex flex-wrap gap-2.5">
                <div className="flex items-center gap-2 rounded-[14px] border border-[#1090D0]/30 bg-[#1090D0]/10 px-3 py-2">
                  <Shield className="h-4 w-4 text-[#5bbfe5]" />
                  <span className="text-[12.5px] font-semibold uppercase tracking-wider text-[#5bbfe5]">
                    {ROLE_LABELS[userRole] || 'Administrador'}
                  </span>
                </div>
                <div className="flex items-center gap-2 rounded-[14px] border border-[#1a3a5a] bg-[#11375a] px-3 py-2">
                  <Building2 className="h-4 w-4 text-slate-300" />
                  <span className="text-[12.5px] text-slate-200">{branchName}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-[18px] border border-[#1a3a5a] bg-[#0b2641]/50 p-4">
              <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                <Calendar className="h-3.5 w-3.5" />
                Miembro desde
              </div>
              <p className="text-[14px] font-semibold text-slate-100">{memberSince}</p>
            </div>

            <button
              type="button"
              onClick={() => setShowPasswordModal(true)}
              className="flex items-center gap-3 rounded-[18px] border border-[#1a3a5a] bg-[#0b2641]/50 p-4 text-left transition hover:border-[#1090D0]/40 hover:bg-[#10304e]"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-[#1090D0]/15 text-[#5bbfe5]">
                <Key className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-semibold text-slate-100">Restablecer contraseña</p>
                <p className="text-[11.5px] text-slate-400">Generar nueva contraseña de acceso</p>
              </div>
            </button>
          </div>
        </div>
      </div>

      {showPasswordModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-[20px] border border-[#1a3a5a] bg-[#0f3151] shadow-2xl shadow-black/50">
            <div className="flex items-center justify-between border-b border-[#1a3a5a] px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-[#1090D0]/15 text-[#5bbfe5]">
                  <Lock className="h-5 w-5" />
                </div>
                <h3 className="text-[16px] font-bold text-slate-50">Cambiar contraseña</h3>
              </div>
              <button
                type="button"
                onClick={closePasswordModal}
                className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition hover:bg-[#0b2641] hover:text-slate-100"
              >
                <X className="h-4.5 w-4.5" />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <div>
                <label className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Nueva contraseña
                </label>
                <div className="flex items-center gap-2 rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2.5">
                  <Lock className="h-4 w-4 text-slate-400" />
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                    className="flex-1 bg-transparent text-[13.5px] text-slate-100 placeholder:text-slate-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Confirmar contraseña
                </label>
                <div className="flex items-center gap-2 rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2.5">
                  <Lock className="h-4 w-4 text-slate-400" />
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="flex-1 bg-transparent text-[13.5px] text-slate-100 placeholder:text-slate-500 focus:outline-none"
                  />
                </div>
              </div>

              {newPassword && confirmPassword && newPassword !== confirmPassword ? (
                <div className="rounded-[14px] border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-200">
                  Las contraseñas no coinciden.
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#1a3a5a] px-5 py-4">
              <button
                type="button"
                onClick={closePasswordModal}
                className="rounded-[14px] border border-[#1a3a5a] bg-[#11375a] px-4 py-2 text-[12.5px] font-semibold text-slate-200 transition hover:border-[#1090D0]/40 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={!newPassword || newPassword !== confirmPassword}
                onClick={closePasswordModal}
                className={cn(
                  'rounded-[14px] px-4 py-2 text-[12.5px] font-bold text-white transition',
                  !newPassword || newPassword !== confirmPassword
                    ? 'bg-[#1090D0]/50 opacity-60'
                    : 'bg-[#1090D0] hover:bg-[#0c79ae]',
                )}
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
