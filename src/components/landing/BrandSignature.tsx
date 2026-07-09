import logo from '@/assets/logosb.png'
import { cn } from '@/lib/utils'

type BrandSignatureProps = {
  compact?: boolean
  inverted?: boolean
}

export default function BrandSignature({
  compact = false,
  inverted = false,
}: BrandSignatureProps) {
  return (
    <div className="flex items-center gap-3" aria-label="Smartbis Business AI">
      <div
        className={cn(
          'flex items-center justify-center rounded-2xl border backdrop-blur-sm',
          compact ? 'h-12 w-12 p-2' : 'h-14 w-14 p-2.5',
          inverted
            ? 'border-white/10 bg-white/[0.06] shadow-[0_18px_50px_rgba(2,6,23,0.35)]'
            : 'border-sky-300/25 bg-slate-950/35 shadow-[0_18px_50px_rgba(2,6,23,0.35)]',
        )}
      >
        <img src={logo} alt="Smartbis" className="h-full w-full object-contain" />
      </div>

      <div className="min-w-0">
        <p
          className={cn(
            'text-[0.68rem] font-semibold uppercase tracking-[0.35em]',
            inverted ? 'text-sky-100/75' : 'text-sky-300/85',
          )}
        >
          Smartbis
        </p>
        <p
          className={cn(
            'font-display text-lg font-semibold tracking-[-0.03em]',
            inverted ? 'text-white' : 'text-slate-50',
          )}
        >
          Business AI
        </p>
      </div>
    </div>
  )
}
