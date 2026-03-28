
import { writeFile } from "node:fs/promises";
import axios from "axios";

// Configuration
const API_URL = "http://127.0.0.1:3000/debug/ask";
const TEST_RESULTS_FILE = "./test_results.json";

// Sample base questions derived from notebook content
const baseQuestions = [
  "¿Qué aprenderé en el curso de Limpiezas Faciales?",
  "¿Cuál es el temario de Limpiezas Faciales?",
  "¿Costo del curso de Hidrofacial?",
  "¿Duran mucho los cursos?",
  "¿Requisitos para el curso de Exosomas?",
  "¿Tienen sucursal en Hermosillo?",
  "¿Cuál es su horario?",
  "¿Hacen envíos a CDMX?",
  "¿Cuál es el precio de la pomada Azelsal?",
  "¿Para qué sirve el DM Clean?",
  "¿Tienen boosters de Stayve?",
  "¿Qué es el PDRN Kiara Reju?",
  "¿Costo del Kit de Hiperpigmentación?",
  "¿Cómo puedo inscribirme?",
  "¿Aceptan tarjeta?",
  "¿El curso de Peeling Químico requiere ser médico?",
  "¿Qué incluye la modalidad presencial de peptonas?",
  "¿Tienen el curso de BB Glow?",
  "¿Qué productos se usan en BB Glow?",
  "¿Dónde puedo ver el calendario?",
  "¿Hay clases los domingos?",
  "¿Qué pasa si no puedo asistir a la hora del curso?",
  "¿Tienen garantía de satisfacción?",
  "¿Precio del Dermapen Dr. Pen M7?",
  "¿Tienen cartuchos de repuesto para Dermapen?",
  "¿Cuál es el número de WhatsApp?",
  "¿Tienen Facebook?",
  "¿Para qué sirve el Skin Restore?",
  "¿Precio del Agua Micelar?",
  "¿Tienen promociones para adolescentes?",
  "¿Qué es el Full D-Tox?",
  "¿Para qué sirve el Hepato Clean?",
  "¿Tienen parches de colágeno?",
  "¿Qué es la radiofrecuencia fraccionada?",
  "¿Tienen curso de labios?",
  "¿Qué es Hyalnano Filling?",
  "¿Costo de la anestesia TKTX?",
  "¿Tienen jeringas y agujas?",
  "¿Cómo se aplica el suero Niaczin?",
  "¿Tienen algo para la rosácea?",
  "¿Qué contiene el Kit Acné Moderado?",
  "¿Diferencia entre Hydrofacial y Limpieza Facial Profunda?",
  "¿Qué son los exosomas?",
  "¿Inversión para el curso de Peptonas?",
  "¿Tienen maderoterapia?",
  "¿De qué trata el curso de moldeado corporal?",
  "¿Ubicación exacta?",
  "¿Tienen Instagram?",
  "¿Qué es el Mesobotox?",
  "¿Costo del Plasma Pen?"
];

// Generate 100 questions by duplicating and slightly varying
function generate100Questions() {
  const questions = [];
  for (let i = 0; i < 100; i++) {
    const base = baseQuestions[i % baseQuestions.length];
    questions.push(base);
  }
  return questions;
}

async function runTests() {
  const questions = generate100Questions();
  const results = [];
  
  console.log(`Starting test of ${questions.length} questions...`);

  for (let i = 0; i < questions.length; i++) {
    const question = questions[i];
    process.stdout.write(`Testing [${i+1}/100]: ${question.substring(0, 40)}... `);
    
    try {
      const response = await axios.post(API_URL, { question });
      results.push({
        id: i + 1,
        question,
        reply: response.data.reply,
        success: true
      });
      console.log("OK");
    } catch (e) {
      console.log("FAIL");
      results.push({
        id: i + 1,
        question,
        error: e.message,
        success: false
      });
    }
    // Small delay to not overwhelm
    await new Promise(r => setTimeout(r, 100));
  }

  await writeFile(TEST_RESULTS_FILE, JSON.stringify(results, null, 2));
  console.log(`Test results saved in ${TEST_RESULTS_FILE}`);
  
  // Summary
  const successful = results.filter(r => r.success).length;
  console.log(`Summary: ${successful}/100 successful requests.`);
}

runTests();
