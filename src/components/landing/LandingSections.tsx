function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-current">
      <path d="M19.05 4.94A9.94 9.94 0 0 0 12 2C6.49 2 2 6.48 2 12c0 1.77.46 3.5 1.35 5.02L2 22l5.1-1.33A9.96 9.96 0 0 0 12 22h.01c5.51 0 9.99-4.48 9.99-10 0-2.67-1.04-5.18-2.95-7.06ZM12 20.2a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.03.79.81-2.95-.2-.3A8.18 8.18 0 0 1 3.8 12c0-4.52 3.68-8.2 8.2-8.2 2.19 0 4.24.85 5.79 2.4a8.14 8.14 0 0 1 2.41 5.8c0 4.52-3.68 8.2-8.2 8.2Zm4.5-6.15c-.24-.12-1.43-.7-1.65-.77-.22-.08-.38-.12-.54.12-.16.23-.61.77-.75.92-.14.16-.28.18-.52.06-.24-.12-1.02-.37-1.94-1.18-.72-.64-1.21-1.43-1.35-1.67-.14-.23-.01-.36.1-.48.1-.1.24-.28.36-.42.12-.14.16-.23.24-.39.08-.16.04-.29-.02-.41-.06-.12-.54-1.31-.75-1.79-.2-.49-.4-.42-.54-.42h-.46c-.16 0-.41.06-.62.29-.21.23-.81.79-.81 1.94s.83 2.26.95 2.41c.12.16 1.63 2.49 3.96 3.49.55.24.98.38 1.31.48.55.17 1.04.14 1.43.09.44-.07 1.43-.58 1.63-1.14.2-.56.2-1.04.14-1.14-.06-.11-.22-.17-.46-.29Z" />
    </svg>
  )
}

function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-current">
      <path d="M13.5 22v-8h2.7l.4-3h-3.1V9.09c0-.87.25-1.46 1.5-1.46H16.7V4.95c-.3-.04-1.33-.12-2.52-.12-2.5 0-4.18 1.52-4.18 4.33V11H7.3v3h2.7v8h3.5Z" />
    </svg>
  )
}

const aboutItems = [
  {
    title: 'Diseno con criterio',
    description:
      'Smartbis combina presencia visual, orden operativo y una narrativa clara para negocios que quieren escalar sin ruido.',
  },
  {
    title: 'Tecnologia util',
    description:
      'La experiencia se construye para ventas, control y conversacion, no para parecer una demo generica de inteligencia artificial.',
  },
  {
    title: 'Base para crecer',
    description:
      'La plataforma prepara acceso, gestion y expansion futura sobre una misma identidad visual y tecnica.',
  },
]

const plans = [
  {
    name: 'Base',
    price: 'Desde $49',
    description: 'Para operaciones que quieren una presencia clara, automatizacion inicial y estructura comercial.',
  },
  {
    name: 'Growth',
    price: 'Desde $99',
    description: 'Pensado para equipos que necesitan mas control, mas flujo y una experiencia mas robusta.',
  },
  {
    name: 'Scale',
    price: 'Personalizado',
    description: 'Orientado a marcas que buscan una capa premium con despliegue, gestion y expansion de modulos.',
  },
]

export default function LandingSections() {
  return (
    <>
      <section id="nosotros" className="relative px-4 py-20 md:px-6 md:py-28">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-300/75">
              Nosotros
            </p>
            <h2 className="mt-4 font-display text-4xl font-semibold tracking-[-0.05em] text-white md:text-5xl">
              Una marca pensada para convertir tecnologia en presencia, control y confianza.
            </h2>
            <p className="mt-5 max-w-2xl text-sm leading-8 text-slate-300 md:text-base">
              Smartbis no busca decorar una landing. Busca proyectar criterio empresarial,
              claridad de producto y una sensacion de sistema preparado para operar de verdad.
            </p>
          </div>

          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {aboutItems.map((item) => (
              <article
                key={item.title}
                className="rounded-[1.8rem] border border-white/10 bg-white/[0.035] p-7 shadow-[0_22px_55px_rgba(2,6,23,0.28)] backdrop-blur-md"
              >
                <h3 className="font-display text-2xl font-semibold tracking-[-0.04em] text-white">
                  {item.title}
                </h3>
                <p className="mt-4 text-sm leading-8 text-slate-300">{item.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="planes" className="relative px-4 py-12 md:px-6 md:py-20">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-300/75">
              Planes
            </p>
            <h2 className="mt-4 font-display text-4xl font-semibold tracking-[-0.05em] text-white md:text-5xl">
              Estructuras simples para crecer desde una presencia premium hasta una operacion completa.
            </h2>
            <p className="mt-5 max-w-2xl text-sm leading-8 text-slate-300 md:text-base">
              Puedes empezar con una base clara y evolucionar hacia una experiencia mas completa
              conforme tu negocio necesite mas control, mas conversion y mas gestion.
            </p>
          </div>

          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {plans.map((plan) => (
              <article
                key={plan.name}
                className="rounded-[1.9rem] border border-white/10 bg-white/[0.035] p-7 shadow-[0_22px_55px_rgba(2,6,23,0.28)] backdrop-blur-md"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300/80">
                  {plan.name}
                </p>
                <h3 className="mt-4 font-display text-3xl font-semibold tracking-[-0.05em] text-white">
                  {plan.price}
                </h3>
                <p className="mt-4 text-sm leading-8 text-slate-300">{plan.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <footer className="mt-8 bg-[#0b1324] px-4 pb-12 pt-8 md:px-6 md:pb-14">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-display text-2xl font-semibold tracking-[-0.05em] text-slate-50">
              Smartbis
            </p>
            <p className="mt-2 text-sm text-slate-300">
              Plataforma visual para conversaciones, operacion y control empresarial.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <a
              href="#"
              aria-label="WhatsApp"
              className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-slate-300/15 bg-slate-100/5 text-slate-200 transition hover:border-cyan-300/30 hover:bg-cyan-300/10 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/55"
            >
              <WhatsAppIcon />
            </a>
            <a
              href="#"
              aria-label="Facebook"
              className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-slate-300/15 bg-slate-100/5 text-slate-200 transition hover:border-cyan-300/30 hover:bg-cyan-300/10 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/55"
            >
              <FacebookIcon />
            </a>
          </div>
        </div>
      </footer>
    </>
  )
}
