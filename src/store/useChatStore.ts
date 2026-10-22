import { create } from 'zustand'
import type { ChatMessage, PanelView } from '@/types/chat'

export const defaultPrompt = `Eres el agente de este cliente. Responde solo con informacion respaldada por el prompt y los documentos disponibles en la base de datos.

Reglas:
- No inventes datos, precios, horarios, promociones o servicios.
- Si algo no aparece en los documentos, dilo con claridad.
- Mantente enfocado en la informacion real del cliente.
- Usa un tono claro, directo y amable.`

type ChatStore = {
  activeView: PanelView
  messages: ChatMessage[]
  setActiveView: (view: PanelView) => void
  addMessage: (message: ChatMessage) => void
  clearMessages: () => void
}

export const useChatStore = create<ChatStore>((set) => ({
  activeView: 'chat',
  messages: [],
  setActiveView: (view) => set({ activeView: view }),
  addMessage: (message) =>
    set((state) => ({
      messages: [...state.messages, message],
    })),
  clearMessages: () => set({ messages: [] }),
}))
