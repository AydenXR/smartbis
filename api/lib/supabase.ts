import type { Request } from 'express'
import {
  createAdminClient,
  createContextClient,
  resolveEnv,
  verifyCredentials,
} from '@supabase/server/core'

function getBearerToken(request: Request) {
  const authorization = request.header('authorization')

  if (!authorization) {
    return null
  }

  const [scheme, token] = authorization.split(' ')

  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null
  }

  return token.trim()
}

function getSupabaseEnvOverrides() {
  return {
    url: process.env.SUPABASE_URL,
    publishableKeys: process.env.SUPABASE_PUBLISHABLE_KEY
      ? { default: process.env.SUPABASE_PUBLISHABLE_KEY }
      : undefined,
    secretKeys: process.env.SUPABASE_SECRET_KEY
      ? { default: process.env.SUPABASE_SECRET_KEY }
      : undefined,
    jwks: process.env.SUPABASE_JWKS_URL ? new URL(process.env.SUPABASE_JWKS_URL) : undefined,
  }
}

export async function createRequestSupabaseContext(request: Request) {
  const resolvedEnv = resolveEnv(getSupabaseEnvOverrides())

  if (resolvedEnv.error) {
    return {
      data: null,
      error: resolvedEnv.error,
    }
  }

  const credentials = {
    token: getBearerToken(request),
    apikey: request.header('apikey')?.trim() || null,
  }

  const authResult = await verifyCredentials(credentials, {
    auth: 'user',
    env: resolvedEnv.data,
  })

  if (authResult.error) {
    return {
      data: null,
      error: authResult.error,
    }
  }

  const auth = authResult.data

  return {
    data: {
      auth,
      supabase: createContextClient({
        auth: {
          token: auth.token,
          keyName: auth.keyName,
        },
        env: resolvedEnv.data,
      }),
      supabaseAdmin: createAdminClient({
        env: resolvedEnv.data,
      }),
    },
    error: null,
  }
}
