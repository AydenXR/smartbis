export function getAuthErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return 'Ocurrio un error inesperado. Intenta de nuevo.'
  }

  const message = error.message.toLowerCase()

  if (message.includes('invalid login credentials')) {
    return 'Las credenciales no son correctas.'
  }

  if (message.includes('email not confirmed')) {
    return 'Debes confirmar tu correo antes de iniciar sesion.'
  }

  if (message.includes('already registered')) {
    return 'Ese correo ya esta registrado.'
  }

  if (message.includes('password should be at least')) {
    return 'La contraseña debe tener al menos 6 caracteres.'
  }

  return error.message
}
