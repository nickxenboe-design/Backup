// This module previously mirrored Firestore carts into a Postgres `carts` table.
// Postgres cart mirroring has been removed; this is now a no-op stub.

import { getFirestore as getFirestoreSingleton } from '../config/firebase.config.mjs';
import { getPricingSettings } from '../config/runtimeSettings.js';
import { applyPriceAdjustments } from './price.utils.js';
import drizzleDb, { carts as cartsTable, tripSelections } from '../db/drizzleClient.js';
import { desc, eq, or, sql } from 'drizzle-orm';

let cartsTableEnsured = false;
const ensureCartsTableExists = async () => {
  if (cartsTableEnsured) return;
  await drizzleDb.execute(sql`
    CREATE TABLE IF NOT EXISTS "carts" (
      "id" serial PRIMARY KEY NOT NULL,
      "cart_id" text NOT NULL,
      "firestore_cart_id" text,
      "booked_by" text,
      "status" text,
      "currency" text,
      "origin" text,
      "destination" text,
      "depart_at" text,
      "arrive_at" text,
      "return_origin" text,
      "return_destination" text,
      "return_depart_at" text,
      "return_arrive_at" text,
      "passenger_count" integer,
      "purchaser" jsonb,
      "passengers" jsonb,
      "busbud_response" jsonb,
      "cost_price" numeric(10, 2),
      "discount" numeric(10, 2),
      "markup" numeric(10, 2),
      "charges" numeric(10, 2),
      "commission" numeric(10, 2),
      "round_diff" numeric(10, 2),
      "retail_price" numeric(10, 2),
      "expires_at" timestamp with time zone DEFAULT (now() + interval '1 hour'),
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "carts_cart_id_unique" UNIQUE("cart_id")
    );
  `);

  await drizzleDb.execute(sql`ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "firestore_cart_id" text;`);
  await drizzleDb.execute(sql`ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "booked_by" text;`);
  await drizzleDb.execute(sql`ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "status" text;`);
  await drizzleDb.execute(sql`ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "currency" text;`);
  await drizzleDb.execute(sql`ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "origin" text;`);
  await drizzleDb.execute(sql`ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "destination" text;`);
  await drizzleDb.execute(sql`ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "depart_at" text;`);
  await drizzleDb.execute(sql`ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "arrive_at" text;`);
  await drizzleDb.execute(sql`ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "return_origin" text;`);
  await drizzleDb.execute(sql`ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "return_destination" text;`);
  await drizzleDb.execute(sql`ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "return_depart_at" text;`);
  await drizzleDb.execute(sql`ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "return_arrive_at" text;`);
  await drizzleDb.execute(sql`ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "passenger_count" integer;`);
  await drizzleDb.execute(sql`ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "purchaser" jsonb;`);
  await drizzleDb.execute(sql`ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "passengers" jsonb;`);
  await drizzleDb.execute(sql`ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "busbud_response" jsonb;`);
  await drizzleDb.execute(sql`ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "cost_price" numeric(10, 2);`);
  await drizzleDb.execute(sql`ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "discount" numeric(10, 2);`);
  await drizzleDb.execute(sql`ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "markup" numeric(10, 2);`);
  await drizzleDb.execute(sql`ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "charges" numeric(10, 2);`);
  await drizzleDb.execute(sql`ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "commission" numeric(10, 2);`);
  await drizzleDb.execute(sql`ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "round_diff" numeric(10, 2);`);
  await drizzleDb.execute(sql`ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "retail_price" numeric(10, 2);`);
  await drizzleDb.execute(sql`ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone DEFAULT (now() + interval '1 hour');`);
  try {
    await drizzleDb.execute(sql`ALTER TABLE "carts" ALTER COLUMN "expires_at" SET DEFAULT (now() + interval '1 hour');`);
  } catch (_) {}
  await drizzleDb.execute(sql`ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;`);
  await drizzleDb.execute(sql`ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;`);

  await drizzleDb.execute(sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'carts' AND column_name = 'cost_price' AND data_type = 'jsonb'
      ) THEN
        ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "cost_price_amount" numeric(10, 2);
        UPDATE "carts"
          SET "cost_price_amount" = CASE
            WHEN "cost_price" IS NULL THEN NULL
            WHEN ("cost_price" ? 'total') THEN (("cost_price"->>'total')::numeric / 100)
            ELSE NULL
          END
        WHERE "cost_price_amount" IS NULL;
        ALTER TABLE "carts" DROP COLUMN "cost_price";
        ALTER TABLE "carts" RENAME COLUMN "cost_price_amount" TO "cost_price";
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'carts' AND column_name = 'retail_price' AND data_type = 'jsonb'
      ) THEN
        ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "retail_price_amount" numeric(10, 2);
        UPDATE "carts"
          SET "retail_price_amount" = CASE
            WHEN "retail_price" IS NULL THEN NULL
            WHEN ("retail_price" ? 'total') THEN (("retail_price"->>'total')::numeric / 100)
            ELSE NULL
          END
        WHERE "retail_price_amount" IS NULL;
        ALTER TABLE "carts" DROP COLUMN "retail_price";
        ALTER TABLE "carts" RENAME COLUMN "retail_price_amount" TO "retail_price";
      END IF;
    END $$;
  `);

  await drizzleDb.execute(sql`ALTER TABLE "carts" DROP COLUMN IF EXISTS "raw";`);
  await drizzleDb.execute(sql`ALTER TABLE "carts" DROP COLUMN IF EXISTS "busbud_cart_id";`);
  await drizzleDb.execute(sql`ALTER TABLE "carts" DROP COLUMN IF EXISTS "trip_id";`);
  await drizzleDb.execute(sql`ALTER TABLE "carts" DROP COLUMN IF EXISTS "route";`);

  cartsTableEnsured = true;
};

let firestoreDb;
const ensureFirestoreDb = async () => {
  if (!firestoreDb) {
    firestoreDb = await getFirestoreSingleton();
  }
  return firestoreDb;
};

const normalizeIso = (v) => {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'number') {
    try {
      const d = new Date(v);
      if (!isNaN(d.getTime())) return d.toISOString();
    } catch (_) {
      return null;
    }
  }
  if (typeof v === 'object') {
    if (typeof v.toDate === 'function') {
      try {
        const d = v.toDate();
        if (d instanceof Date) return d.toISOString();
      } catch (_) {
        return null;
      }
    }
    if (typeof v.seconds === 'number') {
      try {
        const d = new Date(v.seconds * 1000);
        if (!isNaN(d.getTime())) return d.toISOString();
      } catch (_) {
        return null;
      }
    }
  }
  return null;
};

const extractCartStatus = (cart = {}) => {
  return 'awaiting_payment';
};

const toDateOrNull = (v) => {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    const asNum = Number(s);
    if (/^\d+$/.test(s) && Number.isFinite(asNum)) {
      if (asNum > 1e12) {
        const d = new Date(asNum);
        return isNaN(d.getTime()) ? null : d;
      }
      if (asNum > 1e9) {
        const d = new Date(asNum * 1000);
        return isNaN(d.getTime()) ? null : d;
      }
      const d = new Date(Date.now() + asNum * 1000);
      return isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v > 1e12) {
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d;
    }
    if (v > 1e9) {
      const d = new Date(v * 1000);
      return isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(Date.now() + v * 1000);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === 'object') {
    if (typeof v.toDate === 'function') {
      try {
        const d = v.toDate();
        return d instanceof Date && !isNaN(d.getTime()) ? d : null;
      } catch (_) {
        return null;
      }
    }
    if (typeof v.seconds === 'number') {
      const d = new Date(v.seconds * 1000);
      return isNaN(d.getTime()) ? null : d;
    }
    if (typeof v._seconds === 'number') {
      const d = new Date(v._seconds * 1000);
      return isNaN(d.getTime()) ? null : d;
    }
  }
  return null;
};

const extractExpiresAt = (cart = {}) => {
  const md = cart && typeof cart === 'object' ? (cart.metadata || {}) : {};
  const bb = cart && typeof cart === 'object' ? (cart.busbudResponse || {}) : {};
  const bbMd = bb && typeof bb === 'object' ? (bb.metadata || {}) : {};

  const candidates = [
    cart.expiresAt,
    cart.expires_at,
    cart._ttl,
    cart.ttl,
    md.ttl,
    md.pollTtl,
    bbMd.ttl,
    bbMd.pollTtl,
    bbMd.cartExpiryDate,
    bb.expiry
  ];

  for (const c of candidates) {
    const d = toDateOrNull(c);
    if (d) return d;
  }
  return null;
};

const extractPurchaser = (cart = {}) => {
  const pd = cart.passengerDetails || {};
  const cp = pd.completePurchase || {};
  const p1 = cart.purchaserDetails || cart.purchaser || null;
  const p2 = cp.purchaser || cp.user || null;
  const base = p1 || p2 || {};
  const purchaser = {
    first_name: base.first_name || base.firstName || null,
    last_name: base.last_name || base.lastName || null,
    email: base.email || null,
    phone: base.phone || base.phone_number || base.phoneNumber || null,
    opt_in_marketing: base.opt_in_marketing ?? base.optInMarketing ?? null
  };

  const hasAnyIdentity =
    (typeof purchaser.first_name === 'string' && purchaser.first_name.trim()) ||
    (typeof purchaser.last_name === 'string' && purchaser.last_name.trim()) ||
    (typeof purchaser.email === 'string' && purchaser.email.trim()) ||
    (typeof purchaser.phone === 'string' && purchaser.phone.trim()) ||
    purchaser.opt_in_marketing !== null;

  return hasAnyIdentity ? purchaser : null;
};

const extractPassengers = (cart = {}) => {
  const pd = cart.passengerDetails || {};
  const cp = pd.completePurchase || {};
  const fromCP = Array.isArray(cp.items)
    ? cp.items.map(it => it && it.passenger).filter(Boolean)
    : [];
  if (fromCP.length) return fromCP;
  if (Array.isArray(pd.passengers) && pd.passengers.length) return pd.passengers;
  if (Array.isArray(pd.rawPassengers) && pd.rawPassengers.length) return pd.rawPassengers;
  if (Array.isArray(cart.passengers) && cart.passengers.length) return cart.passengers;
  if (Array.isArray(cart.requiredPassengers) && cart.requiredPassengers.length) return cart.requiredPassengers;
  if (Array.isArray(cart.selectedPassengers) && cart.selectedPassengers.length) return cart.selectedPassengers;
  if (cart.trip && Array.isArray(cart.trip.passengers) && cart.trip.passengers.length) return cart.trip.passengers;
  if (Array.isArray(cart.trips)) {
    for (const t of cart.trips) {
      if (t && Array.isArray(t.passengers) && t.passengers.length) return t.passengers;
    }
  }
  return [];
};

const extractBusbudPricing = (cart = {}) => {
  const pd = cart.passengerDetails || {};
  const bb = (pd.busbudResponse || cart.busbudResponse) || {};
  const chargesObj = bb.charges && typeof bb.charges === 'object' ? bb.charges : null;

  // Cost price must reflect Busbud's original (unadjusted) charges.
  // Prefer explicit cost_price fields that we save from the Busbud API response.
  // Only fall back to metadata.original_charges if older carts don't have cost_price.
  const costPrice =
    bb.cost_price ||
    (chargesObj && chargesObj.cost_price) ||
    bb.original_charges ||
    (chargesObj && chargesObj.original_charges) ||
    (bb.adjusted_charges && bb.adjusted_charges.metadata && bb.adjusted_charges.metadata.original_charges) ||
    (bb.retail_price && bb.retail_price.metadata && bb.retail_price.metadata.original_charges) ||
    null;

  const retailPrice =
    bb.retail_price ||
    (chargesObj && chargesObj.retail_price) ||
    bb.adjusted_charges ||
    (chargesObj && chargesObj.adjusted_charges) ||
    null;

  // costPrice is the raw getLatestCharges payload (Busbud totals).
  // retailPrice is the adjusted (business rules) payload produced by BusbudService._processCharges.
  return { bb, costPrice, retailPrice };
};

const centsTotalToCurrencyString = (charges) => {
  if (!charges) return null;
  const v = charges.total;
  const n = typeof v === 'number'
    ? v
    : (typeof v === 'string'
      ? parseFloat(String(v).match(/[0-9]+(?:\.[0-9]+)?/)?.[0] || 'NaN')
      : NaN);
  if (!Number.isFinite(n)) return null;
  return (n / 100).toFixed(2);
};

const splitCentsEvenly = (totalCents, n) => {
  const count = Number(n);
  const total = Number(totalCents);
  if (!Number.isFinite(total) || !Number.isFinite(count) || count <= 0) return [];
  const base = Math.floor(total / count);
  let rem = total - (base * count);
  return Array.from({ length: count }, (_, i) => base + (rem-- > 0 ? 1 : 0));
};

const centsToUnits = (cents) => {
  const n = Number(cents);
  if (!Number.isFinite(n)) return null;
  return Math.round((n / 100) * 100) / 100;
};

const round2 = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 100) / 100 : null);

const isBlank = (v) => v == null || (typeof v === 'string' && !v.trim());

const pickFirstNonBlank = (...vals) => {
  for (const v of vals) {
    if (!isBlank(v)) return v;
  }
  return null;
};

const buildPassengerLookup = (charges) => {
  const byId = new Map();
  const byIndex = [];
  if (!charges || !Array.isArray(charges.items)) return { byId, byIndex };
  for (let i = 0; i < charges.items.length; i++) {
    const it = charges.items[i];
    const p = it && typeof it === 'object' ? it.passenger : null;
    if (p && typeof p === 'object') {
      byIndex[i] = p;
      if (p.id != null) byId.set(String(p.id), p);
    }
  }
  return { byId, byIndex };
};

const getTotalCentsFromChargesOrAmount = (charges, amountStr) => {
  if (charges && typeof charges.total === 'number') return charges.total;
  const v = amountStr != null ? Number(amountStr) : NaN;
  if (!Number.isFinite(v)) return null;
  return Math.round(v * 100);
};

const getItemsCentsIfAligned = (charges, passengerCount) => {
  if (!charges || !Array.isArray(charges.items) || !Number.isFinite(Number(passengerCount))) return null;
  if (charges.items.length !== Number(passengerCount)) return null;
  const centsArr = charges.items.map(it => {
    if (!it || typeof it !== 'object') return null;
    const v = it.amount ?? it.total;
    return typeof v === 'number' ? v : null;
  });
  if (centsArr.some(v => typeof v !== 'number')) return null;
  return centsArr;
};

const getPerPassengerBaseCentsFromCharges = (charges, passengers) => {
  if (!charges || !Array.isArray(charges.items)) return null;
  const list = Array.isArray(passengers) ? passengers : [];
  if (!list.length) return null;

  const byId = new Map();
  for (const it of charges.items) {
    if (!it || typeof it !== 'object') continue;
    const amount = it.amount ?? it.total;
    if (typeof amount !== 'number') continue;
    const p = it.passenger && typeof it.passenger === 'object' ? it.passenger : null;
    const pid = p && p.id != null ? String(p.id) : null;
    if (!pid) continue;
    byId.set(pid, (byId.get(pid) || 0) + amount);
  }

  if (byId.size === 0) return null;

  const arr = list.map((p) => {
    const pid = p && typeof p === 'object'
      ? (p.id ?? p.passengerId ?? p.passenger_id ?? (p.passenger && p.passenger.id) ?? null)
      : null;
    const key = pid != null ? String(pid) : null;
    return key && byId.has(key) ? byId.get(key) : 0;
  });

  return arr;
};

const allocateRemainderAcrossItems = (itemsCents, totalCents) => {
  if (!Array.isArray(itemsCents) || !itemsCents.length) return null;
  const total = Number(totalCents);
  if (!Number.isFinite(total)) return null;
  const sum = itemsCents.reduce((acc, v) => acc + (Number(v) || 0), 0);
  if (!Number.isFinite(sum)) return null;
  const remainder = total - sum;
  const shares = splitCentsEvenly(remainder, itemsCents.length);
  if (!shares.length) return itemsCents;
  return itemsCents.map((v, i) => (Number(v) || 0) + (shares[i] || 0));
};

const allocateRemainderAcrossItemsProportional = (itemsCents, totalCents) => {
  if (!Array.isArray(itemsCents) || !itemsCents.length) return null;
  const total = Number(totalCents);
  if (!Number.isFinite(total)) return null;
  const base = itemsCents.map(v => (Number.isFinite(Number(v)) ? Number(v) : 0));
  const sum = base.reduce((acc, v) => acc + v, 0);
  if (!Number.isFinite(sum)) return null;
  const remainder = total - sum;
  if (remainder === 0) return base;

  const weightsSum = base.reduce((acc, v) => acc + (v > 0 ? v : 0), 0);
  if (!weightsSum) {
    const even = splitCentsEvenly(remainder, base.length);
    return base.map((v, i) => v + (even[i] || 0));
  }

  const shares = base.map(v => {
    if (v <= 0) return 0;
    return Math.trunc((remainder * v) / weightsSum);
  });

  let assigned = shares.reduce((acc, v) => acc + v, 0);
  let left = remainder - assigned;
  if (left !== 0) {
    const idx = base
      .map((v, i) => ({ v, i }))
      .filter(x => x.v > 0)
      .sort((a, b) => b.v - a.v)
      .map(x => x.i);
    let k = 0;
    while (left !== 0 && idx.length) {
      const i = idx[k % idx.length];
      shares[i] += left > 0 ? 1 : -1;
      left += left > 0 ? -1 : 1;
      k++;
    }
  }

  return base.map((v, i) => v + (shares[i] || 0));
};

const enrichPassengersWithPricing = (passengers, opts) => {
  const list = Array.isArray(passengers) ? passengers : [];
  const passengerCount = Number(opts?.passengerCount);
  if (!Number.isFinite(passengerCount) || passengerCount <= 0 || !list.length) return list;

  const currency = opts?.currency || null;
  const costPrice = opts?.costPrice || null;
  const retailPrice = opts?.retailPrice || null;

  const costTotalCents = getTotalCentsFromChargesOrAmount(costPrice, opts?.costPriceAmount);
  const retailTotalCents = getTotalCentsFromChargesOrAmount(retailPrice, opts?.retailPriceAmount);

  const costItems = getItemsCentsIfAligned(costPrice, passengerCount);
  const retailItems = getItemsCentsIfAligned(retailPrice, passengerCount);

  const costBaseByPassenger = getPerPassengerBaseCentsFromCharges(costPrice, list);
  const retailBaseByPassenger = getPerPassengerBaseCentsFromCharges(retailPrice, list);

  const ticketBaseCentsPer = (() => {
    const base = (costBaseByPassenger && costBaseByPassenger.length === passengerCount)
      ? costBaseByPassenger
      : (costItems && costItems.length === passengerCount)
        ? costItems
        : (retailBaseByPassenger && retailBaseByPassenger.length === passengerCount)
          ? retailBaseByPassenger
          : (retailItems && retailItems.length === passengerCount)
            ? retailItems
            : null;
    if (base && base.length) return base;
    const fallbackTotal = costTotalCents != null ? costTotalCents : retailTotalCents;
    return fallbackTotal != null ? splitCentsEvenly(fallbackTotal, passengerCount) : [];
  })();

  // cost_price: allocate raw cart total (incl. fees) across passengers using ticket item weights
  const costCentsPer = (() => {
    const allocated = ticketBaseCentsPer && costTotalCents != null
      ? allocateRemainderAcrossItemsProportional(ticketBaseCentsPer, costTotalCents)
      : null;
    if (allocated && allocated.length) return allocated;
    return ticketBaseCentsPer;
  })();

  // retail_price: allocate adjusted cart total across passengers using same weights
  const adjustedTotalCents = retailTotalCents != null ? retailTotalCents : null;
  const retailCentsPer = (() => {
    const allocated = ticketBaseCentsPer && adjustedTotalCents != null
      ? allocateRemainderAcrossItemsProportional(ticketBaseCentsPer, adjustedTotalCents)
      : null;
    if (allocated && allocated.length) return allocated;
    // If we don't have an adjusted total, fall back to raw cost per passenger
    return costCentsPer;
  })();

  const discountPct = opts?.discountPct;
  const markupPct = opts?.markupPct;
  const chargesFixed = opts?.chargesFixed;
  const apply = opts?.apply;
  const roundToNearest = opts?.roundToNearest;

  const chargesPerPassenger = apply && chargesFixed != null && Number.isFinite(Number(chargesFixed))
    ? round2(Number(chargesFixed) / Number(passengerCount))
    : 0;

  const retailPassengerLookup = buildPassengerLookup(retailPrice);
  const costPassengerLookup = buildPassengerLookup(costPrice);
  const lookupPassenger = (id, idx) => {
    const key = id != null ? String(id) : null;
    if (key && retailPassengerLookup.byId.has(key)) return retailPassengerLookup.byId.get(key);
    if (key && costPassengerLookup.byId.has(key)) return costPassengerLookup.byId.get(key);
    if (idx != null) {
      const rp = retailPassengerLookup.byIndex[idx];
      if (rp) return rp;
      const cp = costPassengerLookup.byIndex[idx];
      if (cp) return cp;
    }
    return null;
  };

  return list.map((p, idx) => {
    const costUnits = idx < costCentsPer.length ? centsToUnits(costCentsPer[idx]) : null;
    const retailUnitsFromUpdatePrices = idx < retailCentsPer.length ? centsToUnits(retailCentsPer[idx]) : null;

    const discount =
      apply && costUnits != null && discountPct != null && Number.isFinite(Number(discountPct))
        ? round2(costUnits * (Number(discountPct) / 100))
        : 0;
    const markup =
      apply && costUnits != null && markupPct != null && Number.isFinite(Number(markupPct))
        ? round2(costUnits * (Number(markupPct) / 100))
        : 0;
    const charges = chargesPerPassenger;

    const retail_price = (() => {
      if (retailUnitsFromUpdatePrices != null) return retailUnitsFromUpdatePrices;
      if (costUnits == null) return null;
      try {
        const v = applyPriceAdjustments(costUnits, {
          currency,
          apply: !!apply,
          discount: discountPct,
          markup: markupPct,
          charges,
          roundToNearest,
          returnMetadata: false
        });
        return typeof v === 'number' && Number.isFinite(v) ? round2(v) : null;
      } catch (_) {
        return null;
      }
    })();

    const base = p && typeof p === 'object' ? { ...p } : {};
    const pid = base.id ?? base.passengerId ?? base.passenger_id ?? (base.passenger && base.passenger.id) ?? null;
    const src = lookupPassenger(pid, idx) || {};
    if (isBlank(base.first_name)) {
      base.first_name = pickFirstNonBlank(
        src.first_name,
        src.firstName,
        src.given_name,
        src.givenName,
        base.firstName,
        base.given_name,
        base.givenName
      );
    }
    if (isBlank(base.last_name)) {
      base.last_name = pickFirstNonBlank(
        src.last_name,
        src.lastName,
        src.family_name,
        src.familyName,
        base.lastName,
        base.family_name,
        base.familyName
      );
    }
    if (isBlank(base.phone)) {
      base.phone = pickFirstNonBlank(
        src.phone,
        src.phone_number,
        src.phoneNumber,
        base.phoneNumber
      );
    }
    return {
      ...base,
      pricing: {
        currency,
        cost_price: costUnits,
        discount,
        markup,
        charges,
        retail_price
      }
    };
  });
};

const extractRoute = (cart = {}) => {
  const pd = cart.passengerDetails || {};
  const cp = pd.completePurchase || {};

  const pickSeg = (seg) => {
    if (!seg || typeof seg !== 'object') return null;
    const o = seg.origin || {};
    const d = seg.destination || {};
    const departRaw =
      (seg.departure_time && (seg.departure_time.timestamp || seg.departure_time)) ||
      (seg.departure && seg.departure.timestamp) ||
      seg.departureTime ||
      seg.depart_at ||
      null;
    const arriveRaw =
      (seg.arrival_time && (seg.arrival_time.timestamp || seg.arrival_time)) ||
      (seg.arrival && seg.arrival.timestamp) ||
      seg.arrivalTime ||
      seg.arrive_at ||
      null;
    return {
      origin: o.name || (o.city && o.city.name) || null,
      destination: d.name || (d.city && d.city.name) || null,
      departAt: normalizeIso(departRaw),
      arriveAt: normalizeIso(arriveRaw)
    };
  };

  const pickSegRange = (segs) => {
    if (!Array.isArray(segs) || !segs.length) return null;
    const first = segs[0];
    const last = segs[segs.length - 1];
    const a = pickSeg(first) || {};
    const b = pickSeg(last) || {};
    return {
      origin: a.origin || null,
      destination: b.destination || null,
      departAt: a.departAt || null,
      arriveAt: b.arriveAt || null
    };
  };

  const tryFromCartSegments = () => {
    const rawTripItems = cart.trip && cart.trip._raw && Array.isArray(cart.trip._raw.items) ? cart.trip._raw.items : null;
    const rawTripItem = rawTripItems && rawTripItems.length ? rawTripItems[0] : null;
    const rawTripItemReturn = rawTripItems && rawTripItems.length > 1 ? rawTripItems[1] : null;
    const segments = rawTripItem && Array.isArray(rawTripItem.segments)
      ? rawTripItem.segments
      : ((cart.busbudResponse && (cart.busbudResponse.segments || (cart.busbudResponse.trip && cart.busbudResponse.trip.segments))) || cart.segments || []);
    if (!Array.isArray(segments) || segments.length === 0) return null;

    let outboundSeg = segments[0] || null;
    let returnSeg = null;
    const tripLegs = rawTripItem && Array.isArray(rawTripItem.trip_legs) ? rawTripItem.trip_legs : [];
    if (tripLegs.length > 0) {
      const leg1SegId = tripLegs[0] && Array.isArray(tripLegs[0].segment_ids) ? tripLegs[0].segment_ids[0] : null;
      const leg2SegId = tripLegs[1] && Array.isArray(tripLegs[1].segment_ids) ? tripLegs[1].segment_ids[0] : null;
      if (leg1SegId) {
        const found = segments.find(s => s && s.id === leg1SegId);
        if (found) outboundSeg = found;
      }
      if (leg2SegId) {
        const foundReturn = segments.find(s => s && s.id === leg2SegId);
        if (foundReturn) returnSeg = foundReturn;
      }
    } else {
      returnSeg = null;
    }

    if (!returnSeg && rawTripItemReturn && Array.isArray(rawTripItemReturn.segments) && rawTripItemReturn.segments.length) {
      returnSeg = rawTripItemReturn.segments[0] || null;
    }

    return {
      outbound: pickSeg(outboundSeg),
      inbound: pickSeg(returnSeg)
    };
  };

  const tryFromTripDetails = () => {
    const td = cart.tripDetails || cart.trip_details || null;
    if (!td) return null;
    return {
      outbound: {
        origin: td.origin || td.from || td.departure || null,
        destination: td.destination || td.to || td.arrival || null,
        departAt: normalizeIso(td.departureTime || td.departure_time || td.depart_at || td.departAt || td.departure || null),
        arriveAt: normalizeIso(td.arrivalTime || td.arrival_time || td.arrive_at || td.arriveAt || td.arrival || null)
      },
      inbound: {
        origin: td.returnOrigin || td.return_origin || td.inboundOrigin || td.inbound_origin || null,
        destination: td.returnDestination || td.return_destination || td.inboundDestination || td.inbound_destination || null,
        departAt: normalizeIso(td.returnDepartureTime || td.return_departure_time || td.return_depart_at || td.returnDepartAt || null),
        arriveAt: normalizeIso(td.returnArrivalTime || td.return_arrival_time || td.return_arrive_at || td.returnArriveAt || null)
      }
    };
  };

  const tryFromCartTripSegments = () => {
    const trip = cart.trip || null;
    const segs = trip && Array.isArray(trip.segments) ? trip.segments : null;
    if (!segs || !segs.length) return null;
    const outbound = pickSegRange(segs);
    const inbound = null;
    return { outbound, inbound };
  };

  const tryFromPurchaseTrips = () => {
    const tripsMap = cp && cp.trips && typeof cp.trips === 'object' ? cp.trips : null;
    if (!tripsMap) return null;
    const anyTrip = Object.values(tripsMap).find(Boolean);
    if (!anyTrip || !Array.isArray(anyTrip.segments) || !anyTrip.segments.length) return null;
    const outbound = pickSegRange(anyTrip.segments);
    const inbound = null;
    return { outbound, inbound };
  };

  const fromSegments = tryFromCartSegments();
  const fromTripDetails = tryFromTripDetails();
  const fromTrip = tryFromCartTripSegments();
  const fromPurchase = tryFromPurchaseTrips();

  const outbound = (fromSegments && fromSegments.outbound) || (fromTripDetails && fromTripDetails.outbound) || (fromTrip && fromTrip.outbound) || (fromPurchase && fromPurchase.outbound) || {};
  const inbound = (fromSegments && fromSegments.inbound) || (fromTripDetails && fromTripDetails.inbound) || (fromTrip && fromTrip.inbound) || (fromPurchase && fromPurchase.inbound) || null;
  return { outbound, inbound };
};

const routeFromTripSelectionRaw = (raw) => {
  const pickSeg = (seg) => {
    if (!seg || typeof seg !== 'object') return null;
    const o = seg.origin || {};
    const d = seg.destination || {};
    const departRaw =
      (seg.departure_time && (seg.departure_time.timestamp || seg.departure_time)) ||
      (seg.departure && seg.departure.timestamp) ||
      seg.departureTime ||
      seg.depart_at ||
      null;
    const arriveRaw =
      (seg.arrival_time && (seg.arrival_time.timestamp || seg.arrival_time)) ||
      (seg.arrival && seg.arrival.timestamp) ||
      seg.arrivalTime ||
      seg.arrive_at ||
      null;
    return {
      origin: o.name || (o.city && o.city.name) || null,
      destination: d.name || (d.city && d.city.name) || null,
      departAt: normalizeIso(departRaw),
      arriveAt: normalizeIso(arriveRaw)
    };
  };

  const pickSegRange = (segs) => {
    if (!Array.isArray(segs) || !segs.length) return null;
    const first = segs[0];
    const last = segs[segs.length - 1];
    const a = pickSeg(first) || {};
    const b = pickSeg(last) || {};
    return {
      origin: a.origin || null,
      destination: b.destination || null,
      departAt: a.departAt || null,
      arriveAt: b.arriveAt || null
    };
  };

  const pickLegRangeByIds = (allSegments, legSegmentIds) => {
    if (!Array.isArray(allSegments) || allSegments.length === 0) return null;
    if (!Array.isArray(legSegmentIds) || legSegmentIds.length === 0) return null;
    const segs = legSegmentIds
      .map((id) => allSegments.find((s) => s && s.id === id))
      .filter(Boolean);
    return pickSegRange(segs);
  };

  if (!raw || typeof raw !== 'object') return null;

  // Prefer item-level segments: round trips typically become multiple items in the cart
  if (Array.isArray(raw.items) && raw.items.length) {
    const item0 = raw.items[0] || null;
    const item1 = raw.items.length > 1 ? raw.items[1] : null;
    const outSegs = item0 && Array.isArray(item0.segments) && item0.segments.length ? item0.segments : null;
    const retSegs = item1 && Array.isArray(item1.segments) && item1.segments.length ? item1.segments : null;
    let outbound = pickSegRange(outSegs) || (Array.isArray(raw.segments) && raw.segments.length ? pickSegRange(raw.segments) : null);
    let inbound = pickSegRange(retSegs) || null;

    if (!inbound && item0 && Array.isArray(item0.trip_legs) && item0.trip_legs.length > 1 && Array.isArray(item0.segments) && item0.segments.length) {
      const leg1Ids = Array.isArray(item0.trip_legs[0]?.segment_ids) ? item0.trip_legs[0].segment_ids : null;
      const leg2Ids = Array.isArray(item0.trip_legs[1]?.segment_ids) ? item0.trip_legs[1].segment_ids : null;
      const outboundByLeg = pickLegRangeByIds(item0.segments, leg1Ids);
      const inboundByLeg = pickLegRangeByIds(item0.segments, leg2Ids);
      // If we have explicit leg mapping, prefer it. A naive pickSegRange over all
      // segments may produce loops (e.g. origin=destination for round trips).
      if (outboundByLeg) {
        outbound = outboundByLeg;
      }
      inbound = inbound || inboundByLeg || null;
    }

    if (outbound || inbound) return { outbound: outbound || {}, inbound: inbound || null };
  }

  if (Array.isArray(raw.trip_legs) && raw.trip_legs.length > 1 && Array.isArray(raw.segments) && raw.segments.length) {
    const leg1Ids = Array.isArray(raw.trip_legs[0]?.segment_ids) ? raw.trip_legs[0].segment_ids : null;
    const leg2Ids = Array.isArray(raw.trip_legs[1]?.segment_ids) ? raw.trip_legs[1].segment_ids : null;
    const outbound = pickLegRangeByIds(raw.segments, leg1Ids) || pickSegRange(raw.segments);
    const inbound = pickLegRangeByIds(raw.segments, leg2Ids) || null;
    if (outbound || inbound) return { outbound: outbound || {}, inbound: inbound || null };
  }

  if (Array.isArray(raw.segments) && raw.segments.length) {
    // Treat raw.segments as connections within a single leg, not a round trip.
    const outbound = pickSegRange(raw.segments);
    const inbound = null;
    if (outbound || inbound) return { outbound: outbound || {}, inbound: inbound || null };
  }

  if (Array.isArray(raw.trips) && raw.trips.length) {
    const t0 = raw.trips[0] || null;
    const t1 = raw.trips.length > 1 ? raw.trips[1] : null;
    const outbound = t0 && Array.isArray(t0.segments) && t0.segments.length ? pickSegRange(t0.segments) : null;
    const inbound = t1 && Array.isArray(t1.segments) && t1.segments.length ? pickSegRange(t1.segments) : null;
    if (outbound || inbound) return { outbound: outbound || {}, inbound: inbound || null };
  }

  if (raw.trips && typeof raw.trips === 'object') {
    const tripsArr = Array.isArray(raw.trips) ? raw.trips : Object.values(raw.trips);
    if (Array.isArray(tripsArr) && tripsArr.length) {
      const t0 = tripsArr[0] || null;
      const t1 = tripsArr.length > 1 ? tripsArr[1] : null;
      const outbound = t0 && Array.isArray(t0.segments) && t0.segments.length ? pickSegRange(t0.segments) : null;
      const inbound = t1 && Array.isArray(t1.segments) && t1.segments.length ? pickSegRange(t1.segments) : null;
      if (outbound || inbound) return { outbound: outbound || {}, inbound: inbound || null };
    }
  }

  return null;
};

export async function upsertCartFromFirestore(cartId, updates = {}) {
  try {
    if (!cartId) return;
    await ensureCartsTableExists();

    const options = arguments.length > 2 && typeof arguments[2] === 'object' ? arguments[2] : {};
    const skipFirestoreRead = !!options.skipFirestoreRead;

    let cartDoc = null;
    if (!skipFirestoreRead) {
      const db = await ensureFirestoreDb();
      try {
        const snap = await db.collection('carts').doc(String(cartId)).get();
        if (snap && snap.exists) {
          cartDoc = { id: snap.id, ...snap.data() };
        }
      } catch (_) {
        cartDoc = null;
      }
    }

    const cart = cartDoc || (updates || {});

    const purchaser = extractPurchaser(cart);
    const passengersBase = extractPassengers(cart);
    const passengerCount = Array.isArray(passengersBase) ? passengersBase.length : null;
    const { bb: busbudResponse, costPrice, retailPrice } = extractBusbudPricing(cart);
    let origin = null;
    let destination = null;
    let departAt = null;
    let arriveAt = null;
    let returnOrigin = null;
    let returnDestination = null;
    let returnDepartAt = null;
    let returnArriveAt = null;
    const routeObj = extractRoute(cart);
    if (routeObj && routeObj.outbound) {
      origin = routeObj.outbound.origin || null;
      destination = routeObj.outbound.destination || null;
      departAt = routeObj.outbound.departAt || null;
      arriveAt = routeObj.outbound.arriveAt || null;
    }
    if (routeObj && routeObj.inbound) {
      returnOrigin = routeObj.inbound.origin || null;
      returnDestination = routeObj.inbound.destination || null;
      returnDepartAt = routeObj.inbound.departAt || null;
      returnArriveAt = routeObj.inbound.arriveAt || null;
    }

    // Fill missing outbound/return route parts from tripSelections raw snapshot.
    if (!origin || !destination || (!returnOrigin && !returnDestination)) {
      try {
        const busbudCartId = cart.busbudCartId || cart.cartId || cart.cart_id || cart.busbud_cart_id || null;
        const rows = await drizzleDb
          .select({ raw: tripSelections.raw })
          .from(tripSelections)
          .where(or(eq(tripSelections.firestoreCartId, String(cartId)), busbudCartId ? eq(tripSelections.cartId, String(busbudCartId)) : sql`FALSE`))
          .orderBy(desc(tripSelections.createdAt))
          .limit(1);
        if (rows && rows.length && rows[0].raw) {
          const r2 = routeFromTripSelectionRaw(rows[0].raw);
          if (r2 && r2.outbound) {
            origin = origin || r2.outbound.origin;
            destination = destination || r2.outbound.destination;
            departAt = departAt || r2.outbound.departAt;
            arriveAt = arriveAt || r2.outbound.arriveAt;
          }
          if (r2 && r2.inbound) {
            returnOrigin = returnOrigin || r2.inbound.origin;
            returnDestination = returnDestination || r2.inbound.destination;
            returnDepartAt = returnDepartAt || r2.inbound.departAt;
            returnArriveAt = returnArriveAt || r2.inbound.arriveAt;
          }
        }
      } catch (_) {
        // ignore
      }
    }

    const currency =
      (retailPrice && retailPrice.currency) ||
      (costPrice && costPrice.currency) ||
      (busbudResponse && busbudResponse.currency) ||
      cart.currency ||
      null;

    const costPriceAmount = centsTotalToCurrencyString(costPrice);
    const retailPriceAmount = centsTotalToCurrencyString(retailPrice);

    const pricingSettings = (() => {
      try {
        return getPricingSettings();
      } catch (_) {
        return null;
      }
    })();

    const baseAmount =
      costPrice && typeof costPrice.total === 'number'
        ? (costPrice.total / 100)
        : (costPriceAmount && !isNaN(Number(costPriceAmount)) ? Number(costPriceAmount) : null);

    const apply = pricingSettings ? !!pricingSettings.apply : false;
    const roundToNearest = pricingSettings && !isNaN(Number(pricingSettings.roundToNearest)) ? Number(pricingSettings.roundToNearest) : 0;

    const commissionPct = pricingSettings && !isNaN(Number(pricingSettings.commission ?? pricingSettings.percentage))
      ? Number(pricingSettings.commission ?? pricingSettings.percentage)
      : null;

    const discountPct = pricingSettings && !isNaN(Number(pricingSettings.discount)) ? Number(pricingSettings.discount) : 0;
    const markupPct = pricingSettings && !isNaN(Number(pricingSettings.markup)) ? Number(pricingSettings.markup) : 0;
    const chargesFixed = pricingSettings && !isNaN(Number(pricingSettings.charges)) ? Number(pricingSettings.charges) : 0;

    const discount = apply && baseAmount != null ? round2(baseAmount * (discountPct / 100)) : 0;
    const markup = apply && baseAmount != null ? round2(baseAmount * (markupPct / 100)) : 0;
    const charges = apply ? round2(chargesFixed) : 0;

    const retailFromBusbud = retailPriceAmount != null && Number.isFinite(Number(retailPriceAmount))
      ? Number(retailPriceAmount)
      : null;

    const retailPriceComputed = (() => {
      if (retailFromBusbud != null) return round2(retailFromBusbud);
      if (baseAmount == null) return null;
      try {
        const chargesTotal = apply ? chargesFixed : 0;
        const v = applyPriceAdjustments(baseAmount, {
          currency,
          apply: !!apply,
          discount: discountPct,
          markup: markupPct,
          charges: chargesTotal,
          roundToNearest,
          returnMetadata: false
        });
        return typeof v === 'number' && Number.isFinite(v) ? round2(v) : null;
      } catch (_) {
        return null;
      }
    })();

    const roundDiff = (() => {
      if (!apply) return 0;
      if (baseAmount == null) return null;
      if (retailFromBusbud != null) return null;
      if (retailPriceComputed == null) return null;
      const rawRetail = baseAmount + (baseAmount * (markupPct / 100)) + (apply ? chargesFixed : 0) - (baseAmount * (discountPct / 100));
      return round2(retailPriceComputed - rawRetail);
    })();

    const commission = (() => {
      const candidates = [
        cart && cart.commission,
        cart && cart.commissionAmount,
        cart && cart.commission_amount,
        cart && cart.passengerDetails && cart.passengerDetails.completePurchase && cart.passengerDetails.completePurchase.commission,
        cart && cart.passengerDetails && cart.passengerDetails.completePurchase && cart.passengerDetails.completePurchase.commissionAmount,
        cart && cart.passengerDetails && cart.passengerDetails.completePurchase && cart.passengerDetails.completePurchase.commission_amount
      ];
      for (const v of candidates) {
        if (v == null) continue;
        if (typeof v === 'string' && !v.trim()) continue;
        const n = Number(v);
        if (Number.isFinite(n)) return round2(n);
      }
      if (baseAmount != null && commissionPct != null && Number.isFinite(Number(commissionPct))) {
        return round2(Number(baseAmount) * (Number(commissionPct) / 100));
      }
      return null;
    })();

    const passengersEnriched = enrichPassengersWithPricing(passengersBase, {
      passengerCount,
      currency,
      costPrice,
      retailPrice,
      costPriceAmount,
      retailPriceAmount,
      discountPct,
      markupPct,
      chargesFixed,
      apply,
      roundToNearest
    });

    const passengers = Array.isArray(passengersEnriched) && passengersEnriched.length ? passengersEnriched : null;

    const expiresAt = extractExpiresAt(cart);

    const now = new Date();
    const toNumericString = (v) => {
      if (v == null) return null;
      if (typeof v === 'string' && v.trim()) return v;
      if (typeof v === 'number' && Number.isFinite(v)) return v.toFixed(2);
      const n = Number(v);
      return Number.isFinite(n) ? n.toFixed(2) : null;
    };

    const status = extractCartStatus(cart);

    const bookedBy = (() => {
      try {
        const agentEmail = cart && (cart.agentEmail || (cart.agent && cart.agent.agentEmail));
        const agentName = cart && (cart.agentName || (cart.agent && cart.agent.agentName));
        const e = typeof agentEmail === 'string' ? agentEmail.trim().toLowerCase() : '';
        if (e) return e;
        const n = typeof agentName === 'string' ? agentName.trim() : '';
        if (n) return n;
        return null;
      } catch (_) {
        return null;
      }
    })();

    const firestoreCartId = cart.firestoreCartId || cart.id || String(cartId);
    const busbudCartId =
      cart.busbudCartId ||
      cart.busbud_cart_id ||
      cart.cartId ||
      cart.cart_id ||
      (cartId != null ? String(cartId) : null);

    const canonicalCartId = String(busbudCartId || '').trim() || String(firestoreCartId || '').trim();

    const record = {
      cartId: canonicalCartId,
      firestoreCartId,
      bookedBy,
      status: status || null,
      currency,
      origin,
      destination,
      departAt,
      arriveAt,
      returnOrigin,
      returnDestination,
      returnDepartAt,
      returnArriveAt,
      passengerCount,
      purchaser,
      passengers,
      busbudResponse,
      costPrice: toNumericString(costPriceAmount),
      discount: toNumericString(discount),
      markup: toNumericString(markup),
      charges: toNumericString(charges),
      commission: toNumericString(commission),
      roundDiff: toNumericString(roundDiff),
      retailPrice: toNumericString(retailPriceComputed),
      updatedAt: now,
      createdAt: now
    };

    if (expiresAt != null) {
      record.expiresAt = expiresAt;
    }

    const updateSet = {
      firestoreCartId: record.firestoreCartId,
      currency: record.currency,
      origin: record.origin,
      destination: record.destination,
      departAt: record.departAt,
      arriveAt: record.arriveAt,
      passengerCount: record.passengerCount,
      busbudResponse: record.busbudResponse,
      costPrice: record.costPrice,
      discount: record.discount,
      markup: record.markup,
      charges: record.charges,
      commission: record.commission,
      roundDiff: record.roundDiff,
      retailPrice: record.retailPrice,
      updatedAt: now
    };
    if (record.bookedBy != null && String(record.bookedBy).trim()) updateSet.bookedBy = record.bookedBy;
    if (record.purchaser != null) updateSet.purchaser = record.purchaser;
    if (record.passengers != null) updateSet.passengers = record.passengers;
    if (record.status != null) updateSet.status = record.status;
    if (record.expiresAt != null) updateSet.expiresAt = record.expiresAt;
    if (record.returnOrigin != null) updateSet.returnOrigin = record.returnOrigin;
    if (record.returnDestination != null) updateSet.returnDestination = record.returnDestination;
    if (record.returnDepartAt != null) updateSet.returnDepartAt = record.returnDepartAt;
    if (record.returnArriveAt != null) updateSet.returnArriveAt = record.returnArriveAt;

    await drizzleDb
      .insert(cartsTable)
      .values(record)
      .onConflictDoUpdate({
        target: cartsTable.cartId,
        set: updateSet
      });
  } catch (e) {
    console.error('Error upserting cart to Postgres:', e);
  }
}

export async function mirrorCartToFirestoreFromPostgres(cartId, firestoreCartId = null) {
  try {
    const pgCart = await getCartFromPostgres(cartId);
    if (!pgCart) return false;

    const db = await ensureFirestoreDb();
    const docId = String(firestoreCartId || pgCart.firestoreCartId || pgCart.cartId || cartId);
    const nowIso = new Date().toISOString();

    const payload = {
      busbudCartId: String(pgCart.cartId || cartId),
      firestoreCartId: docId,
      updatedAt: nowIso,
      lastUpdated: nowIso
    };
    if (pgCart.status != null) payload.status = pgCart.status;
    if (pgCart.currency != null) payload.currency = pgCart.currency;
    if (pgCart.origin != null) payload.origin = pgCart.origin;
    if (pgCart.destination != null) payload.destination = pgCart.destination;
    if (pgCart.departAt != null) payload.departAt = pgCart.departAt;
    if (pgCart.arriveAt != null) payload.arriveAt = pgCart.arriveAt;
    if (pgCart.returnOrigin != null) payload.returnOrigin = pgCart.returnOrigin;
    if (pgCart.returnDestination != null) payload.returnDestination = pgCart.returnDestination;
    if (pgCart.returnDepartAt != null) payload.returnDepartAt = pgCart.returnDepartAt;
    if (pgCart.returnArriveAt != null) payload.returnArriveAt = pgCart.returnArriveAt;
    if (pgCart.purchaser != null) {
      payload.purchaser = pgCart.purchaser;
      payload.purchaserDetails = pgCart.purchaser;
    }
    if (pgCart.passengers != null) payload.passengers = pgCart.passengers;
    if (pgCart.expiresAt != null) {
      payload._ttl = pgCart.expiresAt;
      payload.expiresAt = pgCart.expiresAt;
      if (pgCart.expiresAt instanceof Date && !isNaN(pgCart.expiresAt.getTime())) {
        payload.ttl = Math.floor(pgCart.expiresAt.getTime() / 1000);
      }
    }
    if (pgCart.busbudResponse != null) {
      payload.busbudResponse = pgCart.busbudResponse;
      payload['passengerDetails.busbudResponse'] = pgCart.busbudResponse;
    }

    await db.collection('carts').doc(docId).set(payload, { merge: true });

    return true;
  } catch (e) {
    console.error('Error mirroring cart to Firestore from Postgres:', e);
    return false;
  }
}

export async function upsertCartFromBusbud(cartId, busbudResponse = {}, extra = {}) {
  const cart = {
    ...(extra && typeof extra === 'object' ? extra : {}),
    busbudCartId: String(cartId),
    cartId: String(cartId),
    busbudResponse: busbudResponse && typeof busbudResponse === 'object' ? busbudResponse : {}
  };

  if (!Array.isArray(cart.passengers) || cart.passengers.length === 0) {
    const rpItems = cart.busbudResponse && cart.busbudResponse.retail_price && Array.isArray(cart.busbudResponse.retail_price.items)
      ? cart.busbudResponse.retail_price.items
      : null;
    const cpItems = cart.busbudResponse && cart.busbudResponse.cost_price && Array.isArray(cart.busbudResponse.cost_price.items)
      ? cart.busbudResponse.cost_price.items
      : null;
    const srcItems = cpItems || rpItems;
    if (srcItems) {
      cart.passengers = srcItems.map(it => (it && it.passenger ? it.passenger : null)).filter(Boolean);
    }
  }

  await upsertCartFromFirestore(String(cartId), cart, { skipFirestoreRead: true });
  try {
    await mirrorCartToFirestoreFromPostgres(String(cartId), cart.firestoreCartId || (extra && extra.firestoreCartId) || null);
  } catch (_) {
    // ignore
  }
}

export async function upsertCartPurchaserFromBusbud(cartId, purchaser = {}) {
  try {
    if (!cartId) return;
    await ensureCartsTableExists();
    const now = new Date();
    const busbudCartId = String(cartId);
    const resolvedFirestoreCartId = await (async () => {
      try {
        const rows = await drizzleDb
          .select({ firestoreCartId: tripSelections.firestoreCartId })
          .from(tripSelections)
          .where(eq(tripSelections.cartId, busbudCartId))
          .orderBy(desc(tripSelections.createdAt))
          .limit(1);
        const resolved = rows && rows.length ? rows[0].firestoreCartId : null;
        return resolved ? String(resolved).trim() : null;
      } catch (_) {
        return null;
      }
    })();
    const p = purchaser && typeof purchaser === 'object' ? purchaser : {};
    const normalized = {
      first_name: p.first_name || p.firstName || null,
      last_name: p.last_name || p.lastName || null,
      email: p.email || null,
      phone: p.phone || p.phone_number || p.phoneNumber || null,
      opt_in_marketing: p.opt_in_marketing ?? p.optInMarketing ?? null
    };

    const hasAnyIdentity =
      (typeof normalized.first_name === 'string' && normalized.first_name.trim()) ||
      (typeof normalized.last_name === 'string' && normalized.last_name.trim()) ||
      (typeof normalized.email === 'string' && normalized.email.trim()) ||
      (typeof normalized.phone === 'string' && normalized.phone.trim()) ||
      normalized.opt_in_marketing !== null;
    if (!hasAnyIdentity) return;

    await drizzleDb
      .insert(cartsTable)
      .values({
        cartId: busbudCartId,
        firestoreCartId: resolvedFirestoreCartId,
        purchaser: normalized,
        updatedAt: now,
        createdAt: now
      })
      .onConflictDoUpdate({
        target: cartsTable.cartId,
        set: {
          ...(resolvedFirestoreCartId ? { firestoreCartId: resolvedFirestoreCartId } : {}),
          purchaser: normalized,
          updatedAt: now
        }
      });

    try {
      await mirrorCartToFirestoreFromPostgres(busbudCartId, resolvedFirestoreCartId || null);
    } catch (_) {
      // ignore
    }
  } catch (e) {
    console.error('Error upserting cart purchaser to Postgres:', e);
  }
}

export async function getCartFromPostgres(cartId) {
  try {
    if (!cartId) return null;
    await ensureCartsTableExists();
    const id = String(cartId);
    const rows = await drizzleDb
      .select({
        cartId: cartsTable.cartId,
        firestoreCartId: cartsTable.firestoreCartId,
        bookedBy: cartsTable.bookedBy,
        status: cartsTable.status,
        currency: cartsTable.currency,
        origin: cartsTable.origin,
        destination: cartsTable.destination,
        departAt: cartsTable.departAt,
        arriveAt: cartsTable.arriveAt,
        returnOrigin: cartsTable.returnOrigin,
        returnDestination: cartsTable.returnDestination,
        returnDepartAt: cartsTable.returnDepartAt,
        returnArriveAt: cartsTable.returnArriveAt,
        passengerCount: cartsTable.passengerCount,
        purchaser: cartsTable.purchaser,
        passengers: cartsTable.passengers,
        busbudResponse: cartsTable.busbudResponse,
        costPrice: cartsTable.costPrice,
        discount: cartsTable.discount,
        markup: cartsTable.markup,
        charges: cartsTable.charges,
        commission: cartsTable.commission,
        roundDiff: cartsTable.roundDiff,
        retailPrice: cartsTable.retailPrice,
        expiresAt: cartsTable.expiresAt,
        updatedAt: cartsTable.updatedAt,
        createdAt: cartsTable.createdAt
      })
      .from(cartsTable)
      .where(or(eq(cartsTable.cartId, id), eq(cartsTable.firestoreCartId, id)))
      .limit(1);
    if (!rows || !rows.length) return null;
    return rows[0] || null;
  } catch (e) {
    console.error('Error reading cart from Postgres:', e);
    return null;
  }
}
