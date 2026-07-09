import LandingHeader from '@/components/landing/LandingHeader'
import LandingHero from '@/components/landing/LandingHero'
import LandingSections from '@/components/landing/LandingSections'

export default function Landing() {
  return (
    <main
      id="top"
      className="relative min-h-screen overflow-hidden mesh-background text-slate-50"
    >
      <div className="pointer-events-none absolute inset-0 tech-grid opacity-[0.12]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[34rem] bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.12),transparent_48%)]" />
      <div className="pointer-events-none absolute left-[-12rem] top-[18rem] h-[26rem] w-[26rem] rounded-full bg-cyan-400/10 blur-[140px]" />
      <div className="pointer-events-none absolute bottom-[-8rem] right-[-8rem] h-[24rem] w-[24rem] rounded-full bg-sky-500/10 blur-[120px]" />
      <LandingHeader />
      <LandingHero />
      <LandingSections />
    </main>
  )
}
