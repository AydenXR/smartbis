function renderInlineBold(text: string) {
  const parts = text.split(/(\*\*.*?\*\*)/g)

  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>
    }

    return <span key={`${part}-${index}`}>{part}</span>
  })
}

type MessageContentProps = {
  content: string
}

export default function MessageContent({ content }: MessageContentProps) {
  const lines = content.split('\n')

  return (
    <div className="space-y-3 text-sm leading-7">
      {lines.map((line, index) => {
        if (line.startsWith('- ')) {
          return (
            <div key={`${line}-${index}`} className="flex items-start gap-3">
              <span className="mt-2 h-1.5 w-1.5 rounded-full bg-current opacity-70" />
              <p className="flex-1 whitespace-pre-wrap">{renderInlineBold(line.slice(2))}</p>
            </div>
          )
        }

        return (
          <p key={`${line}-${index}`} className="whitespace-pre-wrap">
            {renderInlineBold(line)}
          </p>
        )
      })}
    </div>
  )
}
