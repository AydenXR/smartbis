const sourceLabels: Record<string, string> = {
  'cursos.md': 'Cursos',
  'empresa.md': 'Empresa',
  'productos.md': 'Productos',
  'tratamiendos.md': 'Tratamientos',
}

export function getSourceLabel(file: string) {
  return sourceLabels[file] || file
}
