import { getFirestore } from './firebase.config.mjs';
import { FieldValue } from 'firebase-admin/firestore';

const state = {
  pricing: {
    commission: 0,
    fixed: 0,
    roundToNearest: 0,
    apply: false,
    discount: 0,
    markup: 0,
    charges: 0
  }
};

export function getPricingSettings() {
  return { ...state.pricing };
}

async function savePricing(pricing) {
  try {
    const db = await getFirestore();
    const ref = db.collection('settings').doc('pricing');
    const commission = Number(pricing.commission ?? pricing.percentage) || 0;
    await ref.set({
      commission,
      percentage: commission,
      fixed: Number(pricing.fixed) || 0,
      roundToNearest: Number(pricing.roundToNearest) || 0,
      apply: !!pricing.apply,
      discount: Number(pricing.discount) || 0,
      markup: Number(pricing.markup) || 0,
      charges: Number(pricing.charges) || 0,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (e) {
    console.error('Failed to save pricing settings to Firestore:', e);
  }
}

export async function loadPricingSettings() {
  try {
    const db = await getFirestore();
    const ref = db.collection('settings').doc('pricing');
    const snap = await ref.get();
    if (snap.exists) {
      const data = snap.data() || {};
      const next = { ...state.pricing };
      if (data.commission !== undefined && !isNaN(Number(data.commission))) next.commission = Number(data.commission);
      else if (data.percentage !== undefined && !isNaN(Number(data.percentage))) next.commission = Number(data.percentage);
      if (data.fixed !== undefined && !isNaN(Number(data.fixed))) next.fixed = Number(data.fixed);
      if (data.roundToNearest !== undefined && !isNaN(Number(data.roundToNearest))) next.roundToNearest = Number(data.roundToNearest);
      if (data.apply !== undefined) next.apply = !!data.apply;
      if (data.discount !== undefined && !isNaN(Number(data.discount))) next.discount = Number(data.discount);
      if (data.markup !== undefined && !isNaN(Number(data.markup))) next.markup = Number(data.markup);
      if (data.charges !== undefined && !isNaN(Number(data.charges))) next.charges = Number(data.charges);
      state.pricing = next;
    } else {
      await savePricing(state.pricing);
    }
  } catch (e) {
    console.error('Failed to load pricing settings from Firestore:', e);
  }
}

export async function updatePricingSettings(partial) {
  if (!partial || typeof partial !== 'object') return;
  const next = { ...state.pricing };
  if (partial.commission !== undefined && !isNaN(Number(partial.commission))) {
    next.commission = Number(partial.commission);
  } else if (partial.percentage !== undefined && !isNaN(Number(partial.percentage))) {
    next.commission = Number(partial.percentage);
  }
  if (partial.fixed !== undefined && !isNaN(Number(partial.fixed))) {
    next.fixed = Number(partial.fixed);
  }
  if (partial.roundToNearest !== undefined && !isNaN(Number(partial.roundToNearest))) {
    next.roundToNearest = Number(partial.roundToNearest);
  }
  if (partial.discount !== undefined && !isNaN(Number(partial.discount))) {
    next.discount = Number(partial.discount);
  }
  if (partial.markup !== undefined && !isNaN(Number(partial.markup))) {
    next.markup = Number(partial.markup);
  }
  if (partial.charges !== undefined && !isNaN(Number(partial.charges))) {
    next.charges = Number(partial.charges);
  }
  if (partial.apply !== undefined) {
    const v = partial.apply;
    next.apply = v === true || v === 'true' || v === '1' || v === 'on';
  }
  state.pricing = next;
  await savePricing(next);
}

export function getAllSettings() {
  return {
    pricing: getPricingSettings()
  };
}
