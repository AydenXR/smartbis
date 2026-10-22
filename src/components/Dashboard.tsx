import { useEffect, useMemo, useState } from 'react'
  import { FilePlus2, Save, Trash2, Bot, Download, PackageCheck, Clock, RefreshCw, PlayCircle, AlertCircle, CheckCircle2 } from 'lucide-react'
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
import CrmPurchasesView from '@/components/CrmPurchasesView'
import CrmAdministrationView from '@/components/CrmAdministrationView'
import CrmAccountsView from '@/components/CrmAccountsView'
import CrmMyProfileView from '@/components/CrmMyProfileView'
import CrmNotificationsView from '@/components/CrmNotificationsView'
import { cn } from '@/lib/utils'
import type { AuthUser, ChatMessage, WorkspaceDocument } from '@/types/app'
import {
  configureMetaManual,
  getMetaOAuthLoginUrl,
  retryMetaPageList,
  getMetaStatus,
  listMetaChats,
  getMetaChatDetail,
  sendMetaManual,
  setMetaState,
  markMetaChatAsRead,
  deleteMetaChat,
  syncMetaAds,
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
    autocuratorEnabled: true,
    webhookSubscribed: false,
    linked: false,
    hasPageToken: false,
  }
}

const CS_PAGES: (string | undefined)[] = ['chats', 'docs', 'settings']

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

  const [isDesktop, setIsDesktop] = useState(false)
  const [installedVersion, setInstalledVersion] = useState<String | null>(null)
  const [remoteVersion, setRemoteVersion] = useState<string | null>(null)
  const [isUpdateAvailable, setIsUpdateAvailable] = useState(false)
  const [isUpdateDownloaded, setIsUpdateDownloaded] = useState(false)
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [isInstalling, setIsInstalling] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null)
  const [updateStatusMsg, setUpdateStatusMsg] = useState('')

  function parseSemverForUpdates(v: unknown): [number, number, number] {
    if (!v || typeof v !== 'string') return [-1, -1, -1]
    const parts = String(v).split(/[.-]/).slice(0, 3).map((x) => parseInt(String(x || '0'), 10) || 0)
    while (parts.length < 3) parts.push(0)
    return [parts[0], parts[1], parts[2]]
  }
  function isRemoteGreaterForUpdates(remote: unknown, local: unknown): boolean {
    const r = parseSemverForUpdates(remote)
    const l = parseSemverForUpdates(local)
    for (let i = 0; i < 3; i += 1) {
      if (r[i] > l[i]) return true
      if (r[i] < l[i]) return false
    }
    return false
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
        checkForUpdates?: () => Promise<any>
        downloadUpdate?: () => Promise<any>
        restartAndInstall?: () => Promise<any>
        log?: (message: string) => void
      }
    }
    const desktop = anyWindow.smartbisDesktop
    if (!desktop) return
    setIsDesktop(true)
    const envVersion = String((import.meta.env.VITE_APP_VERSION as string) || '0.43.0')
    setInstalledVersion(envVersion)

    if (desktop.onRuntime) {
      desktop.onRuntime((data) => {
        if (data?.installedVersion && typeof data.installedVersion === 'string') {
          setInstalledVersion(data.installedVersion)
        }
      })
    }
    if (desktop.onUpdateAvailable) {
      desktop.onUpdateAvailable((data) => {
        const remote = data?.version
        const installed = installedVersion || envVersion
        if (remote && isRemoteGreaterForUpdates(remote, installed)) {
          setRemoteVersion(String(remote))
          setIsUpdateAvailable(true)
          if (data?.downloaded) {
            setIsUpdateDownloaded(true)
            setDownloadProgress(100)
          }
        }
      })
    }
    if (desktop.onUpdateDownloaded) {
      desktop.onUpdateDownloaded(() => {
        setIsUpdateDownloaded(true)
        setDownloadProgress(100)
        setIsDownloading(false)
        setUpdateStatusMsg('Actualización lista para instalar.')
      })
    }
    if (desktop.onUpdateProgress) {
      desktop.onUpdateProgress((data) => {
        const pct = typeof data?.percent === 'number' ? data.percent : null
        if (pct !== null) {
          setDownloadProgress(Math.max(0, Math.min(100, pct)))
        }
      })
    }
    if (desktop.onUpdateError) {
      desktop.onUpdateError((data) => {
        setIsDownloading(false)
        setIsCheckingUpdates(false)
        setUpdateStatusMsg(data?.message || 'Error al actualizar.')
      })
    }
    if (desktop.onUpdateNotAvailable) {
      desktop.onUpdateNotAvailable(() => {
        setIsUpdateAvailable(false)
        setUpdateStatusMsg('Ya tienes la versión más reciente.')
      })
    }
    void (async () => {
      try {
        const res = await desktop.checkForUpdates?.()
        if (res?.installed && typeof res.installed === 'string') {
          setInstalledVersion(res.installed)
        }
        if (res?.ok && res?.updateAvailable && res?.version) {
          setRemoteVersion(String(res.version))
          setIsUpdateAvailable(true)
          if (res.downloaded) {
            setIsUpdateDownloaded(true)
            setDownloadProgress(100)
          }
        } else if (res?.ok) {
          setIsUpdateAvailable(false)
          setUpdateStatusMsg('Ya tienes la versión más reciente.')
        }
      } catch (_) {}
    })()
  }, [installedVersion])

  async function handleCheckUpdates() {
    const desktop = (window as any).smartbisDesktop
    if (!desktop) { setUpdateStatusMsg('Modo web: solo disponible en escritorio.'); return }
    setIsCheckingUpdates(true)
    setUpdateStatusMsg('Verificando actualizaciones...')
    try {
      const res = await desktop.checkForUpdates?.()
      if (res?.installed && typeof res.installed === 'string') setInstalledVersion(res.installed)
      if (res?.ok && res?.updateAvailable && res?.version) {
        setRemoteVersion(String(res.version))
        setIsUpdateAvailable(true)
        if (res.downloaded) { setIsUpdateDownloaded(true); setDownloadProgress(100) }
        setUpdateStatusMsg(`Versión ${res.version} disponible.`)
      } else {
        setIsUpdateAvailable(false)
        setUpdateStatusMsg('Ya tienes la versión más reciente.')
      }
    } catch (e: any) {
      setUpdateStatusMsg(e?.message || 'No se pudo verificar actualizaciones.')
    } finally {
      setIsCheckingUpdates(false)
    }
  }

  async function handleDownloadUpdate() {
    const desktop = (window as any).smartbisDesktop
    if (!desktop) return
    if (!isUpdateAvailable) return
    setIsDownloading(true)
    setDownloadProgress(0)
    setUpdateStatusMsg('Descargando actualización...')
    try {
      const res = await desktop.downloadUpdate?.()
      if (res?.ok) {
        setIsUpdateDownloaded(true)
        setDownloadProgress(100)
        setUpdateStatusMsg('Actualización descargada. Cierra y abre de nuevo o pulsa Instalar.')
      } else {
        setUpdateStatusMsg(res?.message || 'No se pudo descargar.')
      }
    } catch (e: any) {
      setUpdateStatusMsg(e?.message || 'Error al descargar.')
    } finally {
      setIsDownloading(false)
    }
  }

  async function handleInstallUpdate() {
    const desktop = (window as any).smartbisDesktop
    if (!desktop) return
    if (!isUpdateDownloaded) return
    setIsInstalling(true)
    setUpdateStatusMsg('Instalando y reiniciando...')
    try {
      await desktop.restartAndInstall?.()
    } catch (e: any) {
      setIsInstalling(false)
      setUpdateStatusMsg(e?.message || 'No se pudo instalar.')
    }
  }

  const APP_ID = import.meta.env.VITE_FACEBOOK_APP_ID || ''
  const GRAPH_VERSION = import.meta.env.VITE_META_GRAPH_VERSION || 'v22.0'

  // Restricción cashier: solo permitidas operations (POS + Inventario) y myprofile. Todo lo demás → redirect.
  const isCashier = user.posRole === 'cashier'
  // Admin PV: control de Punto de Venta (POS, inventario, compras, ventas, sucursales). Sin acceso a la zona CS.
  const isAdminPv = user.posRole === 'admin_pv'
  // Admin CS: control TOTAL de Atención al cliente (documentos, prompt, chats, pruebas, conexión). Sin acceso al POS.
  const isAdminCs = user.posRole === 'admin_cs'
  // Agente CS: solo administra Chats y Documentos (incluye auto-ingesta). Sin prompt, sin pruebas,
  // sin conexión Messenger, sin POS y sin gestión de cuentas/registros (igual que Caja en su zona).
  const isCsAgent = user.posRole === 'cs_agent'
  // Roles "operativos" (no admin) que no pueden crear sub-usuarios ni ver Cuentas/Registros.
  const isBaseWorker = isCashier || isCsAgent
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
    if (!isAdminPv) return
    if (CS_PAGES.includes(crmPage)) setCrmPage('operations')
  }, [isAdminPv, crmPage, setCrmPage])

  useEffect(() => {
    if (!(isAdminCs || isCsAgent)) return
    if (crmPage === 'operations') setCrmPage('docs')
  }, [isAdminCs, isCsAgent, crmPage, setCrmPage])

  // Agente CS: sin acceso a Conectar (configuración de Messenger) ni a las pestañas Prompt/Pruebas
  // dentro de la vista de Documentos (solo administra chats y documentos/auto-ingesta).
  useEffect(() => {
    if (!isCsAgent) return
    if (crmPage === 'settings') setCrmPage('docs')
    if (activeTab === 'prompt' || activeTab === 'chat') setActiveTab('documents')
  }, [isCsAgent, crmPage, activeTab, setCrmPage, setActiveTab])

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

  async function handleSetMetaState(next: { state?: MetaBotState; testMode?: boolean; autocuratorEnabled?: boolean }) {
    const prev = metaStatus
    setMetaStatus({ ...metaStatus, ...next })
    try {
      const r = await setMetaState(next)
      setMetaStatus((cur) => ({
        ...cur,
        state: (r?.state ?? cur.state),
        testMode: (r?.testMode ?? cur.testMode),
        autocuratorEnabled: (r?.autocuratorEnabled ?? cur.autocuratorEnabled),
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

  function renderRestricted(title: string, message: string) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="rounded-[20px] border border-[#1a3a5a] bg-[#0f3151] p-10 text-center max-w-lg">
          <p className="text-xl font-bold text-[#1090D0]">{title}</p>
          <p className="mt-3 text-sm text-slate-300">{message}</p>
        </div>
      </div>
    )
  }

  return (
    <main className="h-screen w-screen overflow-hidden bg-[#0c2a47] text-white">
      <div className="flex h-screen w-screen flex-row gap-0 overflow-hidden bg-[#0c2a47]">
        <section className="flex h-screen min-h-0 w-full flex-1 flex-col gap-0 overflow-hidden bg-[#0c2a47]">
          <div className="h-screen min-h-0 flex-1 overflow-hidden">
            {crmPage === 'chats' ? (
              isAdminPv ? (
                renderRestricted('Chats · Acceso restringido', 'Esta zona es exclusiva de Admin CS y del propietario de la cuenta.')
              ) : (
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
              )
            ) : crmPage === 'docs' ? (
              isAdminPv ? (
                renderRestricted('Documentos · Acceso restringido', 'Esta zona es exclusiva de Admin CS y del propietario de la cuenta.')
              ) : (
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
                restrictToDocumentsOnly={isCsAgent}
              />
              )
            ) : crmPage === 'settings' ? (
              (isAdminPv || isCsAgent) ? (
                renderRestricted('Conectar · Acceso restringido', 'Esta zona es exclusiva de Admin CS y del propietario de la cuenta.')
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
                onRetryPages={retryMetaPageList}
                onLinkManual={async (inp) => {
                  const r = await configureMetaManual(inp)
                  await handleRefreshStatus()
                  return r
                }}
                onSetState={handleSetMetaState}
                onSyncAds={syncMetaAds}
                APP_ID={APP_ID}
                graphVersion={GRAPH_VERSION}
              />
              )
            ) : crmPage === 'myprofile' ? (
              <CrmMyProfileView
                userEmail={user.email}
                displayName={user.displayName}
                userName={user.displayName}
                userRole={user.posRole || 'admin'}
                memberSince={new Date().toLocaleDateString('es-MX')}
              />
            ) : crmPage === 'accounts' ? (
              user.posRole && !isBaseWorker ? <CrmAccountsView /> : (
                <div className="flex h-full w-full items-center justify-center">
                  <div className="rounded-[20px] border border-[#1a3a5a] bg-[#0f3151] p-10 text-center max-w-lg">
                    <p className="text-xl font-bold text-[#1090D0]">Cuentas · Acceso restringido</p>
                    <p className="mt-3 text-sm text-slate-300">Solo los administradores pueden crear y gestionar subusuarios. Contacta al propietario de la cuenta si necesitas acceso.</p>
                  </div>
                </div>
              )
            ) : crmPage === 'records' ? (
              user.posRole && !isBaseWorker ? <CrmAuditRecordsView /> : (
                <div className="flex h-full w-full items-center justify-center">
                  <div className="rounded-[20px] border border-[#1a3a5a] bg-[#0f3151] p-10 text-center max-w-lg">
                    <p className="text-xl font-bold text-[#1090D0]">Historial · Solo Administradores</p>
                    <p className="mt-3 text-sm text-slate-300">El registro de auditoría es visible solo para administradores.</p>
                  </div>
                </div>
              )
            ) : crmPage === 'operations' ? (
              (isAdminCs || isCsAgent) ? (
                renderRestricted('Punto de Venta · Acceso restringido', 'Esta zona es exclusiva de Admin PV y del propietario de la cuenta.')
              ) : (
              <CrmOperationsLayout
                active={operationsTab}
                setActive={setOperationsTab}
                userEmail={user.email}
                isCashier={user.posRole === 'cashier'}
              >
                {operationsTab === 'pos' ? (
                  <CrmPosView userRole={user.posRole || 'admin'} />
                ) : operationsTab === 'inventory' ? (
                  <CrmInventoryView />
                ) : operationsTab === 'purchases' ? (
                  <CrmPurchasesView />
                ) : operationsTab === 'sales' ? (
                  <CrmSalesView />
                ) : operationsTab === 'administration' ? (
                  <CrmAdministrationView />
                ) : operationsTab === 'branches' ? (
                  <CrmBranchesView />
                ) : operationsTab === 'dashboard' ? (
                  <CrmAuditRecordsView />
                ) : (
                  <div className="flex h-full w-full items-center justify-center overflow-y-auto px-4 py-10">
                    <div className="w-full max-w-3xl space-y-6">
                      <div className="rounded-[22px] border border-[#1a3a5a] bg-[#0f3151] p-8">
                        <div className="flex flex-wrap items-center gap-4">
                          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#1090D0]/18 text-[#5bbfe5] shadow-[inset_0_0_0_1px_rgba(16,144,208,0.3)]">
                            <PackageCheck className="h-7 w-7" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-extrabold uppercase tracking-widest text-slate-400">
                              Smartbis POS · Actualizaciones
                            </p>
                            <p className="mt-1 text-2xl font-extrabold text-slate-50">
                              Versión instalada{' '}
                              <span className="font-mono text-[#1090D0]">
                                v{String(installedVersion || (import.meta.env.VITE_APP_VERSION as string) || '0.43.0')}
                              </span>
                            </p>
                            <p className="mt-1 text-[12.5px] text-slate-400">
                              {isDesktop
                                ? 'Plataforma escritorio con actualizaciones OTA desde updates.smartbis.ai'
                                : 'Plataforma web. Instala la versión de escritorio para recibir actualizaciones automáticas.'}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {isUpdateAvailable && remoteVersion ? (
                              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#1090D0]/40 bg-[#1090D0]/15 px-3 py-1 text-[11px] font-bold text-[#8ed7f5]">
                                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#1090D0] shadow-[0_0_0_3px_rgba(16,144,208,0.18)]" />
                                Actualización v{remoteVersion}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-bold text-emerald-200">
                                <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.18)]" />
                                Versión al día
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
                          <div className="rounded-2xl border border-[#1a3a5a] bg-[#0b2641]/70 p-4">
                            <div className="flex items-center gap-2 text-[10.5px] font-extrabold uppercase tracking-wider text-slate-400">
                              <Clock className="h-3.5 w-3.5" />
                              Lanzamiento
                            </div>
                            <div className="mt-2 font-mono text-[14px] font-bold text-slate-100">
                              {new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}
                            </div>
                          </div>
                          <div className="rounded-2xl border border-[#1a3a5a] bg-[#0b2641]/70 p-4">
                            <div className="flex items-center gap-2 text-[10.5px] font-extrabold uppercase tracking-wider text-slate-400">
                              <Download className="h-3.5 w-3.5" />
                              Canal
                            </div>
                            <div className="mt-2 font-mono text-[14px] font-bold text-slate-100">
                              Estable · OTA
                            </div>
                          </div>
                          <div className="rounded-2xl border border-[#1a3a5a] bg-[#0b2641]/70 p-4">
                            <div className="flex items-center gap-2 text-[10.5px] font-extrabold uppercase tracking-wider text-slate-400">
                              <PackageCheck className="h-3.5 w-3.5" />
                              Entorno
                            </div>
                            <div className="mt-2 font-mono text-[14px] font-bold text-slate-100">
                              {isDesktop ? 'DESKTOP' : 'WEB'}
                            </div>
                          </div>
                        </div>

                        <div className="mt-6">
                          <p className="mb-3 text-[11px] font-extrabold uppercase tracking-widest text-slate-400">
                            Control de actualizaciones
                          </p>
                          <div className="space-y-3 rounded-2xl border border-[#1a3a5a] bg-[#0b2641]/60 p-5">
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => void handleCheckUpdates()}
                                disabled={isCheckingUpdates || isDownloading || isInstalling || !isDesktop}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-[#1a3a5a] bg-[#11375a] px-3.5 py-2 text-[12px] font-semibold text-slate-100 transition hover:border-[#1090D0]/40 hover:text-white disabled:opacity-50"
                              >
                                <RefreshCw className={cn('h-4 w-4', isCheckingUpdates ? 'animate-spin' : '')} />
                                {isCheckingUpdates ? 'Verificando...' : '1. Verificar actualizaciones'}
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDownloadUpdate()}
                                disabled={!isDesktop || !isUpdateAvailable || isDownloading || isCheckingUpdates || isInstalling || isUpdateDownloaded}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-[#1a3a5a] bg-[#11375a] px-3.5 py-2 text-[12px] font-semibold text-slate-100 transition hover:border-[#1090D0]/40 hover:text-white disabled:opacity-50"
                              >
                                <Download className={cn('h-4 w-4', isDownloading ? 'animate-bounce' : '')} />
                                {isUpdateDownloaded ? 'Descargada ✓' : isDownloading ? `Descargando ${downloadProgress !== null ? `${downloadProgress.toFixed(0)}%` : '...'}` : '2. Descargar'}
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleInstallUpdate()}
                                disabled={!isDesktop || !isUpdateDownloaded || isInstalling || isDownloading || isCheckingUpdates}
                                className="inline-flex items-center gap-1.5 rounded-xl bg-[#1090D0] px-4 py-2 text-[12px] font-bold text-white shadow-[0_4px_14px_-4px_rgba(16,144,208,0.8)] transition hover:bg-[#0c79ae] disabled:opacity-50"
                              >
                                <PlayCircle className={cn('h-4 w-4', isInstalling ? 'animate-pulse' : '')} />
                                {isInstalling ? 'Instalando...' : '3. Instalar y reiniciar'}
                              </button>
                            </div>

                            {(downloadProgress !== null && isDownloading) || updateStatusMsg ? (
                              <div className="space-y-2">
                                {downloadProgress !== null && isDownloading ? (
                                  <div>
                                    <div className="mb-1 flex items-center justify-between text-[11px] text-slate-400">
                                      <span>Progreso de descarga</span>
                                      <span className="font-mono font-bold text-[#5bbfe5]">{downloadProgress.toFixed(0)}%</span>
                                    </div>
                                    <div className="h-2 overflow-hidden rounded-full bg-[#071828]">
                                      <div
                                        className="h-full rounded-full bg-gradient-to-r from-[#1090D0] to-[#5bbfe5] transition-all duration-300"
                                        style={{ width: `${Math.max(0, Math.min(100, downloadProgress))}%` }}
                                      />
                                    </div>
                                  </div>
                                ) : null}
                                {updateStatusMsg ? (
                                  <div className={cn(
                                    'flex items-start gap-2 rounded-xl border px-3 py-2 text-[12px]',
                                    (isUpdateAvailable && !isUpdateDownloaded && !isDownloading)
                                      ? 'border-[#1090D0]/30 bg-[#1090D0]/10 text-[#b6e3f4]'
                                      : isUpdateDownloaded
                                      ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100'
                                      : 'border-[#1a3a5a] bg-[#0b2641]/80 text-slate-300',
                                  )}>
                                    {isUpdateDownloaded ? (
                                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                                    ) : isUpdateAvailable && !isDownloading ? (
                                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#5bbfe5]" />
                                    ) : (
                                      <PackageCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                                    )}
                                    <span>{updateStatusMsg}</span>
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </div>

                        <div className="mt-6">
                          <p className="mb-3 text-[11px] font-extrabold uppercase tracking-widest text-slate-400">
                            Notas de la versión
                          </p>
                          <div className="space-y-4 rounded-2xl border border-[#1a3a5a] bg-[#0b2641]/60 p-5 text-[13px] leading-relaxed text-slate-300 tech-scrollbar max-h-[340px] overflow-y-auto">
                            <div>
                              <p className="font-bold text-slate-100">v0.55.0 · Bot Salubel: Pagos inteligentes y listados de productos limpios</p>
                              <p className="mt-1 text-slate-400">
                                Nueva lógica de validación de ubicación obligatoria para Salubel Institute: el bot ahora pregunta si el cliente está en México o Internacional antes de mostrar métodos de pago. Clientes en México reciben cuentas Santander, OXXO y Banamex; clientes internacionales solo pueden pagar vía Stripe o PayPal (nunca se muestran cuentas bancarias mexicanas). Enlaces de Stripe dinámicos según el precio del curso ($895 y $595 MXN). Listados de productos simplificados: ahora el bot muestra únicamente NOMBRE y PRECIO como primera información, ocultando SKU, Unidad y Categoría a menos que el cliente lo solicite explícitamente. Actualizaciones al prompt del sistema con inyección de fecha/hora actual en zona Sonora/Arizona para evitar ofrecer fechas pasadas de cursos. Consistencia centralizada de información de pagos y productos como verdad absoluta en código. Todas las respuestas de pago cierran invitando a enviar el comprobante al WhatsApp +52 1 662 335 8779. Nuevo piso #6 Actualizaciones: ahora incluye botones Verificar, Descargar e Instalar con barra de progreso y estado en tiempo real.
                              </p>
                            </div>
                            <div>
                              <p className="font-bold text-slate-100">v0.44.0 · Ajuste altura escritorio</p>
                              <p className="mt-1 text-slate-400">
                                La nueva barra superior integrada ya no corta los botones Cobrar, Cotizacion, Promociones y Retiro del fondo del POS. Ajuste de solo los 32px exactos que ocupaba la barra, sin exagerar.
                              </p>
                            </div>
                            <div>
                              <p className="font-bold text-slate-100">v0.43.0 · IVA condicional, turno obligatorio y OTA</p>
                              <p className="mt-1 text-slate-400">
                                IVA solo cuando la casilla Factura esta marcada. Turno obligatorio (se quito Cancelar). Barra superior integrada Salir + Desktop PROD sin solapamientos. Actualizaciones OTA automaticas al abrir y boton de notas abajo-derecha. Piso #6 cambio de icono a Descarga con version y changelog. Escritorio se conecta al backend remoto (datos iguales que web).
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[#1a3a5a] pt-5">
                          <p className="text-[11.5px] text-slate-400">
                            Recordatorio rápido: el porcentaje de IVA y la moneda por sucursal se configuran en{' '}
                            <span className="font-bold text-slate-200">#5 Sucursales</span>.
                          </p>
                          <button
                            type="button"
                            onClick={() => void handleCheckUpdates()}
                            disabled={isCheckingUpdates || isDownloading || isInstalling || !isDesktop}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-[#1090D0] px-4 py-2 text-[12px] font-bold text-white transition hover:bg-[#0c79ae] shadow-[0_4px_14px_-4px_rgba(16,144,208,0.8)] disabled:opacity-50"
                          >
                            <RefreshCw className={cn('h-4 w-4', isCheckingUpdates ? 'animate-spin' : '')} />
                            Revisar actualizaciones
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </CrmOperationsLayout>
              )
            ) : crmPage === 'notifications' ? (
              <CrmNotificationsView />
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
                onRetryPages={retryMetaPageList}
                onLinkManual={async (inp) => {
                  const r = await configureMetaManual(inp)
                  await handleRefreshStatus()
                  return r
                }}
                onSetState={handleSetMetaState}
                onSyncAds={syncMetaAds}
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
        onGoNotifications={() => setCrmPage('notifications')}
        isCashier={user.posRole === 'cashier'}
        hideCsSections={isAdminPv}
        hidePosSections={isAdminCs || isCsAgent}
        hideAdminOnlySections={isBaseWorker}
        restrictCsToDocsOnly={isCsAgent}
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
  /** Agente CS: solo administra Documentos (y auto-ingesta); sin acceso a Prompt ni Pruebas. */
  restrictToDocumentsOnly?: boolean
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
    restrictToDocumentsOnly,
  } = props
  return (
    <section className="flex h-screen min-h-0 w-full max-w-full max-h-full flex-col overflow-hidden gap-4 bg-[#0c2a47] px-4 py-4">
      <div className="min-h-0 flex-1 flex flex-col gap-4 overflow-hidden">
      {activeTab === 'chat' && !restrictToDocumentsOnly ? (
        <DashboardChatPanel
          prompt={prompt}
          documents={documents}
          onSendMessage={onSendChatMessage}
        />
      ) : activeTab === 'prompt' && !restrictToDocumentsOnly ? (
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
