
const axios = require('axios');
const fs = require('fs');

const API_URL = 'http://127.0.0.1:3000/api/debug-ai';
const RESULTS_FILE = '/home/aydenx/greenbot/test_calendar_results.md';

const testQuestions = [
    "Hola, ¿qué fechas tienen para el curso de Russian lips?",
    "Me interesa el curso de Mesobotox, ¿tienen disponibilidad online?",
    "¿Hay algo para Limpieza facial proximamente?",
    "¿Cuándo es el de Bioestimulación con salmón presencial?",
    "Quisiera saber las fechas de Toxina botulímica tercio superior",
    "¿Qué cursos tienen en Abril?",
    "¿Tienen fechas para Fibroblast en abril?",
    "¿Cuándo es el de Aumento de glúteos?",
    "¿Qué cursos presenciales hay disponibles pronto?"
];

async function runTests() {
    let output = "# Resultados de Pruebas de Calendario e IA\n\n";
    output += "Simulación de consultas de usuarios sobre fechas de cursos.\n\n";

    for (const question of testQuestions) {
        console.log(`Testing: ${question}`);
        try {
            const res = await axios.post(API_URL, { text: question, psid: "test_" + Date.now() });
            output += `## 👤 Usuario: ${question}\n\n`;
            output += `🤖 **Bot:**\n${res.data.reply}\n\n---\n\n`;
        } catch (e) {
            output += `## 👤 Usuario: ${question}\n\n❌ ERROR: ${e.message}\n\n---\n\n`;
        }
    }

    fs.writeFileSync(RESULTS_FILE, output);
    console.log(`Tests finished. Results saved to ${RESULTS_FILE}`);
}

runTests();
