const calendarBody = document.getElementById('calendarBody');
const monthLabel = document.getElementById('monthLabel');
const prevBtn = document.getElementById('prevMonth');
const nextBtn = document.getElementById('nextMonth');

let currentDate = new Date();
let events = { appointments: [], courses: [] };

let branding = { itemName: 'Cursos / Eventos' };

async function fetchBranding() {
    try {
        const res = await fetch('/api/config/branding');
        const data = await res.json();
        branding = { ...branding, ...data };
        const titleLabel = document.querySelector('#eventModal label');
        if (titleLabel) titleLabel.textContent = `Título del ${branding.itemName}`;
        const legendItem = document.querySelectorAll('.legend-item span')[1];
        if (legendItem) legendItem.textContent = `${branding.itemName}`;
    } catch (e) { console.warn('Branding fetch failed:', e.message); }
}

async function fetchEvents() {
    try {
        const res = await fetch('/api/calendar/events');
        events = await res.json();
        renderCalendar();
    } catch (e) {
        console.error('Error fetching calendar events:', e);
    }
}

function renderCalendar() {
    calendarBody.innerHTML = '';
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    monthLabel.textContent = `${monthNames[month]} ${year}`;

    const dayHeaders = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
    dayHeaders.forEach(h => {
        const div = document.createElement('div');
        div.className = 'day-label';
        div.textContent = h;
        calendarBody.appendChild(div);
    });
    
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    // Padding prev month
    for (let i = firstDay - 1; i >= 0; i--) {
        calendarBody.appendChild(createDayDiv("", true));
    }
    // Current month days
    const today = new Date().toISOString().split('T')[0];
    const monthShorts = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${(month + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
        const isToday = today === dateStr;
        const displayDay = day === 1 ? `1 de ${monthShorts[month]}` : day;
        const dayDiv = createDayDiv(displayDay, false, isToday);
        dayDiv.onclick = () => window.openEventModal(dateStr);
        const eventList = document.createElement('div');
        eventList.className = 'event-list';

        // Appointments
        (events?.appointments || []).filter(a => (a?.start || "").startsWith(dateStr)).forEach(appt => {
            const tag = document.createElement('div');
            tag.className = 'event-tag event-cita';
            tag.innerHTML = `<span>${appt.title}</span>`;
            tag.onclick = (e) => {
                e.stopPropagation();
                window.viewEventDetails(appt, 'cita');
            };
            eventList.appendChild(tag);
        });
        
        // Courses
        (events?.courses || []).filter(c => (c?.date || "") === dateStr).forEach(course => {
            const tag = document.createElement('div');
            const isInhabil = course.title === "INHABIL" || course.title === "CERRADO";
            tag.className = `event-tag ${isInhabil ? 'event-inhabil' : 'event-curso'}`;
            tag.innerHTML = `<span>${course.title}</span> <button class="delete-event-btn" onclick="window.deleteEvent(event, '${course.id}')">×</button>`;
            tag.onclick = (e) => {
                if (e.target.tagName === 'BUTTON') return;
                e.stopPropagation();
                window.viewEventDetails(course, 'curso');
            };
            eventList.appendChild(tag);
        });
        
        dayDiv.appendChild(eventList);
        calendarBody.appendChild(dayDiv);
    }

    // Always fill up to 42 cells (6 rows) to ensure consistent height
    const filled = firstDay + daysInMonth;
    for (let i = filled; i < 42; i++) {
        calendarBody.appendChild(createDayDiv("", true));
    }
}

window.viewEventDetails = (data, type) => {
    let detailsStr = '';
    if (type === 'cita') {
        const d = data.raw || data;
        detailsStr = `
            <div style="text-align: left; font-size: 14px; line-height: 1.8;">
                <p><strong>👤 Paciente:</strong> ${d.nombre || 'N/A'}</p>
                <p><strong>📋 Motivo:</strong> ${d.motivo || 'N/A'}</p>
                <p><strong>📱 WhatsApp:</strong> ${d.whatsapp || 'N/A'}</p>
                <p><strong>⏰ Horario:</strong> ${d.horario || d.horario_cita || 'N/A'}</p>
                <hr style="opacity: 0.1; margin: 15px 0;">
                <p><strong>📍 Estado:</strong> <span class="badge" style="display:inline-block">${data.status || 'aprobado'}</span></p>
                <p style="margin-top: 10px; color: var(--text-dim); font-size: 11px;">Ticket ID: ${data.id || 'N/A'}</p>
            </div>
        `;
    } else {
        const d = data.details || {};
        detailsStr = `<div style="text-align: left; font-size: 14px; line-height: 1.8;">`;
        for (const [k, v] of Object.entries(d)) {
            detailsStr += `<p><strong>🔹 ${k}:</strong> ${v}</p>`;
        }
        detailsStr += `<hr style="opacity: 0.1; margin: 15px 0;"><p style="color: var(--text-dim); font-size: 11px;">Event ID: ${data.id}</p></div>`;
    }

    const modal = document.getElementById('viewModal');
    const title = document.getElementById('viewTitle');
    const container = document.getElementById('viewContent');
    
    title.textContent = data.title || 'Detalles del Evento';
    container.innerHTML = detailsStr;
    modal.classList.add('active');
};

window.closeViewModal = () => {
    document.getElementById('viewModal').classList.remove('active');
};

function createDayDiv(day, otherMonth, isToday) {
    const div = document.createElement('div');
    div.className = `calendar-day ${otherMonth ? 'other-month' : ''}`;
    
    // Google Calendar style header: center circle for today
    const header = document.createElement('div');
    header.className = 'calendar-day-header';
    if (isToday && day) {
        header.innerHTML = `<span class="today-circle">${day}</span>`;
    } else {
        header.innerHTML = `<span>${day}</span>`;
    }
    
    div.appendChild(header);
    return div;
}

// Event Modal & Custom Fields
window.openEventModal = (dateStr = '') => {
    document.getElementById('customFieldsContainer').innerHTML = '';
    document.getElementById('eventTitle').value = '';
    document.getElementById('eventDate').value = dateStr;
    document.getElementById('eventModal').classList.add('active');
};
window.closeEventModal = () => document.getElementById('eventModal').classList.remove('active');

function addDetailField(key = '', placeholder = '') {
    const container = document.getElementById('customFieldsContainer');
    const div = document.createElement('div');
    div.className = 'custom-field-row';
    div.style = 'display: flex; gap: 8px; align-items: center; margin-bottom: 8px;';
    div.innerHTML = `
        <input type="text" class="app-input field-key" placeholder="Dato" value="${key}" style="flex: 1; font-size: 11px; padding: 10px;">
        <input type="text" class="app-input field-value" placeholder="${placeholder || 'Valor'}" style="flex: 2; font-size: 11px; padding: 10px;">
        <button type="button" class="delete-field-btn" style="background: #ef4444; width: 24px; height: 24px; border: none; border-radius: 4px; color: white; cursor: pointer;">×</button>
    `;
    container.appendChild(div);
    div.querySelector('.delete-field-btn').onclick = () => div.remove();
}

// Bind Listeners
document.getElementById('addDesc')?.addEventListener('click', () => addDetailField('Descripción', 'Detalles...'));
document.getElementById('addPrice')?.addEventListener('click', () => addDetailField('Precio', '$...'));
document.getElementById('addMod')?.addEventListener('click', () => addDetailField('Modalidad', '...'));
document.getElementById('addOther')?.addEventListener('click', () => addDetailField('', ''));

window.deleteEvent = async (e, id) => {
    e.stopPropagation();
    if (!confirm('¿Eliminar este evento?')) return;
    try {
        await fetch(`/api/events/${id}`, { method: 'DELETE' });
        fetchEvents();
    } catch (err) { alert('Error al eliminar'); }
};

document.getElementById('eventForm').onsubmit = async (e) => {
    e.preventDefault();
    const details = {};
    document.querySelectorAll('.custom-field-row').forEach(row => {
        const key = row.querySelector('.field-key').value.trim();
        const value = row.querySelector('.field-value').value.trim();
        if (key) details[key] = value;
    });

    const data = {
        title: document.getElementById('eventTitle').value,
        date: document.getElementById('eventDate').value,
        details: details
    };

    try {
        const res = await fetch('/api/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (res.ok) {
            window.closeEventModal();
            fetchEvents();
        }
    } catch (err) { alert('Error al guardar'); }
};

// Appointment Window Configuration logic
async function loadConfig() {
    try {
        const res = await fetch('/api/appointments/config');
        const config = await res.json();
        document.getElementById('start_time').value = config.startTime;
        document.getElementById('end_time').value = config.end_time || config.endTime;
        document.getElementById('saturday_closing').value = config.saturdayEndTime || "17:00";
        document.getElementById('appointment_duration').value = config.durationMinutes;
        document.getElementById('buffer_time').value = config.gapMinutes || 0;
        document.getElementById('off_day').value = config.skipDays || "0";
        document.getElementById('days_to_offer').value = config.displayDays || 1;
    } catch (e) {
        console.error('Error loading config:', e);
    }
}

document.getElementById('calendarConfigForm').onsubmit = async (e) => {
    e.preventDefault();
    const status = document.getElementById('saveStatus');
    status.textContent = 'Guardando...';
    const config = {
        startTime: document.getElementById('start_time').value,
        endTime: document.getElementById('end_time').value,
        saturdayEndTime: document.getElementById('saturday_closing').value,
        durationMinutes: parseInt(document.getElementById('appointment_duration').value),
        gapMinutes: parseInt(document.getElementById('buffer_time').value),
        skipDays: document.getElementById('off_day').value,
        displayDays: parseInt(document.getElementById('days_to_offer').value)
    };

    try {
        await fetch('/api/appointments/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });
        status.textContent = '✅ Guardado con éxito';
        setTimeout(() => status.textContent = '', 3000);
    } catch (e) {
        status.textContent = '❌ Error al guardar';
    }
};

prevBtn.onclick = () => { currentDate.setMonth(currentDate.getMonth() - 1); renderCalendar(); };
nextBtn.onclick = () => { currentDate.setMonth(currentDate.getMonth() + 1); renderCalendar(); };

window.markAsInhabil = async () => {
    const date = document.getElementById('eventDate').value;
    if (!date) return alert('Selecciona una fecha primero');
    if (!confirm('¿Marcar este día como INHÁBIL (Sin Citas)?')) return;
    const data = {
        title: 'INHABIL',
        date: date,
        details: { tipo: 'Bloqueo Citas' }
    };
    try {
        const res = await fetch('/api/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (res.ok) {
            window.closeEventModal();
            fetchEvents();
        }
    } catch (err) { alert('Error al guardar'); }
};

fetchBranding();
fetchEvents();
loadConfig();
