import express, { type NextFunction, type Request, type Response } from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { generateAgentAnswer } from './lib/xai.js'
import { saveLlmRuntimeConfig, syncEnvLocalToProcess } from './lib/runtimeConfig.js'
import {
  createDocument,
  deleteDocument,
  loadWorkspace,
  savePrompt,
  updateDocument,
  type DocumentSection,
} from './lib/workspace.js'

dotenv.config()
dotenv.config({ path: '.env.local', override: true })
void syncEnvLocalToProcess()

const app: express.Application = express()

app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

app.get('/api/health', (_req: Request, res: Response): void => {
  res.status(200).json({
    success: true,
    message: 'ok',
  })
})

app.get('/api/workspace', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const workspace = await loadWorkspace()
    res.status(200).json(workspace)
  } catch (error) {
    next(error)
  }
})

app.put('/api/prompt', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : ''

    if (!prompt) {
      res.status(400).json({
        error: 'El prompt es obligatorio',
      })
      return
    }

    const savedPrompt = await savePrompt(prompt)

    res.status(200).json({
      prompt: savedPrompt,
    })
  } catch (error) {
    next(error)
  }
})

app.put('/api/llm-config', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const baseUrl = typeof req.body?.baseUrl === 'string' ? req.body.baseUrl.trim() : ''
    const model = typeof req.body?.model === 'string' ? req.body.model.trim() : ''
    const apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : undefined

    const llmConfig = await saveLlmRuntimeConfig({
      baseUrl,
      model,
      apiKey,
    })

    res.status(200).json({
      llmConfig,
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/documents', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : ''
    const content = typeof req.body?.content === 'string' ? req.body.content : ''
    const section = typeof req.body?.section === 'string' ? req.body.section : ''
    const isActive = Boolean(req.body?.isActive ?? true)

    if (!title || !content || !['general', 'cursos', 'productos'].includes(section)) {
      res.status(400).json({
        error: 'Documento invalido',
      })
      return
    }

    const document = await createDocument({
      section: section as DocumentSection,
      title,
      content,
      isActive,
    })

    res.status(201).json({
      document,
    })
  } catch (error) {
    next(error)
  }
})

app.put('/api/documents/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = typeof req.params.id === 'string' ? req.params.id : ''
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : ''
    const content = typeof req.body?.content === 'string' ? req.body.content : ''
    const isActive = Boolean(req.body?.isActive ?? true)

    if (!id || !title || !content) {
      res.status(400).json({
        error: 'Documento invalido',
      })
      return
    }

    const document = await updateDocument(id, {
      title,
      content,
      isActive,
    })

    res.status(200).json({
      document,
    })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/documents/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = typeof req.params.id === 'string' ? req.params.id : ''

    if (!id) {
      res.status(400).json({
        error: 'Documento invalido',
      })
      return
    }

    await deleteDocument(id)

    res.status(204).send()
  } catch (error) {
    next(error)
  }
})

app.post('/api/chat', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : ''
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : ''
    const history = Array.isArray(req.body?.history) ? req.body.history : []

    if (!prompt || !message) {
      res.status(400).json({
        error: 'El prompt y el mensaje son obligatorios',
      })
      return
    }

    const answer = await generateAgentAnswer({
      prompt,
      message,
      history,
    })

    res.status(200).json(answer)
  } catch (error) {
    next(error)
  }
})

app.use((error: Error, _req: Request, res: Response, next: NextFunction) => {
  void next
  res.status(500).json({
    error: error.message || 'Error interno del servidor',
  })
})

app.use((_req: Request, res: Response) => {
  res.status(404).json({
    error: 'API no encontrada',
  })
})

export default app
