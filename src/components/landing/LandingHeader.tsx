import { Link } from 'react-router-dom'
import logo from '@/assets/logosb.png'

const navigation = [
  { label: 'Inicio', href: '#top' },
  { label: 'Nosotros', href: '#nosotros' },
  { label: 'Planes', href: '#planes' },
]

export default function LandingHeader() {
  return (
    <header className="sticky top-0 z-40 px-4 pt-4 md:px-6 md:pt-6">
      <div className="relative flex w-full items-center justify-between px-1 py-2 md:px-2">
        <Link
          to="/"
          aria-label="Smartbis"
          className="ml-4 inline-flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 md:ml-6"
        >
          <img src={logo} alt="Smartbis" className="h-10 w-auto object-contain md:h-12" />
        </Link>

        <nav
          aria-label="Navegacion principal"
          className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center justify-center gap-8 md:flex"
        >
          {navigation.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="line-button nav-line-button focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center justify-end gap-5">
          <Link
            to="/login"
            className="line-button line-button-sm hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 md:inline-flex"
          >
            Iniciar sesión
          </Link>
          <Link
            to="/register"
            className="line-button line-button-sm line-button-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
          >
            Crear cuenta
          </Link>
        </div>
      </div>
    </header>
  )
}
