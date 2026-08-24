import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'

const CLIENTS_ROOT = path.resolve(process.cwd(), 'clientsdata')
const SYSTEM_ROOT = path.join(CLIENTS_ROOT, '.system')
const ACCOUNTS_FILE = path.join(SYSTEM_ROOT, 'accounts.json')
const SESSIONS_FILE = path.join(SYSTEM_ROOT, 'sessions.json')
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30
const RESERVED_FILE_NAMES = new Set(['prompt.md'])

const DEFAULT_PROMPT = `Eres el agente de este cliente. Responde solo con informacion respaldada por el prompt y los archivos markdown disponibles en su carpeta.

Reglas:
- No inventes datos, precios, horarios, promociones o servicios.
- Si algo no aparece en los documentos, dilo con claridad.
- Mantente enfocado en la informacion real del cliente.
- Usa un tono claro, directo y amable.`

const DEFAULT_DOCUMENTS: Array<{ fileName: string; content: string }> = [
  {
    fileName: 'infogeneral.md',
    content: `[NOMBRE_DE_EMPRESA]
Nueva cuenta Smartbis

[DESCRIPCION]
Agrega aqui la informacion general del cliente.

[CONTACTO]
Correo de acceso: {{EMAIL}}

[NOTAS]
Edita este archivo con la informacion real del negocio.`,
  },
  {
    fileName: 'productos.md',
    content: `[PRODUCTOS]
Agrega aqui el catalogo de productos del cliente.`,
  },
  {
    fileName: 'cursos.md',
    content: `[CURSOS]
Agrega aqui la informacion de cursos o capacitaciones del cliente.`,
  },
  {
    fileName: 'faqs.md',
    content: `[FAQS]
Agrega aqui preguntas frecuentes y sus respuestas.`,
  },
]

type StoredAccount = {
  clientId: string
  email: string
  passwordHash: string
  passwordSalt: string
  createdAt: string
}

type StoredSession = {
  token: string
  clientId: string
  createdAt: string
  expiresAt: string
}

export type AuthUser = {
  clientId: string
  email: string
  createdAt: string
}

export type LocalWorkspaceDocument = {
  id: string
  fileName: string
  label: string
  content: string
  updatedAt: string
}

type JsonArray = StoredAccount[] | StoredSession[]

function formatDatePrefix(date: Date) {
  const day = `${date.getDate()}`.padStart(2, '0')
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const year = `${date.getFullYear()}`.slice(-2)

  return `${day}${month}${year}`
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function toAuthUser(account: StoredAccount): AuthUser {
  return {
    clientId: account.clientId,
    email: account.email,
    createdAt: account.createdAt,
  }
}

function createPasswordHash(password: string) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')

  return {
    salt,
    hash,
  }
}

function verifyPassword(password: string, salt: string, expectedHash: string) {
  const hashedPassword = scryptSync(password, salt, 64)
  const expectedBuffer = Buffer.from(expectedHash, 'hex')

  if (hashedPassword.length !== expectedBuffer.length) {
    return false
  }

  return timingSafeEqual(hashedPassword, expectedBuffer)
}

function humanizeFileName(fileName: string) {
  const stem = fileName.replace(/\.md$/i, '')

  return stem
    .split(/[-_]+/)
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(' ')
}

function slugify(value: string) {
  const asciiValue = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

  const slug = asciiValue
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || 'documento'
}

function normalizeDocumentFileName(fileName: string) {
  const rawStem = fileName.replace(/\.md$/i, '').trim()
  const stem = slugify(rawStem)

  return `${stem}.md`
}

function assertValidClientId(clientId: string) {
  if (!/^\d{7,}$/.test(clientId)) {
    throw new Error('Cliente invalido')
  }
}

function assertValidDocumentName(fileName: string) {
  if (!/^[a-z0-9-]+\.md$/i.test(fileName)) {
    throw new Error('Nombre de documento invalido')
  }

  if (RESERVED_FILE_NAMES.has(fileName.toLowerCase())) {
    throw new Error('Ese nombre de archivo esta reservado')
  }
}

async function ensureStorage() {
  await fs.mkdir(CLIENTS_ROOT, { recursive: true })
  await fs.mkdir(SYSTEM_ROOT, { recursive: true })
}

async function readJsonFile<T extends JsonArray>(filePath: string, fallback: T): Promise<T> {
  await ensureStorage()

  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return fallback
    }

    throw error
  }
}

async function writeJsonFile(filePath: string, value: unknown) {
  await ensureStorage()
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function readAccounts() {
  return readJsonFile<StoredAccount[]>(ACCOUNTS_FILE, [])
}

async function writeAccounts(accounts: StoredAccount[]) {
  await writeJsonFile(ACCOUNTS_FILE, accounts)
}

async function readSessions() {
  const sessions = await readJsonFile<StoredSession[]>(SESSIONS_FILE, [])
  const now = Date.now()
  const activeSessions = sessions.filter((session) => new Date(session.expiresAt).getTime() > now)

  if (activeSessions.length !== sessions.length) {
    await writeJsonFile(SESSIONS_FILE, activeSessions)
  }

  return activeSessions
}

async function writeSessions(sessions: StoredSession[]) {
  await writeJsonFile(SESSIONS_FILE, sessions)
}

async function listClientDirectories() {
  await ensureStorage()

  const entries = await fs.readdir(CLIENTS_ROOT, { withFileTypes: true }).catch(() => [])

  return entries
    .filter((entry) => entry.isDirectory() && /^\d{7,}$/.test(entry.name))
    .map((entry) => entry.name)
}

async function generateClientId() {
  const prefix = formatDatePrefix(new Date())
  const existingDirectories = await listClientDirectories()
  let maxSequence = 0

  for (const name of existingDirectories) {
    const match = name.match(new RegExp(`^${prefix}(\\d+)$`))

    if (!match?.[1]) {
      continue
    }

    const sequence = Number.parseInt(match[1], 10)

    if (Number.isFinite(sequence)) {
      maxSequence = Math.max(maxSequence, sequence)
    }
  }

  return `${prefix}${maxSequence + 1}`
}

function getClientDirectory(clientId: string) {
  assertValidClientId(clientId)
  return path.join(CLIENTS_ROOT, clientId)
}

async function ensureClientDirectory(clientId: string) {
  const clientDirectory = getClientDirectory(clientId)
  await fs.mkdir(clientDirectory, { recursive: true })
  return clientDirectory
}

async function seedClientWorkspace(clientId: string, email: string) {
  const clientDirectory = await ensureClientDirectory(clientId)
  const promptPath = path.join(clientDirectory, 'prompt.md')

  await fs.writeFile(promptPath, DEFAULT_PROMPT, { encoding: 'utf8', flag: 'wx' }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error
    }
  })

  await Promise.all(
    DEFAULT_DOCUMENTS.map(async (document) => {
      const targetPath = path.join(clientDirectory, document.fileName)
      const content = document.content.replace('{{EMAIL}}', email)

      await fs.writeFile(targetPath, content, { encoding: 'utf8', flag: 'wx' }).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw error
        }
      })
    }),
  )
}

async function readDocument(filePath: string, fileName: string): Promise<LocalWorkspaceDocument> {
  const [content, stats] = await Promise.all([fs.readFile(filePath, 'utf8'), fs.stat(filePath)])

  return {
    id: fileName,
    fileName,
    label: humanizeFileName(fileName),
    content,
    updatedAt: stats.mtime.toISOString(),
  }
}

async function ensureUniqueFileName(clientId: string, preferredName: string) {
  const clientDirectory = await ensureClientDirectory(clientId)
  const stem = preferredName.replace(/\.md$/i, '')
  let attempt = 0
  let candidate = preferredName

  while (true) {
    const filePath = path.join(clientDirectory, candidate)

    try {
      await fs.access(filePath)
      attempt += 1
      candidate = `${stem}-${attempt + 1}.md`
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return candidate
      }

      throw error
    }
  }
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }

    throw error
  }
}

function createSessionRecord(clientId: string): StoredSession {
  const createdAt = new Date()

  return {
    token: randomBytes(32).toString('hex'),
    clientId,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + SESSION_TTL_MS).toISOString(),
  }
}

export async function registerLocalAccount(input: { email: string; password: string }) {
  const email = normalizeEmail(input.email)
  const password = input.password.trim()

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Ingresa un correo valido')
  }

  if (password.length < 8) {
    throw new Error('La contrasena debe tener al menos 8 caracteres')
  }

  const accounts = await readAccounts()

  if (accounts.some((account) => account.email === email)) {
    throw new Error('Ese correo ya esta registrado')
  }

  const clientId = await generateClientId()
  const passwordData = createPasswordHash(password)
  const account: StoredAccount = {
    clientId,
    email,
    passwordHash: passwordData.hash,
    passwordSalt: passwordData.salt,
    createdAt: new Date().toISOString(),
  }

  accounts.push(account)
  await writeAccounts(accounts)
  await seedClientWorkspace(clientId, email)

  const sessions = await readSessions()
  const session = createSessionRecord(clientId)
  await writeSessions([...sessions, session])

  return {
    token: session.token,
    user: toAuthUser(account),
  }
}

export async function loginLocalAccount(input: { email: string; password: string }) {
  const email = normalizeEmail(input.email)
  const password = input.password.trim()
  const accounts = await readAccounts()
  const account = accounts.find((item) => item.email === email)

  if (!account || !verifyPassword(password, account.passwordSalt, account.passwordHash)) {
    throw new Error('Correo o contrasena incorrectos')
  }

  const sessions = await readSessions()
  const session = createSessionRecord(account.clientId)
  await writeSessions([...sessions, session])

  return {
    token: session.token,
    user: toAuthUser(account),
  }
}

export async function logoutLocalSession(token: string) {
  const sessions = await readSessions()
  const nextSessions = sessions.filter((session) => session.token !== token)

  await writeSessions(nextSessions)
}

export async function getUserFromToken(token: string) {
  if (!token.trim()) {
    return null
  }

  const [sessions, accounts] = await Promise.all([readSessions(), readAccounts()])
  const session = sessions.find((item) => item.token === token)

  if (!session) {
    return null
  }

  const account = accounts.find((item) => item.clientId === session.clientId)

  if (!account) {
    return null
  }

  return toAuthUser(account)
}

export async function loadLocalWorkspace(clientId: string) {
  const clientDirectory = await ensureClientDirectory(clientId)
  const promptPath = path.join(clientDirectory, 'prompt.md')
  const entries = await fs.readdir(clientDirectory, { withFileTypes: true })
  const documentNames = entries
    .filter((entry) => {
      if (!entry.isFile()) {
        return false
      }

      if (!entry.name.toLowerCase().endsWith('.md')) {
        return false
      }

      return entry.name.toLowerCase() !== 'prompt.md'
    })
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))

  const prompt = await fs.readFile(promptPath, 'utf8').catch(() => DEFAULT_PROMPT)
  const documents = await Promise.all(
    documentNames.map((fileName) => readDocument(path.join(clientDirectory, fileName), fileName)),
  )

  documents.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))

  return {
    prompt,
    documents,
  }
}

export async function saveLocalPrompt(clientId: string, prompt: string) {
  const nextPrompt = prompt.trim()

  if (!nextPrompt) {
    throw new Error('El prompt no puede estar vacio')
  }

  const clientDirectory = await ensureClientDirectory(clientId)
  const promptPath = path.join(clientDirectory, 'prompt.md')
  await fs.writeFile(promptPath, nextPrompt, 'utf8')

  return nextPrompt
}

export async function createLocalDocument(
  clientId: string,
  input: { fileName?: string; content: string },
) {
  const content = input.content.trim()

  if (!content) {
    throw new Error('El contenido del documento no puede estar vacio')
  }

  const requestedName = normalizeDocumentFileName(input.fileName?.trim() || 'documento')
  assertValidDocumentName(requestedName)

  const fileName = await ensureUniqueFileName(clientId, requestedName)
  const clientDirectory = await ensureClientDirectory(clientId)
  const filePath = path.join(clientDirectory, fileName)

  await fs.writeFile(filePath, content, 'utf8')

  return readDocument(filePath, fileName)
}

export async function updateLocalDocument(
  clientId: string,
  currentFileName: string,
  input: { fileName: string; content: string },
) {
  const currentName = normalizeDocumentFileName(currentFileName)
  const nextFileName = normalizeDocumentFileName(input.fileName)
  const nextContent = input.content.trim()

  assertValidDocumentName(currentName)
  assertValidDocumentName(nextFileName)

  if (!nextContent) {
    throw new Error('El contenido del documento no puede estar vacio')
  }

  const clientDirectory = await ensureClientDirectory(clientId)
  const currentPath = path.join(clientDirectory, currentName)
  const nextPath = path.join(clientDirectory, nextFileName)

  const hasCurrentDocument = await fileExists(currentPath)

  if (!hasCurrentDocument) {
    throw new Error('Documento no encontrado')
  }

  if (currentName !== nextFileName) {
    const hasTargetDocument = await fileExists(nextPath)

    if (hasTargetDocument) {
      throw new Error('Ya existe un documento con ese nombre')
    }
  }

  await fs.writeFile(currentPath, nextContent, 'utf8')

  if (currentName !== nextFileName) {
    await fs.rename(currentPath, nextPath)
    return readDocument(nextPath, nextFileName)
  }

  return readDocument(currentPath, currentName)
}

export async function deleteLocalDocument(clientId: string, fileName: string) {
  const normalizedName = normalizeDocumentFileName(fileName)
  assertValidDocumentName(normalizedName)

  const clientDirectory = await ensureClientDirectory(clientId)
  const filePath = path.join(clientDirectory, normalizedName)

  await fs.unlink(filePath).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('Documento no encontrado')
    }

    throw error
  })
}
