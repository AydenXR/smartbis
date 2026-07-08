export type PanelView = 'prompt' | 'chat'

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export type ContextFileStatus = {
  file: string
  hasContent: boolean
  size: number
}

export type ChatResponse = {
  answer: string
  sources: Array<{
    file: string
    hasContent: boolean
  }>
}
