import { ArrowRight, CheckCircle2, Gift, Loader2 } from 'lucide-react'
import type { PricingPlan } from '@/lib/plans'

type PlanCardProps = {
  plan: PricingPlan
  buttonLabel: string
  onSelect: () => void
  // The landing page offers the free trial; the profile does not (it was already used)
  showTrial?: boolean
  busy?: boolean
}

// The card of a plan, the same in the landing page and in the profile
export default function PlanCard({ plan, buttonLabel, onSelect, showTrial = true, busy = false }: PlanCardProps) {
  return (
    <div className="relative flex w-full max-w-[400px] flex-col overflow-hidden rounded-[28px] border border-[#1090D0]/40 bg-gradient-to-b from-[#173c60] to-[#12304f] p-7 shadow-2xl shadow-[#1090D0]/10 transition hover:-translate-y-1 hover:border-[#1090D0]/70 sm:p-8">
      <div className="pointer-events-none absolute -top-24 -right-24 h-[220px] w-[220px] rounded-full bg-[#1090D0]/20 blur-[80px]" />
      <div className="relative flex flex-1 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-display text-[22px] font-extrabold text-white">{plan.name}</h3>
          {showTrial ? (
            <span className="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-emerald-300">
              15 días gratis
            </span>
          ) : null}
        </div>
        <p className="mt-2 text-[14px] leading-relaxed text-slate-300">{plan.tagline}</p>

        <div className="mt-6 flex flex-wrap items-end gap-x-2 gap-y-1">
          <span className="font-display text-[44px] font-black leading-none text-white">{plan.price}</span>
          <span className="pb-1 text-[14px] font-semibold text-slate-300">
            {plan.currency} / {plan.period}
          </span>
        </div>

        {showTrial ? (
          <p className="mt-4 flex items-start gap-2.5 rounded-[14px] border border-emerald-400/25 bg-emerald-400/10 px-4 py-3 text-[13px] font-semibold leading-relaxed text-emerald-200">
            <Gift className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
            <span>{plan.trial}</span>
          </p>
        ) : null}

        <div className="my-7 h-px w-full bg-[#1a3a5a]" />

        <p className="text-[12px] font-bold uppercase tracking-[0.2em] text-[#4FC3F7]">Incluye</p>
        <ul className="mt-4 flex flex-1 flex-col gap-3.5">
          {plan.features.map((feature) => (
            <li key={feature} className="flex items-start gap-3 text-[14px] leading-relaxed text-slate-200">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#4FC3F7]" />
              <span>{feature}</span>
            </li>
          ))}
          <li className="flex items-start gap-3 text-[14px] font-semibold leading-relaxed text-white">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#1090D0]/20 text-[13px] font-black text-[#4FC3F7]">
              +
            </span>
            <span>Y mucho más…</span>
          </li>
        </ul>

        <button
          type="button"
          onClick={onSelect}
          disabled={busy}
          className="group mt-8 inline-flex w-full items-center justify-center gap-2 rounded-[16px] bg-[#1090D0] px-6 py-4 text-[15px] font-bold text-white shadow-xl shadow-[#1090D0]/25 transition hover:bg-[#0f80b8] disabled:cursor-wait disabled:opacity-70"
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
          {buttonLabel}
          {busy ? null : <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />}
        </button>
      </div>
    </div>
  )
}
