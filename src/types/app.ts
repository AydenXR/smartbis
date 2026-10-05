export type AuthUser = {
  id: string
  clientId: string
  tenantId: string
  email: string
  posRole?: 'owner' | 'admin' | 'admin_pv' | 'admin_cs' | 'cashier' | 'cs_agent'
  posBranchId?: string
  subuserId?: string
  displayName?: string
  authKind?: 'tenant_owner' | 'pos_subuser'
}

export type WorkspaceDocument = {
  id: string
  fileName: string
  label: string
  content: string
  updatedAt: string
  isActive?: boolean
}

export type DocumentIngestionStatus = {
  ok: boolean
  indexedAt?: string
  documents?: number
  activeDocuments?: number
  blocks?: number
  error?: string
}

export type DocumentMutationPayload = {
  document: WorkspaceDocument
  ingestion?: DocumentIngestionStatus
}

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export type ChatResponse = {
  answer: string
  sources: Array<{
    id: string
    title: string
    section: 'general' | 'cursos' | 'productos'
    isActive: boolean
  }>
}

export type WorkspacePayload = {
  user: AuthUser
  prompt: string
  documents: WorkspaceDocument[]
}

export type AuthPayload = {
  token: string
  refreshToken?: string
  user: AuthUser
}
