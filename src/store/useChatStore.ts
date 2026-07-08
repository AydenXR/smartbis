import { create } from 'zustand'
import type { ChatMessage, PanelView } from '@/types/chat'

const STORAGE_KEY = 'salubel-agent-prompt'

export const defaultPrompt = `Eres un agente de Salubel Institute, tu tarea principal es dar informacion basada en los archivos content/cursos.md, content/empresa.md, content/productos.md o content/tratamiendos.md, la cual es tu unica fuente de verdad, si preguntan algo que desconoces puedes decir que no lo sabes.

No inventes servicios o funciones que no tienes como vender productos o responder preguntas offtopic, eres conversacional pero unicamente enfocado a dar la informacion de la empresa. Si no ves temas relacionados a Salubel Institute entonces redirige amablemente a temas de Salubel.`

type ChatStore = {
  activeView: PanelView
  prompt: string
  messages: ChatMessage[]
  setActiveView: (view: PanelView) => void
  setPrompt: (prompt: string) => void
  resetPrompt: () => void
  addMessage: (message: ChatMessage) => void
  replaceLastAssistantMessage: (message: ChatMessage) => void
  clearMessages: () => void
}

function getStoredPrompt() {
  if (typeof window === 'undefined') {
    return defaultPrompt
  }

  return window.localStorage.getItem(STORAGE_KEY) || defaultPrompt
}

function persistPrompt(prompt: string) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(STORAGE_KEY, prompt)
}

export const useChatStore = create<ChatStore>((set) => ({
  activeView: 'chat',
  prompt: getStoredPrompt(),
  messages: [],
  setActiveView: (view) => set({ activeView: view }),
  setPrompt: (prompt) => {
    persistPrompt(prompt)
    set({ prompt })
  },
  resetPrompt: () => {
    persistPrompt(defaultPrompt)
    set({ prompt: defaultPrompt })
  },
  addMessage: (message) =>
    set((state) => ({
      messages: [...state.messages, message],
    })),
  replaceLastAssistantMessage: (message) =>
    set((state) => {
      const nextMessages = [...state.messages]
      const lastAssistantIndex = [...nextMessages]
        .reverse()
        .findIndex((item) => item.role === 'assistant')

      if (lastAssistantIndex === -1) {
        return {
          messages: [...nextMessages, message],
        }
      }

      const targetIndex = nextMessages.length - 1 - lastAssistantIndex
      nextMessages[targetIndex] = message

      return {
        messages: nextMessages,
      }
    }),
  clearMessages: () => set({ messages: [] }),
}))
