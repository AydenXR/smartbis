import { ChevronDown } from 'lucide-react'

export default function LandingHero() {
  return (
    <section className="relative min-h-[calc(100vh-6.5rem)] overflow-x-hidden">
      <div className="pointer-events-none absolute inset-0 tech-grid opacity-[0.08]" />
      <div className="pointer-events-none absolute inset-x-0 top-[8%] h-[30rem] bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.12),transparent_32%)]" />
      <div className="pointer-events-none absolute left-1/2 top-[34%] h-[34rem] w-[34rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-400/12 blur-[180px]" />
      <div className="pointer-events-none absolute left-[14%] top-[24%] h-[18rem] w-[18rem] rounded-full bg-sky-400/8 blur-[130px]" />
      <div className="pointer-events-none absolute right-[10%] top-[18%] h-[22rem] w-[22rem] rounded-full bg-violet-400/8 blur-[150px]" />
      <div className="pointer-events-none absolute inset-x-[16%] bottom-[21.4%] h-20 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.16),transparent_68%)] blur-3xl" />

      <div className="relative flex min-h-[calc(100vh-6.5rem)] flex-col items-center justify-center px-6 pb-20 pt-12 text-center md:px-10 md:pb-28 md:pt-20">
        <div className="relative flex flex-col items-center">
          <div className="hero-wordmark-shell">
            <h1 className="hero-wordmark-main font-display text-center text-[clamp(4.5rem,15vw,11rem)] font-semibold uppercase leading-[0.96] tracking-[-0.08em] text-transparent">
              Smartbis
            </h1>
          </div>

          <div
            aria-hidden="true"
            className="hero-wordmark-reflection -mt-2 font-display text-center text-[clamp(4.5rem,15vw,11rem)] font-semibold uppercase leading-[0.96] tracking-[-0.08em] text-transparent"
          >
            Smartbis
          </div>
        </div>

        <p className="mt-5 max-w-2xl text-balance text-sm leading-8 text-slate-300 md:text-base">
          El primer sistema visual para convertir conversaciones, operacion y control en una
          experiencia premium.
        </p>

        <a
          href="#nosotros"
          className="group mt-9 inline-flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.28em] text-slate-200 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
        >
          <span>Mostrar más</span>
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] transition group-hover:border-cyan-300/30 group-hover:bg-white/[0.06]">
            <ChevronDown className="hero-bounce-arrow h-4 w-4" />
          </span>
        </a>
      </div>
    </section>
  )
}
