// The plans shown for sale, in the landing page and in the upgrade window of the
// profile. planId is the row of the Supabase table plans that is charged: the
// amount comes from there, these texts only describe it.
export type PricingPlan = {
  planId: string
  name: string
  tagline: string
  price: string
  currency: string
  period: string
  trial: string
  features: string[]
}

// Para agregar paquetes (3 o 4 cards) basta con sumar elementos aquí
export const PRICING_PLANS: PricingPlan[] = [
  {
    planId: 'base_849',
    name: 'Paquete Básico',
    tagline: 'Todo lo esencial para atender y vender en automático.',
    price: '$849.00',
    currency: 'MXN',
    period: 'mes',
    // Los mismos días y conversaciones del plan "trial" en Supabase
    trial: 'Prueba gratis de 15 días con hasta 200 conversaciones, sin pagar nada.',
    features: [
      'Bot con IA para Messenger, Instagram y WhatsApp',
      'Hasta 200 conversaciones al mes (contrata más si lo necesitas)',
      'Hasta 3 subusuarios',
      'Punto de venta (POS) con módulo de inventario de productos',
      'Notificación diaria de tus ventas a tu WhatsApp',
    ],
  },
]
