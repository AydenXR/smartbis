import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, readdir } from "node:fs/promises";
import { generateEmbedding, initCollection, upsertPoints } from "./store.js";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function cleanTextForEmbedding(value) {
  return String(value || "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitByHeadings(source) {
  const lines = String(source || "").replace(/\r\n/g, "\n").split("\n");
  const sections = [];
  let current = [];
  for (const line of lines) {
    if (/^\s*#{1,3}\s+/.test(line) && current.length) {
      const block = current.join("\n").trim();
      if (block) sections.push(block);
      current = [line];
      continue;
    }
    current.push(line);
  }
  const last = current.join("\n").trim();
  if (last) sections.push(last);
  if (sections.length) return sections;
  return String(source || "")
    .split(/\n\s*\n/g)
    .map((b) => b.trim())
    .filter(Boolean);
}

function splitLargeSection(block, maxChars = 1600) {
  const text = String(block || "").trim();
  if (!text) return [];
  if (text.length <= maxChars) return [text];
  const lines = text.split("\n");
  const headerLine = lines.find((line) => /^\s*#{1,6}\s+/.test(line)) || "";
  const body = text.split(/\n\s*\n/g).map((p) => p.trim()).filter(Boolean);
  const out = [];
  let acc = "";
  for (const paragraph of body) {
    const candidate = acc ? `${acc}\n\n${paragraph}` : paragraph;
    if (candidate.length > maxChars && acc) {
      out.push(headerLine ? `${headerLine}\n${acc}` : acc);
      acc = paragraph;
    } else {
      acc = candidate;
    }
  }
  if (acc) out.push(headerLine ? `${headerLine}\n${acc}` : acc);
  return out;
}

function toSections(content, fileName) {
  const rawSections = splitByHeadings(content).flatMap((block) => splitLargeSection(block));
  const unique = new Set();
  const sections = [];
  for (const block of rawSections) {
    const normalized = normalizeText(block);
    if (!normalized || normalized.length < 15) continue;
    if (unique.has(normalized)) continue;
    unique.add(normalized);
    sections.push(block);
  }
  return sections.map((block, index) => {
    const lines = block.split("\n").filter(l => l.trim());
    const firstLine = lines[0] || "";
    // Generic heading extraction: removes # and brackets
    const headingTitle = firstLine.replace(/^\s*#{1,6}\s*/, "").replace(/[\[\]]/g, "").trim();
    
    const hash = crypto.createHash("md5").update(`${fileName}#${index}#${normalizeText(block)}`).digest("hex");
    const uuid = [
      hash.substring(0, 8),
      hash.substring(8, 12),
      hash.substring(12, 16),
      hash.substring(16, 20),
      hash.substring(20, 32)
    ].join("-");
    const text = block.trim();
    const cleanText = cleanTextForEmbedding(text);
    return {
      id: uuid,
      payload: {
        fileName,
        title: headingTitle.slice(0, 120),
        text,
      },
      text,
      cleanText
    };
  });
}

async function mapWithConcurrency(items, limit, mapper) {
  const list = Array.isArray(items) ? items : [];
  const out = new Array(list.length);
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const current = next;
      next += 1;
      out[current] = await mapper(list[current], current);
    }
  }
  const workers = [];
  const size = Math.max(1, Math.min(limit, list.length || 1));
  for (let i = 0; i < size; i += 1) workers.push(worker());
  await Promise.all(workers);
  return out;
}

async function upsertInBatches(points, collectionName, batchSize = 16) {
  for (let i = 0; i < points.length; i += batchSize) {
    const batch = points.slice(i, i + batchSize);
    if (batch.length) {
      let retries = 3;
      while (retries > 0) {
        try {
          await upsertPoints(batch, collectionName);
          break;
        } catch (e) {
          retries -= 1;
          console.error(`Error in upsert (retries left: ${retries}):`, e.message);
          if (retries === 0) throw e;
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }
  }
}

export async function ingestNotebook(tenantId = null) {
  const isDefault = !tenantId || tenantId === "default";
  const collectionName = !isDefault ? `notebook_${tenantId}` : (process.env.QDRANT_COLLECTION || "smartbis_notebook");
  const notebookDir = !isDefault 
    ? path.resolve(__dirname, "..", "..", "tenants", tenantId, "notebook")
    : path.resolve(__dirname, "..", "..", "notebook");

  console.log(`Iniciando ingesta para ${tenantId || "default"} en colección '${collectionName}'...`);
  
  await initCollection(collectionName, true);

  try {
    const names = await readdir(notebookDir);
    const mdNames = names.filter((name) => name.toLowerCase().endsWith(".md"));
    
    let totalPoints = 0;

    for (const name of mdNames) {
      console.log(`Procesando ${name}...`);
      const fullPath = path.join(notebookDir, name);
      const content = await readFile(fullPath, "utf8");
      const sections = toSections(content, name);
      console.log(`  -> Generando vectores para ${sections.length} secciones de ${name}...`);
      const vectors = await mapWithConcurrency(sections, 1, async (section) => {
        const textToEmbed = [
          `Archivo: ${section.payload.fileName}`,
          `Título: ${section.payload.title}`,
          `Contenido: ${section.cleanText || section.text}`,
        ].join(". ");
        return generateEmbedding(textToEmbed);
      });
      const points = sections.map((section, index) => ({
        id: section.id,
        vector: vectors[index],
        payload: section.payload
      }));

      if (points.length > 0) {
        await upsertInBatches(points, collectionName, 16);
        totalPoints += points.length;
        console.log(`  -> Insertados ${points.length} chunks de ${name}`);
      }
    }
    console.log(`Ingesta completada. Total chunks: ${totalPoints}`);
  } catch (e) {
    console.error("Error en ingesta:", e);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  ingestNotebook();
}
