export type PanelView = 'chat' | 'prompt' | 'documents'

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export type DocumentSection = 'general' | 'cursos' | 'productos'

export type WorkspaceDocument = {
  id: string
  title: string
  docType: string
  section: DocumentSection
  content: string
  isActive: boolean
  updatedAt: string
}

export type LlmConfig = {
  baseUrl: string
  model: string
  hasApiKey: boolean
  apiKeyPreview: string
}

export type WorkspacePayload = {
  prompt: string
  documents: WorkspaceDocument[]
  llmConfig: LlmConfig
}

export type ContextFileStatus = {
  file: string
  hasContent: boolean
  size: number
}

export type ChatResponse = {
  answer: string
  sources: Array<{
    id: string
    title: string
    section: DocumentSection
    isActive: boolean
  }>
}
