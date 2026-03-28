import fs from 'fs';
const data = JSON.parse(fs.readFileSync('data/sessions.json', 'utf8'));
const psid = process.argv[2];
if (data[psid]) {
  console.log(`\n=== SESSION: ${psid} ===`);
  const messages = data[psid].messages || [];
  messages.forEach((m, i) => {
    console.log(`[${i+1}] ${m.role.toUpperCase()}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`);
  });
} else {
  console.log("No session found for", psid);
}
