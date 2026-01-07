// src/services/purchaseData.js
// Shared module to store purchase response data from addTripDetails
// This allows purchase.js to directly access the purchase response without frontend dependency

let purchaseResponseCache = new Map(); // Store purchase responses by purchaseId

export function savePurchaseResponse(purchaseId, purchaseResponse) {
  console.log(`💾 Saving purchase response to cache: ${purchaseId}`);
  purchaseResponseCache.set(purchaseId, {
    purchaseResponse,
    timestamp: Date.now(),
    source: 'addTripDetails'
  });
}

export function getPurchaseResponse(purchaseId) {
  const cached = purchaseResponseCache.get(purchaseId);
  if (cached) {
    console.log(`📋 Retrieved purchase response from cache: ${purchaseId}`);
    return cached.purchaseResponse;
  }
  console.log(`❌ No purchase response found in cache: ${purchaseId}`);
  return null;
}

export function clearPurchaseResponse(purchaseId) {
  console.log(`🗑️ Clearing purchase response from cache: ${purchaseId}`);
  purchaseResponseCache.delete(purchaseId);
}

export function getAllCachedPurchases() {
  return Array.from(purchaseResponseCache.entries()).map(([id, data]) => ({
    purchaseId: id,
    timestamp: data.timestamp,
    source: data.source
  }));
}

// Clean up old cache entries (older than 30 minutes)
export function cleanupOldCache() {
  const thirtyMinutesAgo = Date.now() - (30 * 60 * 1000);
  let cleaned = 0;

  for (const [purchaseId, data] of purchaseResponseCache.entries()) {
    if (data.timestamp < thirtyMinutesAgo) {
      purchaseResponseCache.delete(purchaseId);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    console.log(`🧹 Cleaned up ${cleaned} old purchase response(s) from cache`);
  }
}
