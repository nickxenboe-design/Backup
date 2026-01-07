import path from 'path';
import { readFile } from 'fs/promises';
import { getFirestore } from './src/config/firebase.config.mjs';

function deriveLocationIdFromCity(data) {
  if (!data || typeof data !== 'object') return null;
  const nameCandidate = data.city_name;
  if (!nameCandidate || typeof nameCandidate !== 'string') return null;
  const trimmed = nameCandidate.trim();
  if (!trimmed) return null;
  const slug = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || null;
}

async function main() {
  const [, , jsonPath, collectionName] = process.argv;

  if (!jsonPath || !collectionName) {
    console.error('Usage: node firestoreImport.mjs <path-to-json> <collection-name>');
    console.error('JSON can be either:');
    console.error('  - An array of objects (optionally with an "id" field for document ID)');
    console.error('  - An object map of { "docId": { ...data } }');
    process.exit(1);
  }

  const resolvedPath = path.isAbsolute(jsonPath)
    ? jsonPath
    : path.join(process.cwd(), jsonPath);

  console.log(`Loading data from: ${resolvedPath}`);

  let parsed;
  try {
    const raw = await readFile(resolvedPath, 'utf8');
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error('Failed to read or parse JSON file:', err.message);
    process.exit(1);
  }

  const docs = [];
  const normalizedCollection = String(collectionName || '').toLowerCase();

  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;

      // For 'locations', always use city_name (slugified) as the document ID, no fallbacks
      if (normalizedCollection === 'locations') {
        const derivedId = deriveLocationIdFromCity(item);
        if (!derivedId) {
          console.warn('Skipping location entry without valid city_name:', item);
          continue;
        }
        docs.push({ id: derivedId, data: item });
        continue;
      }

      // Other collections keep the old behaviour: explicit id if present, otherwise auto ID
      if (typeof item.id === 'string' && item.id.trim()) {
        const { id, ...rest } = item;
        docs.push({ id, data: rest });
      } else {
        docs.push({ id: null, data: item });
      }
    }
  } else if (parsed && typeof parsed === 'object') {
    for (const [id, data] of Object.entries(parsed)) {
      if (!data || typeof data !== 'object') continue;
      docs.push({ id, data });
    }
  } else {
    console.error('JSON root must be an array or object');
    process.exit(1);
  }

  console.log(`Preparing to import ${docs.length} documents into collection "${collectionName}"...`);

  const firestore = await getFirestore();
  const collectionRef = firestore.collection(collectionName);

  // If we're targeting the 'locations' collection, clear existing docs first
  if (normalizedCollection === 'locations') {
    console.log('Clearing existing documents from "locations" collection before import...');
    const snapshot = await collectionRef.get();
    const DELETE_BATCH_SIZE = 400;
    let deleteBatch = firestore.batch();
    let deleteCount = 0;
    let deleteBatchIndex = 0;

    snapshot.forEach((doc) => {
      deleteBatch.delete(doc.ref);
      deleteCount += 1;

      if (deleteCount % DELETE_BATCH_SIZE === 0) {
        deleteBatchIndex += 1;
        console.log(`Committing delete batch ${deleteBatchIndex} with ${DELETE_BATCH_SIZE} documents...`);
        deleteBatch.commit();
        deleteBatch = firestore.batch();
      }
    });

    if (deleteCount % DELETE_BATCH_SIZE !== 0) {
      deleteBatchIndex += 1;
      console.log(`Committing final delete batch ${deleteBatchIndex} with ${deleteCount % DELETE_BATCH_SIZE} documents...`);
      await deleteBatch.commit();
    }

    console.log(`Done. Deleted ${deleteCount} documents from "locations" collection.`);
  }

  const BATCH_SIZE = 400; // stay safely under Firestore's 500-op limit
  let batch = firestore.batch();
  let batchOpCount = 0;
  let written = 0;
  let batchIndex = 0;

  for (const { id, data } of docs) {
    const docRef = id ? collectionRef.doc(id) : collectionRef.doc();
    batch.set(docRef, data, { merge: true });
    batchOpCount += 1;
    written += 1;

    if (batchOpCount >= BATCH_SIZE) {
      batchIndex += 1;
      console.log(`Committing batch ${batchIndex} with ${batchOpCount} documents...`);
      await batch.commit();
      batch = firestore.batch();
      batchOpCount = 0;
    }
  }

  if (batchOpCount > 0) {
    batchIndex += 1;
    console.log(`Committing final batch ${batchIndex} with ${batchOpCount} documents...`);
    await batch.commit();
  }

  console.log(`Done. Imported ${written} documents into collection "${collectionName}".`);
}

main().catch((err) => {
  console.error('Unexpected error during Firestore import:', err);
  process.exit(1);
});
