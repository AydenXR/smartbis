import * as baileysPkg from '@whiskeysockets/baileys';
const makeWASocket = (baileysPkg.default && baileysPkg.default.makeWASocket) 
    ? baileysPkg.default.makeWASocket 
    : (baileysPkg.default || baileysPkg.makeWASocket);

const { 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion,
    downloadMediaMessage,
    makeCacheableSignalKeyStore,
} = baileysPkg.default || baileysPkg;
import pino from 'pino';
import qrcode from 'qrcode';
import axios from 'axios';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });
axios.defaults.httpsAgent = httpsAgent;

const AUTH_PATH = 'data/baileys_auth';
const WA_CONFIG_PATH = 'data/wa_config.json';
const LID_MAP_PATH = 'data/lid_map.json';

// Persistent cache for decryption retries
const MESSAGE_CACHE_PATH = 'data/message_cache.json';
const RETRY_CACHE_PATH = 'data/retry_cache.json';
let messageCache = new Map();
let msgRetryCounterCache = new Map();
const MAX_CACHE_SIZE = 1000;

function loadPersistentCaches() {
    try {
        if (fs.existsSync(MESSAGE_CACHE_PATH)) {
            const data = JSON.parse(fs.readFileSync(MESSAGE_CACHE_PATH, 'utf8'));
            messageCache = new Map(Object.entries(data));
        }
        if (fs.existsSync(RETRY_CACHE_PATH)) {
            const data = JSON.parse(fs.readFileSync(RETRY_CACHE_PATH, 'utf8'));
            msgRetryCounterCache = new Map(Object.entries(data));
        }
    } catch (e) { console.warn('[WA-CACHE] Error loading persistent caches:', e.message); }
}

function savePersistentCaches() {
    try {
        if (!fs.existsSync('data')) fs.mkdirSync('data', { recursive: true });
        fs.writeFileSync(MESSAGE_CACHE_PATH, JSON.stringify(Object.fromEntries(messageCache)));
        fs.writeFileSync(RETRY_CACHE_PATH, JSON.stringify(Object.fromEntries(msgRetryCounterCache)));
    } catch (e) { console.error('[WA-CACHE] Error saving persistent caches:', e.message); }
}

function cacheMessage(msgId, message) {
    if (!message) return;
    if (messageCache.size >= MAX_CACHE_SIZE) {
        const firstKey = messageCache.keys().next().value;
        messageCache.delete(firstKey);
    }
    // Unwrap ephemeral messages for better retry support
    let content = message;
    if (content.ephemeralMessage) content = content.ephemeralMessage.message;
    if (content.viewOnceMessage) content = content.viewOnceMessage.message;
    if (content.viewOnceMessageV2) content = content.viewOnceMessageV2.message;
    
    messageCache.set(msgId, content);
    savePersistentCaches();
}

function getCachedMessage(msgId) {
    return messageCache.get(msgId) || undefined;
}

loadPersistentCaches();

const AUTH_PATH_ABS = path.resolve(process.cwd(), AUTH_PATH);
let sock;
let clientStatus = 'DISCONNECTED';
let qrCodeData = null;
let currentWaConfig = { adminNumbers: [], groupName: "", groupId: "" };
let lidToJid = {}; // Map LID -> JID

// Listeners memory for late binding
let _validationCallback, _commandCallback, _chatCallback;

const loadWaConfig = () => {
    try {
        if (fs.existsSync(WA_CONFIG_PATH)) {
            const raw = fs.readFileSync(WA_CONFIG_PATH, 'utf8');
            currentWaConfig = JSON.parse(raw);
        }
    } catch (e) { console.error('[WA-CONFIG] Error loading config:', e.message); }
};

const loadLidMap = () => {
    try {
        if (fs.existsSync(LID_MAP_PATH)) {
            const raw = fs.readFileSync(LID_MAP_PATH, 'utf8');
            lidToJid = JSON.parse(raw);
            console.log(`[WA-LID] Loaded ${Object.keys(lidToJid).length} mappings from disk.`);
        }
    } catch (e) { console.error('[WA-LID] Error loading map:', e.message); }
};

const saveLidMap = () => {
    try {
        fs.writeFileSync(LID_MAP_PATH, JSON.stringify(lidToJid, null, 2));
    } catch (e) { console.error('[WA-LID] Error saving map:', e.message); }
};

export const normalizeJid = (num) => {
    if (!num) return "";
    if (String(num).endsWith("@lid") || String(num).endsWith("@g.us") || String(num).endsWith("@s.whatsapp.net")) return num;
    let clean = String(num).replace(/\D/g, "");
    if (clean.startsWith("52") && clean.length === 12 && clean[2] !== "1") {
        clean = "521" + clean.substring(2);
    }
    if (!clean.endsWith("@s.whatsapp.net")) clean += "@s.whatsapp.net";
    return clean;
};

export const getGroupList = async () => {
    if (!sock || clientStatus !== 'CONNECTED') return [];
    try {
        const groups = await sock.groupFetchAllParticipating();
        return Object.values(groups).map(g => ({ id: g.id, subject: g.subject }));
    } catch (e) {
        console.error('[WA-GROUPS] Error:', e.message);
        return [];
    }
};

loadWaConfig();
loadLidMap();

let isInitializing = false;
export const initWhatsApp = async () => {
    if (isInitializing) return console.log('[WA-INIT] Ya se está inicializando, saliendo...');
    isInitializing = true;

    if (sock) {
        try { 
            sock.ev.removeAllListeners();
            sock.end(); 
        } catch (e) {}
        sock = null;
    }

    try {
        const { state, saveCreds } = await useMultiFileAuthState(AUTH_PATH);
        const { version } = await fetchLatestBaileysVersion();
        const logger = pino({ level: 'debug' });

        // Cache para reintentos de descifrado por mensaje
        const msgRetryCounterCache = new Map();

        sock = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            logger,
            browser: ['SmartBis AI', 'Chrome', '110.0.5481.177'],
            markOnlineOnConnect: true,
            syncFullHistory: false,
            shouldSyncHistoryMessage: () => false,
            defaultQueryTimeoutMs: 120000,
            emitOwnEvents: true,
            retryRequestDelayMs: 500,
            maxMsgRetryCount: 15,
            msgRetryCounterCache,
            generateHighQualityLinkPreview: false,
            getMessage: async (key) => {
                // CRITICAL FIX: Called when WhatsApp asks for a message re-send for decryption retry
                const cached = getCachedMessage(key.id);
                if (cached) {
                    console.log(`[WA-RETRY] getMessage for ${key.id} - FOUND in cache (Success)`);
                    return cached;
                }
                
                // If not in cache, returning a stub for protocol messages to avoid loops
                console.log(`[WA-RETRY] getMessage for ${key.id} - NOT found in cache (Fail)`);
                return undefined;
            }
        });

        // Single creds.update listener (NO DUPLICATES)
        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                clientStatus = "QR";
                qrCodeData = await qrcode.toDataURL(qr);
                console.log('[WHATSAPP-BAILEYS] QR Generado.');
            }

            if (connection === 'close') {
                const statusCode = (lastDisconnect?.error)?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                console.log(`[WHATSAPP-BAILEYS] Conexión cerrada. Status: ${statusCode} | Reintentando: ${shouldReconnect}`);
                
                if (shouldReconnect) {
                    setTimeout(initWhatsApp, 3000);
                } else {
                    clientStatus = "DISCONNECTED";
                    qrCodeData = null;
                    console.log('[WHATSAPP-BAILEYS] Sesión cerrada (Logout). Borrando caché y re-intentando nuevo QR...');
                    setTimeout(() => {
                        if (fs.existsSync(AUTH_PATH)) {
                            try {
                                fs.rmSync(AUTH_PATH, { recursive: true, force: true });
                            } catch (e) {
                                console.log('[WA-CLEANUP] No se pudo borrar carpeta completa (EBUSY), intentando borrar contenido...');
                                try {
                                    const files = fs.readdirSync(AUTH_PATH);
                                    for (const f of files) {
                                        fs.rmSync(path.join(AUTH_PATH, f), { recursive: true, force: true });
                                    }
                                } catch (e2) { console.error('[WA-CLEANUP-DEEP] Falló:', e2.message); }
                            }
                        }
                        initWhatsApp();
                    }, 2000);
                }
            } else if (connection === 'open') {
                clientStatus = "CONNECTED";
                qrCodeData = null;
                console.log('[WHATSAPP-BAILEYS] Conectado exitosamente.');
            }
        });

        sock.ev.on('messages.upsert', async (m) => {
            console.log(`[WA-UPSERT] Recibidos ${m.messages?.length} mensajes. Tipo: ${m.type}`);
            if (m.type !== 'notify') return;
            for (const msg of m.messages) {
                // Cache ALL messages for decryption retry support
                if (msg.message && msg.key.id) {
                    console.log(`[WA-CACHE] Almacenando mensaje ${msg.key.id} para posibles re-intentos.`);
                    cacheMessage(msg.key.id, msg.message);
                }
                if (!msg.message || msg.key.fromMe) continue;
                const remoteJid = msg.key.remoteJid;
                const isGroup = remoteJid?.endsWith('@g.us');
                
                // Group logic is disabled for general interaction, skip processing
                if (isGroup) {
                    // Only process groups if we decide to handle specific admin commands there in the future
                    continue; 
                }

                const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || "";
                const senderName = msg.pushName || "";
                const senderJid = (msg.key.participant || msg.key.remoteJid).split(':')[0];
                
                // 1. Process mapping identity and referrals
                const contextInfo = msg.message?.extendedTextMessage?.contextInfo || msg.message?.imageMessage?.contextInfo || msg.message?.conversation?.contextInfo;
                const referral = contextInfo?.referral || null;

                if (senderJid.endsWith('@lid') && contextInfo?.quotedMessage && contextInfo?.participant) {
                    const quotedJid = contextInfo.participant.split(':')[0];
                    if (currentWaConfig.adminNumbers.some(a => normalizeJid(a) === quotedJid)) {
                        if (lidToJid[senderJid] !== quotedJid) {
                            lidToJid[senderJid] = quotedJid;
                            saveLidMap();
                            console.log(`[WA-LID] Auto-mapeado: ${senderJid} -> ${quotedJid}`);
                        }
                    }
                }

                const resolvedJid = lidToJid[senderJid] || senderJid;
                const isAdmin = currentWaConfig.adminNumbers.some(a => {
                    const aJid = normalizeJid(a);
                    return aJid === resolvedJid || aJid === senderJid || aJid === remoteJid;
                });

                const lowerText = text.trim().toLowerCase();
                
                // Diagnostic for 'Waiting for this message'
                if (!text && !msg.message?.stubType && !msg.message?.protocolMessage && !msg.message?.imageMessage && !msg.message?.videoMessage) {
                    console.log(`[WA-CRYPTO-FAIL] Globo gris de: ${remoteJid}. Identidad: ${senderJid}. Sincronización pendiente.`);
                }

                console.log(`[WA-IN] Msg from: ${remoteJid} (Res: ${resolvedJid}). Admin? ${isAdmin} | "${text.substring(0, 20)}..."`);

                // 2. Process Administrative Commands
                if (isAdmin && (lowerText.includes("aprobado") || lowerText.includes("rechazado") || lowerText.includes("aceptar") || lowerText.includes("denegar"))) {
                    console.log(`[WA-ADMIN] Comando detectado de ${senderName}: ${lowerText}`);
                    
                    // Call validation callback if it's a simple status update (old flow)
                    if (_validationCallback) {
                        await _validationCallback(resolvedJid, lowerText);
                    }
                    
                    // Call command callback for more complex AI-driven admin actions
                    if (_commandCallback) {
                        const result = await _commandCallback(resolvedJid, text, msg);
                        // If the command handler processed it, we can stop here or continue to AI
                        if (result) return;
                    }
                }

                // 3. AI Chat Handling
                if (_chatCallback) {
                    // Default: AI handles the message
                    const attachments = [];
                    if (msg.message?.imageMessage) {
                        attachments.push({ type: 'image', payload: { url: 'WHATSAPP_INTERNAL' }, isWhatsApp: true, msg });
                    }
                    await _chatCallback(resolvedJid, text, attachments, senderName, referral);
                }
            }
        });

    } catch (err) {
        console.error('[WA-INIT] Critical Error during socket creation:', err.message);
    } finally {
        isInitializing = false;
    }

    // Watch for config changes
    fs.watchFile(WA_CONFIG_PATH, (curr, prev) => {
        console.log('[WA-CONFIG] Config modified, reloading...');
        loadWaConfig();
    });

    return sock;
};

export const registerMessageHandlers = (v, config, cmd, chat) => {
    _validationCallback = v;
    _commandCallback = cmd;
    _chatCallback = chat;
};

export const getWAStatus = () => ({ status: clientStatus, qr: qrCodeData });

export const logoutWhatsApp = async () => {
    console.log('[WHATSAPP-BAILEYS] Iniciando proceso de logout manual (Limpieza profunda)...');
    try {
        if (sock) {
            await sock.logout().catch(e => console.log('[WA-LOGOUT] Ignored socket logout error:', e.message));
        }
    } catch (e) {
        console.error('[WA-LOGOUT] Error en logout:', e.message);
    } finally {
        // Clean up Auth Folder
        if (fs.existsSync(AUTH_PATH)) {
            try {
                fs.rmSync(AUTH_PATH, { recursive: true, force: true });
            } catch (e) { console.warn('[WA-LOGOUT] Auth remove failed:', e.message); }
        }
        // Clear message cache
        messageCache.clear();
        // Clean up LID Map (LID -> Phone identity)
        if (fs.existsSync(LID_MAP_PATH)) {
            try {
                fs.unlinkSync(LID_MAP_PATH);
                lidToJid = {};
            } catch (e) { console.warn('[WA-LOGOUT] LID Map remove failed:', e.message); }
        }
        
        clientStatus = 'DISCONNECTED';
        qrCodeData = null;
        console.log('[WHATSAPP-BAILEYS] Sesión eliminada completamente. Reiniciando instancia en 3 segundos...');
        setTimeout(initWhatsApp, 3000);
    }
    return true;
};

/**
 * Ensures live config updates from the server are reflected in the worker
 */
export const refreshConfig = () => {
    loadWaConfig();
    console.log('[WA-CONFIG] Configuración forzada/recargada live.');
};

export const sendToAdmins = async (message, mediaUrl) => {
    if (!sock || clientStatus !== 'CONNECTED' || !currentWaConfig?.adminNumbers?.length) return null;
    for (const adminNum of currentWaConfig.adminNumbers) {
        try {
            const cleanNum = normalizeJid(adminNum);
            if (mediaUrl) {
                try {
                    let imageBuffer;
                    if (mediaUrl.startsWith('data:')) {
                        const base64Data = mediaUrl.split(',')[1];
                        imageBuffer = Buffer.from(base64Data, 'base64');
                    } else if (mediaUrl.startsWith('http')) {
                        const res = await axios.get(mediaUrl, { responseType: 'arraybuffer', timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } });
                        imageBuffer = Buffer.from(res.data);
                    } else if (fs.existsSync(mediaUrl)) {
                        imageBuffer = fs.readFileSync(mediaUrl);
                    }

                    if (imageBuffer) {
                        const result = await sock.sendMessage(cleanNum, { image: imageBuffer, caption: message });
                        if (result?.key?.id) cacheMessage(result.key.id, result.message);
                    } else {
                        const result = await sock.sendMessage(cleanNum, { text: message });
                        if (result?.key?.id) cacheMessage(result.key.id, result.message);
                    }
                } catch (imgErr) {
                    console.error(`[WHATSAPP] Falló imagen a ${adminNum}, reintentando texto:`, imgErr.message);
                    const result = await sock.sendMessage(cleanNum, { text: message });
                    if (result?.key?.id) cacheMessage(result.key.id, result.message);
                }
            } else {
                const result = await sock.sendMessage(cleanNum, { text: message });
                if (result?.key?.id) cacheMessage(result.key.id, result.message);
            }
        } catch (err) {
            console.error(`[WHATSAPP] Error enviando a admin ${adminNum}:`, err.message);
        }
    }
    return true;
};

export const sendWhatsAppMessage = async (jid, text) => {
    if (!sock || clientStatus !== 'CONNECTED') return null;
    try {
        const cleanJid = normalizeJid(jid);
        const result = await sock.sendMessage(cleanJid, { text });
        // Cache sent message for decryption retry by mobile device
        if (result?.key?.id) {
            cacheMessage(result.key.id, result.message);
        }
        return result;
    } catch (e) {
        console.error('[WA-SEND] Error:', e.message);
        return null;
    }
};

export const sendWhatsAppImage = async (jid, urlOrPath, caption = "") => {
    if (!sock || clientStatus !== 'CONNECTED') return null;
    try {
        const cleanJid = normalizeJid(jid);
        let imageSource;
        if (urlOrPath.startsWith('http')) {
            const res = await axios.get(urlOrPath, { responseType: 'arraybuffer' });
            imageSource = Buffer.from(res.data);
        } else {
            imageSource = fs.readFileSync(urlOrPath);
        }
        const result = await sock.sendMessage(cleanJid, { image: imageSource, caption });
        // Cache sent image for decryption retry support
        if (result?.key?.id) {
            cacheMessage(result.key.id, result.message);
        }
        return result;
    } catch (e) {
        console.error('[WA-SEND-IMG] Error:', e.message);
        return null;
    }
};

export const downloadWAImage = async (msg) => {
    try {
        const buffer = await downloadMediaMessage(msg, 'buffer', {}, { 
            logger: pino({ level: 'silent' }),
            reuploadRequest: sock.updateMediaMessage 
        });
        return buffer;
    } catch (e) {
        console.error('[WA-DOWNLOAD] Error:', e.message);
        return null;
    }
};
