// This module previously mirrored Firestore carts into a Postgres `carts` table.
// Postgres cart mirroring has been removed; this is now a no-op stub.

export async function upsertCartFromFirestore() {
  // no-op: kept only to avoid breaking any stray imports
}
