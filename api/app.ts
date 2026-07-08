import express, { type NextFunction, type Request, type Response } from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { readSourceContexts } from './lib/context.js'
import { generateAgentAnswer } from './lib/xai.js'

dotenv.config()
dotenv.config({ path: '.env.local', override: true })

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

app.get('/api/context-status', async (_req: Request, res: Response) => {
  const files = await readSourceContexts()

  res.status(200).json({
    files: files.map((file) => ({
      file: file.file,
      hasContent: file.hasContent,
      size: file.size,
    })),
  })
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
