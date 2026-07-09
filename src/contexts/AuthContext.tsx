import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

type SignUpParams = {
  email: string
  password: string
}

type AuthContextValue = {
  user: User | null
  session: Session | null
  isLoading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (params: SignUpParams) => Promise<{ needsEmailConfirmation: boolean }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let isMounted = true

    async function loadSession() {
      const { data, error } = await supabase.auth.getSession()

      if (error) {
        if (isMounted) {
          setSession(null)
          setUser(null)
          setIsLoading(false)
        }
        return
      }

      if (isMounted) {
        setSession(data.session)
        setUser(data.session?.user ?? null)
        setIsLoading(false)
      }
    }

    loadSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setUser(nextSession?.user ?? null)
      setIsLoading(false)
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      throw error
    }
  }, [])

  const signUp = useCallback(async ({ email, password }: SignUpParams) => {
    const redirectTo =
      typeof window !== 'undefined' ? `${window.location.origin}/login` : undefined

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectTo,
      },
    })

    if (error) {
      throw error
    }

    return {
      needsEmailConfirmation: !data.session,
    }
  }, [])

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut()

    if (error) {
      throw error
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      session,
      isLoading,
      signIn,
      signUp,
      signOut,
    }),
    [isLoading, session, signIn, signOut, signUp, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export { AuthContext }
