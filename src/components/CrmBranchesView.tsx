import { useEffect, useState } from 'react'
import { MapPin, Plus, Pencil, Trash2, X, Building2, Phone, User as UserIcon, RefreshCw, AlertCircle, Check, Star, Percent } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  type PosBranch,
  posBranches,
  posBranchSave,
  posBranchDelete,
} from '@/lib/api'

type ModalMode = 'create' | 'edit' | null

type FormState = {
  id?: string
  name: string
  address: string
  phone: string
  manager: string
  isMain: boolean
  active: boolean
  ivaEnabled: boolean
  ivaRate: number
  currency: string
}

const emptyForm: FormState = {
  name: '',
  address: '',
  phone: '',
  manager: '',
  isMain: false,
  active: true,
  ivaEnabled: true,
  ivaRate: 16,
  currency: 'MXN',
}

export default function CrmBranchesView() {
  const [branches, setBranches] = useState<PosBranch[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [modalMode, setModalMode] = useState<ModalMode>(null)
  const [form, setForm] = useState<FormState>({ ...emptyForm })
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<PosBranch | null>(null)
  const [editingIva, setEditingIva] = useState<Record<string, number | undefined>>({})
  const [savingIva, setSavingIva] = useState<string | null>(null)

  async function loadAll() {
    setLoading(true)
    setError('')
    try {
      const res = await posBranches()
      setBranches(res.branches)
    } catch (e: any) {
      setError(e?.message || 'No se pudieron cargar las sucursales')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadAll()
  }, [])

  function openCreate() {
    setForm({ ...emptyForm })
    setModalMode('create')
  }

  function openEdit(b: PosBranch) {
    setForm({
      id: b.id,
      name: b.name,
      address: b.address || '',
      phone: b.phone || '',
      manager: b.manager || '',
      isMain: b.isMain,
      active: b.active,
      ivaEnabled: b.ivaEnabled,
      ivaRate: b.ivaRate,
      currency: b.currency || 'MXN',
    })
    setModalMode('edit')
  }

  function closeModal() {
    setModalMode(null)
    setForm({ ...emptyForm })
  }

  async function handleSave() {
    if (!form.name.trim()) return
    setSaving(true)
    setError('')
    try {
      const payload: any = {
        name: form.name.trim(),
        address: form.address.trim() || undefined,
        phone: form.phone.trim() || undefined,
        manager: form.manager.trim() || undefined,
        isMain: form.isMain,
        active: form.active,
        ivaEnabled: form.ivaEnabled,
        ivaRate: Number(form.ivaRate) || 0,
        currency: form.currency.trim() || 'MXN',
      }
      if (modalMode === 'edit' && form.id) {
        payload.id = form.id
      }
      await posBranchSave(payload)
      closeModal()
      void loadAll()
    } catch (e: any) {
      setError(e?.message || 'No se pudo guardar')
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(b: PosBranch, field: 'active' | 'ivaEnabled' | 'isMain') {
    try {
      await posBranchSave({
        id: b.id,
        name: b.name,
        [field]: !b[field],
      })
      void loadAll()
    } catch (e: any) {
      setError(e?.message || 'No se pudo actualizar')
    }
  }

  function startEditIva(b: PosBranch) {
    setEditingIva((prev) => ({ ...prev, [b.id]: b.ivaRate }))
  }

  async function saveIva(b: PosBranch) {
    const next = editingIva[b.id]
    if (next === undefined) return
    setSavingIva(b.id)
    try {
      await posBranchSave({
        id: b.id,
        name: b.name,
        ivaRate: Number(next) || 0,
      })
      setEditingIva((prev) => {
        const copy = { ...prev }
        delete copy[b.id]
        return copy
      })
      void loadAll()
    } catch (e: any) {
      setError(e?.message || 'No se pudo guardar IVA')
    } finally {
      setSavingIva(null)
    }
  }

  function cancelEditIva(id: string) {
    setEditingIva((prev) => {
      const copy = { ...prev }
      delete copy[id]
      return copy
    })
  }

  async function handleDelete() {
    if (!confirmDelete) return
    try {
      await posBranchDelete(confirmDelete.id)
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
            <MapPin className="h-5 w-5" />
          </div>
          <h2 className="text-[22px] font-bold tracking-tight text-slate-50">Sucursales</h2>
          <span className="rounded-full border border-[#1090D0]/40 bg-[#1090D0]/10 px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-[#5bbfe5]">
            Piso #4
          </span>
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
            Nueva sucursal
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto rounded-[20px] border border-[#1a3a5a] bg-[#0f3151]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-[#1a3a5a] bg-[#0b2641]/70 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              <tr>
                <th className="px-5 py-3">Nombre</th>
                <th className="px-5 py-3">Dirección</th>
                <th className="px-5 py-3">Teléfono</th>
                <th className="px-5 py-3">Manager</th>
                <th className="px-5 py-3 text-center">Principal</th>
                <th className="px-5 py-3 text-center">Activa</th>
                <th className="px-5 py-3 text-center">IVA</th>
                <th className="px-5 py-3">IVA %</th>
                <th className="px-5 py-3">Moneda</th>
                <th className="px-5 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {branches.length === 0 && !loading ? (
                <tr>
                  <td colSpan={10} className="px-5 py-12 text-center text-[12.5px] text-slate-400">
                    Aún no hay sucursales creadas.
                  </td>
                </tr>
              ) : null}
              {branches.map((b) => (
                <tr key={b.id} className="border-b border-[#1a3a5a]/50 last:border-0 hover:bg-[#11375a]/40">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-[#1090D0]/15 text-[#5bbfe5]">
                        <Building2 className="h-4 w-4" />
                      </div>
                      <span className="font-semibold text-slate-100">{b.name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 max-w-[220px] truncate text-slate-300" title={b.address}>
                    {b.address || <span className="text-slate-500">—</span>}
                  </td>
                  <td className="px-5 py-3 text-slate-300">
                    {b.phone ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Phone className="h-3.5 w-3.5 text-slate-500" />
                        {b.phone}
                      </span>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-slate-300">
                    {b.manager ? (
                      <span className="inline-flex items-center gap-1.5">
                        <UserIcon className="h-3.5 w-3.5 text-slate-500" />
                        {b.manager}
                      </span>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-center">
                    <button
                      type="button"
                      onClick={() => handleToggle(b, 'isMain')}
                      className={cn(
                        'inline-flex h-8 w-8 items-center justify-center rounded-[10px] border transition',
                        b.isMain
                          ? 'border-amber-400/40 bg-amber-400/15 text-amber-300'
                          : 'border-[#1a3a5a] bg-[#0b2641] text-slate-500 hover:text-amber-300',
                      )}
                      title={b.isMain ? 'Sucursal principal' : 'Marcar como principal'}
                    >
                      <Star className={cn('h-4 w-4', b.isMain && 'fill-current')} />
                    </button>
                  </td>
                  <td className="px-5 py-3 text-center">
                    <button
                      type="button"
                      onClick={() => handleToggle(b, 'active')}
                      className={cn(
                        'relative inline-flex h-6 w-11 items-center rounded-full transition',
                        b.active ? 'bg-[#1090D0]' : 'bg-slate-600/60',
                      )}
                    >
                      <span
                        className={cn(
                          'inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition',
                          b.active ? 'translate-x-5' : 'translate-x-0.5',
                        )}
                      />
                    </button>
                  </td>
                  <td className="px-5 py-3 text-center">
                    <button
                      type="button"
                      onClick={() => handleToggle(b, 'ivaEnabled')}
                      className={cn(
                        'relative inline-flex h-6 w-11 items-center rounded-full transition',
                        b.ivaEnabled ? 'bg-emerald-500' : 'bg-slate-600/60',
                      )}
                      title={b.ivaEnabled ? 'IVA activo' : 'IVA desactivado'}
                    >
                      <span
                        className={cn(
                          'inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition',
                          b.ivaEnabled ? 'translate-x-5' : 'translate-x-0.5',
                        )}
                      />
                    </button>
                  </td>
                  <td className="px-5 py-3">
                    {editingIva[b.id] !== undefined ? (
                      <div className="flex items-center gap-1.5">
                        <div className="flex items-center gap-1.5 rounded-[12px] border border-[#1090D0]/50 bg-[#0b2641] px-2 py-1 focus-within:border-[#1090D0]">
                          <Percent className="h-3.5 w-3.5 text-slate-400" />
                          <input
                            type="number"
                            value={editingIva[b.id] ?? 0}
                            onChange={(e) =>
                              setEditingIva((prev) => ({
                                ...prev,
                                [b.id]: Number(e.target.value),
                              }))
                            }
                            min={0}
                            max={100}
                            step={0.01}
                            className="w-16 bg-transparent text-right font-mono text-[13px] font-semibold text-slate-100 focus:outline-none"
                          />
                        </div>
                        <button
                          type="button"
                          disabled={savingIva === b.id}
                          onClick={() => saveIva(b)}
                          className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/80 text-white transition hover:bg-emerald-500 disabled:opacity-50"
                          title="Guardar IVA"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => cancelEditIva(b.id)}
                          className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-500/60 text-white transition hover:bg-slate-500"
                          title="Cancelar"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => startEditIva(b)}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-[12px] border px-2.5 py-1 font-mono text-[13px] font-bold transition',
                          b.ivaEnabled
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:border-emerald-500/60'
                            : 'border-slate-600/50 bg-[#0b2641] text-slate-400 hover:border-[#1a3a5a]',
                        )}
                        title="Clic para editar tasa de IVA"
                      >
                        <Percent className="h-3.5 w-3.5" />
                        {b.ivaRate}%
                      </button>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center rounded-[10px] border border-[#1a3a5a] bg-[#0b2641] px-2 py-0.5 font-mono text-[11.5px] font-bold text-slate-200">
                      {b.currency || 'MXN'}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => openEdit(b)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#1a3a5a] bg-[#0b2641] text-slate-300 transition hover:border-[#1090D0]/40 hover:text-[#5bbfe5]"
                        title="Editar"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(b)}
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
          <div className="w-full max-w-xl overflow-hidden rounded-[20px] border border-[#1a3a5a] bg-[#0f3151] shadow-2xl shadow-black/50">
            <div className="flex items-center justify-between border-b border-[#1a3a5a] px-5 py-4">
              <h3 className="text-[16px] font-bold text-slate-50">
                {modalMode === 'create' ? 'Nueva sucursal' : 'Editar sucursal'}
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
                    Nombre de sucursal *
                  </label>
                  <div className="flex items-center gap-2 rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2.5 focus-within:border-[#1090D0]/50">
                    <Building2 className="h-4 w-4 text-slate-400" />
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="Ej. Sucursal Centro"
                      className="flex-1 bg-transparent text-[13.5px] text-slate-100 placeholder:text-slate-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <label className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Dirección
                  </label>
                  <div className="flex items-center gap-2 rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2.5 focus-within:border-[#1090D0]/50">
                    <MapPin className="h-4 w-4 text-slate-400" />
                    <input
                      type="text"
                      value={form.address}
                      onChange={(e) => setForm({ ...form, address: e.target.value })}
                      placeholder="Calle, número, colonia..."
                      className="flex-1 bg-transparent text-[13.5px] text-slate-100 placeholder:text-slate-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Teléfono
                  </label>
                  <div className="flex items-center gap-2 rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2.5 focus-within:border-[#1090D0]/50">
                    <Phone className="h-4 w-4 text-slate-400" />
                    <input
                      type="tel"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      placeholder="+52 55 ..."
                      className="flex-1 bg-transparent text-[13.5px] text-slate-100 placeholder:text-slate-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Manager
                  </label>
                  <div className="flex items-center gap-2 rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2.5 focus-within:border-[#1090D0]/50">
                    <UserIcon className="h-4 w-4 text-slate-400" />
                    <input
                      type="text"
                      value={form.manager}
                      onChange={(e) => setForm({ ...form, manager: e.target.value })}
                      placeholder="Nombre del encargado"
                      className="flex-1 bg-transparent text-[13.5px] text-slate-100 placeholder:text-slate-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Moneda
                  </label>
                  <div className="rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2.5 focus-within:border-[#1090D0]/50">
                    <input
                      type="text"
                      value={form.currency}
                      onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
                      placeholder="MXN"
                      maxLength={5}
                      className="w-full bg-transparent font-mono text-[13.5px] font-bold text-slate-100 placeholder:text-slate-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Tasa IVA %
                  </label>
                  <div className="flex items-center gap-2 rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2.5 focus-within:border-[#1090D0]/50">
                    <Percent className="h-4 w-4 text-slate-400" />
                    <input
                      type="number"
                      value={form.ivaRate}
                      onChange={(e) => setForm({ ...form, ivaRate: Number(e.target.value) || 0 })}
                      min={0}
                      max={100}
                      step={0.01}
                      className="flex-1 bg-transparent font-mono text-[13.5px] font-semibold text-slate-100 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 pt-1">
                <label className="flex items-center justify-between rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2.5">
                  <span className="text-[11.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Principal
                  </span>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, isMain: !form.isMain })}
                    className={cn(
                      'relative inline-flex h-6 w-11 items-center rounded-full transition',
                      form.isMain ? 'bg-amber-500' : 'bg-slate-600/60',
                    )}
                  >
                    <span
                      className={cn(
                        'inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition',
                        form.isMain ? 'translate-x-5' : 'translate-x-0.5',
                      )}
                    />
                  </button>
                </label>

                <label className="flex items-center justify-between rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2.5">
                  <span className="text-[11.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Activa
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

                <label className="flex items-center justify-between rounded-[14px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2.5">
                  <span className="text-[11.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    IVA activo
                  </span>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, ivaEnabled: !form.ivaEnabled })}
                    className={cn(
                      'relative inline-flex h-6 w-11 items-center rounded-full transition',
                      form.ivaEnabled ? 'bg-emerald-500' : 'bg-slate-600/60',
                    )}
                  >
                    <span
                      className={cn(
                        'inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition',
                        form.ivaEnabled ? 'translate-x-5' : 'translate-x-0.5',
                      )}
                    />
                  </button>
                </label>
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
                disabled={saving || !form.name.trim()}
                onClick={() => void handleSave()}
                className={cn(
                  'rounded-[14px] px-5 py-2 text-[12.5px] font-bold text-white transition',
                  saving || !form.name.trim()
                    ? 'bg-[#1090D0]/50 opacity-60'
                    : 'bg-[#1090D0] hover:bg-[#0c79ae]',
                )}
              >
                {saving ? 'Guardando...' : modalMode === 'create' ? 'Crear sucursal' : 'Guardar cambios'}
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
                  <h3 className="text-[15.5px] font-bold text-slate-50">Eliminar sucursal</h3>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-300">
                    Se eliminará permanentemente la sucursal{' '}
                    <span className="font-semibold text-white">{confirmDelete.name}</span>. Esta acción
                    no se puede deshacer.
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
