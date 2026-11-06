// Server access to Supabase with the service role key, shared by the workspace
// (accounts, documents) and billing (plans, subscriptions)

export function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL?.trim()
  const serviceRoleKey = process.env.SUPABASE_SECRET_KEY?.trim()
  const anonKey =
    process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.VITE_SUPABASE_ANON_KEY?.trim()

  if (!url || !serviceRoleKey || !anonKey) {
    throw new Error('Falta la configuracion manual de Supabase en el servidor')
  }

  return {
    url,
    serviceRoleKey,
    anonKey,
  }
}

export async function restRequest<T>(
  path: string,
  options?: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
    query?: Record<string, string>
    body?: unknown
    headers?: Record<string, string>
  },
) {
  const { url, serviceRoleKey } = getSupabaseConfig()
  const requestUrl = new URL(`/rest/v1/${path}`, url)

  for (const [key, value] of Object.entries(options?.query || {})) {
    requestUrl.searchParams.set(key, value)
  }

  const response = await fetch(requestUrl, {
    method: options?.method || 'GET',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(45000),
  })

  const text = await response.text()
  const payload = text ? JSON.parse(text) : null

  if (!response.ok) {
    const message =
      payload?.msg ||
      payload?.message ||
      payload?.error_description ||
      payload?.hint ||
      'Error consultando Supabase'

    // The Postgres code ("23505" = a unique index refused the row) lets callers
    // tell cases apart without reading the message
    throw Object.assign(new Error(message), {
      status: response.status,
      code: String(payload?.code || ''),
    })
  }

  return payload as T
}
