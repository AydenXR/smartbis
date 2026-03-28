import axios from 'axios';
import crypto from 'crypto';

const WEBHOOK_URL = 'http://127.0.0.1:3000/webhook';
const APP_SECRET = '5219027b589ecfbb6343f346bf56f162';

async function sendWebhook(payload) {
  // Add random MIDs to simulate real Facebook messages and avoid deduplication
  if (payload.entry) {
    payload.entry.forEach(entry => {
      if (entry.messaging) {
        entry.messaging.forEach(ev => {
          if (ev.message && !ev.message.mid) {
            ev.message.mid = 'm_' + Math.random().toString(36).substring(7);
          }
        });
      }
    });
  }

  const body = JSON.stringify(payload);
  const signature = crypto
    .createHmac('sha256', APP_SECRET)
    .update(body)
    .digest('hex');

  const headers = {
    'Content-Type': 'application/json',
    'X-Hub-Signature-256': `sha256=${signature}`
  };

  try {
    const res = await axios.post(WEBHOOK_URL, payload, { headers });
    console.log(`[SIM] Response: ${res.status} ${res.data}`);
  } catch (err) {
    console.error(`[SIM] Request failed: ${err.message}`);
  }
}

async function runTest() {
  const timestamp = Date.now();
  const psid = `test_flow_user_${timestamp}`;

  console.log(`\n--- TEST 1: Course Enrollment Flow ---`);
  console.log(`[SIM] User: ${psid}`);
  
  // 1. Initial interest
  await sendWebhook({
    object: 'page',
    entry: [{
      messaging: [{
        sender: { id: psid },
        message: { text: "Hola, me interesa el curso de Botox" }
      }]
    }]
  });
  
  await new Promise(r => setTimeout(r, 8000));

  // 2. Mocking arrival of payment proof (image)
  // Since we can't send real FB images, we send an attachment with a dummy URL
  // The bot should capture it as session.lastImageUrl
  await sendWebhook({
    object: 'page',
    entry: [{
      messaging: [{
        sender: { id: psid },
        message: { 
          text: "Aquí está mi comprobante",
          attachments: [{
            type: 'image',
            payload: { url: 'https://example.com/comprobante_dummy.jpg' }
          }]
        }
      }]
    }]
  });
  
  await new Promise(r => setTimeout(r, 8000));

  // 3. User provides data
  await sendWebhook({
    object: 'page',
    entry: [{
      messaging: [{
        sender: { id: psid },
        message: { text: "Mi nombre es Juan Perez, mi correo es juan@gmail.com y mi WA es 5216623358779" }
      }]
    }]
  });

  await new Promise(r => setTimeout(r, 10000));
  
  console.log(`\n--- TEST 2: Appointment Booking Flow ---`);
  const psid2 = `test_appointment_user_${timestamp}`;
  
  await sendWebhook({
    object: 'page',
    entry: [{
      messaging: [{
        sender: { id: psid2 },
        message: { text: "Quiero agendar una cita para valoración" }
      }]
    }]
  });

  await new Promise(r => setTimeout(r, 10000));

  // We should see logs in data/bot.log and tickets.json
  console.log(`\n[SIM] Finished. Check data/bot.log and data/default/tickets.json`);
}

runTest();
