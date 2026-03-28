// UI Reference safely helper
const getEl = (id) => document.getElementById(id) || { textContent: "", value: "", style: {}, addEventListener: () => {} };

const profileBtn = getEl("profileBtn");
const passModal = getEl("passModal");
const passModalTitle = getEl("passModalTitle");
const passModalDesc = getEl("passModalDesc");
const oldPassInput = getEl("oldPassInput");
const newPassInput = getEl("newPassInput");
const confirmPassInput = getEl("confirmPassInput");
const passError = getEl("passError");
const savePassBtn = getEl("savePassBtn");
const cancelPassBtn = getEl("cancelPassBtn");

const chatCountEl = getEl("chat-count");
const chatListContainer = getEl("chat-list-container");
const chatMessagesEl = getEl("chat-messages");
const currentChatNameEl = getEl("current-chat-name");
const userInfoDetailEl = getEl("user-info-detail");
const dateFilter = getEl("dateFilter");
const replyTextarea = getEl("replyTextarea");
const sendReplyBtn = getEl("sendReplyBtn");

// Switches
const messengerSwitch = getEl("messengerStatus");
const whatsappSwitch = getEl("whatsappStatus");

let activePsid = null;
let messagesChart = null;
let allChatsBuffer = [];
let currentFilter = 'all';

async function api(path, options) {
  const response = await fetch(path, options);
  if (!response.ok) {
     const text = await response.text();
     console.error("API Error Response:", text);
     throw new Error(text.includes("<!DOCTYPE") ? "Error del servidor (502/Crash)" : "Error API");
  }
  return await response.json();
}

// BOT STATUS TOGGLE
async function loadBotStatus() {
    try {
        const status = await api("/api/bot/status");
        if (getEl("messengerStatus").id) getEl("messengerStatus").checked = !!status.messenger;
        if (getEl("whatsappStatus").id) getEl("whatsappStatus").checked = !!status.whatsapp;
    } catch (e) { console.error("Error loading status:", e); }
}

async function toggleBotStatus(platform, status) {
    try {
        await api("/api/bot/status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ platform, status })
        });
    } catch (e) {
        alert("Error al cambiar estado: " + e.message);
        loadBotStatus(); // Revert
    }
}
window.toggleBotStatus = toggleBotStatus;

// SECURITY & PASSWORD LOGIC
async function checkPasswordStatus() {
  const mustChange = sessionStorage.getItem('gb_must_change') === 'true';
  if (mustChange) {
    passModalTitle.textContent = "Seguridad Obligatoria";
    passModalDesc.textContent = "Debes cambiar la contraseña genérica 'admin' para habilitar el panel.";
    cancelPassBtn.classList.add("hidden"); 
    passModal.classList.remove("hidden");
  } else {
    cancelPassBtn.classList.remove("hidden");
  }
}

async function handlePassUpdate() {
  const oldPass = oldPassInput.value.trim();
  const newPass = newPassInput.value.trim();
  const confirmPass = confirmPassInput.value.trim();
  
  if (!oldPass || !newPass || !confirmPass) {
    passError.textContent = "Todos los campos son requeridos.";
    return;
  }
  if (newPass.length < 4) {
    passError.textContent = "La nueva contraseña debe tener al menos 4 caracteres.";
    return;
  }
  if (newPass !== confirmPass) {
    passError.textContent = "Las contraseñas no coinciden.";
    return;
  }

  if (!confirm("¿Estás seguro de que deseas cambiar tu contraseña?")) return;

  try {
    savePassBtn.disabled = true;
    await api("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldPassword: oldPass, newPassword: newPass })
    });
    
    alert("Contraseña actualizada con éxito.");
    sessionStorage.removeItem('gb_must_change');
    passModal.classList.add("hidden");
    oldPassInput.value = ""; newPassInput.value = ""; confirmPassInput.value = ""; passError.textContent = "";

  } catch (e) { passError.textContent = e.message; }
  finally { savePassBtn.disabled = false; }
}

// METRICS
async function fetchSummary() {
    try {
        const data = await api("/metrics/api/summary");
        updateChart(data.daily || []);
    } catch (e) { console.error("Summary error:", e); }
}

function updateChart(dailyData) {
    const chartEl = document.getElementById('messagesChart');
    if (!chartEl) return;
    const ctx = chartEl.getContext('2d');
    const labels = dailyData.map(d => d.dateKey).reverse();
    const messengerData = dailyData.map(d => d.messenger || 0).reverse();
    const whatsappData = dailyData.map(d => d.whatsapp || 0).reverse();

    if (messagesChart) messagesChart.destroy();

    messagesChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Messenger',
                    data: messengerData,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    borderWidth: 2, tension: 0.4, fill: true, pointRadius: 2
                },
                {
                    label: 'WhatsApp',
                    data: whatsappData,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    borderWidth: 2, tension: 0.4, fill: true, pointRadius: 2
                }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { display: false, beginAtZero: true }, x: { display: false } }
        }
    });
}

// CHATS & MESSAGES
async function loadConversations(date = "") {
    try {
        const url = date ? `/metrics/api/conversations?dateKey=${date}` : "/metrics/api/conversations";
        const data = await api(url);
        allChatsBuffer = data.items || [];
        applyCurrentFilter();
    } catch (e) { console.error("Error loading chats", e); }
}

function filterByPlatform(type, btn) {
    currentFilter = type;
    document.querySelectorAll('.filter-btn').forEach(b => {
        b.classList.remove('active');
        b.style.background = 'transparent';
        b.style.color = 'var(--text-dim)';
    });
    btn.classList.add('active');
    btn.style.background = 'rgba(255,255,255,0.05)';
    btn.style.color = 'white';
    applyCurrentFilter();
}
window.filterByPlatform = filterByPlatform;

function applyCurrentFilter() {
    let filtered = allChatsBuffer;
    if (currentFilter === 'whatsapp') {
        filtered = allChatsBuffer.filter(c => c.conversationId.includes("@s.whatsapp.net") || c.conversationId.includes("@lid"));
    } else if (currentFilter === 'messenger') {
        filtered = allChatsBuffer.filter(c => !c.conversationId.includes("@s.whatsapp.net") && !c.conversationId.includes("@lid"));
    }
    renderChatList(filtered);
    chatCountEl.textContent = filtered.length;
}

function renderChatList(chats) {
    if (!chats.length) {
        chatListContainer.innerHTML = '<div class="empty-state">No hay conversaciones para este día.</div>';
        return;
    }

    chatListContainer.innerHTML = chats.map(chat => {
        const isWA = chat.conversationId.includes("@s.whatsapp.net") || chat.conversationId.includes("@lid");
        const platformClass = isWA ? 'platform-whatsapp' : 'platform-messenger';
        const platformTag = isWA ? '<span class="platform-tag whatsapp">WA</span>' : '<span class="platform-tag messenger">MSGR</span>';
        
        // Use senderName if available, else truncate ID
        const displayName = chat.senderName || chat.conversationId;
        const shortName = displayName.length > 18 ? displayName.substring(0, 15) + "..." : displayName;

        return `
            <div class="chat-item ${platformClass}" onclick="loadMessages('${chat.conversationId}')">
                <div style="display:flex; align-items:center; width:100%;">
                    <div class="user">${shortName}</div>
                    ${platformTag}
                </div>
                <div class="preview">${chat.responseCount} mensajes</div>
            </div>
        `;
    }).join("");
}

async function loadMessages(psid) {
    try {
        activePsid = psid;
        currentChatNameEl.textContent = `Cargando...`;
        chatMessagesEl.innerHTML = '<div class="empty-state">Cargando historial...</div>';
        
        const [data, profile] = await Promise.all([
            api(`/metrics/api/conversations/${psid}`),
            api(`/api/users/${psid}`).catch(() => ({ name: psid }))
        ]);

        renderMessages(data.items || []);
        currentChatNameEl.textContent = profile.name || psid;

        const isWA = psid.includes("@s.whatsapp.net") || psid.includes("@lid");
        const avatarHtml = `<div class="user-avatar-large">${(profile.name || psid).slice(0, 2).toUpperCase()}</div>`;

        userInfoDetailEl.innerHTML = `
            <div class="user-card-detail">
                ${avatarHtml}
                <div style="width:100%; text-align:left;">
                    <label class="meta-label">Nombre del Cliente</label>
                    <input type="text" id="edit-user-name" class="detail-input" value="${profile.name || ''}" placeholder="Nombre Completo">
                    <label class="meta-label">WhatsApp / Contacto</label>
                    <input type="text" id="edit-user-wa" class="detail-input" value="${profile.whatsapp || ''}" placeholder="+52...">
                    <label class="meta-label">Email</label>
                    <input type="text" id="edit-user-email" class="detail-input" value="${profile.email || ''}" placeholder="correo@gmail.com">
                    <label class="meta-label">Notas Internas</label>
                    <textarea id="edit-user-notes" class="detail-input" style="height:60px;">${profile.notes || ''}</textarea>
                    <button onclick="saveUserInfo()" class="save-user-btn">GUARDAR CAMBIOS</button>
                    <div style="margin-top:20px; font-size:10px; opacity:0.5; color:var(--text-dim);">
                        ID: ${psid} | PLATAFORMA: ${isWA ? 'WHATSAPP' : 'MESSENGER'}
                    </div>
                </div>
            </div>
        `;
    } catch (e) { chatMessagesEl.innerHTML = '<div class="error-text">No se pudo cargar el chat.</div>'; }
}

async function saveUserInfo() {
    if (!activePsid) return;
    const name = getEl("edit-user-name").value;
    const whatsapp = getEl("edit-user-wa").value;
    const email = getEl("edit-user-email").value;
    const notes = getEl("edit-user-notes").value;

    try {
        await api(`/api/users/${activePsid}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, whatsapp, email, notes })
        });
        alert("¡Datos guardados!");
        currentChatNameEl.textContent = name || activePsid;
        loadConversations(dateFilter.value);
    } catch (e) { alert("Error al guardar: " + e.message); }
}
window.saveUserInfo = saveUserInfo;

function renderMessages(messages) {
    chatMessagesEl.innerHTML = messages.map(msg => `
        <div class="message-wrapper user-side" style="margin-bottom:20px;">
            <div style="font-size:10px; color:var(--text-dim); margin-bottom:5px; margin-left:10px;">usuario</div>
            <div class="message user" style="max-width: fit-content;">${msg.question}</div>
        </div>
        <div class="message-wrapper bot-side" style="margin-bottom:20px; display:flex; flex-direction:column; align-items:flex-end;">
            <div style="font-size:10px; color:var(--accent-secondary); margin-bottom:5px; margin-right:10px;">Bot</div>
            <div class="message bot">${msg.answer}</div>
        </div>
    `).join("");
    if (chatMessagesEl.parentElement) {
        chatMessagesEl.parentElement.scrollTop = chatMessagesEl.parentElement.scrollHeight;
    }
}

async function loadBranding() {
    try {
        const data = await api("/api/branding");
        const appTitleEl = document.querySelector(".glow-text");
        const appLogoEl = document.querySelector(".app-logo-img");
        if (appTitleEl) appTitleEl.textContent = data.appName;
        if (appLogoEl) appLogoEl.src = data.appLogo;
        document.title = `${data.appName} | Panel de Control`;
    } catch (e) { console.error("Error loading branding:", e); }
}

// APP BOOT
async function boot() {
  try {
    const today = new Date().toLocaleString('sv-SE', { timeZone: 'America/Hermosillo' }).split(" ")[0];
    if (dateFilter.id) dateFilter.value = today;

    await loadBranding();
    await checkPasswordStatus();
    await loadBotStatus();
    await fetchSummary();
    await loadConversations(today);
  } catch (e) { console.error("Boot error", e); }
}

async function sendManualReply() {
    const text = replyTextarea.value.trim();
    if (!text || !activePsid) return;

    try {
        sendReplyBtn.disabled = true;
        await api(`/metrics/api/conversations/${activePsid}/reply`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text })
        });
        replyTextarea.value = ""; replyTextarea.style.height = '50px';
        await loadMessages(activePsid);
    } catch (e) { alert("Error al enviar: " + e.message);
    } finally { sendReplyBtn.disabled = false; }
}

// EVENTS
if (dateFilter.id) dateFilter.addEventListener("change", (e) => loadConversations(e.target.value));
if (profileBtn.id) profileBtn.addEventListener("click", () => passModal.classList.remove("hidden"));
if (savePassBtn.id) savePassBtn.addEventListener("click", handlePassUpdate);
if (cancelPassBtn.id) cancelPassBtn.addEventListener("click", () => passModal.classList.add("hidden"));

if (replyTextarea.id) {
    replyTextarea.addEventListener("input", function() {
        this.style.height = '50px';
        this.style.height = (this.scrollHeight) + 'px';
    });
    replyTextarea.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendManualReply(); }
    });
}
if (sendReplyBtn.id) sendReplyBtn.addEventListener("click", sendManualReply);

window.loadMessages = loadMessages;
boot();
