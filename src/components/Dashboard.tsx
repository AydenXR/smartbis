import { useEffect, useMemo, useState } from 'react'
import { FilePlus2, Save, Trash2, Bot } from 'lucide-react'
import DashboardChatPanel from '@/components/DashboardChatPanel'
import CrmFloatingNav from '@/components/CrmFloatingNav'
import CrmChatsView from '@/components/CrmChatsView'
import CrmSettingsView from '@/components/CrmSettingsView'
import PromptPanel from '@/components/PromptPanel'
import CrmOperationsLayout, { type OperationsPage } from '@/components/CrmOperationsLayout'
import CrmPosView from '@/components/CrmPosView'
import CrmInventoryView from '@/components/CrmInventoryView'
import CrmBranchesView from '@/components/CrmBranchesView'
import CrmAuditRecordsView from '@/components/CrmAuditRecordsView'
import CrmSalesView from '@/components/CrmSalesView'
import CrmAccountsView from '@/components/CrmAccountsView'
import CrmMyProfileView from '@/components/CrmMyProfileView'
import { cn } from '@/lib/utils'
import type { AuthUser, ChatMessage, WorkspaceDocument } from '@/types/app'
import {
  configureMetaManual,
  getMetaOAuthLoginUrl,
  getMetaStatus,
  listMetaChats,
  getMetaChatDetail,
  sendMetaManual,
  setMetaState,
  markMetaChatAsRead,
  deleteMetaChat,
  type MetaBotState,
  type MetaStatusResponse,
  type MetaChatItem,
  type MetaMessageRow,
} from '@/lib/api'
import { useMetaCrmStore, type CrmPage } from '@/store/useMetaCrmStore'

type WorkspaceTab = 'chat' | 'prompt' | 'documents'

type DashboardProps = {
  user: AuthUser
  prompt: string
  documents: WorkspaceDocument[]
  isSavingPrompt: boolean
  isSavingDocument: boolean
  isDeletingDocument: boolean
  onSavePrompt: (prompt: string) => Promise<void>
  onCreateDocument: (input: { fileName: string; content: string }) => Promise<WorkspaceDocument>
  onUpdateDocument: (
    currentFileName: string,
    input: { fileName: string; content: string },
  ) => Promise<WorkspaceDocument>
  onDeleteDocument: (fileName: string) => Promise<void>
  onSendChatMessage: (
    message: string,
    history: Array<Pick<ChatMessage, 'role' | 'content'>>,
  ) => Promise<string>
  onLogout: () => Promise<void>
}

function createNewDocumentDraft() {
  return {
    currentFileName: '',
    fileName: '',
    content: '',
    isNew: true,
  }
}

function initMetaStatus(): MetaStatusResponse {
  return {
    state: 'PAUSE',
    testMode: false,
    webhookSubscribed: false,
    linked: false,
    hasPageToken: false,
  }
}

export default function Dashboard({
  user,
  prompt,
  documents,
  isSavingPrompt,
  isSavingDocument,
  isDeletingDocument,
  onSavePrompt,
  onCreateDocument,
  onUpdateDocument,
  onDeleteDocument,
  onSendChatMessage,
  onLogout,
}: DashboardProps) {
  // Legacy tab workspace (dentro de Docs)
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('chat')
  const [promptDraft, setPromptDraft] = useState(prompt)
  const [promptStatus, setPromptStatus] = useState('')
  const [documentStatus, setDocumentStatus] = useState('')
  const [documentError, setDocumentError] = useState('')
  const [documentDraft, setDocumentDraft] = useState(createNewDocumentDraft())

  // CRM store state
  const crmPage = useMetaCrmStore((s) => s.page)
  const setCrmPage = useMetaCrmStore((s) => s.setPage)
  const selectChat = useMetaCrmStore((s) => s.selectChat)
  const markChatLocalAsRead = useMetaCrmStore((s) => s.markChatLocalAsRead)
  const deleteChatLocal = useMetaCrmStore((s) => s.deleteChatLocal)

  // Piso activo dentro de Operaciones
  const [operationsTab, setOperationsTab] = useState<OperationsPage>('pos')

  // Local snapshot meta (evitamos async store race conditions; store sigue como side-effect)
  const [metaStatus, setMetaStatus] = useState<MetaStatusResponse>(initMetaStatus())
  const [metaChats, setMetaChats] = useState<MetaChatItem[]>([])
  const [selectedPSID, setSelectedPSID] = useState<string | null>(null)
  const [selectedMessages, setSelectedMessages] = useState<MetaMessageRow[]>([])
  const [loadingStatus, setLoadingStatus] = useState(false)
  const [loadingChats, setLoadingChats] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [errorStatus, setErrorStatus] = useState('')
  const [errorChats, setErrorChats] = useState('')
  const [errorDetail, setErrorDetail] = useState('')

  const APP_ID = import.meta.env.VITE_FACEBOOK_APP_ID || ''
  const GRAPH_VERSION = import.meta.env.VITE_META_GRAPH_VERSION || 'v22.0'

  // Restricción cashier: solo permitidas operations (POS + Inventario) y myprofile. Todo lo demás → redirect.
  const isCashier = user.posRole === 'cashier'
  useEffect(() => {
    if (!isCashier) return
    const ALLOWED: (string | undefined)[] = ['operations', 'myprofile']
    if (!ALLOWED.includes(crmPage)) {
      setCrmPage('operations')
      setOperationsTab('pos')
    }
    if (crmPage === 'operations' && !(['pos', 'inventory'] as OperationsPage[]).includes(operationsTab)) {
      setOperationsTab('pos')
    }
  }, [isCashier, crmPage, operationsTab, setCrmPage, setOperationsTab])

  useEffect(() => {
    setPromptDraft(prompt)
  }, [prompt])

  useEffect(() => {
    if (documentDraft.isNew) {
      return
    }

    const selectedDocument = documents.find(
      (document) => document.fileName === documentDraft.currentFileName,
    )

    if (!selectedDocument) {
      setDocumentDraft(createNewDocumentDraft())
      return
    }

    setDocumentDraft({
      currentFileName: selectedDocument.fileName,
      fileName: selectedDocument.fileName,
      content: selectedDocument.content,
      isNew: false,
    })
  }, [documentDraft.currentFileName, documentDraft.isNew, documents])

  const hasPromptChanges = useMemo(
    () => promptDraft.trim() !== prompt.trim(),
    [prompt, promptDraft],
  )

  // Carga inicial Meta state + chats
  useEffect(() => {
    let mounted = true
    void (async () => {
      setLoadingStatus(true)
      setErrorStatus('')
      setLoadingChats(true)
      setErrorChats('')
      try {
        const [statusR, chatsR] = await Promise.allSettled([getMetaStatus(), listMetaChats(100)])
        if (!mounted) return
        if (statusR.status === 'fulfilled') {
          setMetaStatus({ ...initMetaStatus(), ...statusR.value })
        } else {
          setErrorStatus((statusR.reason as Error)?.message || 'No se pudo cargar estado.')
        }
        if (chatsR.status === 'fulfilled') {
          setMetaChats(chatsR.value.chats)
        } else {
          setErrorChats((chatsR.reason as Error)?.message || 'No se pudo cargar chats.')
        }
      } finally {
        if (mounted) {
          setLoadingStatus(false)
          setLoadingChats(false)
        }
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  async function handleRefreshStatus() {
    setLoadingStatus(true)
    setErrorStatus('')
    try {
      const s = await getMetaStatus()
      setMetaStatus({ ...initMetaStatus(), ...s })
    } catch (e: any) {
      setErrorStatus(e?.message || 'Error al cargar estado.')
      throw e
    } finally {
      setLoadingStatus(false)
    }
  }

  async function handleRefreshChats(opts?: { silent?: boolean }) {
    const silent = Boolean(opts?.silent)
    if (!silent) setLoadingChats(true)
    setErrorChats('')
    try {
      const r = await listMetaChats(100)
      setMetaChats(r.chats)
    } catch (e: any) {
      if (!silent) setErrorChats(e?.message || 'Error al cargar chats.')
      throw e
    } finally {
      setLoadingChats(false)
    }
  }

  async function handleSelectChat(psid: string | null, opts?: { silent?: boolean }) {
    const silent = Boolean(opts?.silent)
    setSelectedPSID(psid)
    if (psid) {
      const target = metaChats.find((c) => c.psid === psid)
      if (target && target.unreadCount > 0) {
        setMetaChats((cur) =>
          cur.map((c) => (c.psid === psid ? { ...c, unreadCount: 0 } : c)),
        )
        void markMetaChatAsRead(psid).catch(() => {})
      }
    }
    void selectChat(
      psid,
      async (p) => {
        if (!silent) setLoadingDetail(true)
        setErrorDetail('')
        try {
          const r = await getMetaChatDetail(p)
          setSelectedMessages(r.messages)
          return r
        } catch (e: any) {
          if (!silent) setErrorDetail(e?.message || 'Error al cargar conversación.')
          return { psid: p, messages: [] }
        } finally {
          setLoadingDetail(false)
        }
      },
      { silent },
    )
    if (!psid) setSelectedMessages([])
  }

  async function handleMarkAsRead(psid: string): Promise<void> {
    markChatLocalAsRead(psid)
    setMetaChats((cur) => cur.map((c) => (c.psid === psid ? { ...c, unreadCount: 0 } : c)))
    try {
      await markMetaChatAsRead(psid)
    } catch {
    }
  }

  async function handleDeleteChat(psid: string): Promise<void> {
    deleteChatLocal(psid)
    setMetaChats((cur) => cur.filter((c) => c.psid !== psid))
    if (selectedPSID === psid) {
      setSelectedPSID(null)
      setSelectedMessages([])
    }
    try {
      await deleteMetaChat(psid)
    } catch {
    }
  }

  async function handleSetMetaState(next: { state?: MetaBotState; testMode?: boolean }) {
    const prev = metaStatus
    setMetaStatus({ ...metaStatus, ...next })
    try {
      const r = await setMetaState(next)
      setMetaStatus((cur) => ({
        ...cur,
        state: (r?.state ?? cur.state),
        testMode: (r?.testMode ?? cur.testMode),
      }))
      return r
    } catch (e) {
      setMetaStatus(prev)
      throw e
    }
  }

  async function handleSendManual(psid: string, text: string) {
    return sendMetaManual(psid, text)
  }

  async function handlePromptSave() {
    if (!promptDraft.trim()) {
      setPromptStatus('El prompt no puede estar vacio.')
      return
    }

    await onSavePrompt(promptDraft)
    setPromptStatus('Prompt guardado.')
  }

  function selectDocument(document: WorkspaceDocument) {
    setActiveTab('documents')
    setDocumentStatus('')
    setDocumentError('')
    setDocumentDraft({
      currentFileName: document.fileName,
      fileName: document.fileName,
      content: document.content,
      isNew: false,
    })
  }

  async function handleDocumentSave() {
    setDocumentStatus('')
    setDocumentError('')

    if (!documentDraft.fileName.trim() || !documentDraft.content.trim()) {
      setDocumentError('Completa el nombre del archivo y su contenido.')
      return
    }

    if (documentDraft.isNew) {
      const createdDocument = await onCreateDocument({
        fileName: documentDraft.fileName,
        content: documentDraft.content,
      })

      setDocumentDraft({
        currentFileName: createdDocument.fileName,
        fileName: createdDocument.fileName,
        content: createdDocument.content,
        isNew: false,
      })
      setDocumentStatus('Documento creado.')
      return
    }

    const updatedDocument = await onUpdateDocument(documentDraft.currentFileName, {
      fileName: documentDraft.fileName,
      content: documentDraft.content,
    })

    setDocumentDraft({
      currentFileName: updatedDocument.fileName,
      fileName: updatedDocument.fileName,
      content: updatedDocument.content,
      isNew: false,
    })
    setDocumentStatus('Documento guardado.')
  }

  async function handleDeleteDocument() {
    setDocumentStatus('')
    setDocumentError('')

    if (documentDraft.isNew || !documentDraft.currentFileName) {
      setDocumentDraft(createNewDocumentDraft())
      return
    }

    await onDeleteDocument(documentDraft.currentFileName)
    setDocumentDraft(createNewDocumentDraft())
    setDocumentStatus('Documento eliminado.')
  }

  return (
    <main className="h-screen w-screen overflow-hidden bg-[#0c2a47] text-white">
      <div className="flex h-screen w-screen flex-row gap-0 overflow-hidden bg-[#0c2a47]">
        <section className="flex h-screen min-h-0 w-full flex-1 flex-col gap-0 overflow-hidden bg-[#0c2a47]">
          <div className="h-screen min-h-0 flex-1 overflow-hidden">
            {crmPage === 'chats' ? (
              <CrmChatsView
                status={metaStatus}
                loadingStatus={loadingStatus}
                errorStatus={errorStatus}
                chats={metaChats}
                loadingChats={loadingChats}
                errorChats={errorChats}
                selectedPSID={selectedPSID}
                selectedMessages={selectedMessages}
                loadingDetail={loadingDetail}
                errorDetail={errorDetail}
                onRefreshStatus={handleRefreshStatus}
                onRefreshChats={handleRefreshChats}
                onSelectChat={handleSelectChat}
                onSetState={handleSetMetaState}
                onSendManual={handleSendManual}
                onMarkAsRead={handleMarkAsRead}
                onDeleteChat={handleDeleteChat}
              />
            ) : crmPage === 'docs' ? (
              <DocsAndPromptView
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                prompt={prompt}
                promptDraft={promptDraft}
                setPromptDraft={setPromptDraft}
                promptStatus={promptStatus}
                hasPromptChanges={hasPromptChanges}
                isSavingPrompt={isSavingPrompt}
                onSavePrompt={async () => { await handlePromptSave(); }}
                documents={documents}
                documentDraft={documentDraft}
                setDocumentDraft={setDocumentDraft}
                selectDocument={(d) => selectDocument(d)}
                documentError={documentError}
                documentStatus={documentStatus}
                isSavingDocument={isSavingDocument}
                isDeletingDocument={isDeletingDocument}
                onSaveDocument={async () => { await handleDocumentSave(); }}
                onDeleteDocument={async () => { await handleDeleteDocument(); }}
                onSendChatMessage={onSendChatMessage}
              />
            ) : crmPage === 'settings' ? (
              <CrmSettingsView
                status={metaStatus}
                loadingStatus={loadingStatus}
                errorStatus={errorStatus}
                onRefresh={handleRefreshStatus}
                onGetOAuthUrl={async () => {
                  const r = await getMetaOAuthLoginUrl()
                  return r.url
                }}
                onLinkManual={async (inp) => {
                  const r = await configureMetaManual(inp)
                  await handleRefreshStatus()
                  return r
                }}
                onSetState={handleSetMetaState}
                APP_ID={APP_ID}
                graphVersion={GRAPH_VERSION}
              />
            ) : crmPage === 'myprofile' ? (
              <CrmMyProfileView
                userEmail={user.email}
                displayName={user.displayName}
                userName={user.displayName}
                userRole={(user.posRole === 'owner' ? 'admin' : (user.posRole || 'admin')) as any}
                memberSince={new Date().toLocaleDateString('es-MX')}
              />
            ) : crmPage === 'accounts' ? (
              user.posRole && user.posRole !== 'cashier' ? <CrmAccountsView /> : (
                <div className="flex h-full w-full items-center justify-center">
                  <div className="rounded-[20px] border border-[#1a3a5a] bg-[#0f3151] p-10 text-center max-w-lg">
                    <p className="text-xl font-bold text-[#1090D0]">Cuentas · Acceso restringido</p>
                    <p className="mt-3 text-sm text-slate-300">Solo los administradores pueden crear y gestionar subusuarios. Contacta al propietario de la cuenta si necesitas acceso.</p>
                  </div>
                </div>
              )
            ) : crmPage === 'records' ? (
              user.posRole && user.posRole !== 'cashier' ? <CrmAuditRecordsView /> : (
                <div className="flex h-full w-full items-center justify-center">
                  <div className="rounded-[20px] border border-[#1a3a5a] bg-[#0f3151] p-10 text-center max-w-lg">
                    <p className="text-xl font-bold text-[#1090D0]">Historial · Solo Administradores</p>
                    <p className="mt-3 text-sm text-slate-300">El registro de auditoría es visible solo para administradores.</p>
                  </div>
                </div>
              )
            ) : crmPage === 'operations' ? (
              <CrmOperationsLayout
                active={operationsTab}
                setActive={setOperationsTab}
                userEmail={user.email}
                isCashier={user.posRole === 'cashier'}
              >
                {operationsTab === 'pos' ? (
                  <CrmPosView />
                ) : operationsTab === 'inventory' ? (
                  <CrmInventoryView />
                ) : operationsTab === 'branches' ? (
                  <CrmBranchesView />
                ) : operationsTab === 'purchases' ? (
                  <CrmSalesView />
                ) : operationsTab === 'dashboard' ? (
                  <CrmAuditRecordsView />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <div className="rounded-[20px] border border-[#1a3a5a] bg-[#0f3151] p-10 text-center">
                      <p className="text-xl font-bold text-[#1090D0]">Configuración · Piso #6</p>
                      <p className="mt-3 text-sm text-slate-300">
                        Recuerda: el IVA se configura individualmente por sucursal en el Piso #4 Sucursales.
                      </p>
                    </div>
                  </div>
                )}
              </CrmOperationsLayout>
            ) : (
              <CrmSettingsView
                status={metaStatus}
                loadingStatus={loadingStatus}
                errorStatus={errorStatus}
                onRefresh={handleRefreshStatus}
                onGetOAuthUrl={async () => {
                  const r = await getMetaOAuthLoginUrl()
                  return r.url
                }}
                onLinkManual={async (inp) => {
                  const r = await configureMetaManual(inp)
                  await handleRefreshStatus()
                  return r
                }}
                onSetState={handleSetMetaState}
                APP_ID={APP_ID}
                graphVersion={GRAPH_VERSION}
              />
            )}
          </div>
        </section>
      </div>

      {/* Indicador de conexión del bot abajo derecha — SOLO en pestaña Chats */}
      {crmPage === 'chats' ? (
        <div className="pointer-events-none fixed bottom-5 right-5 z-50">
          <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-[#1a3a5a] bg-[#0f3151]/90 px-3.5 py-2 shadow-[0_12px_30px_-12px_rgba(0,0,0,0.6)] backdrop-blur-md">
            {(() => {
              const linked = Boolean(metaStatus?.linked)
              const state = metaStatus?.state || 'PAUSE'
              const running = linked && state === 'START'
              const label = running
                ? 'Conectado'
                : !linked
                  ? 'Desconectado'
                  : state === 'PAUSE'
                    ? 'En pausa'
                    : 'Desconectado'
              const dotColor = running
                ? 'bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,0.18)]'
                : !linked
                  ? 'bg-rose-500 shadow-[0_0_0_4px_rgba(244,63,94,0.18)]'
                  : 'bg-amber-400 shadow-[0_0_0_4px_rgba(251,191,36,0.18)]'
              const textColor = running
                ? 'text-emerald-300'
                : !linked
                  ? 'text-rose-300'
                  : 'text-amber-300'
              return (
                <>
                  <span
                    className={
                      'relative inline-block h-2.5 w-2.5 rounded-full ' +
                      dotColor +
                      (running ? ' animate-pulse' : '')
                    }
                  />
                  <Bot className="h-3.5 w-3.5 text-slate-300" />
                  <span className={'text-[11px] font-semibold tracking-wide ' + textColor}>
                    {label}
                  </span>
                </>
              )
            })()}
          </div>
        </div>
      ) : null}

      {/* Menú flotante tipo burbuja Messenger (arrastrable, radial, carrusel paginas) */}
      <CrmFloatingNav
        active={crmPage}
        activeDocsTab={activeTab}
        onChange={(p: CrmPage) => {
          setCrmPage(p)
          void (async () => {
            try {
              if (p === 'chats') {
                await handleRefreshChats({ silent: false })
              } else if (p === 'settings') {
                await handleRefreshStatus()
              } else if (p === 'operations') {
                setOperationsTab('pos')
              }
            } catch (_) {}
          })()
        }}
        onOpenDocsWithTab={(tab) => setActiveTab(tab)}
        status={metaStatus}
        userEmail={user.email}
        onLogout={() => void onLogout()}
        onGoProfile={() => setCrmPage('myprofile')}
        onGoAccounts={() => setCrmPage('accounts')}
        onGoRecords={() => setCrmPage('records')}
        isCashier={user.posRole === 'cashier'}
      />
    </main>
  )
}

// ============================================
// VISTA 2: Docs & Prompt (heredada del antiguo Home y Dashboard, unificada)
// ============================================
type DocsAndPromptViewProps = {
  activeTab: WorkspaceTab
  setActiveTab: (t: WorkspaceTab) => void
  prompt: string
  promptDraft: string
  setPromptDraft: (s: string) => void
  promptStatus: string
  hasPromptChanges: boolean
  isSavingPrompt: boolean
  onSavePrompt: () => Promise<void>
  documents: WorkspaceDocument[]
  documentDraft: ReturnType<typeof createNewDocumentDraft>
  setDocumentDraft: (d: any) => void
  selectDocument: (d: WorkspaceDocument) => void
  documentError: string
  documentStatus: string
  isSavingDocument: boolean
  isDeletingDocument: boolean
  onSaveDocument: () => Promise<void>
  onDeleteDocument: () => Promise<void>
  onSendChatMessage: (
    message: string,
    history: Array<Pick<ChatMessage, 'role' | 'content'>>,
  ) => Promise<string>
}

function DocsAndPromptView(props: DocsAndPromptViewProps) {
  const {
    activeTab,
    setActiveTab,
    prompt,
    promptDraft,
    setPromptDraft,
    promptStatus,
    hasPromptChanges,
    isSavingPrompt,
    onSavePrompt,
    documents,
    documentDraft,
    setDocumentDraft,
    selectDocument,
    documentError,
    documentStatus,
    isSavingDocument,
    isDeletingDocument,
    onSaveDocument,
    onDeleteDocument,
    onSendChatMessage,
  } = props
  return (
    <section className="flex h-screen min-h-0 w-full max-w-full max-h-full flex-col overflow-hidden gap-4 bg-[#0c2a47] px-4 py-4">
      <div className="min-h-0 flex-1 flex flex-col gap-4 overflow-hidden">
      {activeTab === 'chat' ? (
        <DashboardChatPanel
          prompt={prompt}
          documents={documents}
          onSendMessage={onSendChatMessage}
        />
      ) : activeTab === 'prompt' ? (
        <div className="min-h-0 flex-1 flex flex-col overflow-hidden rounded-[20px] border border-[#1a3a5a] bg-[#0f3151] p-5">
          <div className="mb-4 space-y-2 shrink-0">
            <h2 className="font-display text-[18px] font-bold text-white">prompt.md</h2>
            <p className="text-[12px] text-slate-300">
              Este archivo define la instrucción principal del workspace (se usa tanto en el chat
              de pruebas como en el bot de Messenger).
            </p>
          </div>

          <textarea
            value={promptDraft}
            onChange={(event) => setPromptDraft(event.target.value)}
            className="tech-scrollbar min-h-0 flex-1 w-full rounded-[18px] border border-[#1a3a5a] bg-[#0b2641] px-4 py-3.5 text-[13px] leading-relaxed text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-[#1090D0]/50 focus:bg-[#0c2c4c] resize-none"
            placeholder="Escribe aquí el prompt del workspace..."
          />

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 shrink-0">
            <p className="text-[12px] text-slate-400">
              {promptStatus || 'Los cambios se guardan en la configuración del tenant.'}
            </p>
            <button
              type="button"
              onClick={() => void onSavePrompt()}
              disabled={isSavingPrompt || !hasPromptChanges}
              className="inline-flex items-center gap-2 rounded-xl bg-[#1090D0] px-4 py-2 text-[12px] font-bold text-white shadow transition hover:bg-[#0c79ae] disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              {isSavingPrompt ? 'Guardando...' : 'Guardar prompt'}
            </button>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 grid gap-4 overflow-hidden xl:grid-cols-[minmax(300px,360px)_minmax(0,1fr)]">
          <div className="min-h-0 flex flex-col overflow-hidden rounded-[20px] border border-[#1a3a5a] bg-[#0f3151] p-4">
            <div className="mb-4 flex items-center justify-between gap-3 shrink-0">
              <div>
                <h2 className="font-display text-[15px] font-bold text-white">Archivos .md</h2>
                <p className="text-[11px] text-slate-400">{documents.length} documentos</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDocumentDraft(createNewDocumentDraft())
                }}
                className="inline-flex items-center gap-2 rounded-[16px] border border-[#1e3e64]/70 bg-[#133558]/40 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:border-[#1090D0]/50 hover:bg-[#1090D0]/10"
              >
                <FilePlus2 className="h-3.5 w-3.5" />
                Nuevo
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5 tech-scrollbar">
              {documents.length === 0 ? (
                <div className="rounded-[16px] border border-dashed border-[#25507c] bg-white/[0.02] px-4 py-6 text-[12px] text-slate-400 text-center">
                  Aún no hay documentos.
                </div>
              ) : (
                documents.map((document) => (
                  <button
                    key={document.id}
                    type="button"
                    onClick={() => selectDocument(document)}
                    className={cn(
                      'w-full rounded-[16px] border px-3.5 py-2.5 text-left transition',
                      !documentDraft.isNew && documentDraft.currentFileName === document.fileName
                        ? 'border-[#1090D0]/50 bg-[#1090D0]/15 shadow-[inset_0_0_0_1px_rgba(16,144,208,0.25)]'
                        : 'border-[#1e3e64]/70 bg-[#133558]/40 hover:border-[#2a5589] hover:bg-[#173c66]/60',
                    )}
                  >
                    <p className="text-[13px] font-semibold text-white">{document.fileName}</p>
                    <p className="mt-0.5 text-[10px] text-slate-400">
                      Actualizado {new Date(document.updatedAt).toLocaleString('es-MX')}
                    </p>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="min-h-0 flex flex-col overflow-hidden rounded-[20px] border border-[#1a3a5a] bg-[#0f3151] p-5">
            <div className="mb-4 space-y-2 shrink-0">
              <h2 className="font-display text-[18px] font-bold text-white">
                {documentDraft.isNew ? 'Nuevo documento' : documentDraft.fileName}
              </h2>
              <p className="text-[12px] text-slate-300">
                Edita el archivo markdown tal como quedará en la base de datos del workspace. Es la
                fuente de verdad absoluta para el RAG.
              </p>
            </div>

            <div className="min-h-0 flex-1 flex flex-col gap-4 overflow-hidden">
              <label className="block space-y-1.5 shrink-0">
                <span className="text-[12px] font-semibold text-slate-200">Nombre del archivo</span>
                <input
                  type="text"
                  value={documentDraft.fileName}
                  onChange={(event) =>
                    setDocumentDraft((current: any) => ({
                      ...current,
                      fileName: event.target.value,
                    }))
                  }
                  className="w-full rounded-[16px] border border-[#1a3a5a] bg-[#0b2641] px-4 py-2.5 text-[13px] text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-[#1090D0]/50 focus:bg-[#0c2c4c]"
                  placeholder="productos.md"
                />
              </label>

              <label className="block space-y-1.5 min-h-0 flex-1 flex flex-col">
                <span className="text-[12px] font-semibold text-slate-200 shrink-0">Contenido</span>
                <textarea
                  value={documentDraft.content}
                  onChange={(event) =>
                    setDocumentDraft((current: any) => ({
                      ...current,
                      content: event.target.value,
                    }))
                  }
                  className="tech-scrollbar min-h-0 flex-1 w-full rounded-[16px] border border-[#1a3a5a] bg-[#0b2641] px-4 py-3.5 text-[13px] leading-relaxed text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-[#1090D0]/50 focus:bg-[#0c2c4c] resize-none"
                  placeholder="Escribe aquí el contenido markdown..."
                />
              </label>
            </div>

            {documentError ? (
              <div className="mt-4 rounded-[16px] border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-[12px] text-rose-100 shrink-0">
                {documentError}
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 shrink-0">
              <p className="text-[12px] text-slate-400">
                {documentStatus || 'Los documentos se guardan en la base de datos del tenant.'}
              </p>
              <div className="flex flex-wrap gap-3">
                {!documentDraft.isNew ? (
                  <button
                    type="button"
                    onClick={() => void onDeleteDocument()}
                    disabled={isDeletingDocument}
                    className="inline-flex items-center gap-2 rounded-[16px] border border-rose-400/20 bg-rose-400/10 px-3.5 py-2 text-[12px] font-semibold text-rose-100 transition hover:bg-rose-400/20 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {isDeletingDocument ? 'Eliminando...' : 'Eliminar'}
                  </button>
                ) : null}

                <button
                  type="button"
                  onClick={() => void onSaveDocument()}
                  disabled={isSavingDocument}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#1090D0] px-4 py-2 text-[12px] font-bold text-white shadow transition hover:bg-[#0c79ae] disabled:opacity-50"
                >
                  <Save className="h-3.5 w-3.5" />
                  {isSavingDocument ? 'Guardando...' : 'Guardar documento'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
    </section>
  )
}
