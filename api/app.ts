import express, { type NextFunction, type Request, type Response } from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { readSourceContexts } from './lib/context.js'
import { createRequestSupabaseContext } from './lib/supabase.js'
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

app.get('/api/auth/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const contextResult = await createRequestSupabaseContext(req)

    if (contextResult.error || !contextResult.data) {
      res.status(contextResult.error?.status || 401).json({
        error: contextResult.error?.message || 'No autorizado',
      })
      return
    }

    const { auth, supabaseAdmin } = contextResult.data
    const userId = auth.userClaims?.id

    if (!userId) {
      res.status(401).json({
        error: 'No se pudo identificar al usuario autenticado.',
      })
      return
    }

    const [profileResult, membershipsResult] = await Promise.all([
      supabaseAdmin
        .from('profiles')
        .select('id, email, display_name, created_at, updated_at')
        .eq('id', userId)
        .maybeSingle(),
      supabaseAdmin
        .from('memberships')
        .select('id, tenant_id, role, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: true }),
    ])

    if (profileResult.error) {
      throw profileResult.error
    }

    if (membershipsResult.error) {
      throw membershipsResult.error
    }

    const tenantIds = (membershipsResult.data || []).map((membership) => membership.tenant_id)

    const tenantsResult = tenantIds.length
      ? await supabaseAdmin
          .from('tenants')
          .select('id, name, slug, created_at, updated_at')
          .in('id', tenantIds)
      : { data: [], error: null }

    if (tenantsResult.error) {
      throw tenantsResult.error
    }

    const tenantsById = new Map(
      (tenantsResult.data || []).map((tenant) => [
        tenant.id,
        {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          createdAt: tenant.created_at,
          updatedAt: tenant.updated_at,
        },
      ]),
    )

    const memberships = (membershipsResult.data || []).map((membership) => ({
      id: membership.id,
      role: membership.role,
      tenantId: membership.tenant_id,
      createdAt: membership.created_at,
      tenant: tenantsById.get(membership.tenant_id) || null,
    }))

    res.status(200).json({
      user: auth.userClaims,
      profile: profileResult.data
        ? {
            id: profileResult.data.id,
            email: profileResult.data.email,
            displayName: profileResult.data.display_name,
            createdAt: profileResult.data.created_at,
            updatedAt: profileResult.data.updated_at,
          }
        : null,
      memberships,
      activeTenant: memberships[0]?.tenant || null,
    })
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
