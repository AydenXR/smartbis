
/**
 * CALENDAR.JS - Custom Local Calendar System
 * Replaces Google Calendar with local ticket-based availability.
 */

const TIMEZONE = process.env.TIMEZONE || "America/Hermosillo";

function createHermosilloDate(dateStr, timeStr = "00:00:00") {
    // If we have a specific timezone like America/Hermosillo, we can use toLocaleString
    // But for math, we need an offset or a library. 
    // Given the current simple implementation, let's stick to the Hermosillo default but allow override via env if possible.
    // However, Hermosillo is UTC-7 fixed. Let's make it more robust.
    const date = new Date(`${dateStr}T${timeStr}`);
    return new Date(date.toLocaleString("en-US", { timeZone: TIMEZONE }));
}

/**
 * Calculates available slots based on approved appointments in ticketsStore.
 */
export async function getAvailableSlots(dateStr, config, daysCount = 1, tickets = [], manualBlocks = []) {
    const { startTime, endTime, durationMinutes, gapMinutes } = config;
    const allAvailableSlots = [];
    
    let startDate = dateStr ? new Date(dateStr) : new Date();
    if (isNaN(startDate.getTime())) startDate = new Date();

    // Filter approved or in-review appointments to use as "busy" slots
    const busyTickets = tickets.filter(t => 
        t.type === "cita" && 
        (t.status === "aprobado" || t.status === "en_revision" || t.status === "pendiente_datos")
    );

    const skipDays = (config.skipDays || "0").split(",").map(Number);
    const saturdayEndTime = config.saturdayEndTime || "17:00";

    for (let i = 0; i < daysCount; i++) {
        const currentDayForStr = new Date(startDate);
        currentDayForStr.setDate(currentDayForStr.getDate() + i);
        const dayStr = currentDayForStr.toISOString().split('T')[0];
        
        // Check for "INHABIL" or "CERRADO" in manualBlocks (which now contains calendar events for this check)
        const isDayBlocked = (manualBlocks || []).some(b => 
            b.date === dayStr && (b.title?.toUpperCase() === "INHABIL" || b.title?.toUpperCase() === "CERRADO")
        );
        if (isDayBlocked) continue;

        // Skip specified days (weekend configuration)
        // Use a 12:00:00 time to avoid timezone shifts near midnight
        const [y, m, d] = dayStr.split('-').map(Number);
        const checkDate = new Date(y, m - 1, d, 12, 0, 0); 
        const dayOfWeek = checkDate.getDay(); // 0 is Sunday, 1 is Monday...

        if (skipDays.includes(dayOfWeek)) {
            console.log(`[CALENDAR] Skipping ${dayStr} as it matches skipDays (${dayOfWeek})`);
            continue;
        }

        // Saturday schedule adjustment
        let effectiveEndTime = endTime;
        if (checkDate.getDay() === 6) { 
            effectiveEndTime = saturdayEndTime;
        }
        
        // Find busy slots for this day
        const busyOnThisDay = busyTickets.filter(t => t.data?.fecha === dayStr);
        
        const startTimeStr = `${startTime}:00`;
        const endTimeStr = `${effectiveEndTime}:00`;

        let currentSlotStart = new Date(`${dayStr}T${startTimeStr}`);
        const dayEnd = new Date(`${dayStr}T${endTimeStr}`);
        const now = new Date();

        while (currentSlotStart.getTime() + durationMinutes * 60000 <= dayEnd.getTime()) {
            const currentSlotEnd = new Date(currentSlotStart.getTime() + durationMinutes * 60000);
            
            // Format current slot label for comparison
            const hours = currentSlotStart.getHours();
            const minutes = currentSlotStart.getMinutes();
            const ampm = hours >= 12 ? 'p.m.' : 'a.m.';
            const displayHours = hours % 12 || 12;
            const label = `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`;

            // Check if ANY ticket matches this slot (exact label or overlapping)
            const busyMatch = busyOnThisDay.find(t => {
                // Primary check: exact label match (useful for human readable strings)
                if (t.data.horario && t.data.horario.toLowerCase().trim() === label.toLowerCase().trim()) return true;
                
                // Secondary check: ISO overlap (if both start_iso and end_iso exist)
                if (t.data.start_iso && t.data.end_iso) {
                    const bStart = new Date(t.data.start_iso);
                    const bEnd = new Date(t.data.end_iso);
                    return (currentSlotStart < bEnd && currentSlotEnd > bStart);
                }
                return false;
            });

            // Also check manual blocks
            const blockMatch = (manualBlocks || []).find(b => {
                const bStr = b.date || b.start.toISOString().split('T')[0];
                if (bStr !== dayStr) return false;
                return (currentSlotStart < b.end && currentSlotEnd > b.start);
            });

            allAvailableSlots.push({
                fecha: dayStr,
                start: currentSlotStart.toISOString(),
                end: currentSlotEnd.toISOString(),
                label: label,
                isBusy: !!busyMatch || !!blockMatch || currentSlotStart < now,
                busyLabel: busyMatch ? (busyMatch.data?.nombre || "Cita") : (blockMatch ? blockMatch.title : (currentSlotStart < now ? "Pasado" : null))
            });

            currentSlotStart = new Date(currentSlotStart.getTime() + (durationMinutes + gapMinutes) * 60000);
        }
    }

    return allAvailableSlots;
}

/**
 * Mock function to maintain compatibility with existing code.
 * In the new system, creating a ticket IS creating the event.
 */
export async function createCalendarEvent(data) {
    console.log("[CALENDAR] Event handled via Ticket System:", data.summary);
    return { success: true, id: "local-" + Date.now() };
}

/**
 * No-op initialization as we don't need Google Auth anymore.
 */
export async function initCalendar() {
    console.log('[CALENDAR] Local Calendar System ready (No Google dependency)');
}
