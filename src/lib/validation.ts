// Same rules as api/lib/accountSecurity.ts. These give instant feedback in the
// form; the server checks again (and also that the email's domain exists).

const EMAIL_PATTERN =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

export function emailProblem(value: string): string | null {
  const email = normalizeEmail(value)
  if (!email) return 'Escribe tu correo electrónico'
  if (email.length > 254 || email.split('@')[0].length > 64 || !EMAIL_PATTERN.test(email)) {
    return 'Ingresa un correo válido, por ejemplo nombre@empresa.com'
  }
  return null
}

export const PASSWORD_RULES = 'Mínimo 8 caracteres, con al menos una letra y un número'

export function passwordProblem(value: string): string | null {
  const password = value.trim()
  if (password.length < 8) return 'La contraseña debe tener al menos 8 caracteres'
  if (new TextEncoder().encode(password).length > 72) return 'La contraseña es demasiado larga (máximo 72 caracteres)'
  if (!/[A-Za-zÀ-ÿ]/.test(password) || !/\d/.test(password)) return 'La contraseña debe incluir al menos una letra y un número'
  return null
}
