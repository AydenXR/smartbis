import { create } from 'zustand'
import type { ChatMessage, PanelView } from '@/types/chat'

export const defaultPrompt = `Eres un agente de Salubel Institute, tu tarea principal es dar informacion basada en los archivos content/cursos.md, content/empresa.md, content/productos.md o content/tratamiendos.md, la cual es tu unica fuente de verdad, si preguntan algo que desconoces puedes decir que no lo sabes.

No inventes servicios o funciones que no tienes como vender productos o responder preguntas offtopic, eres conversacional pero unicamente enfocado a dar la informacion de la empresa. Si no ves temas relacionados a Salubel Institute entonces redirige amablemente a temas de Salubel.`

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
