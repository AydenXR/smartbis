const API_BASE = String(window.METRICS_API_BASE || "").trim();

const statusEl = document.getElementById("metricsStatus");
const totalMessagesEl = document.getElementById("totalMessages");
const evaluatedMessagesEl = document.getElementById("evaluatedMessages");
const approvedMessagesEl = document.getElementById("approvedMessages");
const rejectedMessagesEl = document.getElementById("rejectedMessages");
const dailyIceberg = document.getElementById("dailyIceberg");
const chatListEl = document.getElementById("chatList");
const calendarDaysEl = document.getElementById("calendarDays");
const conversationThread = document.getElementById("conversationThread");

let selectedDateKey = "";
let selectedConversationId = "";
let conversationsCache = [];
let availableDays = [];

async function fetchJson(path) {
  const resp = await fetch(`${API_BASE}${path}`);
  if (!resp.ok) throw new Error(`API Error: ${resp.status}`);
  return resp.json();
}

async function postJson(path, body) {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  if (!resp.ok) throw new Error(`API Error: ${resp.status}`);
  return resp.json();
}

function formatDate(value) {
    const parts = String(value).split("-");
    if(parts.length < 3) return value;
    return `${parts[2]}/${parts[1]}/${parts[0].slice(2)}`;
}

function renderDailyOverview(daily) {
    dailyIceberg.innerHTML = "";
    daily.forEach(item => {
        const total = item.total || 0;
        const approved = item.approved || 0;
        const rejected = item.rejected || 0;
        const evalCount = item.evaluated || 0;
        
        const approvedPct = total ? (approved / total) * 100 : 0;
        const rejectedPct = total ? (rejected / total) * 100 : 0;
        const pendingPct = 100 - approvedPct - rejectedPct;

        const card = document.createElement("div");
        card.className = `stair-step ${selectedDateKey === item.dateKey ? 'active' : ''}`;
        card.innerHTML = `
            <div class="stair-title">
                <span>${formatDate(item.dateKey)}</span>
                <span>Score: ${item.score !== null ? item.score + '%' : '--'}</span>
            </div>
            <div class="stair-bar">
                <div class="stair-approved" style="width: ${approvedPct}%"></div>
                <div class="stair-rejected" style="width: ${rejectedPct}%"></div>
                <div class="stair-pending" style="width: ${pendingPct}%"></div>
            </div>
        `;
        card.onclick = () => {
            selectedDateKey = item.dateKey;
            loadDailyData();
        };
        dailyIceberg.appendChild(card);
    });
}

function renderChatSidebar(items) {
    chatListEl.innerHTML = "";
    if(!items.length) {
        chatListEl.innerHTML = '<div class="empty-state">No hay chats este día</div>';
        return;
    }
    items.forEach(convo => {
        const div = document.createElement("div");
        div.className = `chat-item ${selectedConversationId === convo.conversationId ? 'active' : ''}`;
        div.innerHTML = `
            <div class="chat-info">
                <strong>ID: ${convo.senderId.slice(-8)}</strong>
                <p style="font-size: 0.75rem; color: #64748b">${convo.responseCount} msgs</p>
            </div>
            <span class="chat-badge">${convo.total - convo.evaluated}</span>
        `;
        div.onclick = () => {
            selectedConversationId = convo.conversationId;
            renderChatSidebar(items);
            loadThread();
        };
        chatListEl.appendChild(div);
    });
}

async function loadDailyData() {
    statusEl.textContent = "Obteniendo datos...";
    const data = await fetchJson("/metrics/api/summary");
    totalMessagesEl.textContent = data.totalMessages;
    evaluatedMessagesEl.textContent = data.evaluated;
    approvedMessagesEl.textContent = data.approved;
    rejectedMessagesEl.textContent = data.rejected;

    renderDailyOverview(data.daily || []);
    
    // Load days footer
    calendarDaysEl.innerHTML = "";
    (data.daily || []).forEach(d => {
        const btn = document.createElement("button");
        btn.className = `calendar-day ${selectedDateKey === d.dateKey ? 'active' : ''}`;
        btn.textContent = formatDate(d.dateKey);
        btn.onclick = () => {
            selectedDateKey = d.dateKey;
            loadDailyData();
        };
        calendarDaysEl.appendChild(btn);
    });

    // Load Convos
    const query = selectedDateKey ? `?dateKey=${selectedDateKey}` : "";
    const convos = await fetchJson(`/metrics/api/conversations${query}`);
    renderChatSidebar(convos.items || []);
    
    if(!selectedConversationId && convos.items?.length) {
        selectedConversationId = convos.items[0].conversationId;
    }
    if(selectedConversationId) loadThread();
    
    statusEl.textContent = "Sincronizado";
}

async function loadThread() {
    if(!selectedConversationId) return;
    const data = await fetchJson(`/metrics/api/conversations/${selectedConversationId}`);
    conversationThread.innerHTML = "";
    
    data.items.forEach(msg => {
        const u = document.createElement("div");
        u.className = "chat-bubble user";
        u.textContent = msg.question;
        conversationThread.appendChild(u);

        const b = document.createElement("div");
        b.className = "chat-bubble bot";
        b.innerHTML = `
            <div class="bot-text">${msg.answer}</div>
            <div class="chat-actions">
                <button class="eval-btn approve ${msg.evalStatus === 'approved' ? 'active' : ''}">✔</button>
                <button class="eval-btn reject ${msg.evalStatus === 'rejected' ? 'active' : ''}">✖</button>
            </div>
        `;
        
        const aBtn = b.querySelector(".approve");
        const rBtn = b.querySelector(".reject");

        aBtn.onclick = () => updateEval(msg.id, 'approved', aBtn, rBtn);
        rBtn.onclick = () => updateEval(msg.id, 'rejected', rBtn, aBtn);

        conversationThread.appendChild(b);
    });
    
    setTimeout(() => {
        conversationThread.scrollTop = conversationThread.scrollHeight;
    }, 50);
}

async function updateEval(msgId, status, btn, other) {
    const isRemove = btn.classList.contains("active");
    const newStatus = isRemove ? null : status;
    
    await postJson(`/metrics/api/messages/${msgId}/evaluate`, { status: newStatus });
    
    btn.classList.toggle("active", !isRemove);
    other.classList.remove("active");
    // Refresh overview silently
    fetchJson("/metrics/api/summary").then(data => {
        totalMessagesEl.textContent = data.totalMessages;
        evaluatedMessagesEl.textContent = data.evaluated;
        approvedMessagesEl.textContent = data.approved;
        rejectedMessagesEl.textContent = data.rejected;
        renderDailyOverview(data.daily || []);
    });
}

async function boot() {
    try {
        const days = await fetchJson("/metrics/api/days");
        if(days.items?.length) selectedDateKey = days.items[0];
        await loadDailyData();
    } catch(e) {
        statusEl.textContent = "Error de conexión";
        console.error(e);
    }
}

boot();
