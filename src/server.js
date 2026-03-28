import express from "express";
import cors from "cors";
import axios from "axios";
import dotenv from "dotenv";
import OpenAI from "openai";
import crypto from "crypto";
import fs from "node:fs";
import { readFile, readdir, writeFile, mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { searchVectors } from "./rag/store.js";
import { ingestNotebook } from "./rag/ingest.js";
import { initWhatsApp, getWAStatus, sendToAdmins, registerMessageHandlers, logoutWhatsApp, sendWhatsAppMessage, sendWhatsAppImage, downloadWAImage, refreshConfig, normalizeJid, getGroupList } from "./whatsapp.js";
import { registerInSheets } from "./sheets.js";
import { getAvailableSlots, createCalendarEvent, initCalendar } from "./calendar.js";

// --- DEBUG LOGGER ---
const LOG_FILE = path.join(process.cwd(), "data", "bot.log");
function logError(label, err) {
    const msg = `[${new Date().toISOString()}] [ERROR] [${label}] ${err?.stack || err?.message || err}\n`;
    console.error(msg);
    try { fs.appendFileSync(LOG_FILE, msg); } catch {}
}
function logDebug(label, msg) {
    const output = `[${new Date().toISOString()}] [DEBUG] [${label}] ${msg}\n`;
    console.log(output);
    try { fs.appendFileSync(LOG_FILE, output); } catch {}
}
// --------------------

dotenv.config();
logDebug("System", "Bot starting...");

const app = express();
// WhatsApp & Sheets Config
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID || "";

app.use(express.json({
  limit: "10mb", // Added limit
  verify: (req, _res, buf) => {
    try { req.rawBody = buf; } catch {}
  }
}));
app.use((req, res, next) => {
  next();
});
app.use(cors());
app.use((req, res, next) => {
    if (req.path === '/webhook' || req.path.startsWith('/api')) {
        console.log(`[HTTP] ${req.method} ${req.path} from ${req.ip}`);
    }
    next();
});

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

// Serve static images (for Messenger attachments)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use("/static/img", express.static(path.join(__dirname, "img")));
app.use("/app/data/temp_media", express.static(path.join(process.cwd(), "data", "temp_media")));

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const FB_VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN || "";
const XAI_API_KEY = process.env.XAI_API_KEY || "";
const XAI_MODEL = process.env.XAI_MODEL || "grok-4-1-fast-reasoning";
const APP_SECRET = process.env.APP_SECRET || "";
const SINGLE_TENANT_MODE = (process.env.SINGLE_TENANT_MODE || "1") !== "0";
const PAYMENT_IMAGE_URL = process.env.PAYMENT_IMAGE_URL || "";

// Universal Configuration
const APP_NAME = process.env.APP_NAME || "SmartBis";
const ITEM_NAME = process.env.ITEM_NAME || "Asesoría/Producto";
const USER_LABEL = process.env.USER_LABEL || "Cliente";
const ACTION_NAME = process.env.ACTION_NAME || "Compra/Cita";
const TICKET_PREFIX = process.env.TICKET_PREFIX || "SB-";
const TIMEZONE = process.env.TIMEZONE || "America/Hermosillo";

// Data files
const TICKETS_FILE = path.join(process.cwd(), "data", "tickets.json");
const WA_CONFIG_FILE = path.join(process.cwd(), "data", "wa_config.json");
const EVENTS_FILE = path.join(process.cwd(), "data", "events.json");

const BUSINESS_ADDRESS = process.env.BUSINESS_ADDRESS || "No especificada";
const BUSINESS_PHONE = process.env.BUSINESS_PHONE || "No especificado";
const BUSINESS_TYPE = process.env.BUSINESS_TYPE || "negocio";
const FOCUS_KEYWORDS = (process.env.FOCUS_KEYWORDS || "venta,servicio,informacion").split(",").map(k => k.trim().toLowerCase());

// Default prompts
const DEFAULT_SYSTEM_PROMPT = `Eres un asesor comercial experto para ${APP_NAME} (${BUSINESS_TYPE}). Tu objetivo es atender dudas sobre ${ITEM_NAME}, gestionar solicitudes y ofrecer una experiencia amable y cálida.

# INFORMACIÓN CLAVE:
- **Ubicación:** ${BUSINESS_ADDRESS}
- **Teléfono:** ${BUSINESS_PHONE}

# PERSONALIDAD Y TONO:
- Sé empático y cercano. Usa el NOMBRE DEL USUARIO si ya lo conoces.
- Usa frases cálidas y visuales (emojis moderados).
- Si el usuario viene de un anuncio, dale una bienvenida especial.

# REGLAS DE ORO:
1. SIEMPRE verifica si el usuario tiene dudas.
2. Guarda información relevante en su perfil usando 'save_user_note'.
3. Mantén la calidez humana en cada paso.
`;
const BOT_ADMIN_PSID = process.env.BOT_ADMIN_PSID || "";
const BOT_ADMIN_WA = (process.env.BOT_ADMIN_WA || "").replace(/\+/g, "").trim();

// Shared state
const tenantCaches = new Map();
const chatSessions = new Map();
const SESSIONS_FILE = path.resolve(__dirname, "..", "data", "sessions.json");

// Session persistence
function loadSessions() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const raw = fs.readFileSync(SESSIONS_FILE, "utf8");
      const data = JSON.parse(raw);
      for (const [psid, session] of Object.entries(data)) {
        chatSessions.set(psid, session);
      }
      console.log(`[SESSIONS] Loaded ${chatSessions.size} sessions from disk.`);
    }
  } catch (e) {
    console.error("[SESSIONS] Error loading sessions:", e.message);
  }
}

function saveSessions() {
  try {
    const obj = Object.fromEntries(chatSessions);
    const dir = path.dirname(SESSIONS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(obj), "utf8");
  } catch (e) {
    console.error("[SESSIONS] Error saving sessions:", e.message);
  }
}

// Load sessions on startup
loadSessions();

// Persist sessions every 60 seconds
setInterval(saveSessions, 60000);
const metricsLogs = new Map();
const pendingBufferedMessages = new Map();
const processedEvents = new Map();
const userBotDisabled = new Map();
const userProfileCache = new Map();
const PROFILES_PATH = path.join(__dirname, "../data/profiles.json");

function loadProfiles() {
    try {
        if (fs.existsSync(PROFILES_PATH)) {
            const data = JSON.parse(fs.readFileSync(PROFILES_PATH, 'utf8'));
            Object.entries(data).forEach(([psid, profile]) => userProfileCache.set(psid, profile));
            console.log(`[PROFILES] Loaded ${userProfileCache.size} profiles.`);
        }
    } catch (e) { console.error("[PROFILES] Load error:", e.message); }
}

function saveProfiles() {
    try {
        const data = Object.fromEntries(userProfileCache);
        fs.writeFileSync(PROFILES_PATH, JSON.stringify(data, null, 2));
    } catch (e) { console.error("[PROFILES] Save error:", e.message); }
}

function updateUserProfileFromArgs(psid, args) {
    if (!psid || !args) return;
    const current = userProfileCache.get(psid) || { name: psid, whatsapp: "", email: "", notes: "" };
    let changed = false;

    if (args.nombre && args.nombre !== "N/D" && args.nombre !== current.name) {
        // If current name is an ID (numeric or ends with @s.whatsapp.net / @lid) or equals the PSID
        const isCurrentId = /^\d+$/.test(current.name) || current.name.includes('@') || current.name === psid;
        if (isCurrentId || current.name === "Desconocido") {
            current.name = args.nombre;
            changed = true;
        }
    }
    if (args.whatsapp && args.whatsapp !== "N/D" && args.whatsapp !== current.whatsapp) {
        current.whatsapp = args.whatsapp;
        changed = true;
    }
    if (args.email && args.email !== "N/D" && args.email !== current.email) {
        current.email = args.email;
        changed = true;
    }
    
    // Auto-extract WA number from ID if not set
    if (!current.whatsapp && (psid.includes("@s.whatsapp.net") || psid.includes("@lid"))) {
        const rawNum = psid.split('@')[0].split(':')[0];
        if (/^\d+$/.test(rawNum)) {
            current.whatsapp = rawNum;
            changed = true;
        }
    }

    if (changed || !userProfileCache.has(psid)) {
        userProfileCache.set(psid, current);
        saveProfiles();
    }
}

async function downloadExternalImage(url, filename) {
    try {
        const dest = path.join(process.cwd(), 'data', 'temp_media', filename);
        const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
        fs.writeFileSync(dest, Buffer.from(res.data));
        return dest;
    } catch (e) {
        console.error(`[DOWNLOAD] Falló descarga de ${url}:`, e.message);
        return null;
    }
}

loadProfiles();

const NOTEBOOK_CACHE_TTL_MS = 60000 * 10;
const SESSION_MAX_MESSAGES = Number(process.env.SESSION_MAX_MESSAGES || 20);
const SESSION_TTL_MS = 3600000 * 24; // 24 hours to prune inactive sessions
const METRICS_MAX_ENTRIES = 1000;
const MESSAGE_BUFFER_MS = Number(process.env.MESSAGE_BUFFER_MS || 5000);
const EVENT_DEDUP_TTL_MS = 3600000;
let pendingIngestion = false;

// Error Handling: Prevent silent crashes
process.on('uncaughtException', (err) => {
  console.error('[CRITICAL-ERROR] Uncaught Exception:', err.message, err.stack);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRITICAL-ERROR] Unhandled Rejection at:', promise, 'reason:', reason);
});

// Bot Status (Mute per platform)
let botStatus = { messenger: true, whatsapp: true };
const BOT_STATUS_FILE = path.join(process.cwd(), "data", "bot_status.json");

async function loadBotStatus() {
  try {
    if (fs.existsSync(BOT_STATUS_FILE)) {
      const data = await readFile(BOT_STATUS_FILE, "utf8");
      botStatus = { ...botStatus, ...JSON.parse(data) };
    }
  } catch (e) { console.error("[STATUS] Error loading:", e.message); }
}
async function saveBotStatus() {
  try { await writeFile(BOT_STATUS_FILE, JSON.stringify(botStatus, null, 2)); } catch {}
}
loadBotStatus();

// --- NEW STATUS ENDPOINTS ---
app.get("/api/bot/status", (req, res) => res.json(botStatus));
app.post("/api/bot/status", async (req, res) => {
  const { platform, status } = req.body;
  if (platform in botStatus) {
    botStatus[platform] = !!status;
    await saveBotStatus();
    res.json({ ok: true, botStatus });
  } else res.status(400).json({ error: "Plataforma inválida" });
});

// WhatsApp Config Persistence
let waConfig = { adminNumbers: [] };

async function loadWAConfig() {
  try {
    const raw = await readFile(WA_CONFIG_FILE, "utf8");
    if (raw && raw.trim()) {
      const data = JSON.parse(raw);
      waConfig = { ...waConfig, ...data };
    }
  } catch (e) { console.error("[WA-CONFIG] Error loading:", e.message); }
}
async function saveWAConfig() {
  await writeFile(WA_CONFIG_FILE, JSON.stringify(waConfig, null, 2));
}

// Events Management
let eventsStore = [];
async function loadEvents() {
    try {
        if (fs.existsSync(EVENTS_FILE)) {
            const data = await readFile(EVENTS_FILE, "utf8");
            eventsStore = JSON.parse(data);
        }
    } catch (e) { console.error("[EVENTS] Error loading:", e.message); }
}
async function saveEvents() {
    await writeFile(EVENTS_FILE, JSON.stringify(eventsStore, null, 2));
}
loadEvents();

// Appointment Config
const APPOINTMENT_CONFIG_PATH = path.join(__dirname, "..", "data", "appointment_config.json");
let appointmentConfig = { startTime: "09:00", endTime: "18:00", durationMinutes: 120, gapMinutes: 20 };

async function loadAppointmentConfig() {
  try {
    const raw = await readFile(APPOINTMENT_CONFIG_PATH, "utf8");
    if (raw && raw.trim()) appointmentConfig = JSON.parse(raw);
  } catch (e) { console.error("[APP-CONFIG] Error loading:", e.message); }
}
async function saveAppointmentConfig() {
  try { await writeFile(APPOINTMENT_CONFIG_PATH, JSON.stringify(appointmentConfig, null, 2)); } catch {}
}

// Removed nested then logic, properly integrated into boot sequence below.

// ============================================
// TICKET SYSTEM
// ============================================
let ticketsStore = [];
let financesStore = [];
let remindersStore = [];
let tasksStore = [];
let inventoryStore = {}; // Object for simple JSON persistence

const TICKETS_MAX = 5000;

function getDataDir(tenantId = "default") {
  return path.resolve(__dirname, "..", "data", tenantId);
}

function getTicketsPath(tenantId) {
  return path.join(getDataDir(tenantId), "tickets.json");
}

function getFinancesPath(tenantId) {
  return path.join(getDataDir(tenantId), "finances.json");
}

function getRemindersPath(tenantId) {
  return path.join(getDataDir(tenantId), "reminders.json");
}

function getTasksPath(tenantId) {
  return path.join(getDataDir(tenantId), "tasks.json");
}

function getInventoryPath(tenantId) {
  return path.join(getDataDir(tenantId), "inventory.json");
}

async function loadTickets(tenantId = "default") {
  try {
    const raw = await readFile(getTicketsPath(tenantId), "utf8");
    ticketsStore = JSON.parse(raw);
    if (!Array.isArray(ticketsStore)) ticketsStore = [];
  } catch { ticketsStore = []; }
}

async function saveTickets(tenantId = "default") {
  const fp = getTicketsPath(tenantId);
  try {
    await mkdir(path.dirname(fp), { recursive: true });
    await writeFile(fp, JSON.stringify(ticketsStore, null, 2), "utf8");
    console.log(`[TICKETS] Saved ${ticketsStore.length} tickets`);
  } catch (e) { console.error(`[TICKETS] Error saving:`, e.message); }
}

async function loadFinances(tenantId = "default") {
  try {
    const raw = await readFile(getFinancesPath(tenantId), "utf8");
    financesStore = JSON.parse(raw);
  } catch { financesStore = []; }
}

async function saveFinances(tenantId = "default") {
  const fp = getFinancesPath(tenantId);
  try {
    await mkdir(path.dirname(fp), { recursive: true });
    await writeFile(fp, JSON.stringify(financesStore, null, 2), "utf8");
  } catch (e) { console.error(`[FINANCES] Error saving:`, e.message); }
}

async function loadReminders(tenantId = "default") {
  try {
    const raw = await readFile(getRemindersPath(tenantId), "utf8");
    remindersStore = JSON.parse(raw);
  } catch { remindersStore = []; }
}

async function saveReminders(tenantId = "default") {
  const fp = getRemindersPath(tenantId);
  try {
    await mkdir(path.dirname(fp), { recursive: true });
    await writeFile(fp, JSON.stringify(remindersStore, null, 2), "utf8");
  } catch (e) { console.error(`[REMINDERS] Error saving:`, e.message); }
}

async function loadTasks(tenantId = "default") {
  try {
    const raw = await readFile(getTasksPath(tenantId), "utf8");
    tasksStore = JSON.parse(raw);
  } catch { tasksStore = []; }
}

async function saveTasks(tenantId = "default") {
  const fp = getTasksPath(tenantId);
  try {
    await mkdir(path.dirname(fp), { recursive: true });
    await writeFile(fp, JSON.stringify(tasksStore, null, 2), "utf8");
  } catch (e) { console.error(`[TASKS] Error saving:`, e.message); }
}

async function loadInventory(tenantId = "default") {
  try {
    const raw = await readFile(getInventoryPath(tenantId), "utf8");
    inventoryStore = JSON.parse(raw);
  } catch { inventoryStore = {}; }
}

async function saveInventory(tenantId = "default") {
  const fp = getInventoryPath(tenantId);
  try {
    await mkdir(path.dirname(fp), { recursive: true });
    await writeFile(fp, JSON.stringify(inventoryStore, null, 2), "utf8");
  } catch (e) { console.error(`[INVENTORY] Error saving:`, e.message); }
}

function generateTicketId() {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
  
  // Find highest sequence for today
  const todayTickets = ticketsStore.filter(t => t.id.includes(dateStr));
  let seqNum = todayTickets.length + 1;
  
  // Safety loop for really unique ID in case of concurrency or re-scans
  let candidate = `${TICKET_PREFIX}${dateStr}-${String(seqNum).padStart(3, "0")}`;
  while (ticketsStore.some(t => t.id === candidate)) {
    seqNum++;
    candidate = `${TICKET_PREFIX}${dateStr}-${String(seqNum).padStart(3, "0")}`;
  }
  
  return candidate;
}

function createTicket(psid, type, data, tenantId) {
  const now = new Date();
  const localISO = now.toLocaleString('sv-SE', { timeZone: TIMEZONE }).replace(' ', 'T');
  
  const existing = ticketsStore.find(t => 
    t.psid === psid && 
    t.type === type && 
    (t.status === "pendiente_datos" || t.status === "registrado_pago" || t.status === "registrado" || t.status === "pendiente_pago")
  );
  
  if (existing) {
    existing.data = { ...existing.data, ...data };
    // Only set to registrado if it wasn't already pending final approval
    if (existing.status !== "aprobado" && type !== "cita") {
        // If it was pendiente_pago but now has image, it's registrado
        if (existing.status === "pendiente_pago" && data.comprobante_url) {
            existing.status = "registrado";
        } else if (existing.status !== "pendiente_pago") {
            existing.status = "registrado";
        }
    }
    existing.updatedAt = localISO;
    saveTickets(tenantId).catch(() => {});
    return existing;
  }

  const ticket = {
    id: generateTicketId(),
    type,
    status: (type === "cita") ? "pendiente_datos" : "registrado",
    psid,
    tenantId: tenantId || "default",
    createdAt: localISO,
    updatedAt: localISO,
    data: { ...data },
    adminNotes: "",
    rejectReason: "",
    messages: []
  };
  ticketsStore.push(ticket);
  if (ticketsStore.length > TICKETS_MAX) ticketsStore = ticketsStore.slice(-TICKETS_MAX);
  saveTickets(tenantId).catch(() => {});
  return ticket;
}

// ============================================
// FUNCTION CALLING TOOLS FOR AI
// ============================================
const AI_TOOLS = [
  {
    type: "function",
    function: {
      name: "send_payment_methods",
      description: "Envía la imagen de métodos de pago al usuario. DEBES llamar esta función para que la imagen se envíe — NO basta con decirlo en texto. Si el usuario es de México y quiere pagar, LLAMA ESTA FUNCIÓN OBLIGATORIAMENTE.",
      parameters: { type: "object", properties: {}, required: [] }
    }
  },
  {
    type: "function",
    function: {
      name: "create_enrollment_ticket",
      description: "OBLIGATORIA: Registra un curso. DEBES llamarla para que el alumno quede inscrito. Es la única forma de que el Jefe vea el registro.",
      parameters: {
        type: "object",
        properties: {
          curso: { type: "string", description: `Nombre del ${ITEM_NAME}` },
          modalidad: { type: "string", description: "Online, Presencial o Grabado" },
          metodo_pago: { type: "string", description: "Método de pago (Opcional si aún no paga)" },
          nombre: { type: "string", description: "Nombre completo del alumno" },
          email: { type: "string", description: "Correo electrónico (Gmail)" },
          whatsapp: { type: "string", description: "Número de WhatsApp" },
          localidad: { type: "string", description: "Ciudad y País" },
          comprobante_url: { type: "string", description: "URL de la imagen del comprobante (Opcional si aún no paga)" },
          monto: { type: "string", description: "Monto del pago (Opcional si aún no paga)" }
        },
        required: ["curso", "modalidad", "nombre", "email", "whatsapp", "localidad"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_purchase_ticket",
      description: "Genera un pedido de productos. Úsala para envíos o para pedidos en sucursal.",
      parameters: {
        type: "object",
        properties: {
          productos: { type: "string", description: "Lista sumaria de productos y cantidades" },
          total: { type: "string", description: "Suma total" },
          tipo_entrega: { type: "string", enum: ["sucursal", "envio"], description: "Recoger en sucursal o Envío a domicilio" },
          metodo_pago: { type: "string", description: "Método de pago" },
          localidad: { type: "string", description: "Ubicación del cliente" },
          nombre: { type: "string", description: "Nombre del cliente" },
          whatsapp: { type: "string", description: "WhatsApp" },
          comprobante_url: { type: "string", description: "URL de la imagen del comprobante (Opcional si es en sucursal)" }
        },
        required: ["productos", "total", "tipo_entrega", "nombre", "whatsapp"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "check_availability",
      description: "Verifica la disponibilidad de citas para una fecha o rango de días. Úsala cuando el usuario quiera agendar una cita.",
      parameters: {
        type: "object",
        properties: {
          fecha: { type: "string", description: "Fecha de inicio (YYYY-MM-DD). Si se omite, usa hoy." },
          dias: { type: "integer", description: "Número de días a consultar. Si no se especifica, usa el valor predeterminado del sistema." }
        }
      }
    }
  },
  {
    type: "function",
        function: {
      name: "create_appointment_request",
      description: "Crea una SOLICITUD DE CITA en el sistema. Úsala cuando el usuario confirme Fecha, Horario y Nombre. NO pide pago.",
      parameters: {
        type: "object",
        properties: {
          fecha: { type: "string", description: "Fecha elegida (YYYY-MM-DD)" },
          horario: { type: "string", description: "Horario elegido (ej. 10:00 AM)" },
          nombre: { type: "string", description: "Nombre completo del cliente" },
          whatsapp: { type: "string", description: "WhatsApp del cliente" },
          motivo: { type: "string", description: "Motivo de la cita (ej. valoración, consulta, etc.)" }
        },
        required: ["fecha", "horario", "nombre", "whatsapp", "motivo"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "save_user_note",
      description: "Guarda información relevante o preferencias del usuario en su perfil permanente. Úsala para recordar intereses, necesidades específicas o contexto que ayude en futuras interacciones.",
      parameters: {
        type: "object",
        properties: {
          nota: { type: "string", description: "La información nueva que quieres recordar del cliente." }
        },
        required: ["nota"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "update_user_identity",
      description: "Actualiza los datos básicos de identidad del usuario (Nombre, WhatsApp, Email). Úsala en cuanto el usuario se presente o proporcione su contacto, sin esperar a crear un ticket.",
      parameters: {
        type: "object",
        properties: {
          nombre: { type: "string", description: "Nombre completo del cliente" },
          whatsapp: { type: "string", description: "Número de WhatsApp" },
          email: { type: "string", description: "Correo electrónico" }
        }
      }
    }
  }
];

const ADMIN_TOOLS = [
  {
    type: "function",
    function: {
      name: "admin_list_tickets",
      description: "Lista los tickets del sistema filtrados por estado. Úsala para responder al Jefe sobre solicitudes pendientes.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["registrado", "aprobado", "rechazado", "pendiente_datos", "todos"], description: "Estado a filtrar." },
          limit: { type: "integer", description: "Máximo de tickets (max 20)." }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "admin_update_ticket",
      description: "Permite aprobar o rechazar un ticket específico. Úsala cuando el Jefe te lo ordene.",
      parameters: {
        type: "object",
        properties: {
          ticketId: { type: "string", description: "ID del ticket (ej: TK-20240325-001)" },
          status: { type: "string", enum: ["aprobado", "rechazado"], description: "Nuevo estado." },
          rejectReason: { type: "string", description: "Motivo si es rechazo." }
        },
        required: ["ticketId", "status"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "admin_query_calendar",
      description: "Consulta el calendario completo para ver qué horarios están ocupados y por quién. Úsala cuando el Jefe pregunte por la agenda.",
      parameters: {
        type: "object",
        properties: {
          fecha: { type: "string", description: "Fecha a consultar (YYYY-MM-DD)." }
        },
        required: ["fecha"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "admin_edit_notebook_info",
      description: "Modifica un valor específico (como un precio) en un archivo notebook (.md). Busca bien la información antes de cambiarla.",
      parameters: {
        type: "object",
        properties: {
          fileName: { type: "string", description: "Nombre del archivo (ej: cursos.md, productos.md)" },
          item: { type: "string", description: "Nombre del curso o producto a modificar." },
          field: { type: "string", description: "Campo a modificar (ej: Precio, Fecha)." },
          newValue: { type: "string", description: "Nuevo valor a establecer." }
        },
        required: ["fileName", "item", "field", "newValue"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "admin_get_agenda",
      description: "Consulta los detalles de todas las citas y eventos agendados para un día específico. Úsala para responder qué hay mañana o cualquier otro día.",
      parameters: {
        type: "object",
        properties: {
          fecha: { type: "string", description: "Fecha a consultar (YYYY-MM-DD)." }
        },
        required: ["fecha"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "admin_get_metrics",
      description: "Consulta cuántos usuarios han interactuado hoy con el bot y métricas rápidas. Úsala para responder al Jefe sobre cuánta gente escribió, mandó mensaje, o estadísticas del día.",
      parameters: {
        type: "object",
        properties: {
          fecha: { type: "string", description: "Fecha (YYYY-MM-DD). Si se omite, usa hoy." }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "admin_create_appointment",
      description: "OBLIGATORIA: Agenda una cita DIRECTAMENTE. DEBES llamar esta función para que la cita quede registrada en el calendario. Si no la llamas, la cita NO EXISTIRÁ.",
      parameters: {
        type: "object",
        properties: {
          fecha: { type: "string", description: "Fecha (YYYY-MM-DD)." },
          horario: { type: "string", description: "Horario (ej: 11:00 AM)." },
          nombre: { type: "string", description: "Nombre (opcional, default: El Jefe)." },
          motivo: { type: "string", description: "Motivo de la cita." },
          whatsapp: { type: "string", description: "Si es para un tercero, DEBES incluir el número de whatsapp del cliente." }
        },
        required: ["fecha", "horario"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "admin_ingest_knowledge",
      description: "Sincroniza la base de datos de conocimiento (RAG). Úsala después de añadir o modificar información en los notebooks para que el bot de clientes aprenda los cambios.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "admin_manage_events",
      description: "Añade o elimina eventos/bloqueos en el calendario (ej: vacaciones, días festivos, cursos presenciales).",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["add", "remove"], description: "Acción a realizar." },
          title: { type: "string", description: "Título del evento (ej: INHABIL, Vacaciones)." },
          date: { type: "string", description: "Fecha (YYYY-MM-DD)." },
          eventId: { type: "string", description: "ID del evento para eliminar." }
        },
        required: ["action"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "admin_read_notebook",
      description: "Lee el contenido completo de un archivo de conocimiento (.md). Úsala para revisar precios o descripciones antes de modificarlas.",
      parameters: {
        type: "object",
        properties: {
          fileName: { type: "string", description: "Archivo a leer (ej: cursos.md, productos.md)." }
        },
        required: ["fileName"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "admin_update_config",
      description: "Actualiza la configuración de la agenda (horarios de apertura/cierre, duración de citas).",
      parameters: {
        type: "object",
        properties: {
          startTime: { type: "string", description: "Hora apertura (HH:mm)." },
          endTime: { type: "string", description: "Hora cierre (HH:mm)." },
          durationMinutes: { type: "integer", description: "Duración de citas en minutos." }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "admin_manage_finances",
      description: "OBLIGATORIA: Gestiona las finanzas. Permite registrar gastos o ingresos adicionales no relacionados a tickets automáticos.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["record", "delete"], description: "Acción a realizar." },
          type: { type: "string", enum: ["ingreso", "gasto"], description: "Tipo de movimiento." },
          amount: { type: "number", description: "Monto del movimiento." },
          description: { type: "string", description: "Detalle del gasto o ingreso (ej: 'Pago de luz', 'Venta externa')." }
        },
        required: ["action", "type", "amount", "description"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "admin_get_financial_report",
      description: "Genera un reporte financiero sumando tickets (ventas/inscripciones) y finanzas manuales.",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", enum: ["hoy", "semana", "mes"], description: "Periodo a consultar." }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "admin_set_reminder",
      description: "OBLIGATORIA: Agenda un recordatorio que el bot enviará por WhatsApp al Jefe o a un tercero en una fecha/hora específica.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Mensaje que el bot debe enviar." },
          date_time: { type: "string", description: "OBLIGATORIO: Fecha y hora en formato ISO 8601 (YYYY-MM-DDTHH:mm:ss). Calcula la fecha absoluta basándote en la fecha/hora actual proporcionada en el sistema." },
          whatsapp: { type: "string", description: "Opcional: Si el recordatorio es para alguien más. Por defecto se envía al Jefe." }
        },
        required: ["text", "date_time"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "admin_manage_tasks",
      description: "Gestiona una lista de tareas pendientes (ToDo list) del negocio.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["add", "done", "list", "remove"], description: "Acción a realizar." },
          text: { type: "string", description: "Texto de la tarea (para 'add')." },
          id: { type: "string", description: "ID de la tarea (para 'done' o 'remove')." }
        },
        required: ["action"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "admin_manage_inventory",
      description: "OBLIGATORIA: Gestiona el stock de productos.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["update", "check", "list_low"], description: "Acción a realizar." },
          item: { type: "string", description: "Nombre del producto." },
          stock: { type: "number", description: "Nueva cantidad en existencia (si es update)." }
        },
        required: ["action"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "admin_bulk_clear",
      description: "OBLIGATORIA: Elimina todos los registros de un tipo específico (ej: todas las 'cita') de una fecha. Úsala cuando el Jefe te pida 'quitar todos los cursos' o 'borrar citas del lunes'.",
      parameters: {
        type: "object",
        properties: {
          recordType: { type: "string", enum: ["cita", "tarea", "recordatorio", "inscripcion"], description: "Tipo de registro a limpiar." },
          date: { type: "string", description: "Fecha opcional (YYYY-MM-DD) a limpiar. Si es 'todo', borra todos los registros de ese tipo." }
        },
        required: ["recordType", "date"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "admin_get_whatsapp_groups",
      description: "Obtiene la lista de grupos donde el bot participa. Úsala para buscar el ID de un grupo por su nombre.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "admin_send_whatsapp_message",
      description: "OBLIGATORIA: Envía un mensaje directo a un usuario o a un grupo de WhatsApp.",
      parameters: {
        type: "object",
        properties: {
          target: { type: "string", description: "Número (521...) o ID de grupo (@g.us)." },
          text: { type: "string", description: "Contenido del mensaje." }
        },
        required: ["target", "text"]
      }
    }
  }
];

// ============================================
// Configuration Helpers
// ============================================
function getTenantPaths(tenantId) {
  const isDefault = tenantId === "default" || !tenantId;
  const base = isDefault
    ? path.resolve(__dirname, "..")
    : path.resolve(__dirname, "..", "tenants", tenantId);
  
  return {
    prompt: path.join(base, "soul", "prompt.md"),
    notebook: path.join(base, "notebook"),
    data: path.resolve(__dirname, "..", "data", tenantId || "default"),
    metrics: path.resolve(__dirname, "..", "data", tenantId || "default", "metrics.json"),
    collection: !isDefault ? `notebook_${tenantId}` : (process.env.QDRANT_COLLECTION || "smartbis_notebook"),
    fbToken: process.env[`FB_TOKEN_${tenantId}`] || process.env.FB_PAGE_ACCESS_TOKEN || ""
  };
}

// Security
function isValidSignature(req) {
  if (!APP_SECRET) return true;
  const signature = req.headers["x-hub-signature-256"];
  if (!signature) {
    console.warn("[WEBHOOK] Missing x-hub-signature-256 header");
    return false;
  }
  const elements = signature.split("=");
  const signatureHash = elements[1];
  const expectedHash = crypto
    .createHmac("sha256", APP_SECRET)
    .update(req.rawBody)
    .digest("hex");
  
  const ok = signatureHash === expectedHash;
  if (!ok) {
    console.warn(`[WEBHOOK] Signature mismatch! Received: ${signatureHash.substring(0,10)}... Expected: ${expectedHash.substring(0,10)}...`);
  }
  return ok;
}

function shouldProcessEvent(eventKey) {
  const now = Date.now();
  if (processedEvents.has(eventKey)) return false;
  
  processedEvents.set(eventKey, now);
  
  // Optimization: Cleanup periodically but avoid too many scans
  if (processedEvents.size > 10000) {
    let deleted = 0;
    for (const [k, v] of processedEvents) {
      if (now - v > EVENT_DEDUP_TTL_MS) {
        processedEvents.delete(k);
        deleted++;
      }
    }
    // Final safety: if map is still too large (very high traffic), clear it entirely
    if (processedEvents.size > 15000) {
        console.warn(`[SYS] Deduplication map limit reached (15,000+), clearing all to prevent memory issues.`);
        processedEvents.clear();
    }
  }
  return true;
}

// Background Task: Prune old chat sessions to prevent memory leaks
setInterval(() => {
    const now = Date.now();
    let prunedCount = 0;
    for (const [psid, session] of chatSessions) {
        if (now - (session.updatedAt || 0) > SESSION_TTL_MS) {
            chatSessions.delete(psid);
            prunedCount++;
        }
    }
    if (prunedCount > 0) {
        console.log(`[MEMORY] Pruned ${prunedCount} inactive sessions from RAM.`);
    }
}, 3600000); // Check every hour

// Text Processing
function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function stripGreetings(text) {
  const t = normalizeText(text);
  return t
    .replace(/\b(hola|buenos dias|buenas tardes|buenas noches|buen dia|que tal|hey|buenas)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isGreetingOnly(text) {
  const stripped = stripGreetings(text);
  if (!stripped) return true;
  // Short affirmative/conversational words are NOT greetings
  const conversationalWords = ["si", "no", "ok", "va", "vale", "dale", "claro", "listo", "lista", "ya", "bien", "okey", "okay", "sip", "sep", "nop", "nel", "eso", "ajá", "aja", "mande", "dime", "por favor", "porfavor", "gracias", "quiero", "me interesa"];
  const normalizedStripped = normalizeText(stripped);
  if (conversationalWords.some(w => normalizedStripped === w || normalizedStripped.startsWith(w + " "))) return false;
  return stripped.length < 2 && /^[!?.]+$/.test(stripped);
}

function tokenize(value) {
  const t = stripGreetings(value);
  return t.split(/[^a-z0-9]+/g).filter((v) => v.length > 2);
}

// Retrieval Logic
async function loadNotebookSections(tenantId) {
  const { notebook } = getTenantPaths(tenantId);
  const cache = tenantCaches.get(tenantId) || { loadedAt: 0, sections: [] };
  const now = Date.now();

  if (now - cache.loadedAt < NOTEBOOK_CACHE_TTL_MS && cache.sections.length) {
    return cache.sections;
  }

  try {
    const names = await readdir(notebook);
    const mdNames = names.filter((n) => n.toLowerCase().endsWith(".md"));
    const sections = [];
    for (const name of mdNames) {
      try {
        const content = await readFile(path.join(notebook, name), "utf8");
        sections.push(...toSections(content, name));
      } catch (err) {
        console.error(`Error leyendo ${name} para ${tenantId}:`, err.message);
      }
    }
    tenantCaches.set(tenantId, { loadedAt: now, sections });
    return sections;
  } catch {
    return [];
  }
}

function splitByHeadings(source) {
  const lines = String(source || "").replace(/\r\n/g, "\n").split("\n");
  const sections = [];
  let current = [];
  for (const line of lines) {
    if (/^\s*#{1,2}\s+/.test(line) && current.length) {
      const block = current.join("\n").trim();
      if (block) sections.push(block);
      current = [line];
      continue;
    }
    current.push(line);
  }
  const last = current.join("\n").trim();
  if (last) sections.push(last);
  return sections;
}

function toSections(content, fileName) {
  return splitByHeadings(content)
    .map((block, index) => {
      const firstLine = block.split("\n")[0]?.trim() || "";
      const title = firstLine.replace(/^\s*#{1,6}\s*/, "").replace(/[\[\]]/g, "").trim().slice(0, 120);
      return {
        id: `${fileName}#${index + 1}`,
        fileName,
        title,
        text: block,
        normalized: normalizeText(block),
        tokens: tokenize(block),
      };
    });
}

function scoreSection(section, queryNorm, queryTokens) {
  let score = 0;
  const normalizedTitle = normalizeText(section.title || "");
  const normalizedText = section.normalized || "";
  const fileName = section.fileName?.toLowerCase() || "";
  
  // High score if the title contains ANY of the query tokens (especially Course Names)
  for (const token of queryTokens) {
    if (token.length < 3) continue; // skip small tokens
    if (normalizedTitle.includes(token)) score += 20;
    if (normalizedText.includes(token)) score += 5;
  }
  
  if (queryNorm.includes("temario") && normalizedTitle.includes("temario")) score += 150;
  if (queryNorm.includes("temario") && normalizedText.includes("temario")) score += 50;

  // Extra points for whole query match in title
  if (normalizedTitle && queryNorm && (queryNorm.includes(normalizedTitle) || normalizedTitle.includes(queryNorm))) {
    score += 100;
  }

  // PRICING REINFORCEMENT
  const priceKeywords = ["cuanto", "cost", "preci", "VALOR", "PAGO", "CUESTA", "COTIZA", "PRECIO"];
  const isAskingPrice = priceKeywords.some(kw => queryNorm.includes(normalizeText(kw)));
  if (isAskingPrice) {
    if (normalizedTitle.includes("preci") || normalizedTitle.includes("cost") || normalizedTitle.includes("valor")) {
      score += 200;
    }
    if (normalizedText.includes("costo") || normalizedText.includes("precio")) {
      score += 100;
    }
  }

  // CATEGORY BOOST: Dinámico basado en ITEM_NAME o palabras clave
  const categoryKeywords = ITEM_NAME.toLowerCase().split(/[\/\s,]+/).filter(k => k.length > 3);
  const matchedCategory = categoryKeywords.some(kw => queryNorm.includes(kw));
  if (matchedCategory) {
    score += 100;
  }

  // LOCATION BOOST: Enhanced detection for address/location
  const locationKeywords = ["donde", "ubicacion", "ciudad", "pais", "sucursal", "direccion", "ubicados", "ubican", "encuentran"];
  const isLocationQuery = locationKeywords.some(kw => queryNorm.includes(normalizeText(kw)));
  if (isLocationQuery) {
    if (fileName.includes("faq") || fileName.includes("info")) score += 300;
    if (normalizedTitle.includes("ubicacion") || normalizedTitle.includes("donde") || normalizedTitle.includes("direccion")) score += 200;
  }
  
  // PRODUCT/SERVICE BOOST: Basado en FOCUS_KEYWORDS de la env
  const isProductQuery = FOCUS_KEYWORDS.some(kw => queryNorm.includes(kw));
  
  if (isProductQuery) {
    score += 150;
  }

  return score;
}

async function getNotebookContext(question, tenantId, isGreeting = false, history = []) {
  if (isGreeting) return "";
  const sections = await loadNotebookSections(tenantId);
  const { userLabel } = getTenantPaths(tenantId);
  
  // Normalize current question
  const queryNorm = normalizeText(question);
  const queryTokens = tokenize(question);

  // Normalize history for secondary context
  let historyNorm = "";
  let historyTokens = [];
  if (history.length > 0) {
    historyNorm = normalizeText(history.slice(-3).map(m => {
      if (typeof m.content === 'string') return m.content;
      return "";
    }).join(" "));
    historyTokens = tokenize(historyNorm);
  }

  // KEYWORD SCORING
  const scored = sections.map(section => {
    let score = scoreSection(section, queryNorm, queryTokens);
    
    // Background history matching (lower weight)
    if (historyTokens.length > 0) {
      let historyScore = scoreSection(section, historyNorm, historyTokens);
      score += historyScore * 0.25; // History keywords weighted at 25%
    }

    return { section, score };
  })
  .filter(i => i.score > 5)
  .sort((a, b) => b.score - a.score)
  .slice(0, 50);

  // VECTOR SEARCH (Cleaned of User Name)
  const collection = process.env.QDRANT_COLLECTION || "smartbis_notebook";
  let vectorResults = [];
  const vectorQuery = question.replace(new RegExp(process.env.USER_LABEL || "", "gi"), "").trim();
  
  if (vectorQuery.length > 3) {
      try {
        const results = await searchVectors(vectorQuery, 30, collection);
        vectorResults = results.map(r => ({
          section: {
            id: `vec_${collection}_${r.id}`,
            fileName: r.payload?.fileName || "vector_db",
            title: r.payload?.title || "Relevancia semántica",
            text: r.payload?.text || "",
          },
          score: r.score * 100 
        }));
      } catch (vErr) {
          console.error(`[QDRANT-FAIL] Falling back to keyword-only search:`, vErr.message);
      }
  }

  // DEDUPLICATE AND MERGE
  const finalMap = new Map();
  [...scored, ...vectorResults].forEach(item => {
    const key = (item.section.title + item.section.fileName).toLowerCase();
    if (!finalMap.has(key) || finalMap.get(key).score < item.score) {
      finalMap.set(key, item);
    }
  });

  const finalChunks = Array.from(finalMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 100);

  let contextString = finalChunks.map(i => `[FILE: ${i.section.fileName}] ${i.section.text}`).join('\n\n');
  
  // ADD CALENDAR
  try {
    const data = await readFile(EVENTS_FILE, "utf8");
    const events = JSON.parse(data);
    const now = new Date();
    const filterDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const isoFilter = filterDate.toLocaleString('sv-SE', { timeZone: TIMEZONE }).split(' ')[0];
    const relevantEvents = events
      .filter(e => e.date >= isoFilter)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 15);

    const eventsText = "\n\n# EVENTOS Y CALENDARIO PRÓXIMO:\n" + 
      relevantEvents.map(e => `- [${e.date}] ${e.title} (${e.details?.Modalidad || ""})`).join('\n');
    
    contextString += eventsText;
  } catch (e) { console.error("Calendar ctx error:", e.message); }

  return contextString;
}

// ============================================
// MESSENGER INTEGRATION
// ============================================
async function getMessengerUserInfo(psid, tenantId) {
    const { fbToken } = getTenantPaths(tenantId);
    if (!fbToken) return null;
    try {
        const url = `https://graph.facebook.com/v19.0/${psid}?fields=first_name,last_name,profile_pic&access_token=${fbToken}`;
        const res = await axios.get(url);
        if (res.data && res.data.first_name) {
            userProfileCache.set(psid, { 
                name: `${res.data.first_name} ${res.data.last_name || ""}`.trim(),
                pic: res.data.profile_pic,
                whatsapp: "",
                email: "",
                notes: ""
            });
            saveProfiles(); // CRITICAL: Save to disk
            return res.data;
        }
    } catch (e) { /* Silently fail if not verified or error */ }
    return null;
}
async function sendToMessenger(psid, text, tenantId) {
  const { fbToken } = getTenantPaths(tenantId);
  if (!fbToken) return console.warn(`No FB token for tenant ${tenantId}`);
  try {
    await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${fbToken}`, {
      recipient: { id: psid },
      message: { text }
    });
  } catch (e) { console.error("FB Send Error:", e.response?.data || e.message); }
}


// Universal Sender Dispatcher
async function sendUniversalMessage(psid, text, tenantId = "default") {
    if (psid.includes("@s.whatsapp.net") || psid.includes("@lid")) {
        return await sendWhatsAppMessage(psid, text);
    } else {
        return await sendToMessenger(psid, text, tenantId);
    }
}

async function sendUniversalImage(psid, imageUrl, caption, tenantId = "default") {
    if (psid.includes("@s.whatsapp.net") || psid.includes("@lid")) {
        return await sendWhatsAppImage(psid, imageUrl, caption || "");
    } else {
        return await sendImageToMessenger(psid, imageUrl, tenantId);
    }
}

async function sendImageToMessenger(psid, imageUrl, tenantId) {
  const { fbToken } = getTenantPaths(tenantId);
  if (!fbToken) return console.warn(`No FB token for tenant ${tenantId}`);
  try {
    await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${fbToken}`, {
      recipient: { id: psid },
      message: {
        attachment: {
          type: "image",
          payload: { url: imageUrl, is_reusable: true }
        }
      }
    });
    console.log(`[IMG] Sent payment image to ${psid}`);
  } catch (e) { console.error("FB Image Send Error:", e.response?.data || e.message); }
}

async function sendAction(psid, action, tenantId) {
  const { fbToken } = getTenantPaths(tenantId);
  if (!fbToken) return;
  try {
    await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${fbToken}`, {
      recipient: { id: psid },
      sender_action: action
    });
  } catch {}
}

// ============================================
// Global lock to prevent concurrent AI runs for the same user
const activeRequests = new Set();

// AI + FUNCTION CALLING
// ============================================
async function getAdminSkillsContext() {
    try {
        const skillsDir = path.resolve(process.cwd(), "skills");
        if (!fs.existsSync(skillsDir)) return "";
        const files = await readdir(skillsDir);
        let context = "\n\n# TUS SKILLS DISPONIBLES (INSTRUCCIONES TÉCNICAS):\n";
        for (const f of files) {
            if (f.endsWith(".md")) {
                const content = await readFile(path.join(skillsDir, f), "utf8");
                context += `\n--- SKILL: ${f} ---\n${content}\n`;
            }
        }
        return context;
    } catch (e) { return ""; }
}

// AI + FUNCTION CALLING
// ============================================
async function askAI(text, psid, tenantId, attachments = []) {
  // Wait if there's an active request for this PSID (simple retry loop)
  let attempts = 0;
  while (activeRequests.has(psid) && attempts < 10) {
    console.log(`[AI] Waiting for PSID ${psid} to be free (attempt ${attempts+1})...`);
    await new Promise(r => setTimeout(r, 2000));
    attempts++;
  }

  if (activeRequests.has(psid)) {
    console.log(`[AI] FORCED BLOCK concurrent PSID: ${psid} after timeout.`);
    return "procesando...";
  }
  activeRequests.add(psid);

  try {
    const session = chatSessions.get(psid) || { messages: [], updatedAt: Date.now() };
    if (!chatSessions.has(psid)) chatSessions.set(psid, session);

    // 0. Check if it's Admin
    const cleanPsid = psid.split(':')[0];
    const isAdmin = waConfig.adminNumbers.some(a => normalizeJid(a) === normalizeJid(cleanPsid)) || (BOT_ADMIN_PSID && cleanPsid === BOT_ADMIN_PSID);

    // 1. Load System Prompt
    const { prompt: clientPromptPath } = getTenantPaths(tenantId);
    const adminPromptPath = path.resolve(process.cwd(), "soul-agent", "prompt.md");
    
    const selectedPath = isAdmin ? adminPromptPath : clientPromptPath;
    let system = DEFAULT_SYSTEM_PROMPT;
    try {
      const content = await readFile(selectedPath, "utf8");
      system = content.trim() || DEFAULT_SYSTEM_PROMPT;
      
      if (isAdmin) {
          const skillsCtx = await getAdminSkillsContext();
          system += skillsCtx;
          const pendingTickets = ticketsStore.filter(t => ["registrado", "pendiente_pago", "pendiente_aprobacion", "pendiente_datos"].includes(t.status));
          if (pendingTickets.length > 0) {
              system += "\n\n# TICKETS PENDIENTES ACTUALES (PARA TU ACCIÓN INMEDIATA):\n" + 
                  pendingTickets.map(t => {
                      const details = t.type === 'inscripcion' ? `Curso: ${t.data.curso}` : t.type === 'cita' ? `Cita: ${t.data.fecha} @ ${t.data.horario}` : `Compra: ${t.data.productos}`;
                      return `- ID: [${t.id}] | Cliente: ${t.data.nombre || 'N/D'} | ${details} | Monto: ${t.data.monto || 'N/D'}`;
                  }).join('\n') + 
                  "\n\nINSTRUCCIÓN: Si el Jefe dice 'Aprobado' o 'Listo' sin especificar ID, asume que se refiere al ticket MÁS RECIENTE de la lista anterior y ejecútalo de inmediato.";
          }
      }
    } catch (err) {
      console.error(`[AI] Error reading prompt from ${selectedPath}: ${err.message}`);
      system = DEFAULT_SYSTEM_PROMPT;
    }

    // --- 2. PREPARE CONTEXT & METADATA ---
    const history = session.messages || [];
    const referral = session.referral;
    const hasAttachments = attachments && attachments.length > 0;
    const isGreeting = hasAttachments ? false : isGreetingOnly(text);

    // Identity
    let profile = userProfileCache.get(psid);
    if (!profile) {
        profile = { name: psid, whatsapp: "", email: "", notes: "" };
        userProfileCache.set(psid, profile);
        saveProfiles();
    }

    // Auto-detect referral from text
    const adKeywords = [
        "vi esto en facebook", "vi el anuncio", "más información sobre el curso", 
        "información de la promoción", "vi un anuncio", "vengo del anuncio", 
        "mas informacion", "me interesa el producto", "me interesa el curso",
        "precio por favor", "costo por favor", "info por favor", "quiero mas info",
        "hola me interesa", "vi tu publicidad"
    ];
    let autoAdCtx = "";
    if (!referral && text) {
        const normT = normalizeText(text);
        const match = adKeywords.some(k => normT.includes(normalizeText(k)));
        if (match) {
            autoAdCtx = `\n\n[PROVINIENCIA PROBABLE]: El usuario parece venir de un ANUNCIO o PUBLICIDAD por el tipo de mensaje inicial ("${text}").`;
            autoAdCtx += `\nINSTRUCCIÓN CORE: No preguntes "¿qué te interesa?", mejor sé proactivo y ofrece de inmediato la información más relevante de nuestro catálogo o pregunta si viene por una promoción vigente de forma amable.`;
        }
    }

    // --- 3. PREPARE SEARCH QUERY (RAG) ---
    let searchText = text;
    if (referral) {
        const adTitle = referral.ads_context_data?.ad_title || referral.headline || referral.body || "";
        if (adTitle && text.includes("(cliente entró por el anuncio)")) {
            searchText = `${adTitle} (referral auto-trigger)`;
        } else if (adTitle) {
            searchText = `${text} (relacionado con anuncio: ${adTitle})`;
        }
    } else if (autoAdCtx) {
        searchText = `${text} (interés en promociones o productos generales de Facebook)`;
    }

    // NEW: Payment Intent Reinforcement
    let paymentReinforcement = "";
    const lowerT = normalizeText(text || "");
    if (lowerT.includes("pagar") || lowerT.includes("inscrip") || lowerT.includes("metodo") || lowerT.includes("cuenta") || lowerT.includes("clabe") || lowerT.includes("tarjeta")) {
        paymentReinforcement = `\n[INSTRUCCIÓN DE ALTA PRIORIDAD]: Si en tu respuesta vas a entregar métodos de pago de México, DEBES llamar a la herramienta 'send_payment_methods' de forma simultánea. Decirlo por texto no es suficiente, la imagen solo se envía mediante la herramienta.`;
    }

    const context = await getNotebookContext(searchText, tenantId, isGreeting, history);

    // 3. Referral Priority Context
    let referralInjection = "";
    if (referral) {
      const adTitle = referral.ads_context_data?.ad_title || referral.headline || referral.body || referral.ref || "";
      const adFuente = referral.source || "N/D";
      const idDelAnuncio = referral.ad_id || "N/D";
      const adRef = referral.ref || "";
      
      referralInjection = `\n\n### [CONTEXTO CRÍTICO: ANUNCIO DE FACEBOOK] ###\n`;
      referralInjection += `EL USUARIO VIENE DE UN ANUNCIO ESPECÍFICO. ES TU PRIORIDAD ABSOLUTA.\n`;
      if (adTitle) referralInjection += `- TÍTULO DEL ANUNCIO: "${adTitle}"\n- INSTRUCCIÓN: Este título te dice EXACTAMENTE de qué curso o producto quiere información. No preguntes "en qué curso estás interesado", asume que es el de este título.\n`;
      referralInjection += `- Fuente: ${adFuente} | AdID: ${idDelAnuncio}\n`;
      if (adRef) referralInjection += `- Referencia (ref): ${adRef}\n`;
      referralInjection += `- ACCIÓN: Saluda reconociendo que viene del anuncio y dale la información de ese curso/producto de inmediato usando el formato oficial.\n`;
      referralInjection += `###########################################\n\n`;
    }

    // 4. Time Awareness
    const now = new Date();
    const localIsoDate = now.toLocaleString('sv-SE', { timeZone: TIMEZONE }).split(' ')[0];
    const localDayName = now.toLocaleDateString('es-MX', { timeZone: TIMEZONE, weekday: 'long' });
    const localTimeStr = now.toLocaleString('es-MX', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: true });

    const EVENT_LOOKBACK_DAYS = Number(process.env.EVENT_LOOKBACK_DAYS || 30);
    const EVENT_MAX_CONTEXT = Number(process.env.EVENT_MAX_CONTEXT || 15);
    
    const startDate = new Date(now.getTime() - EVENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const filterIsoDate = startDate.toLocaleString('sv-SE', { timeZone: TIMEZONE }).split(' ')[0];

    const nextEvents = eventsStore
      .filter(e => e.date >= filterIsoDate)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, EVENT_MAX_CONTEXT);

    let eventsCtx = "";
    if (nextEvents.length > 0) {
      const header = ITEM_NAME.toUpperCase() + "S PROGRAMADOS";
      eventsCtx = `\n\n# ${header}:\n${nextEvents.map(e => {
        const modality = e.details?.Modalidad || e.details?.modalidad || "";
        const modalityStr = modality ? ` (${modality})` : "";
        return `- [${e.date}] ${e.title}${modalityStr}`;
      }).join('\n')}`;
    }

    const configCtx = `\n# REGLAS DE CITAS:\n- Horario: ${appointmentConfig.startTime} a ${appointmentConfig.endTime} (Sáb: ${appointmentConfig.saturdayEndTime})\n- Descanso: ${appointmentConfig.skipDays || "0"}`;
    const localFullIso = now.toLocaleString('sv-SE', { timeZone: TIMEZONE }).replace(' ', 'T');
    const timeInjection = `\n\n[FECHA ACTUAL]: ${localDayName}, ${localIsoDate} | [HORA ACTUAL]: ${localTimeStr} | [ISO ACTUAL]: ${localFullIso}\n(Cerrado los domingos). ${configCtx}${eventsCtx}`;

    // --- 6. AUTOMATIC RECORDING OF LEADS ---

    // --- AUTOMATIC FIRST-MESSAGE RECORDING ---
    let profileChanged = false;
    if (history.length === 0) {
        const timestamp = new Date().toLocaleDateString('es-MX');
        
        // 1. Auto-record ad provenance
        if (referral) {
            const adTitle = referral.ads_context_data?.ad_title || referral.headline || referral.body || referral.ref || "";
            const adInfo = `[ADS] Fuente: ${referral.source || 'N/D'} | AdID: ${referral.ad_id || 'N/D'}${adTitle ? ' | Título: ' + adTitle : ''}`;
            if (!profile.notes.includes("[ADS]") && !profile.notes.includes(referral.ad_id || "MISSING")) {
                profile.notes = (profile.notes + "\n" + `[${timestamp}] ` + adInfo).trim();
                profileChanged = true;
            }
        } else if (autoAdCtx && !profile.notes.includes("[AUTO-AD]")) {
            const adInfo = `\n[${timestamp}] [AUTO-AD] Detección automática de anuncio por mensaje inicial: "${text.substring(0, 50)}..."`;
            profile.notes = (profile.notes + adInfo).trim();
            profileChanged = true;
        }

        // 2. Auto-extract possible name if current name is an ID
        const isCurrentId = /^\d+$/.test(profile.name) || profile.name.includes('@') || profile.name === "Desconocido" || profile.name === psid;
        if (isCurrentId && text) {
            const nameRegex = /\b(?:me llamo|soy|mi nombre es)\s+([A-ZÁÉÍÓÚ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚ][a-záéíóúñ]+){0,2})\b/i;
            const match = text.match(nameRegex);
            if (match && match[1] && match[1].length > 2) {
                profile.name = match[1].trim();
                profileChanged = true;
            }
        }

        if (profileChanged) {
            userProfileCache.set(psid, profile);
            saveProfiles();
        }
    }
    // ------------------------------------------

    const identityCtx = `\n\n[IDENTIDAD DEL USUARIO]: Nombre=${profile.name || 'Desconocido'}, Email=${profile.email || 'N/D'}, WA=${profile.whatsapp || 'N/D'}\n[NOTAS DEL PERFIL]: ${profile.notes || 'Sin notas'}`;
    const platformCtx = `\n\n[PLATAFORMA]: Estás hablando por ${psid.includes('@') ? 'WhatsApp' : 'Messenger'}.`;
    const plat = psid.includes('@') ? 'WhatsApp' : 'Messenger';
    logDebug("AI-Preload", `User: ${profile.name} | Plat: ${plat} | Referral: ${!!referral} | AutoAd: ${!!autoAdCtx}`);

    const userMessageContent = [];
    if (text) userMessageContent.push({ type: "text", text: text });
    
    if (attachments.length > 0) {
      const imageAttachments = attachments.filter(a => a.type === "image");
      if (imageAttachments.length > 0) {
          const lastImage = imageAttachments[imageAttachments.length - 1];
          
          for (const img of imageAttachments) {
              let currentUrl = img.payload?.url || "";
              if (img.isWhatsApp && img.msg) {
                  const buffer = await downloadWAImage(img.msg);
                  if (buffer) {
                      const mime = img.msg.message?.imageMessage?.mimetype || "image/jpeg";
                      const base64 = buffer.toString('base64');
                      currentUrl = `data:${mime};base64,${base64}`;
                      userMessageContent.push({ 
                        type: "image_url", 
                        image_url: { url: currentUrl } 
                      });
                  }
              } else {
                  currentUrl = img.payload.url;
                  let added = false;
                  if (currentUrl && fs.existsSync(currentUrl)) {
                      try {
                          const base64 = fs.readFileSync(currentUrl, 'base64');
                          const ext = currentUrl.split('.').pop()?.toLowerCase() || 'jpeg';
                          const mime = ["jpg", "jpeg"].includes(ext) ? "image/jpeg" : "image/png";
                          userMessageContent.push({ type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } });
                          added = true;
                      } catch (e) { logError("AI-Image-Read", e); }
                  }
                  
                  if (!added) {
                      userMessageContent.push({ type: "image_url", image_url: { url: currentUrl } });
                  }
              }
              session.lastImageUrl = currentUrl;
              userMessageContent.push({ type: "text", text: `[Imagen adjunta]` });
          }
      }
    }

    if (userMessageContent.length === 0) {
      userMessageContent.push({ type: "text", text: "(mensaje vacío)" });
    }

    // 6. OpenAI Request
    const client = new OpenAI({ apiKey: XAI_API_KEY, baseURL: "https://api.x.ai/v1" });
    const greetingInstruction = isGreeting 
      ? "\nResponde de forma amable al saludo." 
      : "\nResponde basándote en el contexto y usa herramientas si es necesario.";

    if (isAdmin && !isGreeting) {
       userMessageContent.push({ 
         type: "text", 
         text: "[ADMIN-FORCE-REMINDER] Recuerda: Si el Jefe te está pidiendo un cambio (Cita, Curso, Venta, Bloqueo), ES OBLIGATORIO que LLAMES A LA HERRAMIENTA CORRESPONDIENTE AHORA MISMO. No confirmes sin llamar a la herramienta."
       });
    }

    const messages = [
      { role: "system", content: system + "\n\n# CONTEXTO DEL USUARIO:\n" + identityCtx + platformCtx + referralInjection + autoAdCtx + paymentReinforcement + "\n\n# CONTEXTO DEL NOTEBOOK:\n" + context + timeInjection + greetingInstruction },
      ...history,
      { role: "user", content: userMessageContent }
    ];

    const currentTools = isAdmin 
      ? [ ...ADMIN_TOOLS, ...AI_TOOLS.filter(t => !["create_appointment_request", "check_availability"].includes(t.function.name)) ] 
      : AI_TOOLS;

    const requestParams = { model: XAI_MODEL, messages };
    requestParams.tools = currentTools;
    requestParams.tool_choice = (isAdmin && !isGreeting) ? "required" : "auto";
    
    const response = await client.chat.completions.create(requestParams);
    const choice = response.choices[0];
    
    // 6. Handle Tool Calls
    if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
      logDebug("AI-Tools", `Call count: ${choice.message.tool_calls.length} | Tools: ${choice.message.tool_calls.map(c => c.function.name).join(", ")}`);
      const toolResults = [];
      const usedCalls = new Set();
      for (const call of choice.message.tool_calls) {
        const callHash = `${call.function.name}:${call.function.arguments}`;
        if (usedCalls.has(callHash)) continue;
        usedCalls.add(callHash);

        let args = {};
        try { args = JSON.parse(call.function.arguments); } catch {}
        
        let targetPsid = psid;
        if (isAdmin && args.whatsapp) {
            targetPsid = normalizeJid(args.whatsapp);
        }
        
        console.log(`[TOOL] Calling ${call.function.name} | Args: ${JSON.stringify(args).substring(0, 200)} | Target: ${targetPsid}`);
        let result = { success: false, message: "Función no encontrada." };

        if (call.function.name === "send_payment_methods") {
          await sendUniversalImage(targetPsid, PAYMENT_IMAGE_URL, "Aquí tienes nuestros métodos de pago.", tenantId);
          result = { success: true, message: "Métodos de pago enviados." };
        } else if (call.function.name === "create_enrollment_ticket") {
          updateUserProfileFromArgs(targetPsid, args);
          let actualImage = null;
          if (args.comprobante_url && String(args.comprobante_url).trim().length > 0) {
              actualImage = session.lastImageUrl;
              if (args.comprobante_url.startsWith('http') || args.comprobante_url.startsWith('/app')) {
                  actualImage = args.comprobante_url;
              }
              session.lastImageUrl = null; // Consume image
          }

          const t = createTicket(targetPsid, "inscripcion", { ...args, comprobante_url: actualImage }, tenantId);
          
          if (!actualImage) {
              t.status = "pendiente_pago";
              await saveTickets(tenantId);
              result = { success: true, ticket_id: t.id, message: "Pre-inscripción registrada correctamente en el sistema. Espera el pago." };
              
              const adminMsg = `⏳ *NUEVO INTERESADO (PENDIENTE DE PAGO)*
Ticket: #${t.id}
Nombre: ${args.nombre || 'N/D'}
Curso: ${args.curso || 'N/D'}
Whatsapp: ${args.whatsapp || 'N/D'}
Correo: ${args.email || 'N/D'}`;
              await sendToAdmins(adminMsg);
          } else {
              t.status = "registrado";
              await saveTickets(tenantId);
              result = { success: true, ticket_id: t.id, message: "Inscripción finalizada con comprobante." };

              const adminMsg = `📌 *NUEVA INSCRIPCIÓN (PAGADA)*
Ticket: #${t.id}
Nombre: ${args.nombre || 'N/D'}
Curso: ${args.curso || 'N/D'}
Localidad: ${args.localidad || 'N/D'}
Whatsapp: ${args.whatsapp || 'N/D'}
Correo: ${args.email || 'N/D'}
Modalidad: ${args.modalidad || 'N/D'}

Comprobante enviado adjunto.`;
              await sendToAdmins(adminMsg, actualImage);
          }
        } else if (call.function.name === "create_purchase_ticket") {
          updateUserProfileFromArgs(targetPsid, args);
          let actualImage = null;
          if (args.comprobante_url && String(args.comprobante_url).trim().length > 0) {
              actualImage = session.lastImageUrl;
              if (args.comprobante_url.startsWith('http') || args.comprobante_url.startsWith('/app')) {
                  actualImage = args.comprobante_url;
              }
              session.lastImageUrl = null; // Consume image
          }

          const t = createTicket(targetPsid, "compra", { ...args, comprobante_url: actualImage }, tenantId);
          result = { success: true, ticket_id: t.id, message: "Pedido registrado con éxito." };
          
          const adminMsg = `🛒 *NUEVO PEDIDO*
Ticket: #${t.id}
Tipo: ${args.tipo_entrega === "sucursal" ? "RECOGER EN SUCURSAL" : "ENVÍO A DOMICILIO"}
Nombre: ${args.nombre || 'N/D'}
Productos: ${args.productos || 'N/D'}
Total: ${args.total || 'N/D'}
Ubicacion: ${args.localidad || 'N/D'}
Whatsapp: ${args.whatsapp || 'N/D'}`;

          await sendToAdmins(adminMsg, actualImage);
        } else if (call.function.name === "check_availability") {
          const manualBlocks = eventsStore.map(e => ({ start: new Date(e.date), end: new Date(e.date), title: e.title, date: e.date }));
          const slots = await getAvailableSlots(args.fecha, appointmentConfig, args.dias || appointmentConfig.displayDays || 1, ticketsStore, manualBlocks);
          result = { success: true, slots: slots.filter(s => !s.isBusy) };
        } else if (call.function.name === "create_appointment_request") {
          // 1. Robust Time Parsing (Same as used for generating labels)
          const cleanHourStr = args.horario.replace(/\s*[ap]\.?m\.?/i, '').trim(); 
          const isPM = args.horario.toLowerCase().includes('p.m.') || args.horario.toLowerCase().includes('pm');
          let hourNum = parseInt(cleanHourStr.split(':')[0]);
          const minNum = parseInt(cleanHourStr.split(':')[1] || "0");
          if (isPM && hourNum < 12) hourNum += 12;
          if (!isPM && hourNum === 12) hourNum = 0;
          
          // Generate the exact label used by getAvailableSlots
          const displayHours = hourNum % 12 || 12;
          const labelAMPM = hourNum >= 12 ? 'p.m.' : 'a.m.';
          const targetLabel = `${displayHours}:${minNum.toString().padStart(2, '0')} ${labelAMPM}`;
          
          console.log(`[CALENDAR] Searching for exact overlap for ${targetLabel} (${args.horario}) on ${args.fecha}`);
          
          // 2. Final server-side availability check
          const slots = await getAvailableSlots(args.fecha, appointmentConfig, 1, ticketsStore);
          const isTaken = slots.some(s => {
              // Exact match or highly normalized match
              const sNorm = s.label.toLowerCase().replace(/\./g, '').replace(/\s/g, '');
              const tNorm = targetLabel.toLowerCase().replace(/\./g, '').replace(/\s/g, '');
              return (sNorm === tNorm && s.isBusy);
          });
          
          if (isTaken) {
            result = { success: false, message: `Lo siento, el horario ${args.horario} para el ${args.fecha} ya no está disponible. Por favor, ofrece otros horarios al usuario.` };
          } else {
            // Check if the slot actually exists in the valid slots for that day
            const slotExists = slots.some(s => {
                const sNorm = s.label.toLowerCase().replace(/\./g, '').replace(/\s/g, '');
                const tNorm = targetLabel.toLowerCase().replace(/\./g, '').replace(/\s/g, '');
                return sNorm === tNorm;
            });

            if (!slotExists) {
               result = { success: false, message: `El horario ${args.horario} no es un intervalo válido. Por favor consulta la disponibilidad primero.` };
            } else {
                // Generate ISO timestamps on server
                const startISO = `${args.fecha}T${hourNum.toString().padStart(2, '0')}:${minNum.toString().padStart(2, '0')}:00`;
                const durationHours = Math.floor(appointmentConfig.durationMinutes / 60);
                const durationMinRem = appointmentConfig.durationMinutes % 60;
                let endHour = hourNum + durationHours;
                let endMin = minNum + durationMinRem;
                if (endMin >= 60) { endHour += 1; endMin -= 60; }
                const endISO = `${args.fecha}T${endHour.toString().padStart(2, '0')}:${endMin.toString().padStart(2, '0')}:00`;

                updateUserProfileFromArgs(targetPsid, args);
                const t = createTicket(targetPsid, "cita", { ...args, horario: targetLabel, start_iso: startISO, end_iso: endISO }, tenantId);
                
                // AUTO-APPROVE as requested by user
                t.status = "aprobado";
                await saveTickets(tenantId);
                
                result = { success: true, ticket_id: t.id, message: `La cita ha sido AGENDADA Y CONFIRMADA automáticamente para el ${args.fecha} a las ${targetLabel} por el motivo: ${args.motivo}.` };
                
                // Skip sending redundant direct message here, let AI reply
                // await sendUniversalMessage(psid, `¡Tu cita ha sido confirmada automáticamente! ✅ Te esperamos el día ${args.fecha} a las ${targetLabel} para tu ${args.motivo}.`, tenantId);

                const adminMsg = `📅 *NUEVA CITA AGENDADA*
${args.nombre || 'N/D'} a agendado una cita para el dia ${args.fecha} a las ${targetLabel}
motivo: ${args.motivo || 'N/D'}
whatsapp: ${args.whatsapp || 'N/D'}`;

                await sendToAdmins(adminMsg);
                
                // Context injection for admins (so they know the appointment exists)
                for (const adminNum of waConfig.adminNumbers) {
                    const adminJid = normalizeJid(adminNum);
                    const adminSession = chatSessions.get(adminJid) || { messages: [], updatedAt: Date.now() };
                    adminSession.messages.push({ role: "assistant", content: adminMsg });
                    chatSessions.set(adminJid, adminSession);
                }
            }
          }
        } else if (call.function.name === "save_user_note") {
            const profile = userProfileCache.get(targetPsid) || { name: targetPsid, whatsapp: "", email: "", notes: "" };
            const timestamp = new Date().toLocaleDateString('es-MX');
            profile.notes = (profile.notes + `\n[${timestamp}] ${args.nota}`).trim();
            userProfileCache.set(targetPsid, profile);
            saveProfiles();
            result = { success: true, message: "Nota guardada en el perfil del cliente." };
        } else if (call.function.name === "update_user_identity") {
            updateUserProfileFromArgs(targetPsid, args);
            result = { success: true, message: "Identidad del usuario actualizada con éxito." };
        } else if (call.function.name === "admin_create_appointment" && isAdmin) {
          console.log(`[ADMIN-TOOL] Ejecutando admin_create_appointment con args:`, JSON.stringify(args));
          try {
            // Robust Time Parsing (Same as client-side)
            const cleanHourMatch = args.horario.match(/(\d+):?(\d+)?/);
            if (!cleanHourMatch) throw new Error("Horario no reconocido. Usa ej: 10:00 AM");
            
            const isPM = args.horario.toLowerCase().includes('p.m.') || args.horario.toLowerCase().includes('pm');
            let hourNum = parseInt(cleanHourMatch[1]);
            const minNum = parseInt(cleanHourMatch[2] || "0");
            if (isPM && hourNum < 12) hourNum += 12;
            if (!isPM && hourNum === 12) hourNum = 0;
            
            const displayHours = hourNum % 12 || 12;
            const labelAMPM = hourNum >= 12 ? 'p.m.' : 'a.m.';
            const targetLabel = `${displayHours}:${minNum.toString().padStart(2, '0')} ${labelAMPM}`;

            const startISO = `${args.fecha}T${hourNum.toString().padStart(2, '0')}:${minNum.toString().padStart(2, '0')}:00`;
            const durationMin = appointmentConfig.durationMinutes || 60;
            const durationHours = Math.floor(durationMin / 60);
            const durationMinRem = durationMin % 60;
            let endHour = hourNum + durationHours;
            let endMin = minNum + durationMinRem;
            if (endMin >= 60) { endHour += 1; endMin -= 60; }
            const endISO = `${args.fecha}T${endHour.toString().padStart(2, '0')}:${endMin.toString().padStart(2, '0')}:00`;

            // ADMIN: Always create a NEW ticket (never reuse existing)
            const now = new Date();
            const localISO = now.toLocaleString('sv-SE', { timeZone: TIMEZONE }).replace(' ', 'T');
            const profile = userProfileCache.get(targetPsid) || { whatsapp: "" };

            const ticket = {
              id: generateTicketId(),
              type: "cita",
              status: "aprobado",
              psid: targetPsid,
              tenantId: tenantId || "default",
              createdAt: localISO,
              updatedAt: localISO,
              data: {
                fecha: args.fecha,
                horario: targetLabel,
                nombre: args.nombre || "El Jefe (Agendado Directo)",
                whatsapp: args.whatsapp || profile.whatsapp || "N/D",
                motivo: args.motivo || "Cita de Oficina / Jefe",
                start_iso: startISO,
                end_iso: endISO
              },
              adminNotes: "Creado directamente por admin",
              rejectReason: "",
              messages: []
            };
            ticketsStore.push(ticket);
            if (ticketsStore.length > 500) ticketsStore = ticketsStore.slice(-500);
            await saveTickets(tenantId);
            
            console.log(`[ADMIN-TOOL] Cita creada: ${ticket.id} | ${args.fecha} ${targetLabel} | ${args.nombre || 'El Jefe'}`);
            result = { success: true, ticket_id: ticket.id, message: `Cita agendada exitosamente: ${args.nombre || 'El Jefe'} el ${args.fecha} a las ${targetLabel}. Ticket: ${ticket.id}` };
          } catch (e) {
            console.error(`[ADMIN-TOOL] Error en admin_create_appointment:`, e);
            result = { success: false, message: `Error agendando cita: ${e.message}` };
          }
        } else if (call.function.name === "admin_add_inventory_item" && isAdmin) {
            const { notebook: nbPath } = getTenantPaths(tenantId);
            const targetFile = path.join(nbPath, args.fileName);
            
            try {
                const newItem = `\n\n### ${args.name}\n- **Categoría:** ${args.category || 'Varios'}\n- **Descripción:** ${args.description || 'Sin descripción'}\n- **Precio:** ${args.price}\n- **Actualizado:** ${new Date().toLocaleDateString()}\n`;
                await fs.promises.appendFile(targetFile, newItem);
                // Clear notebook cache so RAG picks up the change
                tenantCaches.delete(tenantId);
                result = { success: true, message: `Jefe, he añadido "${args.name}" al archivo ${args.fileName} correctamente.` };
            } catch (e) {
                result = { success: false, message: `Error modificando base de datos: ${e.message}` };
            }
        } else if (call.function.name === "admin_list_tickets" && isAdmin) {
            const status = args.status || "registrado";
            const limit = args.limit || 10;
            const filtered = ticketsStore
                .filter(t => status === "todos" || t.status === status)
                .slice(-limit);
            result = { success: true, tickets: filtered.map(t => ({ id: t.id, status: t.status, nombre: t.data.nombre, curso: t.data.curso, type: t.type })) };
        } else if (call.function.name === "admin_update_ticket" && isAdmin) {
            const { ticketId, status, rejectReason } = args;
            const idx = ticketsStore.findIndex(t => t.id === ticketId);
            if (idx === -1) {
              result = { success: false, message: "Ticket no encontrado." };
            } else {
              const ticket = ticketsStore[idx];
              ticket.status = status;
              if (rejectReason) ticket.rejectReason = rejectReason;
              
              // Notification logic (extracted from old validation callback)
              if (status === "aprobado") {
                if (ticket.type === "inscripcion") {
                  await sendUniversalMessage(ticket.psid, `¡Tus datos y pago para el curso **${ticket.data?.curso}** han sido validados! ✅ Tu registro es oficial.`, ticket.tenantId);
                } else if (ticket.type === "compra") {
                  await sendUniversalMessage(ticket.psid, `¡Tu pedido **${ticket.id}** ha sido aprobado! 🛍️ Comenzaremos con el envío.`, ticket.tenantId);
                } else if (ticket.type === "cita") {
                  await sendUniversalMessage(ticket.psid, `¡Cita confirmada! ✅ Te esperamos el día ${ticket.data.fecha} a las ${ticket.data.horario}.`, ticket.tenantId);
                }
              } else if (status === "rechazado") {
                await sendUniversalMessage(ticket.psid, `Lo sentimos, tu solicitud **#${ticketId}** ha sido rechazada. ❌ Motivo: ${rejectReason || 'No especificado'}`, ticket.tenantId);
              }
              
              await saveTickets(ticket.tenantId);
              result = { success: true, message: `Ticket ${ticketId} actualizado a ${status}.` };
            }
        } else if (call.function.name === "admin_query_calendar" && isAdmin) {
            const dateStr = args.fecha || new Date().toISOString().split('T')[0];
            const manualBlocks = eventsStore.map(e => ({ start: new Date(e.date), end: new Date(e.date), title: e.title, date: e.date }));
            const slots = await getAvailableSlots(dateStr, appointmentConfig, 1, ticketsStore, manualBlocks);
            result = { success: true, slots: slots.map(s => ({ hora: s.label, estado: s.isBusy ? `OCUPADO (${s.busyLabel})` : "LIBRE" })) };
        } else if (call.function.name === "admin_get_agenda" && isAdmin) {
            const dateStr = args.fecha || new Date().toISOString().split('T')[0]; // Use new Date() for current date
            const appointments = ticketsStore.filter(t => t.type === 'cita' && t.status === 'aprobado' && t.data.fecha === dateStr);
            const events = eventsStore.filter(e => e.date === dateStr);
            
            let agenda = `🗓️ Agenda para el ${dateStr}:\n`;
            if (appointments.length === 0 && events.length === 0) {
                agenda += "No hay actividades agendadas para este día.";
            } else {
                if (appointments.length > 0) {
                    agenda += "\n🏥 CITAS:\n" + appointments.map(t => `- ${t.data.horario}: ${t.data.nombre} (${t.data.motivo})`).join('\n');
                }
                if (events.length > 0) {
                    agenda += "\n🎓 EVENTOS/CURSOS:\n" + events.map(e => `- ${e.title}`).join('\n');
                }
            }
            result = { success: true, agenda };
        } else if (call.function.name === "admin_get_metrics" && isAdmin) {
            const dateStr = args.fecha || new Date().toLocaleString('sv-SE', { timeZone: TIMEZONE }).split(' ')[0];
            const logs = metricsLogs.get(tenantId) || [];
            const dayLogs = logs.filter(l => (l.timestamp || "").startsWith(dateStr));
            const uniqueUsers = new Set(dayLogs.map(l => l.psid)).size;
            const messagesExchanged = dayLogs.length;
            
            result = { 
                success: true, 
                metrics: `Resumen del día ${dateStr}: ${uniqueUsers} usuarios únicos interactuaron con el bot. Se intercambiaron ${messagesExchanged} mensajes.` 
            };
        } else if (call.function.name === "admin_edit_notebook_info" && isAdmin) {
            const { fileName, item, field, newValue } = args;
            const { notebook } = getTenantPaths(tenantId);
            const filePath = path.join(notebook, fileName);
            if (!fs.existsSync(filePath)) {
                result = { success: false, message: `Archivo ${fileName} no encontrado.` };
            } else {
                let content = fs.readFileSync(filePath, "utf8");
                const lines = content.split('\n');
                let found = false;
                
                // Super simple regex/line matcher for the demo/implementation
                // Find line with 'item' and then find 'field' in the following lines or same block
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].toLowerCase().includes(item.toLowerCase())) {
                        // Scan for the field in the block (simple heuristic)
                        for (let j = i; j < i + 20 && j < lines.length; j++) {
                                // Improved regex: Match "Field: Value" or "- Field: Value" or "+ Field: Value"
                                const regex = new RegExp(`^(\\s*[\\-\\+*]?\\s*${field}[:\\s-]+)([^\\n\\|]+)`, 'im');
                                if (regex.test(lines[j])) {
                                    lines[j] = lines[j].replace(regex, `$1${newValue}`);
                                    found = true;
                                    break;
                                }
                            if (lines[j].startsWith('#') && j > i) break; // Start of next section
                        }
                    }
                    if (found) break;
                }
                
                if (found) {
                    fs.writeFileSync(filePath, lines.join('\n'), "utf8");
                    tenantCaches.delete(tenantId);
                    result = { success: true, message: `Información de ${item} actualizada con éxito en ${fileName}.` };
                } else {
                    result = { success: false, message: `No pude encontrar el campo '${field}' para '${item}' en ${fileName}.` };
                }
            }
        } else if (call.function.name === "admin_ingest_knowledge" && isAdmin) {
            try {
                await ingestNotebook(tenantId);
                result = { success: true, message: "✅ Jefe, he sincronizado la base de datos. Los cambios ya son visibles para los clientes." };
            } catch (e) {
                result = { success: false, message: `Error en ingesta: ${e.message}` };
            }
        } else if (call.function.name === "admin_manage_events" && isAdmin) {
            const { action, title, date, eventId } = args;
            try {
                if (action === "add") {
                    const newEvent = { id: Date.now().toString(), title: title || "Evento Admin", date };
                    eventsStore.push(newEvent);
                    await saveEvents();
                    result = { success: true, message: `✅ Evento "${title}" añadido para el ${date}.` };
                } else if (action === "remove") {
                    const originalLen = eventsStore.length;
                    eventsStore = eventsStore.filter(e => e.id !== eventId && e.date !== date); // Allow delete by date or ID
                    if (eventsStore.length < originalLen) {
                        await saveEvents();
                        result = { success: true, message: "✅ Evento eliminado correctamente." };
                    } else {
                        result = { success: false, message: "No encontré el evento para eliminar." };
                    }
                }
            } catch (e) {
                result = { success: false, message: `Error gestionando eventos: ${e.message}` };
            }
        } else if (call.function.name === "admin_read_notebook" && isAdmin) {
            const { notebook: nbPath } = getTenantPaths(tenantId);
            const targetFile = path.join(nbPath, args.fileName);
            try {
                if (fs.existsSync(targetFile)) {
                    const content = fs.readFileSync(targetFile, "utf8");
                    result = { success: true, content: content.substring(0, 10000), message: `Leído con éxito: ${args.fileName}` };
                } else {
                    result = { success: false, message: "Archivo no encontrado." };
                }
            } catch (e) { result = { success: false, message: e.message }; }
        } else if (call.function.name === "admin_update_config" && isAdmin) {
            try {
                if (args.startTime) appointmentConfig.startTime = args.startTime;
                if (args.endTime) appointmentConfig.endTime = args.endTime;
                if (args.durationMinutes) appointmentConfig.durationMinutes = args.durationMinutes;
                
                await writeFile(getAppointmentConfigPath(tenantId), JSON.stringify(appointmentConfig, null, 2));
                result = { success: true, message: "✅ Configuración de agenda actualizada correctamente." };
            } catch (e) { result = { success: false, message: e.message }; }
        } else if (call.function.name === "admin_manage_finances" && isAdmin) {
            try {
                const { action, type, amount, description } = args;
                if (action === "record") {
                    const entry = { id: Date.now().toString(), type, amount, description, date: new Date().toISOString() };
                    financesStore.push(entry);
                    await saveFinances(tenantId);
                    result = { success: true, message: `✅ Movimiento registrado: ${type.toUpperCase()} de $${amount} por "${description}".` };
                } else if (action === "delete") {
                    const originalLen = financesStore.length;
                    financesStore = financesStore.filter(f => f.id !== args.id);
                    if (financesStore.length < originalLen) {
                        await saveFinances(tenantId);
                        result = { success: true, message: "✅ Movimiento eliminado." };
                    } else { result = { success: false, message: "No encontré el movimiento." }; }
                }
            } catch (e) { result = { success: false, message: e.message }; }
        } else if (call.function.name === "admin_get_financial_report" && isAdmin) {
            try {
                // 1. Calculate Revenue from Tickets
                const period = args.period || "hoy";
                const now = new Date();
                const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                
                // Income from tickets (sales and enrollments)
                const paidTickets = ticketsStore.filter(t => 
                    ["compra", "inscripcion"].includes(t.type) && 
                    ["registrado", "aprobado"].includes(t.status)
                );

                let totalRevenue = 0;
                paidTickets.forEach(t => {
                   // Quick hack: extract number from amount string (e.g. "$1,200 MXN")
                   const amtStr = String(t.data.total || t.data.monto || "0").replace(/[^0-9.]/g, "");
                   totalRevenue += parseFloat(amtStr) || 0;
                });

                // 2. Add manual incomes, subtract manual expenses
                let manualIncome = 0;
                let manualExpense = 0;
                financesStore.forEach(f => {
                    if (f.type === "ingreso") manualIncome += f.amount;
                    else manualExpense += f.amount;
                });

                const summary = {
                    ticketsRevenue: totalRevenue,
                    manualIncome,
                    manualExpense,
                    netBalance: totalRevenue + manualIncome - manualExpense
                };

                result = { 
                    success: true, 
                    summary, 
                    message: `Jefe, aquí el balance: Ganancia por Tickets: $${totalRevenue}, Ingresos Manuales: $${manualIncome}, Gastos: $${manualExpense}. Balance Neto: $${summary.netBalance}.` 
                };
            } catch (e) { result = { success: false, message: e.message }; }
        } else if (call.function.name === "admin_set_reminder" && isAdmin) {
            try {
                let finalDate = args.date_time;
                // Basic relative parser for "en X segundos/minutos/horas/dias"
                if (String(args.date_time).toLowerCase().includes("en ")) {
                   const numMatch = args.date_time.match(/\d+/);
                   if (numMatch) {
                       const num = parseInt(numMatch[0]);
                       const unit = args.date_time.toLowerCase();
                       const d = new Date();
                       if (unit.includes("segundo")) d.setSeconds(d.getSeconds() + num);
                       else if (unit.includes("minuto")) d.setMinutes(d.getMinutes() + num);
                       else if (unit.includes("hora")) d.setHours(d.getHours() + num);
                       else if (unit.includes("dia") || unit.includes("día")) d.setDate(d.getDate() + num);
                       finalDate = d.toISOString();
                   }
                }

                const reminder = { 
                    id: Date.now().toString(), 
                    text: args.text, 
                    date_time: finalDate, 
                    whatsapp: args.whatsapp || psid, 
                    sent: false,
                    createdAt: new Date().toISOString()
                };
                remindersStore.push(reminder);
                await saveReminders(tenantId);
                result = { success: true, message: `✅ Entendido Jefe. Recordatorio programado (${finalDate}). Yo avisaré por WhatsApp.` };
            } catch (e) { result = { success: false, message: e.message }; }
        } else if (call.function.name === "admin_manage_tasks" && isAdmin) {
            try {
                const { action, text, id: taskId } = args;
                if (action === "add") {
                    const task = { id: (tasksStore.length + 1).toString(), text, status: "pending", date: new Date().toISOString() };
                    tasksStore.push(task);
                    await saveTasks(tenantId);
                    result = { success: true, message: `✅ Tarea añadida: "${text}" (ID: ${task.id})` };
                } else if (action === "done") {
                    const t = tasksStore.find(x => x.id === taskId);
                    if (t) {
                        t.status = "done";
                        await saveTasks(tenantId);
                        result = { success: true, message: `✅ Tarea #${taskId} completada.` };
                    } else { result = { success: false, message: "Tarea no encontrada." }; }
                } else if (action === "list") {
                    const pending = tasksStore.filter(x => x.status === "pending");
                    result = { success: true, tasks: pending, message: `Pendientes: ${pending.length}` };
                } else if (action === "remove") {
                    tasksStore = tasksStore.filter(x => x.id !== taskId);
                    await saveTasks(tenantId);
                    result = { success: true, message: "Tarea eliminada." };
                }
            } catch (e) { result = { success: false, message: e.message }; }
        } else if (call.function.name === "admin_manage_inventory" && isAdmin) {
            try {
                const { action, item, stock } = args;
                if (action === "update") {
                    inventoryStore[item] = stock;
                    await saveInventory(tenantId);
                    result = { success: true, message: `✅ Stock de "${item}" actualizado a ${stock}.` };
                } else if (action === "check") {
                    const val = inventoryStore[item] !== undefined ? inventoryStore[item] : "N/D (No registrado)";
                    result = { success: true, stock: val, message: `Existencias de ${item}: ${val}` };
                } else if (action === "list_low") {
                    const low = Object.entries(inventoryStore).filter(([k, v]) => v < 5).map(([k, v]) => `${k}: ${v}`);
                    result = { success: true, low_stock: low, message: low.length > 0 ? "⚠️ Productos con bajo stock!" : "Todo en orden." };
                }
            } catch (e) { result = { success: false, message: e.message }; }
        } else if (call.function.name === "admin_bulk_clear" && isAdmin) {
            try {
                const { recordType, date } = args;
                let count = 0;
                if (recordType === "cita" || recordType === "inscripcion") {
                    const originalLen = ticketsStore.length;
                    ticketsStore = ticketsStore.filter(t => {
                        if (t.type !== recordType) return true;
                        if (date === "todo") return false;
                        if (t.data.fecha === date) return false;
                        return true;
                    });
                    count = originalLen - ticketsStore.length;
                    await saveTickets(tenantId);
                } else if (recordType === "tarea") {
                    const originalLen = tasksStore.length;
                    if (date === "todo") tasksStore = [];
                    count = originalLen - tasksStore.length;
                    await saveTasks(tenantId);
                } else if (recordType === "recordatorio") {
                    const originalLen = remindersStore.length;
                    if (date === "todo") remindersStore = [];
                    else remindersStore = remindersStore.filter(r => !r.date_time.includes(date));
                    count = originalLen - remindersStore.length;
                    await saveReminders(tenantId);
                }
                result = { success: true, message: `✅ Jefe, he eliminado ${count} registros de tipo '${recordType}'.` };
            } catch (e) { result = { success: false, message: e.message }; }
        } else if (call.function.name === "admin_get_whatsapp_groups" && isAdmin) {
            try {
                const groups = await getGroupList();
                result = { success: true, groups, message: `Jefe, encontré ${groups.length} grupos activos.` };
            } catch (e) { result = { success: false, message: e.message }; }
        } else if (call.function.name === "admin_send_whatsapp_message" && isAdmin) {
            try {
                const { target, text } = args;
                const res = await sendWhatsAppMessage(target, text);
                if (res) {
                    result = { success: true, message: `✅ Mensaje enviado con éxito a '${target}'.` };
                } else {
                    result = { success: false, message: "No se pudo enviar el mensaje. Verifica la conexión o el ID/número." };
                }
            } catch (e) { result = { success: false, message: e.message }; }
        }

        console.log(`[TOOL-RESULT] ${call.function.name} => success: ${result.success} | ${(result.message || '').substring(0, 100)}`);
        toolResults.push({ tool_call_id: call.id, role: "tool", name: call.function.name, content: JSON.stringify(result) });
      }

      const secondResponse = await client.chat.completions.create({
        model: XAI_MODEL,
        messages: [...messages, choice.message, ...toolResults]
      });
      const finalReply = secondResponse.choices[0].message.content || "";
      session.messages.push({ role: "user", content: text || "(imagen)" });
      session.messages.push({ role: "assistant", content: finalReply });
      chatSessions.set(psid, { ...session, messages: session.messages.slice(-SESSION_MAX_MESSAGES), updatedAt: Date.now() });
      
      // CRITICAL FIX: Persist immediately
      saveSessions();
      
      return finalReply;
    }

    // 7. Normal Response
    const reply = choice.message.content || "";
    session.messages.push({ role: "user", content: text || "(imagen)" });
    session.messages.push({ role: "assistant", content: reply });
    chatSessions.set(psid, { ...session, messages: session.messages.slice(-SESSION_MAX_MESSAGES), updatedAt: Date.now() });
    
    // CRITICAL FIX: Persist immediately
    saveSessions();

    return reply;
  } catch (err) {
    logError("askAI", err);
    return "Disculpa, tuve un problema técnico.";
  } finally {
    activeRequests.delete(psid);
  }
}

async function persistMetrics(tenantId) {
  const { metrics, data } = getTenantPaths(tenantId);
  const log = metricsLogs.get(tenantId) || [];
  await mkdir(data, { recursive: true });
  await writeFile(metrics, JSON.stringify(log, null, 2), "utf8");
}

// ============================================
// BUFFERING & WEBHOOK
// ============================================
function enqueueBufferedMessage(psid, text, tenantId, attachments = []) {
  const existing = pendingBufferedMessages.get(psid);
  if (existing) {
    existing.messages.push(text);
    if (attachments.length) existing.attachments.push(...attachments);
    clearTimeout(existing.timer);
    existing.timer = setTimeout(() => flushBuffer(psid, tenantId), MESSAGE_BUFFER_MS);
  } else {
    const timer = setTimeout(() => flushBuffer(psid, tenantId), MESSAGE_BUFFER_MS);
    pendingBufferedMessages.set(psid, { messages: [text], attachments: [...attachments], timer });
  }
}

async function flushBuffer(psid, tenantId) {
  const data = pendingBufferedMessages.get(psid);
  if (!data) return;

  const merged = data.messages.filter(Boolean).join("\n");
  const attachments = [...(data.attachments || [])];
  
  // Clear buffer IMMEDIATELY so new incoming messages during askAI create a new buffer
  data.messages = [];
  data.attachments = [];

  if (!merged && attachments.length === 0) return;

  try {
    console.log(`[AI] Processing buffer for ${psid}. Merged: "${merged.substring(0, 30)}..."`);
    await sendAction(psid, "mark_seen", tenantId);
    await sendAction(psid, "typing_on", tenantId);
    
    const reply = await askAI(merged, psid, tenantId, attachments);
    
    // Safety check: Don't send internal status or empty replies
    if (reply && reply !== "procesando..." && reply.trim() !== "") {
        await sendUniversalMessage(psid, reply, tenantId);
        
        // --- LOG TO METRICS ---
        const platform = (psid.includes("@s.whatsapp.net") || psid.includes("@lid")) ? "whatsapp" : "messenger";
        const profile = userProfileCache.get(psid);
        const name = profile?.name || (platform === "whatsapp" ? psid.split('@')[0] : psid);
        
        const now = new Date();
        const localISO = now.toLocaleString('sv-SE', { timeZone: TIMEZONE }).replace(' ', 'T');
        const logs = metricsLogs.get(tenantId) || [];
        logs.push({
            id: Date.now(),
            psid,
            name, // Add name for better panel indexing
            question: merged.substring(0, 500),
            answer: reply,
            timestamp: localISO,
            platform,
            isManual: false
        });
        metricsLogs.set(tenantId, logs.slice(-METRICS_MAX_ENTRIES));
        await persistMetrics(tenantId);
        // ---------------------
        logDebug("AI", `Response sent to ${name} (${platform}).`);
    } else {
        logDebug("Flush-Trace", `Response was suppressed or empty for ${psid}.`);
    }
    await sendAction(psid, "typing_off", tenantId);
    logDebug("Flush-Finish", `Buffer finished for ${psid}.`);
  } catch (e) {
    console.error(`[AI ERROR] Error in flushBuffer for ${psid}:`, e.message);
  } finally {
    // Check if buffer is empty before deleting. If not empty, it means new messages arrived.
    const current = pendingBufferedMessages.get(psid);
    if (current && current.messages.length === 0 && current.attachments.length === 0) {
        pendingBufferedMessages.delete(psid);
    }
  }
}

// Webhooks
app.get("/webhook", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === FB_VERIFY_TOKEN) {
    res.send(req.query["hub.challenge"]);
  } else res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  // Ultra-raw debug: log every single hit
  try {
    fs.appendFileSync(path.join(process.cwd(), "data", "webhook_raw.jsonl"), JSON.stringify({ t: new Date().toISOString(), ip: req.ip, body: req.body }) + "\n");
  } catch {}
  logDebug("Webhook", `POST received from ${req.ip}`);
  const signatureOk = isValidSignature(req);
  if (!signatureOk) {
    console.warn(`[WEBHOOK] Invalid signature or missing rawBody. Recheck APP_SECRET.`);
    return res.sendStatus(403);
  }
  const body = req.body;
  
  if (body.object === "page") {
    logDebug("Webhook", `Object is 'page' | Body keys: ${Object.keys(body).join(", ")} | Entry count: ${body.entry?.length}`);
    for (const entry of body.entry) {
        logDebug("Webhook-Entry", `Entry keys: ${Object.keys(entry).join(", ")} | hasMessaging: ${!!entry.messaging} | hasChanges: ${!!entry.changes}`);
      const tenantId = SINGLE_TENANT_MODE ? "default" : entry.id;
      
      for (const event of entry.messaging || []) {
        const targetPsid = event.sender?.id;
        if (!targetPsid) continue;

        logDebug("Webhook-Event", `Event keys for ${targetPsid}: ${Object.keys(event).join(", ")} | hasMessage: ${!!event.message} | hasPostback: ${!!event.postback} | hasReferral: ${!!event.referral}`);

        // Auto-extract name if not in cache (Facebook verified only)
        if (event.message && !event.message.is_echo && !userProfileCache.has(targetPsid)) {
            getMessengerUserInfo(targetPsid, tenantId).catch(() => {});
        }

        // Capture Referral (Ads)
        const referral = event.referral || event.message?.referral;
        if (referral) {
            // Update persistent profile
            const profile = userProfileCache.get(targetPsid) || { name: targetPsid, whatsapp: "", email: "", notes: "" };
            const adTitle = referral.ads_context_data?.ad_title || referral.headline || referral.body || referral.ref || "";
            const adInfo = `[ADS] Fuente: ${referral.source || 'N/D'} | AdID: ${referral.ad_id || 'N/D'}${adTitle ? ' | Título: ' + adTitle : ''}`;
            if (!profile.notes.includes(adInfo)) {
                profile.notes = (profile.notes + "\n" + adInfo).trim();
                userProfileCache.set(targetPsid, profile);
                saveProfiles();
            }
            
            // Update active session for AI context
            const session = chatSessions.get(targetPsid) || { messages: [] };
            session.referral = referral;
            chatSessions.set(targetPsid, session);
            saveSessions(); // Persist referral immediately
            logDebug("Ads", `Captured referral for ${targetPsid}: ${JSON.stringify(referral)}`);

            // Proactive trigger: If it's a standalone referral, enqueue a virtual message to trigger AI greeting
            if (!event.message && !event.postback) {
              enqueueBufferedMessage(targetPsid, "(cliente entró por el anuncio)", tenantId, []);
            }
        }

        if (event.message && !event.message.is_echo) {
          const text = (event.message.text || "").trim();
          const lowerText = text.toLowerCase();

          // Per-platform Mute Check (messenger vs whatsapp)
          if (!botStatus.messenger) continue; 

          // Per-user handoff check
          if (userBotDisabled.get(targetPsid)) {
            continue;
          }

          // Command Interception (Status only now)
          if (lowerText === "/status") {
            const userStatus = userBotDisabled.get(targetPsid) ? "HUMANO (IA Apagada)" : "AUTOMÁTICO (IA Activa)";
            const platformStatus = botStatus.messenger ? "ACTIVO" : "SILENCIADO";
            await sendUniversalMessage(targetPsid, `🤖 BOT: Plataforma=${platformStatus} | Chat=${userStatus}`, tenantId);
            continue;
          }

          // Extract attachments (images, etc.) — filter out stickers (like 👍)
          const rawAttachments = event.message.attachments || [];
          const attachments = rawAttachments.filter(a => {
            // Stickers in Messenger have a sticker_id field
            if (event.message.sticker_id || a.payload?.sticker_id) return false;
            // Filter out tiny "like" button thumbnails (they're typically very small)
            if (a.type === 'image' && a.payload?.url && a.payload.url.includes('like_icon')) return false;
            return true;
          });

          // If it's ONLY a sticker/like with no text, treat it as a simple reaction
          if (attachments.length === 0 && rawAttachments.length > 0 && !text) {
            continue; // Skip sticker-only messages
          }

          const eventKey = `mid:${event.message.mid || Date.now() + Math.random()}`;
          if (shouldProcessEvent(eventKey)) {
            // IMMEDIATE IMAGE DOWNLOAD for Messenger (prevent expiration)
            const session = chatSessions.get(targetPsid) || { messages: [] };
            for (const att of attachments) {
                if (att.type === 'image' && att.payload?.url && !att.isWhatsApp) {
                    const ext = att.payload.url.split('?')[0].split('.').pop() || 'jpg';
                    const localFile = `fb_${targetPsid}_${Date.now()}.${ext}`;
                    const localPath = await downloadExternalImage(att.payload.url, localFile);
                    if (localPath) {
                        att.payload.url = localPath; // Replace with local path for AI and Tool calls
                        session.lastImageUrl = localPath;
                    }
                }
            }
            if (session.lastImageUrl) chatSessions.set(targetPsid, session);
            
            enqueueBufferedMessage(targetPsid, text, tenantId, attachments);
          }
        }

        // Handle POSTBACK events (Facebook ads often arrive as postbacks, not messages)
        if (event.postback) {
          const postbackReferral = event.postback.referral;
          if (postbackReferral) {
            // Capture ad referral from postback
            const profile = userProfileCache.get(targetPsid) || { name: targetPsid, whatsapp: "", email: "", notes: "" };
            const adTitle = postbackReferral.ads_context_data?.ad_title || postbackReferral.headline || postbackReferral.body || postbackReferral.ref || "";
            const adInfo = `[ADS-PB] Fuente: ${postbackReferral.source || 'N/D'} | AdID: ${postbackReferral.ad_id || 'N/D'}${adTitle ? ' | Título: ' + adTitle : ''}`;
            if (!profile.notes.includes(adInfo)) {
              profile.notes = (profile.notes + "\n" + adInfo).trim();
              userProfileCache.set(targetPsid, profile);
              saveProfiles();
            }
            const session = chatSessions.get(targetPsid) || { messages: [] };
            session.referral = postbackReferral;
            chatSessions.set(targetPsid, session);
            saveSessions();
            logDebug("Ads-Postback", `Captured postback referral for ${targetPsid}: ${JSON.stringify(postbackReferral)}`);
          }

          // Process postback payload as a message if it has text
          const postbackText = event.postback.title || event.postback.payload || "";
          if (postbackText && botStatus.messenger && !userBotDisabled.get(targetPsid)) {
            const eventKey = `postback:${targetPsid}:${Date.now()}`;
            if (shouldProcessEvent(eventKey)) {
              enqueueBufferedMessage(targetPsid, postbackText, tenantId, []);
            }
          }
        }
      }
    }
    res.status(200).send("EVENT_RECEIVED");
  } else res.sendStatus(404);
});

// ============================================
// TICKET API ENDPOINTS
// ============================================
app.get("/api/tickets", (_req, res) => {
  const sorted = [...ticketsStore].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  res.json({ items: sorted });
});

// WHATSAPP API
app.get("/api/whatsapp/status", (_req, res) => {
  res.json(getWAStatus());
});

app.get("/api/whatsapp/qr", (_req, res) => {
  const { qr } = getWAStatus();
  res.json({ qr });
});

app.get("/api/whatsapp/test", async (_req, res) => {
  const result = await sendToAdmins("Este es un mensaje de prueba del sistema Smartbis. 🧪");
  if (result) {
    res.json({ success: true, message: "Mensaje de prueba enviado exitosamente a los administradores." });
  } else {
    res.status(500).json({ success: false, message: "Error al enviar mensaje. Verifica que haya números administradores configurados." });
  }
});

app.get("/api/whatsapp/config", (_req, res) => {
  res.json(waConfig);
});

// CALENDAR API (Custom)
app.get("/api/calendar/events", async (req, res) => {
  const tenantId = req.query.tenantId || "default";
  
  // 1. Get Appointments (Aprobados)
  const appointments = ticketsStore
    .filter(t => t.type === "cita" && t.status === "aprobado")
    .map(t => ({
      id: t.id,
      title: `Cita: ${t.data.nombre}`,
      start: t.data.start_iso,
      end: t.data.end_iso,
      type: 'cita',
      raw: t.data
    }));

  // 2. Get Structured Events from events.json
  const structuredEvents = eventsStore.map(e => {
      const detailsStr = e.details ? Object.entries(e.details).map(([k,v]) => `${k}: ${v}`).join(", ") : "";
      return {
          id: e.id,
          title: e.title,
          dateLabel: e.date.split('-').reverse().slice(0, 2).join('/'),
          type: 'curso',
          text: `${e.title}${detailsStr ? ` (${detailsStr})` : ""}`,
          date: e.date
      };
  });

  res.json({ appointments, courses: structuredEvents, activities: structuredEvents });
});

// NEW STRUCTURED EVENTS API
app.get("/api/events", (req, res) => {
    // Return all events, but UI will highlight past ones
    res.json({ items: eventsStore });
});

app.post("/api/events", async (req, res) => {
    const { title, date, details } = req.body;
    if (!title || !date) return res.status(400).json({ error: "Título y fecha son obligatorios" });
    
    const newEvent = {
        id: `ev-${Date.now()}`,
        title,
        date, // YYYY-MM-DD
        details: details || {},
        createdAt: new Date().toISOString()
    };
    
    eventsStore.push(newEvent);
    await saveEvents();
    res.json({ ok: true, event: newEvent });
});

app.delete("/api/events/:id", async (req, res) => {
    eventsStore = eventsStore.filter(e => e.id !== req.params.id);
    await saveEvents();
    res.json({ ok: true });
});

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";

app.get(["/api/branding", "/api/config/branding"], (req, res) => {
    res.json({
        appName: APP_NAME,
        appLogo: process.env.APP_LOGO || "/img/logo.png",
        itemName: ITEM_NAME
    });
});

app.post("/api/auth/login", (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        res.json({ ok: true, is_default: (ADMIN_PASSWORD === "admin") });
    } else {
        res.status(401).json({ error: "Contraseña incorrecta." });
    }
});

app.post("/api/auth/change-password", (req, res) => {
    // Security fallback to allow dashboard access
    res.json({ ok: true });
});

app.post("/api/whatsapp/config", async (req, res) => {
  // Clear and update with exactly what frontend sends (adminNumbers array)
  waConfig.adminNumbers = req.body.adminNumbers || [];
  await saveWAConfig();
  refreshConfig(); // Force immediate reload in the WhatsApp worker
  console.log('[WA-CONFIG] Updated live config and refreshed worker:', waConfig);
  res.json({ ok: true });
});

app.post("/api/whatsapp/logout", async (_req, res) => {
  try {
    const ok = await logoutWhatsApp();
    res.json({ ok });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Deprecated - Group messages removed

app.delete("/api/tickets/:id", async (req, res) => {
  const { id } = req.params;
  const tenantId = req.query.tenantId || "default";
  const index = ticketsStore.findIndex(t => t.id === id);
  if (index !== -1) {
    ticketsStore.splice(index, 1);
    await saveTickets(tenantId);
    res.json({ ok: true, message: `Ticket ${id} eliminado.` });
  } else {
    res.status(404).json({ error: "Ticket no encontrado." });
  }
});

app.get("/api/tickets/:id", (req, res) => {
  const ticket = ticketsStore.find(t => t.id === req.params.id);
  if (!ticket) return res.status(404).json({ error: "Ticket no encontrado" });
  res.json(ticket);
});

// addCitaToCalendario was removed as it's no longer needed for tickets-based calendars.

app.patch("/api/tickets/:id", async (req, res) => {
  const ticket = ticketsStore.find(t => t.id === req.params.id);
  if (!ticket) return res.status(404).json({ error: "Ticket no encontrado" });
  
  const { status, adminNotes, rejectReason } = req.body;
  const oldStatus = ticket.status;
  if (status) ticket.status = status;
  if (adminNotes !== undefined) ticket.adminNotes = adminNotes;
  if (rejectReason !== undefined) ticket.rejectReason = rejectReason;
  
  const now = new Date();
  ticket.updatedAt = now.toLocaleString('sv-SE', { timeZone: TIMEZONE }).replace(' ', 'T');
  
  await saveTickets(ticket.tenantId || "default");
  
  // If status changed to approved, rejected or pending_data, notify the client via Messenger
  if (status === "aprobado" && oldStatus !== "aprobado") {
    if (ticket.type === "cita") {
      // Nothing to do here, calendar reads from ticketsStore automatically
    }
    const msg = `🎉 ¡Excelente noticias, ${ticket.data.nombre || ""}! Tu ${ACTION_NAME} para ${ITEM_NAME} **${ticket.data.curso}** ha sido COMPLETADO. ✅\n\nPronto te contactaremos para los siguientes pasos. ¡Gracias por confiar en ${COMPANY_NAME}! ✨`;
    await sendUniversalMessage(ticket.psid, msg, ticket.tenantId || "default");
  } else if (status === "pendiente_datos") {
    const msg = `✅ ¡Tu pago ha sido verificado! Ahora, para completar tu ${ACTION_NAME} de **${ticket.data.curso}**, por favor proporciónanos los siguientes datos:\n\n1. Nombre completo\n2. Correo de contacto\n3. Número de WhatsApp\n\nQuedo a la espera de tu respuesta para finalizar el proceso. 😊`;
    await sendUniversalMessage(ticket.psid, msg, ticket.tenantId || "default");
  } else if (status === "rechazado") {
    const reason = rejectReason || "No se especificó motivo.";
    const msg = `Hola ${ticket.data.nombre || ""}. Lamentablemente, tu solicitud de ${ACTION_NAME} para **${ticket.data.curso}** no pudo ser procesada. ❌\n\nMotivo: ${reason}\n\nSi tienes dudas, no dudes en contactarnos. Estamos para ayudarte. 😊`;
    await sendUniversalMessage(ticket.psid, msg, ticket.tenantId || "default");
  }
  
  res.json({ ok: true, ticket });
});

app.post("/api/tickets/:id/reply", async (req, res) => {
  const ticket = ticketsStore.find(t => t.id === req.params.id);
  if (!ticket) return res.status(404).json({ error: "Ticket no encontrado" });
  
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "No text provided" });

  const now = new Date();
  const localISO = now.toLocaleString('sv-SE', { timeZone: 'America/Hermosillo' }).replace(' ', 'T');
  
  // Add to ticket messages
  ticket.messages.push({
    from: "admin",
    text,
    timestamp: localISO
  });
  
  await saveTickets(ticket.tenantId || "default");
  
  // Send to Messenger
  await sendUniversalMessage(ticket.psid, text, ticket.tenantId || "default");
  
  res.json({ ok: true });
});

// ============================================
// INGEST API
// ============================================
app.post("/api/ingest", async (req, res) => {
  const tenantId = req.query.tenantId || "default";
  try {
    await ingestNotebook(tenantId);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ============================================
// USER PROFILE SERVICE
// ============================================

app.get("/api/users/:psid", (req, res) => {
    const psid = req.params.psid;
    const profile = userProfileCache.get(psid) || { name: psid, whatsapp: "", email: "", notes: "" };
    res.json(profile);
});

app.post("/api/users/:psid", (req, res) => {
    const psid = req.params.psid;
    const { name, whatsapp, email, notes } = req.body;
    userProfileCache.set(psid, { name, whatsapp, email, notes });
    saveProfiles();
    res.json({ ok: true });
});

app.get("/metrics/api/user-profile/:id", async (req, res) => {
  const psid = req.params.id;
  const tenantId = req.query.tenantId || "default";
  const profile = await getFBUserProfile(psid, tenantId);
  res.json(profile || { name: "Usuario desconocido", pic: "" });
});

// ============================================
// DIAGNOSTIC API (For Benchmarks & Internal Tests)
// ============================================
app.post(["/api/debug/ask", "/api/debug-ai", "/debug/ask"], async (req, res) => {
  const { text, question, psid, tenantId } = req.body;
  const targetText = text || question;
  const targetPsid = psid || "debug_user";
  const targetTenant = tenantId || "default";

  if (!targetText) return res.status(400).json({ error: "No text/question provided" });

  try {
    const reply = await askAI(targetText, targetPsid, targetTenant);
    res.json({ reply, ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================
// METRICS API
// ============================================
function getMetricsLog(req) {
  const tenantId = req.query.tenantId || "default";
  return metricsLogs.get(tenantId) || [];
}

app.get("/metrics/api/days", (req, res) => {
  const logs = getMetricsLog(req);
  const days = [...new Set(logs.map(log => log.timestamp.split("T")[0]))].sort().reverse();
  res.json({ items: days });
});

app.get("/metrics/api/summary", (req, res) => {
  const logs = getMetricsLog(req);
  const totalMessages = logs.length;
  let evaluated = 0, approved = 0, rejected = 0;
  const daysMap = {};
  
  logs.forEach(log => {
    const day = log.timestamp.split("T")[0];
    if (!daysMap[day]) daysMap[day] = { dateKey: day, total: 0, evaluated: 0, approved: 0, rejected: 0, score: null, messenger: 0, whatsapp: 0 };
    daysMap[day].total++;
    
    const platform = log.platform || "messenger";
    if (daysMap[day][platform] !== undefined) daysMap[day][platform]++;

    if (log.evalStatus) {
      evaluated++;
      daysMap[day].evaluated++;
      if (log.evalStatus === "approved") { approved++; daysMap[day].approved++; }
      if (log.evalStatus === "rejected") { rejected++; daysMap[day].rejected++; }
    }
  });

  const daily = Object.values(daysMap).sort((a,b) => b.dateKey.localeCompare(a.dateKey)).map(d => {
    if (d.evaluated > 0) d.score = Math.round((d.approved / d.evaluated) * 100);
    return d;
  });

  // Add ticket stats
  const ticketStats = {
    total: ticketsStore.length,
    registrado: ticketsStore.filter(t => t.status === "registrado").length,
    aprobado: ticketsStore.filter(t => t.status === "aprobado").length,
    rechazado: ticketsStore.filter(t => t.status === "rechazado").length,
  };

  res.json({ totalMessages, evaluated, approved, rejected, daily, ticketStats });
});

app.get("/metrics/api/conversations", (req, res) => {
  const logs = getMetricsLog(req);
  const dateKey = req.query.dateKey;
  const filtered = dateKey ? logs.filter(l => l.timestamp.split("T")[0] === dateKey) : logs;
  
  const convos = {};
  filtered.forEach(log => {
    if (!convos[log.psid]) {
      const profile = userProfileCache.get(log.psid);
      convos[log.psid] = { 
          conversationId: log.psid, 
          senderId: log.psid, 
          senderName: profile?.name || log.psid,
          total: 0, 
          evaluated: 0, 
          responseCount: 0 
      };
    }
    convos[log.psid].total++;
    convos[log.psid].responseCount++;
    if (log.evalStatus) convos[log.psid].evaluated++;
  });
  
  res.json({ items: Object.values(convos).sort((a, b) => b.responseCount - a.responseCount) });
});

app.get("/metrics/api/conversations/:id", (req, res) => {
  const logs = getMetricsLog(req);
  const id = req.params.id;
  const items = logs.filter(l => l.psid === id);
  res.json({ items });
});

app.post("/metrics/api/conversations/:id/reply", async (req, res) => {
  const psid = req.params.id;
  const text = req.body.text;
  const tenantId = req.query.tenantId || "default";

  if (!text) return res.status(400).json({ error: "No text provided" });

  try {
    await sendUniversalMessage(psid, text, tenantId);
    
    const now = new Date();
    const localISO = now.toLocaleString('sv-SE', { timeZone: 'America/Hermosillo' }).replace(' ', 'T');
    const logs = metricsLogs.get(tenantId) || [];
    
    const platform = (psid.includes("@s.whatsapp.net") || psid.includes("@lid")) ? "whatsapp" : "messenger";
    logs.push({ 
        id: Date.now(), 
        psid, 
        question: "(Respuesta Manual)", 
        answer: text, 
        timestamp: localISO,
        platform,
        isManual: true 
    });
    
    metricsLogs.set(tenantId, logs.slice(-METRICS_MAX_ENTRIES));
    await persistMetrics(tenantId);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/metrics/api/messages/:id/evaluate", async (req, res) => {
  const tenantId = req.query.tenantId || "default";
  const logs = metricsLogs.get(tenantId) || [];
  const msgId = Number(req.params.id);
  const msg = logs.find(l => l.id === msgId);
  if (msg) {
    msg.evalStatus = req.body.status;
    await persistMetrics(tenantId);
  }
  res.json({ ok: true });
});

// ============================================
// NOTEBOOK & DATABASE EXPLORER API
// ============================================
app.get("/api/notebook/files", async (req, res) => {
  const tenantId = req.query.tenantId || "default";
  const { notebook } = getTenantPaths(tenantId);
  try {
    const files = await readdir(notebook);
    const mdFiles = files.filter(f => f.endsWith(".md"));
    const details = await Promise.all(mdFiles.map(async f => {
        const content = await readFile(path.join(notebook, f), "utf8");
        return {
            name: f,
            size: content.length,
            sections: toSections(content, f).length
        };
    }));
    res.json({ items: details });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/notebook/search", async (req, res) => {
    const query = req.query.q;
    const tenantId = req.query.tenantId || "default";
    if (!query) return res.json({ items: [] });

    try {
        const sections = await loadNotebookSections(tenantId);
        const queryNorm = normalizeText(query);
        const queryTokens = tokenize(query);
        
        const scored = sections.map(s => ({
            section: s,
            score: scoreSection(s, queryNorm, queryTokens)
        }))
        .filter(item => item.score > 2)
        .sort((a,b) => b.score - a.score)
        .slice(0, 20);

        res.json({ items: scored });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/notebook/file", async (req, res) => {
    const tenantId = req.query.tenantId || "default";
    const fileName = req.query.name;
    if (!fileName) return res.status(400).json({ error: "Missing name" });
    const { notebook } = getTenantPaths(tenantId);
    try {
        const content = await readFile(path.join(notebook, fileName), "utf8");
        res.json({ content });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/notebook/file", async (req, res) => {
    const tenantId = req.query.tenantId || "default";
    const { name, content } = req.body;
    if (!name) return res.status(400).json({ error: "Missing name" });
    const { notebook } = getTenantPaths(tenantId);
    try {
        await writeFile(path.join(notebook, name), content, "utf8");
        tenantCaches.delete(tenantId);
        pendingIngestion = true;
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/notebook/file", async (req, res) => {
    const tenantId = req.query.tenantId || "default";
    const fileName = req.query.name;
    if (!fileName) return res.status(400).json({ error: "Missing name" });
    if (fileName === "calendario.md") return res.status(403).json({ error: "Este archivo es obligatorio y no puede ser eliminado." });
    const { notebook } = getTenantPaths(tenantId);
    try {
        await unlink(path.join(notebook, fileName));
        tenantCaches.delete(tenantId);
        pendingIngestion = true;
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/notebook/status", (_req, res) => {
    res.json({ pending: pendingIngestion });
});

app.post("/api/notebook/ingest", async (req, res) => {
    const tenantId = req.query.tenantId || "default";
    try {
        await ingestNotebook(tenantId);
        tenantCaches.delete(tenantId);
        pendingIngestion = false;
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================
// APPOINTMENTS API
// ============================================
app.get("/api/appointments/config", async (req, res) => {
  res.json(appointmentConfig);
});

app.post("/api/appointments/config", async (req, res) => {
  const { startTime, endTime, durationMinutes, gapMinutes, skipDays, saturdayEndTime } = req.body;
  if (startTime) appointmentConfig.startTime = startTime;
  if (endTime) appointmentConfig.endTime = endTime;
  if (durationMinutes) appointmentConfig.durationMinutes = parseInt(durationMinutes);
  if (gapMinutes) appointmentConfig.gapMinutes = parseInt(gapMinutes);
  if (skipDays !== undefined) appointmentConfig.skipDays = skipDays;
  if (saturdayEndTime) appointmentConfig.saturdayEndTime = saturdayEndTime;
  
  await writeFile(APPOINTMENT_CONFIG_PATH, JSON.stringify(appointmentConfig, null, 2));
  res.json({ ok: true, config: appointmentConfig });
});

app.get("/api/appointments/list", async (req, res) => {
  const dateStr = req.query.date || new Date().toISOString().split("T")[0];
  const tenantId = req.query.tenantId || "default";

  try {
    // 1. Get blocked dates from eventsStore (e.g. "INHABIL")
    const manualBlocks = eventsStore.map(e => ({
        start: new Date(e.date + "T00:00:00"),
        end: new Date(e.date + "T23:59:59"),
        title: e.title,
        date: e.date
    }));

    const slots = await getAvailableSlots(dateStr, appointmentConfig, 1, ticketsStore, manualBlocks);
    res.json({ items: slots });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================
// BOOT
// ============================================
(async () => {
  const { metrics } = getTenantPaths("default");
  try {
    const data = JSON.parse(await readFile(metrics, "utf8"));
    metricsLogs.set("default", Array.isArray(data) ? data : []);
  } catch (e) {
    // ignore
  }
  
  // Load tickets
  await loadTickets("default");
  await loadFinances("default");
  await loadReminders("default");
  await loadTasks("default");
  await loadInventory("default");
  console.log(`[ADMIN-DATA] Loaded: Finances, Reminders, Tasks, Inventory`);

  // Start Reminders Background Job
  setInterval(async () => {
    const now = new Date();
    let changed = false;
    for (const r of remindersStore) {
        if (!r.sent && new Date(r.date_time) <= now) {
            const dest = r.whatsapp;
            console.log(`[REMINDER] Triggered for ${dest}: ${r.text}`);
            await sendWhatsAppMessage(dest, `🔔 *AVISO ROBERTO (Admin)* 🔔\n\n${r.text}`);
            r.sent = true;
            r.sentAt = now.toISOString();
            changed = true;
        }
    }
    if (changed) await saveReminders("default");
  }, 10000); // Check every 10 seconds for high reactivity (eg: "en 30 segundos")

  // Done initializing
  
  // Load WA config
  await loadWAConfig();
  console.log(`[WA-CONFIG] Group: ${waConfig.groupName}`);

  // Load Appointment Config
  await loadAppointmentConfig();
  console.log(`[APP-CONFIG] Loaded: ${appointmentConfig.startTime} - ${appointmentConfig.endTime}`);
  
  // Local Calendar Logic
  await initCalendar();

  // Register WA handlers
  registerMessageHandlers(
    // 1. Validation Callback (Aprobado/Rechazado simple logic)
    async (remoteJid, action) => {
        // This can be used for non-AI instant actions if desired.
        // For now, we rely on the AI's admin skills for more robust handling.
        console.log(`[WA-CALLBACK] Admin action from ${remoteJid}: ${action}`);
    },
    null,
    // 2. Command Callback (Admin commands)
    async (remoteJid, text, msg) => {
        // We let the regular chat buffer handle admin commands too, 
        // as askAI is now admin-aware and has the skill to update tickets.
        return false; // Continue to AI flow
    },
    // 3. Chat Callback
    async (remoteJid, text, attachments, senderName, referral) => {
    // Per-platform Mute Check
    if (!botStatus.whatsapp) return;

    if (senderName) updateUserProfileFromArgs(remoteJid, { nombre: senderName });
    
    // Capture Referral (Ads) for WhatsApp
    if (referral) {
        const profile = userProfileCache.get(remoteJid) || { name: remoteJid, whatsapp: "", email: "", notes: "" };
        const adTitle = referral.ads_context_data?.ad_title || referral.headline || referral.body || "";
        const adInfo = `[ADS-WA] Fuente: ${referral.source || 'N/D'} | AdID: ${referral.ad_id || 'N/D'}${adTitle ? ' | Título: ' + adTitle : ''}`;
        if (!profile.notes.includes(adInfo)) {
            profile.notes = (profile.notes + "\n" + adInfo).trim();
            userProfileCache.set(remoteJid, profile);
        }
        // Update session
        const session = chatSessions.get(remoteJid) || { messages: [] };
        session.referral = referral;
        chatSessions.set(remoteJid, session);
        console.log(`[Ads-WA] User ${remoteJid} clicked on ad:`, referral);
    }
      
    console.log(`[WA-CHAT] Incoming from ${remoteJid}: ${text}`);
      // Use buffering for WhatsApp as well to merge multiple messages
      enqueueBufferedMessage(remoteJid, text, "default", attachments);
  });

  // Init WA
  initWhatsApp();
  
  app.listen(PORT, () => console.log(`Multitenant Server running on port ${PORT}`));
})();
