import { create } from 'zustand'
import type {
  MetaBotState,
  MetaChatItem,
  MetaMessageRow,
  MetaStatusResponse,
} from '@/lib/api'

export type CrmPage = 'chats' | 'docs' | 'settings' | 'operations' | 'myprofile' | 'accounts' | 'records' | 'notifications'

export interface MetaStoreState {
  page: CrmPage
  setPage: (p: CrmPage) => void

  status: MetaStatusResponse | null
  loadingStatus: boolean
  errorStatus: string
  loadStatus: (fn: () => Promise<MetaStatusResponse>) => Promise<void>
  setState: (fn: (next: { state?: MetaBotState; testMode?: boolean }) => Promise<any>, next: { state?: MetaBotState; testMode?: boolean }) => Promise<void>

  chats: MetaChatItem[]
  loadingChats: boolean
  errorChats: string
  loadChats: (fn: () => Promise<{ chats: MetaChatItem[] }>, opts?: { silent?: boolean }) => Promise<void>
  markChatLocalAsRead: (psid: string) => void
  deleteChatLocal: (psid: string) => void

  selectedPSID: string | null
  selectedMessages: MetaMessageRow[]
  loadingDetail: boolean
  errorDetail: string
  selectChat: (
    psid: string | null,
    fn?: (psid: string) => Promise<{ psid: string; messages: MetaMessageRow[] }>,
    opts?: { silent?: boolean },
  ) => Promise<void>
  appendLocalMessage: (msg: MetaMessageRow) => void
}

const initialStatus: MetaStatusResponse = {
  state: 'PAUSE',
  testMode: false,
  webhookSubscribed: false,
  linked: false,
  hasPageToken: false,
}

export const useMetaCrmStore = create<MetaStoreState>((set, get) => ({
  page: 'chats',
  setPage: (p) => set({ page: p }),

  status: null,
  loadingStatus: false,
  errorStatus: '',
  async loadStatus(fn) {
    set({ loadingStatus: true, errorStatus: '' })
    try {
      const r = await fn()
      set({ status: { ...initialStatus, ...r }, loadingStatus: false })
    } catch (e: any) {
      set({ loadingStatus: false, errorStatus: e?.message || 'Error al cargar estado del bot' })
    }
  },
  async setState(fn, next) {
    const prev = get().status
    set({
      status: prev ? { ...prev, ...next } : { ...initialStatus, ...next },
    })
    try {
      const r: any = await fn(next)
      if (r?.state !== undefined || r?.testMode !== undefined) {
        set({
          status: (get().status ? { ...get().status!, state: r.state ?? get().status!.state, testMode: r.testMode ?? get().status!.testMode } : null),
        })
      }
    } catch (e: any) {
      if (prev) set({ status: prev })
      throw e
    }
  },

  chats: [],
  loadingChats: false,
  errorChats: '',
  async loadChats(fn, opts) {
    const silent = Boolean(opts?.silent)
    if (!silent) set({ loadingChats: true, errorChats: '' })
    try {
      const r = await fn()
      set({ chats: r.chats, loadingChats: false })
    } catch (e: any) {
      set({ loadingChats: false, errorChats: silent ? '' : (e?.message || 'Error al cargar chats') })
    }
  },
  markChatLocalAsRead(psid) {
    const chats = get().chats
    const i = chats.findIndex((c) => c.psid === psid)
    if (i >= 0 && chats[i].unreadCount > 0) {
      const next = [...chats]
      next[i] = { ...next[i], unreadCount: 0 }
      set({ chats: next })
    }
  },
  deleteChatLocal(psid) {
    const current = get().chats.filter((c) => c.psid !== psid)
    const patch: Partial<MetaStoreState> = { chats: current }
    if (get().selectedPSID === psid) {
      patch.selectedPSID = null
      patch.selectedMessages = []
    }
    set(patch as any)
  },

  selectedPSID: null,
  selectedMessages: [],
  loadingDetail: false,
  errorDetail: '',
  async selectChat(psid, fn, opts) {
    const silent = Boolean(opts?.silent)
    set({ selectedPSID: psid, errorDetail: silent ? (get().errorDetail) : '' })
    if (!psid || !fn) {
      set({ selectedMessages: [], loadingDetail: false })
      return
    }
    const current = get().chats.find((c) => c.psid === psid)
    if (current && current.unreadCount > 0) {
      get().markChatLocalAsRead(psid)
    }
    if (!silent) set({ loadingDetail: true })
    try {
      const r = await fn(psid)
      set({ selectedMessages: r.messages, loadingDetail: false })
    } catch (e: any) {
      set({ loadingDetail: false, errorDetail: silent ? (get().errorDetail) : (e?.message || 'Error al cargar conversación') })
    }
  },
  appendLocalMessage(msg) {
    if (get().selectedPSID === msg.psid) {
      set({ selectedMessages: [...(get().selectedMessages || []), msg] })
    }
  },
}))
