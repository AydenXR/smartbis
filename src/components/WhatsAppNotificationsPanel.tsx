import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, FlaskConical, Loader2, MessageCircle, Smartphone } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getWhatsAppNotificationStatus, sendWhatsAppNotificationTest, setWhatsAppNotificationRecipient, type WhatsAppNotificationStatus } from '@/lib/api'

export default function WhatsAppNotificationsPanel() {
  const [status, setStatus] = useState<WhatsAppNotificationStatus | null>(null)
  const [recipient, setRecipient] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true
    const refresh = async () => {
      try {
        const next = await getWhatsAppNotificationStatus()
        if (!mounted) return
        setStatus(next)
        setRecipient((current) => current || next.recipient || '')
        setError('')
      } catch (e: any) {
        if (mounted) setError(e?.message || 'No se pudo consultar WhatsApp.')
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 4000)
    return () => { mounted = false; window.clearInterval(timer) }
  }, [])

  async function saveRecipient() {
    setSaving(true); setNotice(''); setError('')
    try {
      const result = await setWhatsAppNotificationRecipient(recipient)
      setRecipient(result.recipient)
      setNotice('Número destino guardado.')
    } catch (e: any) {
      setError(e?.message || 'No se pudo guardar el número.')
    } finally { setSaving(false) }
  }

  async function sendTest() {
    setTesting(true); setNotice(''); setError('')
    try {
      const result = await sendWhatsAppNotificationTest()
      setNotice(`Mensaje de prueba enviado a +${result.recipient}.`)
    } catch (e: any) {
      setError(e?.message || 'No se pudo enviar el mensaje de prueba.')
    } finally { setTesting(false) }
  }

  const connected = status?.state === 'CONNECTED'
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[#0c2a47] p-5 text-white tech-scrollbar">
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <header className="rounded-[20px] border border-[#1a3a5a] bg-[#0f3151] p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-400/10 text-emerald-300"><MessageCircle className="h-5 w-5" /></div>
            <div>
              <h2 className="text-[16px] font-semibold">Avisos de inscripción por WhatsApp</h2>
              <p className="mt-1 text-[12px] text-slate-300">Enlaza el teléfono emisor y configura el número que recibirá un aviso al confirmar una inscripción desde una conversación.</p>
            </div>
          </div>
        </header>

        <div className="rounded-[20px] border border-[#1a3a5a] bg-[#0f3151] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">Teléfono emisor</p>
              <p className="mt-1 text-[13px] font-medium text-white">{connected ? `Conectado${status?.linkedNumber ? ` · +${status.linkedNumber}` : ''}` : status?.state === 'QR' ? 'Esperando lectura del QR' : status?.state || 'Iniciando conexión…'}</p>
            </div>
            <span className={cn('rounded-full px-3 py-1.5 text-[11px] font-semibold', connected ? 'bg-emerald-400/15 text-emerald-200' : 'bg-amber-300/15 text-amber-200')}>{connected ? 'Conectado' : status?.state || 'Conectando'}</span>
          </div>
          {status?.qr ? (
            <div className="mt-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <div className="rounded-xl bg-white p-2"><img src={status.qr} alt="QR para enlazar WhatsApp" className="h-56 w-56" /></div>
              <p className="max-w-md text-[12px] leading-relaxed text-slate-300">En el teléfono emisor abre WhatsApp → Dispositivos vinculados → Vincular dispositivo y escanea este código.</p>
            </div>
          ) : !connected ? <p className="mt-3 text-[11px] text-slate-400">El QR aparecerá aquí cuando el servicio termine de iniciar.</p> : null}
        </div>

        <div className="rounded-[20px] border border-[#1a3a5a] bg-[#0f3151] p-5">
          <h3 className="text-[13px] font-semibold">Número que recibirá los avisos</h3>
          <p className="mt-1 text-[11px] text-slate-400">Escribe el número con lada internacional, por ejemplo 526621234567.</p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="min-w-[250px] flex-1 text-[10px] font-semibold uppercase tracking-wider text-slate-300">
              WhatsApp destino
              <span className="mt-1 flex items-center gap-2 rounded-xl border border-[#1a3a5a] bg-[#0b2641] px-3 py-2 normal-case tracking-normal">
                <Smartphone className="h-4 w-4 shrink-0 text-slate-400" />
                <input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="526621234567" className="w-full bg-transparent text-[12px] text-white outline-none placeholder:text-slate-500" />
              </span>
            </label>
            <button type="button" disabled={saving || !recipient.trim()} onClick={() => void saveRecipient()} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-[11px] font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}{saving ? 'Guardando…' : 'Guardar número'}
            </button>
            <button type="button" disabled={testing || saving || !connected || !status?.recipient} onClick={() => void sendTest()} className="inline-flex items-center gap-2 rounded-xl border border-[#1090D0]/30 bg-[#1090D0]/10 px-4 py-2.5 text-[11px] font-semibold text-[#8bd5f5] transition hover:bg-[#1090D0]/20 disabled:opacity-40" title={!connected ? 'Conecta WhatsApp primero' : !status?.recipient ? 'Guarda el número destino primero' : 'Envía una simulación al número guardado'}>
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}{testing ? 'Enviando prueba…' : 'Enviar prueba'}
            </button>
          </div>
          {notice ? <p className="mt-2 text-[11px] text-emerald-200">{notice}</p> : null}
          {error ? <p className="mt-2 text-[11px] text-rose-200">{error}</p> : null}
        </div>

        <div className="flex items-start gap-2 rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-[11px] leading-relaxed text-amber-100/80">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Esta conexión usa WhatsApp Web no oficial. Conserva la carpeta <code>clientsdata/_whatsapp_auth</code> para mantener la sesión entre reinicios; WhatsApp puede limitar o bloquear la cuenta.
        </div>
      </div>
    </section>
  )
}
