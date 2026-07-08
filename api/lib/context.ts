import { promises as fs } from 'fs'
import path from 'path'

export const sourceFiles = [
  'cursos.md',
  'empresa.md',
  'productos.md',
  'tratamiendos.md',
] as const

const CONTENT_DIRECTORY = 'content'

export type SourceContext = {
  file: string
  content: string
  hasContent: boolean
  size: number
}

function resolveSourcePath(file: string) {
  return path.resolve(process.cwd(), CONTENT_DIRECTORY, file)
}

export async function readSourceContexts(): Promise<SourceContext[]> {
  return Promise.all(
    sourceFiles.map(async (file) => {
      const filePath = resolveSourcePath(file)
      const rawContent = await fs.readFile(filePath, 'utf8').catch(() => '')
      const content = rawContent.trim()

      return {
        file,
        content,
        hasContent: content.length > 0,
        size: rawContent.length,
      }
    }),
  )
}

export async function buildSourcesContextBlock() {
  const sources = await readSourceContexts()

  const contextBlock = sources
    .map((source) => {
      if (!source.hasContent) {
        return `[ARCHIVO: ${source.file}]\n(Sin contenido)\n`
      }

      return `[ARCHIVO: ${source.file}]\n${source.content}\n`
    })
    .join('\n')

  return {
    sources,
    contextBlock,
  }
}
