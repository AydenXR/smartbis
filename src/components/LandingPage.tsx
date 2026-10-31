import LogoSb from '../assets/logosb.png'
import {
  Bot,
  BookOpenText,
  FlaskConical,
  Shield,
  PlugZap,
  FileJson,
  MessageCircle,
  ArrowRight,
  CheckCircle2,
} from 'lucide-react'

type LandingPageProps = {
  onLoginClick: () => void
  onRegisterClick: () => void
}

const features = [
  {
    icon: Bot,
    title: 'Respuestas automáticas 24/7',
    description:
      'El bot contesta tus leads de Messenger al instante usando tu prompt personalizado y tu base de conocimiento.',
  },
  {
    icon: BookOpenText,
    title: 'Prompt y documentos .md',
    description:
      'Editor nativo de prompt + documentos markdown por cliente. Todo lo que el bot necesita saber en un solo lugar.',
  },
  {
    icon: FlaskConical,
    title: 'Test Mode seguro',
    description:
      'Activa Test Mode y prueba cambios SIN enviar nada al cliente. Apágalo cuando todo esté listo para producción.',
  },
  {
    icon: Shield,
    title: 'Multi-tenant privado',
    description:
      'Cada cuenta tiene su propio espacio, prompt, documentos y chat. Nada se mezcla entre clientes.',
  },
]

const steps = [
  {
    n: '01',
    title: 'Conecta tu página Facebook',
    description:
      'Un clic en "Continuar con Facebook", autorizas tu página y listo. Sin tokens manuales ni configuración técnica.',
    icon: PlugZap,
  },
  {
    n: '02',
    title: 'Escribe tu prompt y sube documentos',
    description:
      'Define cómo quieres que responda el bot y agrega PDFs o notas en markdown con la información de tu negocio.',
    icon: FileJson,
  },
  {
    n: '03',
    title: 'El bot contesta mientras duermes',
    description:
      'Activa Test Mode para validar todo, luego enciende el bot y olvídate: responderá a tus leads 24/7.',
    icon: MessageCircle,
  },
]

export default function LandingPage({ onLoginClick, onRegisterClick }: LandingPageProps) {
  return (
    <div className="relative min-h-screen w-full overflow-x-hidden bg-[#0c2a47] text-slate-100">
      <div className="pointer-events-none absolute -top-40 -left-40 h-[520px] w-[520px] rounded-full bg-[#1090D0]/20 blur-[120px]" />
      <div className="pointer-events-none absolute top-40 -right-40 h-[520px] w-[520px] rounded-full bg-[#305070]/50 blur-[140px]" />

      <header className="sticky top-0 z-40 w-full border-b border-[#1a3a5a]/70 bg-[#0c2a47]/75 backdrop-blur-xl">
        <div className="mx-auto flex h-20 w-full max-w-7xl items-center justify-between px-6 sm:px-8">
          <a href="#top" className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] border border-[#1a3a5a] bg-[#0f3151] p-1.5">
              <img src={LogoSb} alt="Smartbis Logo" className="h-full w-full object-contain" />
            </div>
            <div className="flex flex-col leading-none">
              <span className="font-display text-[18px] font-extrabold tracking-[0.22em] text-[#1090D0]">
                SMARTBIS
              </span>
              <span className="mt-1 text-[11px] font-medium tracking-wider text-slate-400">
                CRM MESSENGER · AI
              </span>
            </div>
          </a>

          <nav className="hidden items-center gap-8 md:flex">
            {[
              { href: '#caracteristicas', label: 'Características' },
              { href: '#como-funciona', label: 'Cómo funciona' },
              { href: '#precios', label: 'Precios' },
              { href: '#faq', label: 'FAQ' },
            ].map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-[13px] font-semibold text-slate-300 transition hover:text-white"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onLoginClick}
              className="rounded-[14px] border border-[#1a3a5a] bg-[#0f3151]/60 px-4 py-2.5 text-[13px] font-bold text-white transition hover:border-[#1090D0]/50 hover:bg-[#0f3151]"
            >
              Iniciar sesión
            </button>
            <button
              type="button"
              onClick={onRegisterClick}
              className="rounded-[14px] bg-[#1090D0] px-4 py-2.5 text-[13px] font-bold text-white shadow-lg shadow-[#1090D0]/20 transition hover:bg-[#0f80b8]"
            >
              Empezar gratis
            </button>
          </div>
        </div>
      </header>

      <section id="top" className="relative mx-auto w-full max-w-7xl px-6 pt-16 pb-24 sm:px-8 sm:pt-24">
        <div className="grid items-center gap-16 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1.7fr)]">
          <div className="relative space-y-8">
            <h1 className="font-display text-[42px] font-extrabold leading-[1.05] tracking-tight text-white sm:text-[50px] lg:text-[56px]">
              Convierte <span className="text-[#1090D0]">cada mensaje</span> de Messenger en una cita confirmada.
            </h1>

            <p className="max-w-xl text-[16px] leading-relaxed text-slate-300 sm:text-[17px]">
              Smartbis es el CRM de Messenger para clínicas, consultorios y negocios de servicios.
              Conecta tu página Facebook en 1 clic, escribe cómo quieres que responda tu bot y
              empieza a atender leads 24/7 sin levantar un dedo.
            </p>

            <div className="flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={onRegisterClick}
                className="group inline-flex items-center gap-2 rounded-[16px] bg-[#1090D0] px-7 py-4 text-[14px] font-bold text-white shadow-xl shadow-[#1090D0]/25 transition hover:bg-[#0f80b8]"
              >
                Crear cuenta gratis
                <ArrowRight className="h-4.5 w-4.5 transition-transform group-hover:translate-x-0.5" />
              </button>
            </div>

            <ul className="flex flex-wrap items-center gap-x-6 gap-y-3 text-[13px] font-medium text-slate-300">
              {[
                '✅ Test Mode incluido',
                '✅ Multi-tenant privado',
                '✅ Prompt + Docs .md',
                '✅ Sin tarjeta',
              ].map((t) => (
                <li key={t} className="inline-flex items-center gap-1.5">
                  {t}
                </li>
              ))}
            </ul>
          </div>

          <div className="relative justify-self-end w-[97%]">
            <div className="absolute -inset-6 rounded-[36px] bg-gradient-to-br from-[#1090D0]/25 via-transparent to-[#305070]/30 blur-2xl" />
            <div className="relative overflow-hidden rounded-[28px] border border-[#1a3a5a] bg-[#0b2540] shadow-2xl shadow-[#050a18]/50">
              <div className="flex items-center justify-between border-b border-[#1a3a5a] bg-[#0b2540]/80 px-6 py-4">
                <div className="flex items-center gap-3">
                  <span className="h-3.5 w-3.5 rounded-full bg-[#ef5350]/85" />
                  <span className="h-3.5 w-3.5 rounded-full bg-[#FFB74D]/85" />
                  <span className="h-3.5 w-3.5 rounded-full bg-[#66BB6A]/85" />
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-[#1a3a5a] bg-[#0c2a47] px-4 py-2 text-[12px] font-semibold text-slate-300">
                  <Shield className="h-4 w-4 text-[#4FC3F7]" />
                  app.smartbis.ai · CRM Messenger
                </div>
                <div className="w-[86px]" />
              </div>

              <div className="grid h-[520px] min-h-0 w-full grid-cols-[230px_1fr] text-left">
                <div className="border-r border-[#1a3a5a] bg-[#0b2540] p-5">
                  <div className="flex items-center gap-3 rounded-[16px] border border-[#1a3a5a] bg-[#0f3151] p-4">
                    <div className="h-11 w-11 shrink-0 rounded-full border border-[#1090D0]/40 bg-[#1090D0]/20" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-bold text-white">Dra. Lydia C.</div>
                      <div className="truncate text-[11.5px] font-medium text-emerald-300">● Conectada</div>
                    </div>
                  </div>

                  <div className="mt-6 space-y-2 text-[11.5px] text-slate-300">
                    <div className="flex justify-between rounded-[12px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2.5">
                      <span className="text-slate-400">Página:</span>
                      <span className="font-semibold text-slate-100">Conectada</span>
                    </div>
                    <div className="flex justify-between rounded-[12px] border border-[#1a3a5a] bg-[#0b2641] px-3 py-2.5">
                      <span className="text-slate-400">Test mode:</span>
                      <span className="font-semibold text-amber-300">ON</span>
                    </div>
                  </div>

                  <div className="mt-6 space-y-2.5">
                    {['Mensajes', 'Prompt y Docs', 'Settings'].map((l, i) => (
                      <div
                        key={l}
                        className={
                          'rounded-[13px] px-3.5 py-2.5 text-[13px] font-semibold ' +
                          (i === 0
                            ? 'border border-[#1090D0]/30 bg-[#1090D0]/10 text-[#4FC3F7]'
                            : 'text-slate-300 hover:bg-[#0f3151]')
                        }
                      >
                        {l}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2.1fr)]">
                  <aside className="border-r border-[#1a3a5a] bg-[#0c2a47]">
                    <div className="border-b border-[#1a3a5a] px-5 py-3.5 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                      Conversaciones
                    </div>
                    <ul className="space-y-1.5 p-3.5">
                      {[
                        { n: 'Mariana Gutiérrez', m: '¿Tienen citas mañana?', t: '2m', u: true },
                        { n: 'Luis Pérez H.', m: 'Gracias por la info ✅', t: '15m', u: false },
                        { n: 'Paola Ramírez', m: 'Cuánto cuesta la 1ra?', t: '1h', u: true },
                      ].map((c) => (
                        <li
                          key={c.n}
                          className={
                            'rounded-[15px] border px-4 py-3 ' +
                            (c.u
                              ? 'border-[#1090D0]/40 bg-[#1090D0]/8'
                              : 'border-transparent bg-[#0f3151]/40 hover:bg-[#0f3151]')
                          }
                        >
                          <div className="flex items-center justify-between">
                            <div className="truncate text-[13px] font-bold text-white">{c.n}</div>
                            <div className="ml-2 shrink-0 text-[11px] font-semibold text-slate-400">{c.t}</div>
                          </div>
                          <div className="mt-1 truncate text-[12px] text-slate-300">{c.m}</div>
                        </li>
                      ))}
                    </ul>
                  </aside>

                  <div className="flex min-h-0 flex-col bg-[#0c2a47]">
                    <div className="flex items-center justify-between border-b border-[#1a3a5a] px-6 py-4">
                      <div>
                        <div className="text-[14px] font-bold text-white">Mariana Gutiérrez</div>
                        <div className="text-[11.5px] font-medium text-emerald-300">● En línea</div>
                      </div>
                      <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-300">
                        <FlaskConical className="h-3.5 w-3.5" /> TEST
                      </div>
                    </div>

                    <div className="min-h-0 flex-1 space-y-4 overflow-hidden px-6 py-5">
                      <div className="flex justify-start">
                        <div className="max-w-[80%] rounded-[18px] rounded-bl-sm border border-[#1a3a5a] bg-[#0f3151] px-4 py-3 text-[13px] leading-relaxed text-slate-100">
                          Hola 👋 ¿Tienen citas disponibles mañana para limpieza dental?
                        </div>
                      </div>

                      <div className="flex justify-end">
                        <div className="max-w-[85%] rounded-[18px] rounded-br-sm border border-[#1090D0]/40 bg-gradient-to-br from-[#1090D0]/95 to-[#0d6fa3]/95 px-4 py-3 text-[13px] leading-relaxed font-medium text-white shadow-lg shadow-[#1090D0]/20">
                          ¡Hola Mariana! 👋 Gracias por escribir a Sonrisalud. Sí, tenemos mañana jueves a las <b>10:30am</b> y a las <b>4:00pm</b> disponibles para limpieza dental. ¿Cuál horario te queda mejor? 😊
                        </div>
                      </div>

                      <div className="flex justify-start">
                        <div className="max-w-[80%] rounded-[18px] rounded-bl-sm border border-[#1a3a5a] bg-[#0f3151] px-4 py-3 text-[13px] leading-relaxed text-slate-100">
                          Perfecto, me quedo con las 10:30am 🙌 ¡Muchas gracias!
                        </div>
                      </div>

                      <div className="flex justify-end">
                        <div className="max-w-[85%] rounded-[18px] rounded-br-sm border border-[#1090D0]/40 bg-gradient-to-br from-[#1090D0]/95 to-[#0d6fa3]/95 px-4 py-3 text-[13px] leading-relaxed font-medium text-white shadow-lg shadow-[#1090D0]/20">
                          ¡Cita confirmada! ✅ Te esperamos mañana jueves 10:30am en Sonrisalud. Cualquier cambio mándanos un WhatsApp: <b>662 123 4567</b>
                        </div>
                      </div>

                      <div className="flex justify-start pt-1">
                        <div className="inline-flex items-center gap-2 rounded-full border border-[#1a3a5a] bg-[#0b2641] px-3.5 py-2 text-[11px] font-semibold text-slate-400">
                          <CheckCircle2 className="h-4 w-4 text-[#4FC3F7]" />
                          2 respuestas · El bot respondió con tu prompt
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="caracteristicas" className="relative mx-auto w-full max-w-7xl px-6 py-24 sm:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <div className="inline-flex rounded-full border border-[#1a3a5a] bg-[#0f3151]/60 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.25em] text-slate-300">
            Características
          </div>
          <h2 className="mt-5 font-display text-[36px] font-extrabold leading-tight text-white sm:text-[42px]">
            Todo lo que necesitas para <span className="text-[#1090D0]">automatizar Messenger</span>
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-slate-300">
            Olvídate de plugins complicados, tokens expirados y docu-tutoriales de 4 horas. Smartbis
            viene preconfigurado para que abras tu negocio y empieces a vender en minutos.
          </p>
        </div>

        <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <div
              key={f.title}
              className="group flex flex-col gap-3 rounded-[20px] border border-[#1a3a5a] bg-[#0f3151]/70 p-6 transition hover:-translate-y-1 hover:border-[#1090D0]/40 hover:bg-[#0f3151]"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-[14px] border border-[#1a3a5a] bg-[#0b2641]">
                <f.icon className="h-6 w-6 text-[#4FC3F7]" />
              </div>
              <h3 className="mt-1 font-display text-[17px] font-bold text-white">{f.title}</h3>
              <p className="text-[13px] leading-relaxed text-slate-300">{f.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="como-funciona" className="relative mx-auto w-full max-w-7xl px-6 py-24 sm:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <div className="inline-flex rounded-full border border-[#1a3a5a] bg-[#0f3151]/60 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.25em] text-slate-300">
            Cómo funciona
          </div>
          <h2 className="mt-5 font-display text-[36px] font-extrabold leading-tight text-white sm:text-[42px]">
            3 pasos y tu bot <span className="text-[#1090D0]">está vivo</span>
          </h2>
        </div>

        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          {steps.map((s) => (
            <div
              key={s.n}
              className="relative flex flex-col overflow-hidden rounded-[22px] border border-[#1a3a5a] bg-[#0f3151]/70 p-7"
            >
              <div className="flex items-center justify-between">
                <div className="font-display text-[42px] font-black leading-none text-[#1090D0]/30">
                  {s.n}
                </div>
                <div className="flex h-12 w-12 items-center justify-center rounded-[14px] border border-[#1a3a5a] bg-[#0b2641]">
                  <s.icon className="h-6 w-6 text-[#4FC3F7]" />
                </div>
              </div>
              <h3 className="mt-6 font-display text-[20px] font-bold text-white">{s.title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-slate-300">{s.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="precios" className="relative mx-auto w-full max-w-7xl px-6 py-16 sm:px-8">
        <div className="relative overflow-hidden rounded-[32px] border border-[#1090D0]/30 bg-gradient-to-br from-[#0f3151] via-[#0c2a47] to-[#0b2540] px-8 py-16 shadow-2xl shadow-[#1090D0]/10 sm:px-14">
          <div className="pointer-events-none absolute -top-40 -right-40 h-[420px] w-[420px] rounded-full bg-[#1090D0]/25 blur-[120px]" />
          <div className="relative mx-auto flex max-w-5xl flex-col items-center text-center">
            <h2 className="font-display text-[34px] font-extrabold leading-tight text-white sm:text-[44px]">
              ¿Listo para que tu bot <span className="text-[#4FC3F7]">conteste mientras duermes?</span>
            </h2>
            <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-slate-300">
              Crea tu cuenta gratis hoy, conecta tu página Facebook y prueba tu primer flujo en menos de 5 minutos.
              Sin tarjeta, sin compromisos, sin letras chiquitas.
            </p>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
              <button
                type="button"
                onClick={onRegisterClick}
                className="group inline-flex items-center gap-2 rounded-[18px] bg-[#1090D0] px-7 py-4 text-[15px] font-bold text-white shadow-2xl shadow-[#1090D0]/30 transition hover:bg-[#0f80b8]"
              >
                Crear cuenta gratis
                <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
              </button>
              <button
                type="button"
                onClick={onLoginClick}
                className="rounded-[18px] border border-[#1a3a5a] bg-[#0b2641]/60 px-7 py-4 text-[15px] font-bold text-white transition hover:border-[#1090D0]/50"
              >
                Iniciar sesión
              </button>
            </div>
          </div>
        </div>
      </section>

      <footer id="faq" className="relative border-t border-[#1a3a5a]/70 bg-[#0b2540]/40">
        <div className="mx-auto w-full max-w-7xl px-6 py-14 sm:px-8">
          <div className="grid gap-10 md:grid-cols-4">
            <div className="md:col-span-2">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-[14px] border border-[#1a3a5a] bg-[#0f3151] p-1.5">
                  <img src={LogoSb} alt="Smartbis Logo" className="h-full w-full object-contain" />
                </div>
                <div className="flex flex-col leading-none">
                  <span className="font-display text-[18px] font-extrabold tracking-[0.22em] text-[#1090D0]">
                    SMARTBIS
                  </span>
                  <span className="mt-1 text-[11px] font-medium tracking-wider text-slate-400">
                    CRM MESSENGER · AI
                  </span>
                </div>
              </div>
              <p className="mt-5 max-w-md text-[13px] leading-relaxed text-slate-400">
                Smartbis AI · CRM Messenger para clínicas y negocios de servicios. Multi-tenant,
                prompt + documentos, Test Mode incluido.
              </p>
            </div>

            <div>
              <h4 className="text-[12px] font-bold uppercase tracking-[0.22em] text-white">Producto</h4>
              <ul className="mt-5 space-y-2.5 text-[13px] text-slate-400">
                <li><a className="hover:text-white transition" href="#caracteristicas">Características</a></li>
                <li><a className="hover:text-white transition" href="#como-funciona">Cómo funciona</a></li>
                <li><a className="hover:text-white transition" href="#precios">Precios</a></li>
                <li><a className="hover:text-white transition" href="#top">¿Qué es Smartbis?</a></li>
              </ul>
            </div>

            <div>
              <h4 className="text-[12px] font-bold uppercase tracking-[0.22em] text-white">Cuenta</h4>
              <ul className="mt-5 space-y-2.5 text-[13px] text-slate-400">
                <li>
                  <button type="button" onClick={onLoginClick} className="text-left hover:text-white transition">
                    Iniciar sesión
                  </button>
                </li>
                <li>
                  <button type="button" onClick={onRegisterClick} className="text-left hover:text-white transition">
                    Crear cuenta
                  </button>
                </li>
                <li className="text-slate-500">Soporte · hola@smartbis.ai</li>
                <li><a className="hover:text-white transition" href="/privacidad/index.html">Política de privacidad</a></li>
                <li><a className="hover:text-white transition" href="/eliminar-datos/index.html">Eliminación de datos</a></li>
              </ul>
            </div>
          </div>

          <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-[#1a3a5a]/60 pt-6 sm:flex-row sm:items-center">
            <p className="text-[12px] text-slate-500">
              © {new Date().getFullYear()} Smartbis AI. Todos los derechos reservados.
            </p>
            <p className="text-[12px] text-slate-500">
              Facebook y Messenger son marcas registradas de Meta Platforms, Inc. Smartbis es una herramienta de terceros.
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
