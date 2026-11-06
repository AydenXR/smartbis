import nodemailer, { type Transporter } from 'nodemailer'

// Account emails (email confirmation, password reset) go out through the SMTP
// account of a mail provider (Google Workspace, Zoho, Brevo, Amazon SES...).
// Configuration in .env.local:
//   SMTP_HOST, SMTP_PORT (587 or 465), SMTP_SECURE (true for 465),
//   SMTP_USER, SMTP_PASS, SMTP_FROM ("Smartbis <no-responder@smartbis.ai>"),
//   APP_PUBLIC_URL (https://www.smartbis.ai; where the links in the emails point)

type MailMessage = { to: string; subject: string; html: string; text: string }

let transporter: Transporter | null = null

export function isMailerConfigured() {
  return Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_FROM?.trim())
}

function getTransporter() {
  if (transporter) return transporter
  const port = Number(process.env.SMTP_PORT || 587)
  const secure = /^(1|true|yes)$/i.test(process.env.SMTP_SECURE || '') || port === 465
  const user = process.env.SMTP_USER?.trim()
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST?.trim(),
    port,
    secure,
    // Port 587 must upgrade to TLS; never send credentials in clear text
    requireTLS: !secure,
    auth: user ? { user, pass: process.env.SMTP_PASS || '' } : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  })
  return transporter
}

// Production needs SMTP. In development, without it, the email is printed in
// the server console so the links can still be tested.
async function sendMail(message: MailMessage) {
  if (!isMailerConfigured()) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('El envío de correos no está configurado (SMTP_HOST / SMTP_FROM)')
    }
    console.warn(`[mailer] SMTP no configurado (desarrollo). Correo para ${message.to}: ${message.subject}\n${message.text}`)
    return
  }
  await getTransporter().sendMail({ from: process.env.SMTP_FROM?.trim(), ...message })
}

export function appPublicUrl() {
  const configured = (process.env.APP_PUBLIC_URL || process.env.META_FRONTEND_URL || '').trim().replace(/\/+$/, '')
  return configured || 'https://www.smartbis.ai'
}

// The logo is a fixed-name copy in public/email (Vite renames src/assets on each
// build). Email clients download it from the internet, so it always comes from a
// public https address, also when the links point to localhost.
function emailLogoUrl() {
  const configured = process.env.EMAIL_LOGO_URL?.trim()
  if (configured) return configured
  const base = appPublicUrl()
  // A new logo gets a new file name: mail clients cache images by address, and
  // emails already sent keep showing the file they were sent with
  return `${base.startsWith('https://') ? base : 'https://www.smartbis.ai'}/email/logo-smartbis-sb.png`
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}

function layout(input: {
  title: string
  intro: string
  highlight?: string
  note?: { label: string; text: string }
  button: string
  link: string
  footer: string
}) {
  const link = escapeHtml(input.link)
  const highlight = input.highlight
    ? `<p style="color:#ffffff;font-size:15px;line-height:1.6;margin:0 0 24px;padding:14px 16px;background:#123150;border-left:4px solid #1090D0;border-radius:8px;">${escapeHtml(input.highlight)}</p>`
    : ''
  const note = input.note
    ? `<p style="color:#cbd5e1;font-size:14px;line-height:1.6;margin:0 0 24px;padding:14px 16px;background:#123150;border-left:4px solid #f5a524;border-radius:8px;"><strong style="color:#f5a524;">${escapeHtml(input.note.label)}</strong> ${escapeHtml(input.note.text)}</p>`
    : ''
  const html = `<!doctype html>
<html lang="es">
<body style="margin:0;padding:0;background:#0b2540;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b2540;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#0f3151;border:1px solid #1a3a5a;border-radius:16px;">
        <tr><td style="padding:28px 28px 8px;">
          <div style="font-weight:800;letter-spacing:4px;color:#1090D0;font-size:15px;">SMARTBIS</div>
          <h1 style="color:#ffffff;font-size:22px;line-height:1.3;margin:20px 0 12px;">${escapeHtml(input.title)}</h1>
          <p style="color:#cbd5e1;font-size:15px;line-height:1.6;margin:0 0 24px;">${escapeHtml(input.intro)}</p>
          ${highlight}${note}<a href="${link}" style="display:inline-block;background:#1090D0;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 24px;border-radius:12px;">${escapeHtml(input.button)}</a>
          <p style="color:#94a3b8;font-size:13px;line-height:1.6;margin:24px 0 0;">Si el botón no funciona, copia y pega este enlace en tu navegador:<br><a href="${link}" style="color:#5cc0f0;word-break:break-all;">${link}</a></p>
          <p style="color:#94a3b8;font-size:13px;line-height:1.6;margin:20px 0 24px;">${escapeHtml(input.footer)}</p>
        </td></tr>
        <tr><td align="center" style="padding:4px 28px 28px;border-top:1px solid #1a3a5a;">
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px;">
            <tr><td style="background:#ffffff;border-radius:14px;padding:10px 14px;">
              <img src="${escapeHtml(emailLogoUrl())}" width="64" height="64" alt="Smartbis" style="display:block;border:0;outline:none;text-decoration:none;width:64px;height:64px;">
            </td></tr>
          </table>
        </td></tr>
      </table>
      <p style="color:#64748b;font-size:12px;margin:16px 0 0;">Smartbis · <a href="${escapeHtml(appPublicUrl())}" style="color:#64748b;">${escapeHtml(appPublicUrl().replace(/^https?:\/\//, ''))}</a></p>
    </td></tr>
  </table>
</body>
</html>`
  const text = `${input.title}\n\n${input.intro}\n\n${input.highlight ? `${input.highlight}\n\n` : ''}${input.note ? `${input.note.label} ${input.note.text}\n\n` : ''}${input.button}: ${input.link}\n\n${input.footer}\n\nSmartbis · ${appPublicUrl()}`
  return { html, text }
}

// The token goes after "#": browsers never send it to the server, so it stays
// out of nginx, Cloudflare and proxy logs
// trial: the free trial that starts when the email is confirmed (plan "trial")
export function emailVerificationEmail(token: string, trial?: { days: number; conversations: number }) {
  return {
    subject: 'Confirma tu correo para activar tu cuenta de Smartbis',
    ...layout({
      title: 'Confirma tu correo',
      intro: 'Gracias por registrarte en Smartbis. Para activar tu cuenta e iniciar sesión, confirma que este correo es tuyo.',
      highlight: trial
        ? `🎁 Tienes ${trial.days} días de prueba gratis. Empiezan al confirmar tu correo: tu bot atenderá hasta ${trial.conversations} conversaciones de Messenger sin costo.`
        : undefined,
      // Meta only lets apps answer Messenger for Pages; a personal profile cannot be connected
      note: {
        label: 'Importante:',
        text:
          'Smartbis se conecta a la página de Facebook de tu negocio. Los perfiles personales de Facebook no se pueden integrar, ' +
          'ya que Meta solo permite atender mensajes de forma automática desde páginas. Si aún no tienes una, puedes crearla gratis ' +
          'desde tu cuenta de Facebook antes de conectar el bot.',
      },
      button: 'Confirmar mi correo',
      link: `${appPublicUrl()}/verificar-correo#token=${encodeURIComponent(token)}`,
      footer: 'El enlace vence en 48 horas. Si tú no creaste una cuenta en Smartbis, ignora este correo.',
    }),
  }
}

export function passwordResetEmail(tokenHash: string) {
  return {
    subject: 'Restablece tu contraseña de Smartbis',
    ...layout({
      title: 'Restablece tu contraseña',
      intro: 'Recibimos una solicitud para cambiar la contraseña de tu cuenta de Smartbis. Usa el botón para elegir una nueva.',
      button: 'Cambiar mi contraseña',
      link: `${appPublicUrl()}/restablecer-contrasena#token=${encodeURIComponent(tokenHash)}`,
      footer: 'Por seguridad, el enlace funciona una sola vez y vence en 1 hora. Si tú no lo pediste, ignora este correo: tu contraseña no cambiará.',
    }),
  }
}

export async function sendEmailVerificationEmail(to: string, token: string, trial?: { days: number; conversations: number }) {
  await sendMail({ to, ...emailVerificationEmail(token, trial) })
}

export async function sendPasswordResetEmail(to: string, tokenHash: string) {
  await sendMail({ to, ...passwordResetEmail(tokenHash) })
}

export function planPaidEmail(input: { planName: string; periodEnd: string }) {
  const until = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Mexico_City' })
    .format(new Date(input.periodEnd))
  return {
    subject: `Tu ${input.planName} de Smartbis está activo`,
    ...layout({
      title: '¡Gracias por tu pago!',
      intro: `Recibimos tu pago y tu ${input.planName} ya está activo. Tu bot sigue atendiendo a tus clientes de Messenger sin interrupciones.`,
      highlight: `✅ Tu paquete está vigente hasta el ${until}. Las conversaciones de tu bot se cuentan de nuevo a partir de hoy.`,
      button: 'Ir a Smartbis',
      link: appPublicUrl(),
      footer: 'Puedes consultar tu paquete y su vigencia en cualquier momento desde Mi perfil.',
    }),
  }
}

export async function sendPlanPaidEmail(to: string, input: { planName: string; periodEnd: string }) {
  await sendMail({ to, ...planPaidEmail(input) })
}
