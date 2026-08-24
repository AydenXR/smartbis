import { useEffect, useState } from 'react'
import { Plus, Users, Pencil, Trash2, X, Mail, User, Shield, Building2, RefreshCw, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  type PosBranch,
  type PosRole,
  type PosSubuser,
  posBranches,
  posSubusers,
  posSubuserCreate,
  posSubuserUpdate,
  posSubuserDelete,
} from '@/lib/api'

type ModalMode = 'create' | 'edit' | null

type FormState = {
  id?: string
  name: string
  email: string
  password: string
  role: PosRole
  branchId: string
  active: boolean
}

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$'
  let out = ''
  for (let i = 0; i < 12; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

const emptyForm: FormState = {
  name: '',
  email: '',
  password: '',
  role: 'cashier',
  branchId: '',
  active: true,
}

export default function CrmAccountsView() {
  const [users, setUsers] = useState<PosSubuser[]>([])
  const [branches, setBranches] = useState<PosBranch[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [modalMode, setModalMode] = useState<ModalMode>(null)
  const [form, setForm] = useState<FormState>({ ...emptyForm })
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<PosSubuser | null>(null)

  async function loadAll() {
    setLoading(true)
    setError('')
    try {
      const [uRes, bRes] = await Promise.all([posSubusers(), posBranches()])
      setUsers(uRes.users)
      setBranches(bRes.branches)
    } catch (e: any) {
      setError(e?.message || 'No se pudieron cargar los datos')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadAll()
  }, [])

  function branchName(id: string) {
    return branches.find((b) => b.id === id)?.name || '—'
  }

  function openCreate() {
    setForm({ ...emptyForm, password: generatePassword(), branchId: branches[0]?.id || '' })
    setModalMode('create')
  }

  function openEdit(u: PosSubuser) {
    setForm({
      id: u.id,
      name: u.name,
      email: u.email,
      password: '',
      role: u.role,
      branchId: u.branchId,
      active: u.active,
    })
    setModalMode('edit')
  }

  function closeModal() {
    setModalMode(null)
    setForm({ ...emptyForm })
  }

  async function handleSave() {
    const isAdminRole = form.role === 'admin'
    if (!form.name.trim() || !form.email.trim()) return
    if (!isAdminRole && !form.branchId) return
    if (modalMode === 'create' && !form.password.trim()) return
    setSaving(true)
    setError('')
    try {
      if (modalMode === 'create') {
        await posSubuserCreate({
          name: form.name.trim(),
          email: form.email.trim(),
          password: form.password,
          role: form.role,
          branchId: form.branchId,
        })
      } else if (modalMode === 'edit' && form.id) {
        const payload: any = {
          name: form.name.trim(),
          role: form.role,
          branchId: form.branchId,
          active: form.active,
        }
        if (form.password.trim()) payload.newPassword = form.password
        await posSubuserUpdate(form.id, payload)
      }
      closeModal()
      void loadAll()
    } catch (e: any) {
      setError(e?.message || 'No se pudo guardar')
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleActive(u: PosSubuser) {
    try {
      await posSubuserUpdate(u.id, { active: !u.active })
      void loadAll()
    } catch (e: any) {
      setError(e?.message || 'No se pudo actualizar')
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return
    try {
      await posSubuserDelete(confirmDelete.id)
      setConfirmDelete(null)
      void loadAll()
    } catch (e: any) {
      setError(e?.message || 'No se pudo eliminar')
    }
  }

  return (
    <section className="flex min-h-0 w-full flex-col overflow-hidden bg-[#0c2a47] px-6 py-6 text-white">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[16px] bg-[#1090D0]/15 text-[#5bbfe5]">
            <Users className="h-5 w-5" />
          </div>
          <h2 className="text-[22px] font-bold tracking-tight text-slate-50">
            Cuentas · Sub-usuarios
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {error ? (
            <div className="flex items-center gap-2 rounded-[14px] border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-[11.5px] text-rose-200">
              <AlertCircle className="h-3.5 w-3.5" />
              {error}
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => void loadAll()}
            disabled={loading}
            className="flex h-9 items-center gap-2 rounded-[14px] border border-[#1a3a5a] bg-[#11375a] px-3.5 text-[12px] font-semibold text-slate-200 transition hover:border-[#1090D0]/40 disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            Refrescar
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="flex h-9 items-center gap-2 rounded-[14px] bg-[#1090D0] px-4 text-[12px] font-bold text-white transition hover:bg-[#0c79ae]"
          >
            <Plus className="h-4 w-4" />
            Nueva cuenta
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto rounded-[20px] border border-[#1a3a5a] bg-[#0f3151]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-[#1a3a5a] bg-[#0b2641]/70 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              <tr>
                <th className="px-5 py-3">Nombre</th>
                <th className="px-5 py-3">Email</th>
                <th className="px-5 py-3">Rol</th>
                <th className="px-5 py-3">Sucursal</th>
                <th className="px-5 py-3">Activo</th>
                <th className="px-5 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && !loading ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-[12.5px] text-slate-400">
                    Aún no hay sub-usuarios creados.
                  </td>
                </tr>
              ) : null}
              {users.map((u) => (
                <tr key={u.id} className="border-b border-[#1a3a5a]/50 last:border-0 hover:bg-[#11375a]/40">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#1090D0]/15 text-[12px] font-bold text-[#5bbfe5]">
                        {u.name
                          .split(' ')
                          .map((s) => s[0])
                          .filter(Boolean)
                          .slice(0, 2)
                          .join('')
                          .toUpperCase()}
                      </div>
                      <span className="font-semibold text-slate-100">{u.name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-slate-200">{u.email}</td>
                  <td className="px-5 py-3">
                    {u.role === 'admin' ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/30 bg-violet-500/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-violet-200">
                        <Shield className="h-3 w-3" />
                        Admin
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-emerald-200">
                        <Shield className="h-3 w-3" />
                        Caja
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <div className="inline-flex items-center gap-1.5 rounded-[12px] bg-[#0b2641]/60 px-2.5 py-1 text-[12px] text-slate-200">
                      <Building2 className="h-3 w-3 text-slate-400" />
                      {branchName(u.branchId)}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <button
                      type="button"
                      onClick={() => handleToggleActive(u)}
                      className={cn(
                        'relative inline-flex h-6 w-11 items-center rounded-full transition',
                        u.active ? 'bg-[#1090D0]' : 'bg-slate-600/60',
                      )}
                    >
                      <span
                        className={cn(
                          'inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition',
                          u.active ? 'translate-x-5' : 'translate-x-0.5',
                        )}
                      />
                    </button>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => openEdit(u)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#1a3a5a] bg-[#0b2641] text-slate-300 transition hover:border-[#1090D0]/40 hover:text-[#5bbfe5]"
                        title="Editar"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(u)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#1a3a5a] bg-[#0b2641] text-slate-300 transition hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-300"
                        title="Eliminar"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modalMode ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-[20px] border border-[#1a3a5a] bg-[#0f3151] shadow-2xl shadow-black/50">
            <div className="flex items-center justify-between border-b border-[#1a3a5a] px-5 py-4">
              <h3 className="text-[16px] font-bold text-slate-50">
                {modalMode === 'create' ? 'Nueva cuenta' : 'Editar cuenta'}
              </h3>
              <button
                type="button"
                onClick={closeModal}
                className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition hover:bg-[#0b2641] hover:text-slate-100"
              >
                <X className="h-4.5 w-4.5" />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Nombre completo
                  </label>
                  <div className="flex items-center gap-2 rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2.5 focus-within:border-[#1090D0]/50">
                    <User className="h-4 w-4 text-slate-400" />
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="Ej. Juan Pérez"
                      className="flex-1 bg-transparent text-[13.5px] text-slate-100 placeholder:text-slate-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <label className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Email
                  </label>
                  <div className="flex items-center gap-2 rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2.5 focus-within:border-[#1090D0]/50">
                    <Mail className="h-4 w-4 text-slate-400" />
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      placeholder="usuario@ejemplo.com"
                      className="flex-1 bg-transparent text-[13.5px] text-slate-100 placeholder:text-slate-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <label className="mb-1.5 flex items-center justify-between text-[11.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    <span>Contraseña {modalMode === 'edit' ? '(dejar vacío para no cambiar)' : ''}</span>
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, password: generatePassword() })}
                      className="normal-case tracking-normal text-[11px] font-semibold text-[#5bbfe5] transition hover:text-[#1090D0]"
                    >
                      Generar sugerencia
                    </button>
                  </label>
                  <div className="rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2.5 focus-within:border-[#1090D0]/50">
                    <input
                      type="text"
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      placeholder="••••••••"
                      className="w-full bg-transparent font-mono text-[13.5px] text-slate-100 placeholder:text-slate-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Rol
                  </label>
                  <div className="flex gap-2 rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] p-1.5">
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, role: 'admin' })}
                      className={cn(
                        'flex-1 rounded-[10px] px-3 py-2 text-[12px] font-bold transition',
                        form.role === 'admin'
                          ? 'bg-violet-500/85 text-white shadow-inner'
                          : 'text-slate-300 hover:text-white',
                      )}
                    >
                      Admin
                    </button>
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, role: 'cashier' })}
                      className={cn(
                        'flex-1 rounded-[10px] px-3 py-2 text-[12px] font-bold transition',
                        form.role === 'cashier'
                          ? 'bg-emerald-500/85 text-white shadow-inner'
                          : 'text-slate-300 hover:text-white',
                      )}
                    >
                      Caja
                    </button>
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 flex items-center justify-between text-[11.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    <span>Sucursal</span>
                    {form.role === 'admin' ? (
                      <span className="normal-case tracking-normal text-[10.5px] text-violet-300/90">
                        Admin: controla todas las cajas
                      </span>
                    ) : null}
                  </label>
                  <div
                    className={cn(
                      'flex items-center gap-2 rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2.5 focus-within:border-[#1090D0]/50',
                      form.role === 'admin' ? 'opacity-60' : '',
                    )}
                  >
                    <Building2 className="h-4 w-4 text-slate-400" />
                    <select
                      value={form.branchId}
                      onChange={(e) => setForm({ ...form, branchId: e.target.value })}
                      disabled={form.role === 'admin'}
                      className="flex-1 bg-transparent text-[13.5px] text-slate-100 focus:outline-none disabled:cursor-not-allowed disabled:opacity-80"
                    >
                      {form.role === 'admin' ? (
                        <option value="" className="bg-[#0f3151]">
                          (Todas · Control total)
                        </option>
                      ) : (
                        <option value="" className="bg-[#0f3151]">
                          Seleccionar...
                        </option>
                      )}
                      {branches.map((b) => (
                        <option key={b.id} value={b.id} className="bg-[#0f3151]">
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {modalMode === 'edit' ? (
                  <div className="sm:col-span-2">
                    <label className="mb-1.5 flex items-center justify-between rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2.5">
                      <span className="text-[11.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                        Cuenta activa
                      </span>
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, active: !form.active })}
                        className={cn(
                          'relative inline-flex h-6 w-11 items-center rounded-full transition',
                          form.active ? 'bg-[#1090D0]' : 'bg-slate-600/60',
                        )}
                      >
                        <span
                          className={cn(
                            'inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition',
                            form.active ? 'translate-x-5' : 'translate-x-0.5',
                          )}
                        />
                      </button>
                    </label>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#1a3a5a] px-5 py-4">
              <button
                type="button"
                onClick={closeModal}
                className="rounded-[14px] border border-[#1a3a5a] bg-[#11375a] px-4 py-2 text-[12.5px] font-semibold text-slate-200 transition hover:border-[#1090D0]/40 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={
                  saving ||
                  !form.name.trim() ||
                  !form.email.trim() ||
                  !form.branchId ||
                  (modalMode === 'create' && !form.password.trim())
                }
                onClick={() => void handleSave()}
                className={cn(
                  'rounded-[14px] px-5 py-2 text-[12.5px] font-bold text-white transition',
                  saving ||
                  !form.name.trim() ||
                  !form.email.trim() ||
                  !form.branchId ||
                  (modalMode === 'create' && !form.password.trim())
                    ? 'bg-[#1090D0]/50 opacity-60'
                    : 'bg-[#1090D0] hover:bg-[#0c79ae]',
                )}
              >
                {saving ? 'Guardando...' : modalMode === 'create' ? 'Crear cuenta' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmDelete ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-[20px] border border-[#1a3a5a] bg-[#0f3151] shadow-2xl shadow-black/50">
            <div className="p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-rose-500/15 text-rose-300">
                  <Trash2 className="h-5.5 w-5.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[15.5px] font-bold text-slate-50">Eliminar cuenta</h3>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-300">
                    Se eliminará permanentemente la cuenta de{' '}
                    <span className="font-semibold text-white">{confirmDelete.name}</span> (
                    {confirmDelete.email}). Esta acción no se puede deshacer.
                  </p>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#1a3a5a] px-5 py-4">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="rounded-[14px] border border-[#1a3a5a] bg-[#11375a] px-4 py-2 text-[12.5px] font-semibold text-slate-200 transition hover:border-[#1090D0]/40 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                className="rounded-[14px] border border-rose-500/30 bg-rose-500 px-4 py-2 text-[12.5px] font-bold text-white transition hover:bg-rose-600"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Trash2 className="h-4 w-4" />
                  Eliminar
                </span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
