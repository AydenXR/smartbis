import { QdrantClient } from "@qdrant/js-client-rest";
import { pipeline } from "@xenova/transformers";

const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const DEFAULT_COLLECTION = process.env.QDRANT_COLLECTION || "smartbis_notebook";

// Singleton client
let client = null;
let embedder = null;

function getClient() {
  if (!client) {
    client = new QdrantClient({ url: QDRANT_URL });
  }
  return client;
}

async function getEmbedder() {
  if (!embedder) {
    embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }
  return embedder;
}

export async function generateEmbedding(text) {
  const pipe = await getEmbedder();
  const output = await pipe(text, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}

export async function initCollection(collectionName = DEFAULT_COLLECTION, recreate = false) {
  const qdrant = getClient();
  const result = await qdrant.getCollections();
  const exists = result.collections.some((c) => c.name === collectionName);

  if (exists && recreate) {
    console.log(`Deleting existing collection '${collectionName}'...`);
    await qdrant.deleteCollection(collectionName);
  }

  if (!exists || recreate) {
    await qdrant.createCollection(collectionName, {
      vectors: {
        size: 384,
        distance: "Cosine",
      },
    });
    console.log(`Collection '${collectionName}' created in Qdrant.`);
  }
}

export async function upsertPoints(points, collectionName = DEFAULT_COLLECTION) {
  const qdrant = getClient();
  await qdrant.upsert(collectionName, {
    wait: true,
    points,
  });
}

export async function searchVectors(queryText, limit = 5, collectionName = DEFAULT_COLLECTION) {
  const qdrant = getClient();
  const vector = await generateEmbedding(queryText);
  
  const searchResult = await qdrant.search(collectionName, {
    vector,
    limit,
    with_payload: true,
  });

  return searchResult;
}
