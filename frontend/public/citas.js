const configForm = document.getElementById('config-form');
const viewDateInput = document.getElementById('view-date');
const slotsContainer = document.getElementById('slots-container');
const configStatus = document.getElementById('config-status');

// Set default date to today
viewDateInput.value = new Date().toISOString().split('T')[0];

async function loadConfig() {
    try {
        const res = await fetch('/api/appointments/config');
        const config = await res.json();
        document.getElementById('startTime').value = config.startTime;
        document.getElementById('endTime').value = config.endTime;
        document.getElementById('durationMinutes').value = config.durationMinutes;
        document.getElementById('gapMinutes').value = config.gapMinutes;
        document.getElementById('skipDays').value = config.skipDays || "0";
        document.getElementById('saturdayEndTime').value = config.saturdayEndTime || "17:00";
    } catch (e) {
        console.error('Error loading config:', e);
    }
}

async function saveConfig(e) {
    e.preventDefault();
    configStatus.textContent = 'Guardando...';
    const config = {
        startTime: document.getElementById('startTime').value,
        endTime: document.getElementById('endTime').value,
        durationMinutes: parseInt(document.getElementById('durationMinutes').value),
        gapMinutes: parseInt(document.getElementById('gapMinutes').value),
        skipDays: document.getElementById('skipDays').value,
        saturdayEndTime: document.getElementById('saturdayEndTime').value
    };

    try {
        const res = await fetch('/api/appointments/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });
        if (res.ok) {
            configStatus.textContent = '✅ Configuración guardada';
            setTimeout(() => configStatus.textContent = '', 3000);
            loadSlots();
        } else {
            configStatus.textContent = '❌ Error al guardar';
        }
    } catch (e) {
        configStatus.textContent = '❌ Error de conexión';
    }
}

async function loadSlots() {
    const date = viewDateInput.value;
    if (!date) return;

    slotsContainer.innerHTML = '<div class="empty-state">Cargando disponibilidad...</div>';

    try {
        const res = await fetch(`/api/appointments/list?date=${date}`);
        const data = await res.json();
        
        if (data.items && data.items.length > 0) {
            slotsContainer.innerHTML = '';
            data.items.forEach(slot => {
                const div = document.createElement('div');
                div.className = 'slot-card';
                const opacity = slot.isBusy ? '0.6' : '1';
                const color = slot.isBusy ? '#ef4444' : '#10b981';
                const statusText = slot.isBusy ? slot.busyLabel : 'Disponible';
                
                div.style = `opacity: ${opacity}; background: rgba(255,255,255,0.05); padding: 15px; border-radius: 12px; border: 1px solid ${slot.isBusy ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.1)'}; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;`;
                div.innerHTML = `
                    <div>
                        <span style="color: ${slot.isBusy ? '#fca5a5' : 'var(--primary)'}; font-weight: 800; font-size: 18px;">${slot.label}</span>
                        <div style="font-size: 12px; color: ${slot.isBusy ? '#f87171' : 'var(--text-dim)'};">${statusText}</div>
                    </div>
                    <div style="background: ${color}; width: 10px; height: 10px; border-radius: 50%; box-shadow: 0 0 10px ${color};"></div>
                `;
                slotsContainer.appendChild(div);
            });
        } else {
            slotsContainer.innerHTML = '<div class="empty-state">No hay horarios disponibles para esta fecha o configuración.</div>';
        }
    } catch (e) {
        slotsContainer.innerHTML = '<div class="empty-state">Error al cargar disponibilidad.</div>';
    }
}

configForm.addEventListener('submit', saveConfig);
viewDateInput.addEventListener('change', loadSlots);

// Initial load
loadConfig();
loadSlots();
