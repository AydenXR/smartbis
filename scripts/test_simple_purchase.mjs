import axios from 'axios';
import crypto from 'crypto';

const WEBHOOK_URL = 'http://127.0.0.1:3000/webhook';
const APP_SECRET = '5219027b589ecfbb6343f346bf56f162';

async function send(txt) {
  const payload = {
    object: 'page',
    entry: [{
      messaging: [{
        sender: { id: 'test_prod_123' },
        message: { text: txt, mid: 'm_'+Math.random() }
      }]
    }]
  };
  const body = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', APP_SECRET).update(body).digest('hex');
  await axios.post(WEBHOOK_URL, payload, {
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': 'sha256='+sig
    }
  });
}

send('¿Cuánto cuestan los viales de Salmon DNA de Stayve y tienes envío a Hermosillo?');
