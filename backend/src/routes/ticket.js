 import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import BusbudService from '../services/busbud.service.mjs';
import qr from 'qr-image';
import axios from 'axios';
import archiver from 'archiver';
import { PassThrough } from 'stream';
import AdmZip from 'adm-zip';
import { sendEmail } from '../utils/email.js';
import { ApiError } from '../utils/apiError.js';
import { updateCart, getOrCreateFirestoreCartId } from '../utils/firestore.js';
import { getFirestore } from '../config/firebase.config.mjs';
import { applyPriceAdjustments } from '../utils/price.utils.js';
import { body, query, validationResult } from 'express-validator';
import fs from 'fs';
import crypto from 'crypto';
import { eq, or, sql } from 'drizzle-orm';
import drizzleDb, { carts as cartsPgTable, payments, tripSelections, cartPassengerDetails, tickets as ticketsTable } from '../db/drizzleClient.js';
import logger from '../utils/logger.js';
import { generatePdfFromHtml } from '../utils/ticketPdf.js';

const isProduction = process.env.NODE_ENV === 'production';

const recentEticketSendByPnr = new Map();

const ticketLogoDataUri = (() => {
  try {
    const logoPath = fileURLToPath(new URL('../../assets/logo-main/e-ticket-logo.png', import.meta.url));
    const logoBuf = fs.readFileSync(logoPath);
    return `data:image/png;base64,${logoBuf.toString('base64')}`;
  } catch (_) {
    return null;
  }
})();

let ticketsTableEnsured = false;
const ensureTicketsTableExists = async () => {
  if (ticketsTableEnsured) return;
  await drizzleDb.execute(sql`
    CREATE TABLE IF NOT EXISTS "tickets" (
      "id" serial PRIMARY KEY NOT NULL,
      "pnr" text NOT NULL,
      "booked_by" text,
      "url" text NOT NULL,
      "hold_pdf_base64" text,
      "final_pdf_base64" text,
      "final_zip_base64" text,
      "hold_pdf_updated_at" timestamp with time zone,
      "final_pdf_updated_at" timestamp with time zone,
      "final_zip_updated_at" timestamp with time zone,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "tickets_pnr_unique" UNIQUE("pnr")
    );
  `);

  await drizzleDb.execute(sql`
    ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "hold_pdf_base64" text;
  `);
  await drizzleDb.execute(sql`
    ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "final_pdf_base64" text;
  `);
  await drizzleDb.execute(sql`
    ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "final_zip_base64" text;
  `);
  await drizzleDb.execute(sql`
    ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "hold_pdf_updated_at" timestamp with time zone;
  `);
  await drizzleDb.execute(sql`
    ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "final_pdf_updated_at" timestamp with time zone;
  `);
  await drizzleDb.execute(sql`
    ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "final_zip_updated_at" timestamp with time zone;
  `);
  ticketsTableEnsured = true;
};

const resolveBookedByFromPostgres = async (_pnr) => {
  try {
    const ref = String(_pnr || '').trim();
    if (!ref) return null;

    try {
      const pRows = await drizzleDb
        .select({ bookedBy: payments.bookedBy })
        .from(payments)
        .where(eq(payments.transactionRef, ref))
        .limit(1);
      const p = pRows && pRows.length ? (pRows[0] || null) : null;
      const pb = p && p.bookedBy ? String(p.bookedBy).trim() : '';
      if (pb) return pb;
    } catch (_) {}

    return null;
  } catch (_) {
    return null;
  }
};

const maybeHalvePassengersForRoundTrip = (passengers) => {
  try {
    const list = Array.isArray(passengers) ? passengers : [];
    if (list.length < 2) return null;
    if (list.length % 2 !== 0) return null;
    const half = list.length / 2;
    if (half < 1) return null;

    const normalize = (s) => typeof s === 'string' ? s.trim().toLowerCase() : (s == null ? '' : String(s).trim().toLowerCase());
    const normalizeDocCandidate = (val) => {
      if (val == null) return '';
      const raw = String(val).trim();
      if (!raw) return '';
      const looksUuidish = raw.length >= 16 && (raw.includes('-') || raw.includes('_') || /^[a-f0-9-]{16,}$/i.test(raw));
      if (looksUuidish) return '';
      if (/^[0-9]+$/.test(raw) && raw.length <= 4) return '';
      return raw;
    };
    const fullName = (p = {}) => p.name || p.fullName || p.full_name || p.displayName || p.display_name || '';
    const firstName = (p = {}) => p.first_name || p.firstName || p.given_name || p.givenName || p.name_first || '';
    const lastName = (p = {}) => p.last_name || p.lastName || p.family_name || p.familyName || p.name_last || '';
    const docNo = (p = {}) => {
      if (!p || typeof p !== 'object') return '';
      if (p.idNumber || p.id_number || p.id_no) return normalizeDocCandidate(p.idNumber || p.id_number || p.id_no);
      if (p.passport || p.passport_number) return normalizeDocCandidate(p.passport || p.passport_number);
      if (p.documentNumber || p.document_no) return normalizeDocCandidate(p.documentNumber || p.document_no);
      if (Array.isArray(p.documents)) {
        const d = p.documents.find((d) => d && (d.number || d.value || d.id));
        if (d) return normalizeDocCandidate(d.number || d.value || d.id);
      }
      return '';
    };
    const keyFor = (p = {}) => {
      const doc = normalize(normalizeDocCandidate(docNo(p)));
      if (doc) return `doc:${doc}`;
      const fn = normalize(firstName(p));
      const ln = normalize(lastName(p));
      const nm = (() => {
        const byParts = [fn, ln].filter(Boolean).join(' ').trim();
        const byFull = normalize(fullName(p)).replace(/\s+/g, ' ').trim();
        return (byParts || byFull) ? (byParts || byFull) : '';
      })();
      if (nm) return `name:${nm}`;
      return '';
    };
    const counts = (arr) => {
      const m = new Map();
      for (const p of arr) {
        const k = keyFor(p);
        if (!k) continue;
        m.set(k, (m.get(k) || 0) + 1);
      }
      return m;
    };
    const a = list.slice(0, half);
    const b = list.slice(half);
    const ma = counts(a);
    const mb = counts(b);
    if (!ma.size || !mb.size) return null;
    let inter = 0;
    for (const [k, va] of ma.entries()) {
      const vb = mb.get(k) || 0;
      if (vb > 0) inter += Math.min(va, vb);
    }
    const ratio = inter / half;
    if (ratio >= 0.75) return a;
    return null;
  } catch (_) {
    return null;
  }
};

const normalizeToBuffer = (value) => {
  try {
    if (value == null) return null;
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof Uint8Array) return Buffer.from(value);
    if (ArrayBuffer.isView(value) && value.buffer) return Buffer.from(value.buffer);
    if (value instanceof ArrayBuffer) return Buffer.from(value);
    return Buffer.from(value);
  } catch (_) {
    return null;
  }
};

const looksLikePdfBuffer = (bufLike) => {
  try {
    const buf = normalizeToBuffer(bufLike);
    if (!buf || buf.length < 5) return false;
    return buf.subarray(0, 5).toString('ascii') === '%PDF-';
  } catch (_) {
    return false;
  }
};

const sha256Hex = (bufLike) => {
  try {
    const buf = normalizeToBuffer(bufLike);
    if (!buf || !buf.length) return null;
    return crypto.createHash('sha256').update(buf).digest('hex');
  } catch (_) {
    return null;
  }
};

const getCachedTicketPdfFromPostgres = async (_pnr, which) => {
  try {
    await ensureTicketsTableExists();
    const target = String(which || '').toLowerCase() === 'final_zip'
      ? 'final_zip'
      : (String(which || '').toLowerCase() === 'final' ? 'final' : 'hold');

    const selectObj = target === 'final_zip'
      ? { b64: ticketsTable.finalZipBase64 }
      : (target === 'final'
        ? { b64: ticketsTable.finalPdfBase64 }
        : { b64: ticketsTable.holdPdfBase64 });

    const rows = await drizzleDb
      .select(selectObj)
      .from(ticketsTable)
      .where(eq(ticketsTable.pnr, String(_pnr)))
      .limit(1);
    if (!rows || !rows.length) return null;
    const r0 = rows[0] || {};
    const b64 = r0.b64;
    if (!b64 || typeof b64 !== 'string') return null;
    const buf = Buffer.from(b64, 'base64');
    if (!buf || !buf.length) return null;
    return buf;
  } catch (_) {
    return null;
  }
};

const hydrateEticketCartFromCartsTable = async (cart, { _pnr, cartIdHint, requestId } = {}) => {
  try {
    const ids = new Set();
    if (_pnr != null && String(_pnr).trim()) ids.add(String(_pnr).trim());
    if (cartIdHint != null && String(cartIdHint).trim()) ids.add(String(cartIdHint).trim());

    const base = cart && typeof cart === 'object' ? cart : {};
    const cid = base.busbudCartId || base.cartId || base.cart_id || null;
    if (cid != null && String(cid).trim()) ids.add(String(cid).trim());

    const idList = Array.from(ids).filter(Boolean);
    if (!idList.length) return base;

    const whereOr = [];
    for (const id of idList) {
      whereOr.push(eq(cartsPgTable.cartId, String(id)));
      whereOr.push(eq(cartsPgTable.busbudCartId, String(id)));
    }

    const rows = await drizzleDb
      .select({
        cartId: cartsPgTable.cartId,
        busbudCartId: cartsPgTable.busbudCartId,
        currency: cartsPgTable.currency,
        passengerCount: cartsPgTable.passengerCount,
        purchaser: cartsPgTable.purchaser,
        passengers: cartsPgTable.passengers,
        retailPrice: cartsPgTable.retailPrice,
      })
      .from(cartsPgTable)
      .where(or(...whereOr))
      .limit(1);

    if (!rows || !rows.length) return base;
    const row = rows[0] || {};

    if (row.busbudCartId && !base.busbudCartId) base.busbudCartId = row.busbudCartId;
    if (row.cartId && !base.cartId) base.cartId = row.cartId;
    if (row.cartId && !base.pnr) base.pnr = row.cartId;

    if (row.purchaser && !base.purchaser) {
      base.purchaser = row.purchaser;
    }

    const pgPassengers = (() => {
      try {
        if (!row || row.passengers == null) return null;
        if (Array.isArray(row.passengers)) return row.passengers;
        if (typeof row.passengers === 'string' && row.passengers.trim()) {
          const parsed = JSON.parse(row.passengers);
          if (Array.isArray(parsed)) return parsed;
          if (parsed && typeof parsed === 'object' && Array.isArray(parsed.passengers)) return parsed.passengers;
        }
        if (row.passengers && typeof row.passengers === 'object' && Array.isArray(row.passengers.passengers)) return row.passengers.passengers;
      } catch (_) {
        return null;
      }
      return null;
    })();

    if (Array.isArray(pgPassengers) && pgPassengers.length) {
      base.passengers = pgPassengers;
      base.requiredPassengers = pgPassengers;
      if (!(typeof base.passengerCount === 'number' && base.passengerCount > 0)) {
        base.passengerCount = (typeof row.passengerCount === 'number' && row.passengerCount > 0)
          ? row.passengerCount
          : pgPassengers.length;
      }
      if (!base.passengerDetails) base.passengerDetails = {};
      if (!base.passengerDetails.passengers) base.passengerDetails.passengers = pgPassengers;
    }

    const rt = row.retailPrice != null ? Number(row.retailPrice) : NaN;
    if (Number.isFinite(rt) && rt > 0) {
      base.totalPrice = rt;
      base.totalAmount = rt;
      base.total = rt;
    }

    if (row.currency) {
      if (!base.summary) base.summary = {};
      if (!base.summary.currency) base.summary.currency = row.currency;
      if (!base.currency) base.currency = row.currency;
    }

    return base;
  } catch (e) {
    logger.warn(`[${requestId}] Failed to hydrate e-ticket cart from Postgres carts table`, { _pnr, cartIdHint, error: e.message });
    return cart && typeof cart === 'object' ? cart : {};
  }
};

const upsertTicketPdfCache = async ({ _pnr, pnr, bookedBy, url, which, pdfBuffer }) => {
  try {
    const resolvedPnr = (_pnr != null && String(_pnr).trim()) ? String(_pnr).trim() : String(pnr || '').trim();
    if (!resolvedPnr) return;
    await ensureTicketsTableExists();

    // Do not allow a hold/reserved PDF to overwrite a final ticket once the final ticket exists.
    if (which === 'hold') {
      try {
        const existing = await drizzleDb
          .select({
            finalPdfBase64: ticketsTable.finalPdfBase64,
            finalZipBase64: ticketsTable.finalZipBase64
          })
          .from(ticketsTable)
          .where(eq(ticketsTable.pnr, String(resolvedPnr)))
          .limit(1);
        const row0 = existing && existing.length ? (existing[0] || {}) : null;
        const hasFinalAlready = !!(
          row0 &&
          ((typeof row0.finalZipBase64 === 'string' && row0.finalZipBase64.trim()) ||
            (typeof row0.finalPdfBase64 === 'string' && row0.finalPdfBase64.trim()))
        );
        if (hasFinalAlready) return;
      } catch (_) {
        // ignore
      }
    }

    if ((which === 'final' || which === 'hold') && !looksLikePdfBuffer(pdfBuffer)) {
      logger.warn(`Refusing to cache non-PDF buffer in tickets table`, {
        _pnr: String(resolvedPnr),
        which,
        size: (normalizeToBuffer(pdfBuffer) && normalizeToBuffer(pdfBuffer).length) ? normalizeToBuffer(pdfBuffer).length : 0
      });
      return;
    }
    const now = new Date();
    const baseVals = {
      pnr: String(resolvedPnr),
      bookedBy: bookedBy ? String(bookedBy) : null,
      url: String(url),
      createdAt: now
    };
    const normalizedPdfBuffer = normalizeToBuffer(pdfBuffer);
    if (!normalizedPdfBuffer || !normalizedPdfBuffer.length) {
      logger.warn(`Refusing to cache empty PDF buffer in tickets table`, { _pnr: String(resolvedPnr), which });
      return;
    }
    const b64 = normalizedPdfBuffer.toString('base64');
    const setObj = which === 'final_zip'
      ? { finalZipBase64: b64, finalZipUpdatedAt: now, holdPdfBase64: null, holdPdfUpdatedAt: now }
      : (which === 'final'
        ? { finalPdfBase64: b64, finalPdfUpdatedAt: now, holdPdfBase64: null, holdPdfUpdatedAt: now }
        : { holdPdfBase64: b64, holdPdfUpdatedAt: now });
    await drizzleDb
      .insert(ticketsTable)
      .values({
        ...baseVals,
        ...setObj
      })
      .onConflictDoUpdate({
        target: ticketsTable.pnr,
        set: {
          bookedBy: baseVals.bookedBy,
          url: baseVals.url,
          ...setObj
        }
      });
  } catch (e) {
    logger.warn(`Failed to persist ticket PDF cache in Postgres`, { _pnr: (_pnr != null ? _pnr : pnr), which, error: e.message });
  }
};

const buildZipBuffer = async (files = []) => {
  const archive = archiver('zip', { zlib: { level: 9 } });
  const out = new PassThrough();
  const chunks = [];
  out.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    out.on('end', () => resolve(Buffer.concat(chunks)));
    out.on('error', reject);
    archive.on('error', reject);
  });
  archive.pipe(out);
  const seenNames = new Set();
  let appended = 0;
  for (const f of files) {
    if (!f || !f.name) continue;
    const name = String(f.name);
    if (seenNames.has(name)) continue;
    seenNames.add(name);
    const buf = normalizeToBuffer(f.buffer);
    if (!buf || !buf.length) continue;
    archive.append(buf, { name });
    appended += 1;
  }

  if (!appended) {
    throw new Error('No valid PDF buffers were provided for ZIP generation');
  }

  await archive.finalize();
  return done;
};

const countPdfFilesInZipBuffer = (bufLike) => {
  try {
    const buf = normalizeToBuffer(bufLike);
    if (!buf || !buf.length) return null;
    const zip = new AdmZip(buf);
    const entries = zip.getEntries() || [];
    const pdfs = entries.filter((e) => e && !e.isDirectory && e.entryName && /\.pdf$/i.test(String(e.entryName)));
    return pdfs.length;
  } catch (_) {
    return null;
  }
};

const uniquePassengerCount = (passengers) => {
  try {
    const list = Array.isArray(passengers) ? passengers : [];
    if (!list.length) return null;

    const normalize = (s) => typeof s === 'string' ? s.trim().toLowerCase() : (s == null ? '' : String(s).trim().toLowerCase());
    const normalizeDocCandidate = (val) => {
      if (val == null) return '';
      const raw = String(val).trim();
      if (!raw) return '';
      const looksUuidish = raw.length >= 16 && (raw.includes('-') || raw.includes('_') || /^[a-f0-9-]{16,}$/i.test(raw));
      if (looksUuidish) return '';
      if (/^[0-9]+$/.test(raw) && raw.length <= 4) return '';
      return raw;
    };

    const fullName = (p = {}) => p.name || p.fullName || p.full_name || p.displayName || p.display_name || '';
    const firstName = (p = {}) => p.first_name || p.firstName || p.given_name || p.givenName || p.name_first || '';
    const lastName = (p = {}) => p.last_name || p.lastName || p.family_name || p.familyName || p.name_last || '';
    const docNo = (p = {}) => {
      if (!p || typeof p !== 'object') return '';
      if (p.idNumber || p.id_number || p.id_no) return normalizeDocCandidate(p.idNumber || p.id_number || p.id_no);
      if (p.passport || p.passport_number) return normalizeDocCandidate(p.passport || p.passport_number);
      if (p.documentNumber || p.document_no) return normalizeDocCandidate(p.documentNumber || p.document_no);
      if (Array.isArray(p.documents)) {
        const d = p.documents.find((d) => d && (d.number || d.value || d.id));
        if (d) return normalizeDocCandidate(d.number || d.value || d.id);
      }
      return '';
    };

    const keyFor = (p = {}) => {
      const fn = normalize(firstName(p));
      const ln = normalize(lastName(p));
      const doc = normalize(normalizeDocCandidate(docNo(p)));
      const nm = (() => {
        const byParts = [fn, ln].filter(Boolean).join(' ').trim();
        const byFull = normalize(fullName(p)).replace(/\s+/g, ' ').trim();
        return (byParts || byFull) ? (byParts || byFull) : '';
      })();
      if (doc) return `doc:${doc}`;
      if (nm) return `name:${nm}`;
      return '';
    };

    const seen = new Set();
    let count = 0;
    for (const p of list) {
      const k = keyFor(p);
      if (!k) continue;
      if (seen.has(k)) continue;
      seen.add(k);
      count += 1;
    }
    if (count > 0) return count;

    const fallbackSeen = new Set();
    let fallbackCount = 0;
    for (const p of list) {
      const fn = normalize(firstName(p));
      const ln = normalize(lastName(p));
      const nm = (() => {
        const byParts = [fn, ln].filter(Boolean).join(' ').trim();
        const byFull = normalize(fullName(p)).replace(/\s+/g, ' ').trim();
        return (byParts || byFull) ? (byParts || byFull) : '';
      })();
      const k = nm ? `name:${nm}` : '';
      if (!k) continue;
      if (fallbackSeen.has(k)) continue;
      fallbackSeen.add(k);
      fallbackCount += 1;
    }
    return fallbackCount > 0 ? fallbackCount : null;
  } catch (_) {
    return null;
  }
};

const dedupePassengersByName = (passengers) => {
  try {
    const list = Array.isArray(passengers) ? passengers : [];
    if (!list.length) return [];
    const normalize = (s) => typeof s === 'string' ? s.trim().toLowerCase() : (s == null ? '' : String(s).trim().toLowerCase());
    const fullName = (p = {}) => p.name || p.fullName || p.full_name || p.displayName || p.display_name || '';
    const firstName = (p = {}) => p.first_name || p.firstName || p.given_name || p.givenName || p.name_first || '';
    const lastName = (p = {}) => p.last_name || p.lastName || p.family_name || p.familyName || p.name_last || '';
    const uniq = [];
    const seen = new Set();
    for (const p of list) {
      const fn = normalize(firstName(p));
      const ln = normalize(lastName(p));
      const nm = (() => {
        const byParts = [fn, ln].filter(Boolean).join(' ').trim();
        const byFull = normalize(fullName(p)).replace(/\s+/g, ' ').trim();
        return (byParts || byFull) ? (byParts || byFull) : '';
      })();
      const k = nm;
      if (!k) continue;
      if (seen.has(k)) continue;
      seen.add(k);
      uniq.push(p);
    }
    return uniq;
  } catch (_) {
    return [];
  }
};

const dedupePassengersByIdentity = (passengers) => {
  try {
    const list = Array.isArray(passengers) ? passengers : [];
    if (!list.length) return [];

    const normalize = (s) => typeof s === 'string' ? s.trim().toLowerCase() : (s == null ? '' : String(s).trim().toLowerCase());
    const normalizeDocCandidate = (val) => {
      if (val == null) return '';
      const raw = String(val).trim();
      if (!raw) return '';
      const looksUuidish = raw.length >= 16 && (raw.includes('-') || raw.includes('_') || /^[a-f0-9-]{16,}$/i.test(raw));
      if (looksUuidish) return '';
      if (/^[0-9]+$/.test(raw) && raw.length <= 4) return '';
      return raw;
    };
    const fullName = (p = {}) => p.name || p.fullName || p.full_name || p.displayName || p.display_name || '';
    const firstName = (p = {}) => p.first_name || p.firstName || p.given_name || p.givenName || p.name_first || '';
    const lastName = (p = {}) => p.last_name || p.lastName || p.family_name || p.familyName || p.name_last || '';
    const docNo = (p = {}) => {
      if (!p || typeof p !== 'object') return '';
      if (p.idNumber || p.id_number || p.id_no) return normalizeDocCandidate(p.idNumber || p.id_number || p.id_no);
      if (p.passport || p.passport_number) return normalizeDocCandidate(p.passport || p.passport_number);
      if (p.documentNumber || p.document_no) return normalizeDocCandidate(p.documentNumber || p.document_no);
      if (Array.isArray(p.documents)) {
        const d = p.documents.find((d) => d && (d.number || d.value || d.id));
        if (d) return normalizeDocCandidate(d.number || d.value || d.id);
      }
      return '';
    };
    const keyFor = (p = {}) => {
      const fn = normalize(firstName(p));
      const ln = normalize(lastName(p));
      const doc = normalize(normalizeDocCandidate(docNo(p)));
      const nm = (() => {
        const byParts = [fn, ln].filter(Boolean).join(' ').trim();
        const byFull = normalize(fullName(p)).replace(/\s+/g, ' ').trim();
        return (byParts || byFull) ? (byParts || byFull) : '';
      })();
      if (doc) return `doc:${doc}`;
      if (nm) return `name:${nm}`;
      return '';
    };

    const uniq = [];
    const seen = new Set();
    for (const p of list) {
      const k = keyFor(p);
      if (!k) continue;
      if (seen.has(k)) continue;
      seen.add(k);
      uniq.push(p);
    }
    return uniq;
  } catch (_) {
    return [];
  }
};

const expectedFinalZipPdfCountFromPostgres = async (_pnr) => {
  try {
    const ref = String(_pnr || '').trim();
    if (!ref) return null;

    let passengerCount = null;
    let passengerListCandidate = null;
    try {
      const rows = await drizzleDb
        .select({
          passengers: cartPassengerDetails.passengers,
          passengerCount: cartPassengerDetails.passengerCount,
          cartId: cartPassengerDetails.cartId,
          firestoreCartId: cartPassengerDetails.firestoreCartId,
        })
        .from(cartPassengerDetails)
        .where(or(eq(cartPassengerDetails.firestoreCartId, ref), eq(cartPassengerDetails.cartId, ref)))
        .limit(1);
      if (rows && rows.length) {
        const row0 = rows[0] || {};
        const pc = row0.passengerCount;
        const arr = Array.isArray(row0.passengers)
          ? row0.passengers
          : (row0.passengers && typeof row0.passengers === 'object' && Array.isArray(row0.passengers.passengers)
            ? row0.passengers.passengers
            : null);
        if (Array.isArray(arr) && arr.length) passengerListCandidate = arr;
        const dedupIdentity = uniquePassengerCount(arr);
        const dedupByName = Array.isArray(arr) ? dedupePassengersByName(arr).length : 0;
        if (dedupByName > 0 && dedupIdentity > 0 && dedupIdentity % 2 === 0 && dedupByName * 2 === dedupIdentity) {
          passengerCount = dedupByName;
        } else if (dedupIdentity != null && dedupIdentity > 0) {
          passengerCount = dedupIdentity;
        } else if (typeof pc === 'number' && pc > 0) {
          passengerCount = pc;
        } else if (Array.isArray(arr) && arr.length) {
          passengerCount = arr.length;
        }
      }
    } catch (_) {
    }

    if (!passengerCount) {
      try {
        const cRows = await drizzleDb
          .select({ passengerCount: cartsPgTable.passengerCount, passengers: cartsPgTable.passengers })
          .from(cartsPgTable)
          .where(or(eq(cartsPgTable.cartId, ref), eq(cartsPgTable.busbudCartId, ref)))
          .limit(1);
        if (cRows && cRows.length) {
          const row0 = cRows[0] || {};
          const pc = row0.passengerCount;
          const arr = (() => {
            try {
              if (Array.isArray(row0.passengers)) return row0.passengers;
              if (typeof row0.passengers === 'string' && row0.passengers.trim()) {
                const parsed = JSON.parse(row0.passengers);
                if (Array.isArray(parsed)) return parsed;
                if (parsed && typeof parsed === 'object' && Array.isArray(parsed.passengers)) return parsed.passengers;
              }
              if (row0.passengers && typeof row0.passengers === 'object' && Array.isArray(row0.passengers.passengers)) return row0.passengers.passengers;
            } catch (_) {
              return null;
            }
            return null;
          })();
          if (Array.isArray(arr) && arr.length) passengerListCandidate = arr;
          const dedupIdentity = uniquePassengerCount(arr);
          const dedupByName = Array.isArray(arr) ? dedupePassengersByName(arr).length : 0;
          if (dedupByName > 0 && dedupIdentity > 0 && dedupIdentity % 2 === 0 && dedupByName * 2 === dedupIdentity) {
            passengerCount = dedupByName;
          } else if (dedupIdentity != null && dedupIdentity > 0) {
            passengerCount = dedupIdentity;
          } else if (typeof pc === 'number' && pc > 0) {
            passengerCount = pc;
          }
        }
      } catch (_) {
      }
    }

    let hasReturnLeg = null;
    try {
      const tsRows = await drizzleDb
        .select({ isRoundTrip: tripSelections.isRoundTrip })
        .from(tripSelections)
        .where(or(eq(tripSelections.firestoreCartId, ref), eq(tripSelections.cartId, ref)))
        .limit(1);
      if (tsRows && tsRows.length && typeof tsRows[0].isRoundTrip === 'boolean') {
        hasReturnLeg = tsRows[0].isRoundTrip;
      }
    } catch (_) {
    }

    if (hasReturnLeg == null) {
      try {
        const cRows = await drizzleDb
          .select({ returnOrigin: cartsPgTable.returnOrigin, returnDestination: cartsPgTable.returnDestination })
          .from(cartsPgTable)
          .where(or(eq(cartsPgTable.cartId, ref), eq(cartsPgTable.busbudCartId, ref)))
          .limit(1);
        if (cRows && cRows.length) {
          const ro = cRows[0] && cRows[0].returnOrigin;
          const rd = cRows[0] && cRows[0].returnDestination;
          if (ro && rd) hasReturnLeg = true;
        }
      } catch (_) {
      }
    }

    if (hasReturnLeg && Array.isArray(passengerListCandidate) && passengerListCandidate.length) {
      const halved = maybeHalvePassengersForRoundTrip(passengerListCandidate);
      if (halved && halved.length && (!passengerCount || halved.length < passengerCount)) {
        passengerCount = halved.length;
      }
    }

    if (!passengerCount || !Number.isFinite(Number(passengerCount)) || Number(passengerCount) <= 0) return null;
    const legs = hasReturnLeg ? 2 : 1;
    return Number(passengerCount) * legs;
  } catch (_) {
    return null;
  }
};

const normalizePassengerCategory = (raw) => {
  const s = raw == null ? '' : String(raw).trim().toLowerCase();
  if (!s) return 'adult';
  if (s === 'child' || s === 'children' || s === 'youth' || s === 'teen' || s === 'student') return 'child';
  if (s.includes('child') || s.includes('youth') || s.includes('teen') || s.includes('student')) return 'child';
  return 'adult';
};

const passengerCategoryOf = (p = {}) => {
  return normalizePassengerCategory(
    p.category ||
    p.passengerType ||
    p.passenger_type ||
    p.type ||
    p.source_passenger_category ||
    (p.fields && (p.fields.category || p.fields.type)) ||
    ''
  );
};

const toNum = (v) => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const m = String(v).match(/[0-9]+(?:\.[0-9]+)?/);
    if (m) return parseFloat(m[0]);
  }
  return NaN;
};

const toMajorAmountMaybe = (rawAmount, totalHintMajor) => {
  const n = toNum(rawAmount);
  if (!Number.isFinite(n)) return null;
  if (Number.isFinite(totalHintMajor) && totalHintMajor > 0 && n > totalHintMajor * 5) {
    return n / 100;
  }
  if (n >= 1000 && (!Number.isFinite(totalHintMajor) || totalHintMajor < 1000)) {
    return n / 100;
  }
  return n;
};

const pickMoneyLikeValue = (raw) => {
  if (raw == null) return null;
  if (typeof raw === 'number' || typeof raw === 'string') return raw;
  if (typeof raw !== 'object') return null;
  // Common shapes
  // { amount, currency } OR { total, currency } OR { total: { amount } }
  const direct = raw.amount ?? raw.total ?? raw.value ?? raw.price ?? raw.fare ?? null;
  if (direct != null && (typeof direct === 'number' || typeof direct === 'string')) return direct;
  if (direct && typeof direct === 'object') {
    const nested = direct.amount ?? direct.total ?? direct.value ?? null;
    if (nested != null && (typeof nested === 'number' || typeof nested === 'string')) return nested;
  }
  // Sometimes: { prices: { total } }
  if (raw.prices && typeof raw.prices === 'object') {
    const p = raw.prices;
    const v = p.amount ?? p.total ?? p.value ?? null;
    if (v != null && (typeof v === 'number' || typeof v === 'string')) return v;
    if (v && typeof v === 'object') {
      const vv = v.amount ?? v.total ?? v.value ?? null;
      if (vv != null && (typeof vv === 'number' || typeof vv === 'string')) return vv;
    }
  }
  return null;
};

const extractTypeWeightsFromPurchase = (completePurchase) => {
  const cp = completePurchase || {};
  const tripsObj = cp.trips && typeof cp.trips === 'object' ? cp.trips : {};
  const trips = tripsObj ? Object.values(tripsObj).filter(Boolean) : [];

  let adultTotal = 0;
  let childTotal = 0;
  let adultCount = 0;
  let childCount = 0;
  let any = false;

  const addPassengerEntry = (typeRaw, totalRaw, countRaw) => {
    const t = normalizePassengerCategory(typeRaw);
    const total = toNum(totalRaw);
    if (!Number.isFinite(total)) return;
    let count = Number.isFinite(Number(countRaw)) ? Number(countRaw) : 0;
    if (!count || count < 1) count = 1;
    any = true;
    if (t === 'child') {
      childTotal += total;
      childCount += count;
    } else {
      adultTotal += total;
      adultCount += count;
    }
  };

  const consumeBreakdown = (breakdown) => {
    if (!breakdown || typeof breakdown !== 'object') return;
    if (Array.isArray(breakdown.passengers)) {
      for (const p of breakdown.passengers) {
        if (!p || typeof p !== 'object') continue;
        const typeRaw = p.category || p.passengerType || p.passenger_type || p.type || '';
        const totalRaw = p.total ?? (p.breakdown && (p.breakdown.total ?? p.breakdown.base)) ?? p.amount;
        const countRaw = p.count;
        addPassengerEntry(typeRaw, totalRaw, countRaw);
      }
      return;
    }

    for (const [k, v] of Object.entries(breakdown)) {
      const key = String(k || '').toLowerCase();
      if (!key) continue;
      if (key === 'total' || key === 'tax' || key === 'taxes' || key === 'fee' || key === 'fees') continue;
      const typeGuess = normalizePassengerCategory(key);
      if (typeGuess !== 'adult' && typeGuess !== 'child') continue;
      if (typeof v === 'number' || typeof v === 'string') {
        addPassengerEntry(typeGuess, v, 1);
      } else if (v && typeof v === 'object') {
        const totalRaw = v.total ?? v.amount;
        const countRaw = v.count;
        addPassengerEntry(typeGuess, totalRaw, countRaw);
      }
    }
  };

  for (const t of trips) {
    const prices = Array.isArray(t.prices) ? t.prices : [];
    for (const entry of prices) {
      if (!entry || typeof entry !== 'object') continue;
      const b1 = entry.prices && entry.prices.breakdown;
      const b2 = entry.breakdown;
      const b3 = entry.details && entry.details.public_price_group && entry.details.public_price_group.prices && entry.details.public_price_group.prices.breakdown;
      if (b1) consumeBreakdown(b1);
      if (b2) consumeBreakdown(b2);
      if (b3) consumeBreakdown(b3);
    }
  }

  return {
    adultTotal,
    childTotal,
    adultCount,
    childCount,
    any
  };
};

const computePerPassengerTotals = ({ passengers, completePurchase, totalMajor }) => {
  const list = Array.isArray(passengers) ? passengers : [];

  const toCents = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100);
  };
  const fromCents = (c) => {
    const n = Number(c);
    if (!Number.isFinite(n)) return 0;
    return Number((n / 100).toFixed(2));
  };
  const splitCentsEvenly = (totalCents, n) => {
    const count = Number(n);
    const total = Number(totalCents);
    if (!Number.isFinite(total) || !Number.isFinite(count) || count <= 0) return [];
    const base = Math.floor(total / count);
    let rem = total - (base * count);
    return Array.from({ length: count }, (_, _i) => base + (rem-- > 0 ? 1 : 0));
  };
  const allocateCentsProportional = (weightsCents, totalCents) => {
    const total = Number(totalCents);
    const weights = Array.isArray(weightsCents) ? weightsCents.map((v) => Math.max(0, Number(v) || 0)) : [];
    if (!Number.isFinite(total) || !weights.length) return [];
    const sumW = weights.reduce((a, b) => a + b, 0);
    if (!sumW) return splitCentsEvenly(total, weights.length);

    const rawShares = weights.map((w) => (total * w) / sumW);
    const baseShares = rawShares.map((x) => Math.floor(x));
    let rem = total - baseShares.reduce((a, b) => a + b, 0);

    const order = rawShares
      .map((x, i) => ({ i, frac: x - Math.floor(x) }))
      .sort((a, b) => (b.frac - a.frac) || (a.i - b.i))
      .map((x) => x.i);

    const out = baseShares.slice();
    for (let k = 0; k < out.length && rem > 0; k++) {
      const i = order[k];
      out[i] += 1;
      rem -= 1;
      if (k === out.length - 1 && rem > 0) k = -1;
    }
    return out;
  };

  const totalsFromCartPricing = (() => {
    if (!list.length) return null;
    const vals = list.map((p) => {
      const raw = (() => {
        if (!p || typeof p !== 'object') return null;
        const pr = p.pricing && typeof p.pricing === 'object' ? p.pricing : null;
        const candidate = (
          (pr && (pr.retail_price ?? pr.retailPrice ?? pr.retail ?? pr.retail_amount ?? pr.retailAmount ?? pr.total ?? pr.amount)) ??
          (p.retail_price ?? p.retailPrice ?? p.retail ?? p.price ?? p.fare ?? p.amount ?? p.total) ??
          null
        );
        return pickMoneyLikeValue(candidate) ?? candidate;
      })();
      if (raw == null) return null;

      // Use the same major/cents heuristic used elsewhere, with a hint from the known total.
      const hint = Number.isFinite(Number(totalMajor)) ? Number(totalMajor) : NaN;
      const major = toMajorAmountMaybe(pickMoneyLikeValue(raw) ?? raw, hint);
      if (major != null && Number.isFinite(Number(major)) && Number(major) > 0) return Number(major);

      const raw2 = pickMoneyLikeValue(raw) ?? raw;
      const n = typeof raw2 === 'number'
        ? raw2
        : (typeof raw2 === 'string' ? parseFloat(String(raw2).match(/[0-9]+(?:\.[0-9]+)?/)?.[0] || 'NaN') : NaN);
      return Number.isFinite(n) ? n : null;
    });
    if (vals.some(v => v == null)) return null;
    return vals.map(v => Number(Number(v).toFixed(2)));
  })();

  const totalForDivisionCents = (() => {
    const totalForDivision = Number.isFinite(Number(totalMajor)) ? Number(totalMajor) : NaN;
    if (!Number.isFinite(totalForDivision) || totalForDivision <= 0) return null;
    return toCents(totalForDivision);
  })();

  if (totalsFromCartPricing) {
    const cents = totalsFromCartPricing.map((v) => toCents(v));
    if (totalForDivisionCents != null) {
      const allocated = allocateCentsProportional(cents, totalForDivisionCents);
      if (allocated && allocated.length === list.length) return allocated.map(fromCents);
    }
    return cents.map(fromCents);
  }

  const totalForDivision = Number.isFinite(Number(totalMajor)) ? Number(totalMajor) : NaN;
  if (!list.length || !Number.isFinite(totalForDivision) || totalForDivision <= 0) {
    return list.map(() => 0);
  }

  const cp = completePurchase || {};
  const items = Array.isArray(cp.items) ? cp.items : [];
  if (items.length && items.length === list.length) {
    const base = [];
    let ok = true;
    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {};
      const candidate =
        (it.display_price && (it.display_price.amount ?? it.display_price.total)) ??
        (it.price && (it.price.amount ?? it.price.total)) ??
        (it.fare && (it.fare.total ?? it.fare.amount)) ??
        it.amount ??
        it.total;
      const major = toMajorAmountMaybe(candidate, totalForDivision);
      if (major == null || !Number.isFinite(major) || major <= 0) {
        ok = false;
        break;
      }
      base.push(major);
    }
    if (ok && base.length === list.length) {
      const baseCents = base.map((v) => toCents(v));
      const totalCents = toCents(totalForDivision);
      const allocated = allocateCentsProportional(baseCents, totalCents);
      if (allocated && allocated.length === list.length) return allocated.map(fromCents);
    }
  }

  const weights = extractTypeWeightsFromPurchase(cp);
  const adultUnit = (weights.any && weights.adultTotal > 0 && weights.adultCount > 0)
    ? (weights.adultTotal / weights.adultCount)
    : 1;
  const childUnit = (weights.any && weights.childTotal > 0 && weights.childCount > 0)
    ? (weights.childTotal / weights.childCount)
    : adultUnit;

  const baseTotals = list.map((p) => (passengerCategoryOf(p) === 'child' ? childUnit : adultUnit));
  const baseCents = baseTotals.map((v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.max(1, Math.round(n * 100));
  });
  const allocated = allocateCentsProportional(baseCents, toCents(totalForDivision));
  if (allocated && allocated.length === list.length) {
    return allocated.map(fromCents);
  }

  const passengerCount = list.length || 1;
  const even = splitCentsEvenly(toCents(totalForDivision), passengerCount);
  return even.map(fromCents);
};

const computeHoldAdultChildBreakdown = ({ passengers, completePurchase, totalMajor, currencyPrefix = '', fallbackCount = null }) => {
  const list = Array.isArray(passengers) ? passengers : [];
  let adultCount = 0;
  let childCount = 0;
  for (const p of list) {
    if (passengerCategoryOf(p) === 'child') childCount += 1;
    else adultCount += 1;
  }

  const passengerCount = (adultCount + childCount) || (typeof fallbackCount === 'number' && fallbackCount > 0 ? fallbackCount : (list.length || 1));
  const total = Number(totalMajor);
  const totalFinite = Number.isFinite(total) && total > 0 ? total : NaN;

  const fmtMoney = (n) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return '-';
    const s = v.toFixed(2);
    return currencyPrefix ? `${currencyPrefix}${s}` : s;
  };

  const fromPassengerPricing = (() => {
    if (!list.length) return null;
    let ok = true;
    let adultBase = 0;
    let childBase = 0;
    for (const p of list) {
      const raw = p && p.pricing && (p.pricing.retail_price ?? p.pricing.retailPrice);
      const n = typeof raw === 'number'
        ? raw
        : (typeof raw === 'string'
          ? parseFloat(String(raw).match(/[0-9]+(?:\.[0-9]+)?/)?.[0] || 'NaN')
          : NaN);
      if (!Number.isFinite(n)) { ok = false; break; }
      if (passengerCategoryOf(p) === 'child') childBase += n;
      else adultBase += n;
    }
    if (!ok) return null;
    return { adultBase, childBase };
  })();

  const weights = extractTypeWeightsFromPurchase(completePurchase);
  const baseAdult = (() => {
    if (fromPassengerPricing) return fromPassengerPricing.adultBase;
    if (weights.any && adultCount > 0) {
      const adultUnit = (weights.adultCount > 0 && weights.adultTotal > 0) ? (weights.adultTotal / weights.adultCount) : 1;
      return adultUnit * adultCount;
    }
    return adultCount;
  })();
  const baseChild = (() => {
    if (fromPassengerPricing) return fromPassengerPricing.childBase;
    if (weights.any && childCount > 0) {
      const adultUnit = (weights.adultCount > 0 && weights.adultTotal > 0) ? (weights.adultTotal / weights.adultCount) : 1;
      const childUnit = (weights.childCount > 0 && weights.childTotal > 0) ? (weights.childTotal / weights.childCount) : adultUnit;
      return childUnit * childCount;
    }
    return childCount;
  })();

  const baseSum = Number(baseAdult) + Number(baseChild);
  let adultTotal = 0;
  let childTotal = 0;
  if (Number.isFinite(totalFinite) && baseSum > 0) {
    adultTotal = adultCount > 0 ? totalFinite * (Number(baseAdult) / baseSum) : 0;
    adultTotal = Number(adultTotal.toFixed(2));
    childTotal = childCount > 0 ? Number((totalFinite - adultTotal).toFixed(2)) : 0;
  } else if (Number.isFinite(totalFinite)) {
    if (adultCount > 0 && childCount === 0) adultTotal = Number(totalFinite.toFixed(2));
    if (childCount > 0 && adultCount === 0) childTotal = Number(totalFinite.toFixed(2));
  }

  const adultUnit = adultCount > 0 ? Number((adultTotal / adultCount).toFixed(2)) : NaN;
  const childUnit = childCount > 0 ? Number((childTotal / childCount).toFixed(2)) : NaN;

  const passengersText = (adultCount > 0 && childCount > 0)
    ? `${passengerCount} (Adults: ${adultCount}, Children: ${childCount})`
    : String(passengerCount);

  const lines = [];
  if (adultCount > 0) lines.push(`Adult: ${fmtMoney(adultUnit)} x ${adultCount} = ${fmtMoney(adultTotal)}`);
  if (childCount > 0) lines.push(`Child: ${fmtMoney(childUnit)} x ${childCount} = ${fmtMoney(childTotal)}`);
  if (adultCount > 0 && childCount > 0 && Number.isFinite(totalFinite)) lines.push(`Total: ${fmtMoney(totalFinite)}`);

  const breakdownPlain = lines.length ? lines.join('\n') : (Number.isFinite(totalFinite) ? fmtMoney(totalFinite) : '-');
  const breakdownHtml = lines.length ? lines.join('<br/>') : (Number.isFinite(totalFinite) ? fmtMoney(totalFinite) : '-');

  return { passengerCount, adultCount, childCount, passengersText, breakdownPlain, breakdownHtml };
};

const normalizeCompletePurchase = (value) => {
  try {
    let v = value;

    const parseMaybeJson = (input) => {
      try {
        if (input == null) return input;
        if (typeof input === 'string') {
          const s = String(input).trim();
          if (!s) return input;
          if (s.startsWith('{') || s.startsWith('[')) {
            return JSON.parse(s);
          }
          return input;
        }
        if (Buffer.isBuffer(input)) {
          const s = input.toString('utf8').trim();
          if (!s) return input;
          if (s.startsWith('{') || s.startsWith('[')) {
            return JSON.parse(s);
          }
          return input;
        }
      } catch (_) {
        return input;
      }
      return input;
    };

    for (let i = 0; i < 6; i += 1) {
      v = parseMaybeJson(v);
      if (!v || typeof v !== 'object') return null;
      if (Array.isArray(v.items) || v.booking || v.trips) return v;
      const candidates = [
        parseMaybeJson(v.data),
        parseMaybeJson(v.payload),
        parseMaybeJson(v.result),
        parseMaybeJson(v.response && v.response.data),
        parseMaybeJson(v.response && v.response.body && v.response.body.data),
        parseMaybeJson(v.body && v.body.data),
      ].filter(Boolean);
      const next = candidates.find((c) => c && typeof c === 'object');
      if (!next || next === v) break;
      v = next;
    }
    return v && typeof v === 'object' ? v : null;
  } catch (_) {
    return null;
  }
};

const isValidTicketNo = (ticketNo, _pnr) => {
  try {
    if (ticketNo == null) return false;
    const t = String(ticketNo).trim();
    if (!t) return false;
    const normalized = t.replace(/\s+/g, ' ');
    const invalidSet = new Set(['-', '—', 'â€”', 'null', 'undefined']);
    if (invalidSet.has(normalized.toLowerCase())) return false;
    return true;
  } catch (_) {
    return false;
  }
};

const ticketNoForPassengerIndex = (completePurchase, idx = 0, _fallback = null) => {
  try {
    const cp = normalizeCompletePurchase(completePurchase) || completePurchase || {};
    const items = Array.isArray(cp.items) ? cp.items : [];
    const ticketItems = items.filter((it) => {
      if (!it || typeof it !== 'object') return false;
      const t = it.type || it.item_type || it.itemType || null;
      return t != null && String(t).toLowerCase() === 'ticket';
    });
    const it = ticketItems[idx] || null;
    const reservationNumber = it && it.details && (it.details.reservation_number || it.details.reservationNumber);
    if (reservationNumber != null && String(reservationNumber).trim()) return String(reservationNumber).trim();
    return null;
  } catch (_) {
    return null;
  }
};

const ticketNoForPassengerLeg = (completePurchase, passengerIdx = 0, legKey = null, passengerCount = null, passenger = null) => {
  try {
    const cp = normalizeCompletePurchase(completePurchase) || completePurchase || {};
    const items = Array.isArray(cp.items) ? cp.items : [];
    const ticketItems = items.filter((it) => {
      if (!it || typeof it !== 'object') return false;
      const t = it.type || it.item_type || it.itemType || null;
      return t != null && String(t).toLowerCase() === 'ticket';
    });

    const idx = Number(passengerIdx);
    const count = Number(passengerCount);
    const isReturn = String(legKey || '').toLowerCase() === 'return';

    const normalizeName = (obj) => {
      try {
        if (!obj || typeof obj !== 'object') return '';
        const first = obj.first_name || obj.firstName || obj.given_name || obj.givenName || obj.name_first || '';
        const last = obj.last_name || obj.lastName || obj.family_name || obj.familyName || obj.name_last || '';
        const s = `${String(first || '').trim()} ${String(last || '').trim()}`.trim().toLowerCase();
        return s;
      } catch (_) {
        return '';
      }
    };
    const passengerNameNorm = normalizeName(passenger);
    if (passengerNameNorm) {
      const matches = ticketItems.filter((it) => {
        try {
          const p = (it && (it.passenger || it.traveler || (it.details && (it.details.passenger || it.details.traveler)))) || null;
          const cand = normalizeName(p);
          return cand && cand === passengerNameNorm;
        } catch (_) {
          return false;
        }
      });
      if (matches.length >= 2) {
        const itMatch = isReturn ? matches[1] : matches[0];
        const rn = itMatch && itMatch.details && (itMatch.details.reservation_number || itMatch.details.reservationNumber);
        if (rn != null && String(rn).trim()) return String(rn).trim();
      }
      if (matches.length === 1) {
        const itMatch = matches[0];
        const rn = itMatch && itMatch.details && (itMatch.details.reservation_number || itMatch.details.reservationNumber);
        if (rn != null && String(rn).trim()) return String(rn).trim();
      }
    }

    const baseIdx = Number.isFinite(idx) ? idx : 0;
    const candidates = [];

    if (isReturn) {
      if (Number.isFinite(count) && count > 0 && ticketItems.length >= count * 2) {
        candidates.push(baseIdx + count); // block ordering: all outbound then all return
      }
      candidates.push(baseIdx * 2 + 1); // interleaved ordering: outbound, return, outbound, return
      candidates.push(baseIdx + 1);
    } else {
      candidates.push(baseIdx);
      candidates.push(baseIdx * 2);
    }

    const seen = new Set();
    for (const c of candidates) {
      const ci = Number(c);
      if (!Number.isFinite(ci) || ci < 0) continue;
      if (seen.has(ci)) continue;
      seen.add(ci);
      if (ci >= ticketItems.length) continue;
      const it = ticketItems[ci] || null;
      const reservationNumber = it && it.details && (it.details.reservation_number || it.details.reservationNumber);
      if (reservationNumber != null && String(reservationNumber).trim()) return String(reservationNumber).trim();
    }

    return null;
  } catch (_) {
    return null;
  }
};

const deriveOperatorFromPurchase = (purchase) => {
  if (!purchase || typeof purchase !== 'object') return null;
  try {
    const booking = purchase.booking || {};
    const items = Array.isArray(purchase.items) ? purchase.items : [];
    let operatorName = null;

    const firstItem = items[0] || null;
    if (firstItem && firstItem.trip) {
      const tripKey = firstItem.trip.id || firstItem.trip.trip_id || firstItem.trip.tripId;
      const tripsMap = purchase.trips && typeof purchase.trips === 'object' ? purchase.trips : {};
      const trip = tripKey && tripsMap[tripKey] ? tripsMap[tripKey] : null;
      if (trip && Array.isArray(trip.segments) && trip.segments.length) {
        const seg = trip.segments[0] || {};
        const segOperator = seg.operator || {};
        operatorName =
          seg.operator_name ||
          seg.operatorName ||
          (typeof seg.operator === 'string' ? seg.operator : null) ||
          segOperator.name ||
          segOperator.label ||
          segOperator.operator_name ||
          segOperator.operatorName ||
          operatorName;
      }
    }

    if (!operatorName) {
      const directSegments = Array.isArray(purchase.segments)
        ? purchase.segments
        : (purchase.trip && Array.isArray(purchase.trip.segments) ? purchase.trip.segments : null);
      if (Array.isArray(directSegments) && directSegments.length) {
        const seg = directSegments[0] || {};
        const segOperator = seg.operator || {};
        operatorName =
          seg.operator_name ||
          seg.operatorName ||
          (typeof seg.operator === 'string' ? seg.operator : null) ||
          segOperator.name ||
          segOperator.label ||
          segOperator.operator_name ||
          segOperator.operatorName ||
          operatorName;
      }
    }

    if (!operatorName && Array.isArray(booking.tickets)) {
      const ticketsArr = booking.tickets;
      if (ticketsArr.length > 0) {
        const firstTicket = ticketsArr[0] || {};
        const seg = firstTicket.segment || firstTicket.trip || {};
        const segOp = seg.operator || {};
        operatorName =
          seg.operator_name ||
          seg.operatorName ||
          (typeof seg.operator === 'string' ? seg.operator : null) ||
          segOp.name ||
          segOp.label ||
          segOp.operator_name ||
          segOp.operatorName ||
          operatorName;
      }
    }

    if (!operatorName) {
      operatorName =
        booking.operator_name ||
        booking.operatorName ||
        (typeof booking.operator === 'string' ? booking.operator : null) ||
        (purchase.operator && (purchase.operator.name || purchase.operator.label || purchase.operator.operator_name || purchase.operator.operatorName)) ||
        purchase.operator_name ||
        purchase.operatorName ||
        null;
    }

    const s = operatorName != null ? String(operatorName).trim() : '';
    if (!s || s.toLowerCase() === 'unknown' || s === 'â€”' || s === '—') return null;
    return s;
  } catch (_) {
    return null;
  }
};

const segmentHasOperator = (s) => {
  try {
    if (!s || typeof s !== 'object') return false;
    if (s.operator_name || s.operatorName) return true;
    if (typeof s.operator === 'string' && String(s.operator).trim()) return true;
    const op = s.operator || {};
    return !!(op.name || op.label || op.operator_name || op.operatorName || op.xid);
  } catch (_) {
    return false;
  }
};

const pickSegmentWithOperator = (segments) => {
  if (!Array.isArray(segments) || !segments.length) return null;
  return segments.find(segmentHasOperator) || segments[0] || null;
};

const segCityName = (seg, which) => {
  try {
    if (!seg || typeof seg !== 'object') return null;
    const node = which === 'destination' ? seg.destination : seg.origin;
    const direct =
      (node && (node.city && (node.city.name || node.city.city_name || node.city.cityName))) ||
      (node && (node.name || node.city_name || node.cityName)) ||
      null;
    if (direct) return String(direct);
    const fallback = which === 'destination'
      ? (seg.destination_city_name || seg.destinationCityName || seg.destination_city || seg.destinationCity || null)
      : (seg.origin_city_name || seg.originCityName || seg.origin_city || seg.originCity || null);
    return fallback ? String(fallback) : null;
  } catch (_) {
    return null;
  }
};

const segTs = (seg, which) => {
  try {
    if (!seg || typeof seg !== 'object') return null;
    const v = which === 'arrival'
      ? ((seg.arrival_time && (seg.arrival_time.timestamp || seg.arrival_time.utc || seg.arrival_time.value || seg.arrival_time)) || (seg.arrival && (seg.arrival.timestamp || seg.arrival.utc || seg.arrival.value || seg.arrival)) || seg.arrivalTime || seg.arrive_at || null)
      : ((seg.departure_time && (seg.departure_time.timestamp || seg.departure_time.utc || seg.departure_time.value || seg.departure_time)) || (seg.departure && (seg.departure.timestamp || seg.departure.utc || seg.departure.value || seg.departure)) || seg.departureTime || seg.depart_at || null);
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch (_) {
    return null;
  }
};

const pickSegmentsByIds = (segments, ids) => {
  if (!Array.isArray(segments) || !segments.length) return [];
  if (!Array.isArray(ids) || !ids.length) return [];
  const out = [];
  for (const id of ids) {
    const found = segments.find((s) => s && s.id === id);
    if (found) out.push(found);
  }
  return out;
};

const router = express.Router();

// ================================
// ðŸŽ« HOLD TICKET PDF VIA PUPPETEER
// ================================
// GET /api/ticket/hold/pdf/:pnr
router.get('/hold/pdf/:pnr', async (req, res) => {
  const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const startTime = Date.now();
  const { pnr } = req.params;

  res.setHeader('x-ticket-hold-pdf', 'v1');
  res.setHeader('x-ticket-hold-pdf-request-id', requestId);

  if (!pnr) {
    return res.status(400).json({ success: false, error: 'Missing pnr', requestId });
  }

  try {
    const forceRegen = (req.query && (req.query.regen === '1' || req.query.regen === 'true'));
    const q = req.query || {};
    const paperRaw = (q.paper || q.format || q.size || '').toString().toLowerCase();
    const thermalOff = q.thermal === '0' || q.thermal === 0 || q.thermal === false || q.thermal === 'false';
    const explicitA4 = paperRaw === 'a4' || paperRaw === 'paper=a4' || paperRaw === 'letter' || paperRaw === 'legal';
    // Default to 48mm output unless explicitly requesting A4 or disabling thermal.
    const isThermal = !explicitA4 && !thermalOff;
    if (!forceRegen) {
      const cached = await getCachedTicketPdfFromPostgres(pnr, 'hold');
      if (cached) {
        res.status(200);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=reserved-ticket-${encodeURIComponent(String(pnr))}.pdf`);
        res.setHeader('Content-Length', cached.length);
        res.end(cached);
        return;
      }
    }

    const db = await getFirestore();
    // Try exact PNR doc first, then resolve canonical Firestore cart ID
    const primaryDocId = String(pnr);
    let snap = await db.collection('carts').doc(primaryDocId).collection('tickets').where('isHold', '==', true).limit(1).get();
    if (snap.empty) {
      const resolvedId = await resolveCartDocId(primaryDocId, { createIfMissing: false }).catch(() => null);
      if (resolvedId) {
        snap = await db.collection('carts').doc(String(resolvedId)).collection('tickets').where('isHold', '==', true).limit(1).get();
      }
    }

    // Fallback: search any cart tickets by ref_no/pnr in collection group
    let ticketDoc = null;
    let ticketCartId = null;
    if (!snap.empty) {
      ticketDoc = snap.docs[0];
      ticketCartId = ticketDoc.ref.parent && ticketDoc.ref.parent.parent ? ticketDoc.ref.parent.parent.id : null;
    } else {
      const tryCollectionGroup = async (fieldPath) => {
        try {
          const qs = await db.collectionGroup('tickets')
            .where('isHold', '==', true)
            .where(fieldPath, '==', primaryDocId)
            .limit(1)
            .get();
          return qs.empty ? null : qs.docs[0];
        } catch (_) {
          return null;
        }
      };
      ticketDoc =
        (await tryCollectionGroup('pnr')) ||
        (await tryCollectionGroup('options.ref_no')) ||
        (await tryCollectionGroup('options.ticket.ref_no'));
      if (ticketDoc) {
        ticketCartId = ticketDoc.ref.parent && ticketDoc.ref.parent.parent ? ticketDoc.ref.parent.parent.id : null;
      }
    }

    if (!ticketDoc) {
      return res.status(404).json({ success: false, error: 'Hold ticket not found', requestId });
    }

    const ticketData = ticketDoc.data() || {};
    if (!ticketData.cartId && ticketCartId) {
      ticketData.cartId = ticketCartId;
    }

    const opt = ticketData.options || {};
    const t = opt.ticket || {};
    const itin = opt.itinerary || {};

    const refNo = t.ref_no || opt.ref_no || pnr || '';
    const priceRaw = t.price || opt.price || '';
    const departCity = itin.depart_city || itin.departCity || '';
    const departDate = itin.depart_date || '';
    const departTime = itin.depart_time || '';
    const arriveCity = itin.arrive_city || itin.arriveCity || '';
    const arriveDate = itin.arrive_date || '';
    const arriveTime = itin.arrive_time || '';
    let operator = opt.operatorName || opt.operator || '';
    const qrDataUrl = typeof opt.qrDataUrl === 'string' ? opt.qrDataUrl : null;

    const rawBookedBy = (
      (t && (t.booked_by || t.bookedBy)) ||
      opt.booked_by ||
      opt.bookedBy ||
      null
    );

    const looksLikeEmail = (v) => {
      if (!v) return false;
      const s = String(v).trim();
      return /@/.test(s) && /\./.test(s);
    };

    let bookedByDisplay =
      (await resolveBookedByFromPostgres(refNo || pnr)) ||
      'online';
    if (!bookedByDisplay) bookedByDisplay = 'online';

    // Prevent showing purchaser/agent emails as "Booked By".
    // If old data stored an email, fall back to agent name (if present) or 'online'.
    if (looksLikeEmail(bookedByDisplay)) {
      try {
        bookedByDisplay = (await resolveBookedByFromPostgres(refNo || pnr)) || 'online';
      } catch (_) {
        bookedByDisplay = (await resolveBookedByFromPostgres(refNo || pnr)) || 'online';
      }
    }

    const priceText = String(priceRaw || '');

    const toNumSimple = (v) => (typeof v === 'number')
      ? v
      : (typeof v === 'string'
        ? parseFloat(String(v).match(/[0-9]+(?:\.[0-9]+)?/)?.[0] || 'NaN')
        : NaN);

    const holdCart = await (async () => {
      try {
        const cartIdForHold = ticketData.cartId || ticketCartId;
        if (!cartIdForHold) return null;
        const cartSnap = await db.collection('carts').doc(String(cartIdForHold)).get();
        return cartSnap.exists ? (cartSnap.data() || {}) : null;
      } catch (_) {
        return null;
      }
    })();

    const pgHoldCartFromCartsTable = await (async () => {
      try {
        const cartIdForHold = ticketData.cartId || ticketCartId || pnr;
        if (!cartIdForHold) return null;
        const rows = await drizzleDb
          .select({
            cartId: cartsPgTable.cartId,
            busbudCartId: cartsPgTable.busbudCartId,
            returnOrigin: cartsPgTable.returnOrigin,
            returnDestination: cartsPgTable.returnDestination,
            returnDepartAt: cartsPgTable.returnDepartAt,
            returnArriveAt: cartsPgTable.returnArriveAt,
          })
          .from(cartsPgTable)
          .where(or(eq(cartsPgTable.cartId, String(cartIdForHold)), eq(cartsPgTable.busbudCartId, String(cartIdForHold))))
          .limit(1);
        return rows && rows.length ? (rows[0] || null) : null;
      } catch (_) {
        return null;
      }
    })();

    const pgTripSelectionRawForHold = await (async () => {
      try {
        const cartIdForHold = ticketData.cartId || ticketCartId || pnr;
        if (!cartIdForHold) return null;
        const pgCartId = pgHoldCartFromCartsTable && pgHoldCartFromCartsTable.cartId ? pgHoldCartFromCartsTable.cartId : null;
        if (!pgCartId) return null;
        const rowsByCart = await drizzleDb
          .select({ raw: tripSelections.raw })
          .from(tripSelections)
          .where(eq(tripSelections.cartId, String(pgCartId)))
          .limit(1);
        const rowCart = rowsByCart && rowsByCart.length ? rowsByCart[0] : null;
        return rowCart && rowCart.raw ? rowCart.raw : null;
      } catch (_) {
        return null;
      }
    })();

    const holdTripLegs = (() => {
      try {
        const c = holdCart || {};
        const tsRaw = pgTripSelectionRawForHold || null;
        const tsItems = tsRaw && Array.isArray(tsRaw.items) ? tsRaw.items : null;
        const tsTripItem = tsItems && tsItems.length ? tsItems[0] : null;
        const tsTripItemReturn = tsItems && tsItems.length > 1 ? tsItems[1] : null;

        const rawTripItems = c.trip && c.trip._raw && Array.isArray(c.trip._raw.items) ? c.trip._raw.items : null;
        const rawTripItem = rawTripItems && rawTripItems.length ? rawTripItems[0] : null;
        const rawTripItemReturn = rawTripItems && rawTripItems.length > 1 ? rawTripItems[1] : null;

        let segments = rawTripItem && Array.isArray(rawTripItem.segments)
          ? rawTripItem.segments
          : ((c.busbudResponse && (c.busbudResponse.segments || (c.busbudResponse.trip && c.busbudResponse.trip.segments))) || c.segments || []);

        const returnSegments = (rawTripItemReturn && Array.isArray(rawTripItemReturn.segments) && rawTripItemReturn.segments.length)
          ? rawTripItemReturn.segments
          : ((tsTripItemReturn && Array.isArray(tsTripItemReturn.segments) && tsTripItemReturn.segments.length) ? tsTripItemReturn.segments : null);

        if ((!Array.isArray(segments) || !segments.length) && tsTripItem && Array.isArray(tsTripItem.segments)) {
          segments = tsTripItem.segments;
        }
        if ((!Array.isArray(segments) || !segments.length) && tsRaw && Array.isArray(tsRaw.segments)) {
          segments = tsRaw.segments;
        }
        if ((!Array.isArray(segments) || !segments.length) && tsRaw && tsRaw.trip && Array.isArray(tsRaw.trip.segments)) {
          segments = tsRaw.trip.segments;
        }
        if ((!Array.isArray(segments) || !segments.length) && tsRaw && tsRaw.trips && typeof tsRaw.trips === 'object') {
          const tripsArr = Array.isArray(tsRaw.trips) ? tsRaw.trips : Object.values(tsRaw.trips);
          if (tripsArr.length && Array.isArray(tripsArr[0].segments)) {
            segments = tripsArr[0].segments;
          }
        }
        const segCityNameSimple = (seg, which) => {
          try {
            if (!seg || typeof seg !== 'object') return null;
            const node = which === 'destination' ? seg.destination : seg.origin;
            const direct =
              (node && (node.city && (node.city.name || node.city.city_name || node.city.cityName))) ||
              (node && (node.name || node.city_name || node.cityName)) ||
              null;
            if (direct) return String(direct);
            const fallback = which === 'destination'
              ? (seg.destination_city_name || seg.destinationCityName || seg.destination_city || seg.destinationCity || null)
              : (seg.origin_city_name || seg.originCityName || seg.origin_city || seg.originCity || null);
            return fallback ? String(fallback) : null;
          } catch (_) {
            return null;
          }
        };

        let outboundSeg = null;
        let returnSeg = null;
        let outboundFirstSeg = null;
        let outboundLastSeg = null;
        let returnFirstSeg = null;
        let returnLastSeg = null;
        if (Array.isArray(segments) && segments.length) {
          const tripLegs = (rawTripItem && Array.isArray(rawTripItem.trip_legs) ? rawTripItem.trip_legs : (tsTripItem && Array.isArray(tsTripItem.trip_legs) ? tsTripItem.trip_legs : []));
          if (Array.isArray(tripLegs) && tripLegs.length > 1) {
            const leg1Ids = Array.isArray(tripLegs[0]?.segment_ids) ? tripLegs[0].segment_ids : null;
            const leg2Ids = Array.isArray(tripLegs[1]?.segment_ids) ? tripLegs[1].segment_ids : null;
            const outSegs = pickSegmentsByIds(segments, leg1Ids);
            const retSegs = pickSegmentsByIds(segments, leg2Ids);
            if (outSegs.length) {
              outboundFirstSeg = outSegs[0];
              outboundLastSeg = outSegs[outSegs.length - 1];
              outboundSeg = pickSegmentWithOperator(outSegs) || outboundFirstSeg;
            } else {
              outboundSeg = segments[0];
              outboundFirstSeg = outboundSeg;
              outboundLastSeg = outboundSeg;
            }
            if (retSegs.length) {
              returnFirstSeg = retSegs[0];
              returnLastSeg = retSegs[retSegs.length - 1];
              returnSeg = pickSegmentWithOperator(retSegs) || returnFirstSeg;
            }
          } else {
            outboundSeg = segments[0];
            outboundFirstSeg = outboundSeg;
            outboundLastSeg = segments[segments.length - 1] || outboundSeg;
          }
        }

        if (!returnSeg && Array.isArray(returnSegments) && returnSegments.length) {
          returnFirstSeg = returnSegments[0] || null;
          returnLastSeg = returnSegments[returnSegments.length - 1] || returnFirstSeg;
          returnSeg = pickSegmentWithOperator(returnSegments) || returnFirstSeg || null;
        }

        // Final safe fallback: only treat the second segment as a return leg if it clearly reverses the outbound cities.
        if (!returnSeg && Array.isArray(segments) && segments.length > 1 && outboundSeg) {
          const cand = segments[1];
          const oo = segCityNameSimple(outboundSeg, 'origin');
          const od = segCityNameSimple(outboundSeg, 'destination');
          const ro = segCityNameSimple(cand, 'origin');
          const rd = segCityNameSimple(cand, 'destination');
          const norm = (s) => (s == null ? '' : String(s)).trim().toLowerCase();
          const looksLikeReturn = norm(ro) && norm(rd) && norm(oo) && norm(od) && norm(ro) === norm(od) && norm(rd) === norm(oo);
          if (looksLikeReturn) {
            returnSeg = cand;
            returnFirstSeg = cand;
            returnLastSeg = cand;
          }
        }

        return { outboundSeg, outboundFirstSeg, outboundLastSeg, returnSeg, returnFirstSeg, returnLastSeg };
      } catch (_) {
        return { outboundSeg: null, outboundFirstSeg: null, outboundLastSeg: null, returnSeg: null, returnFirstSeg: null, returnLastSeg: null };
      }
    })();

    const segCityNameForHold = (seg, which) => {
      try {
        if (!seg || typeof seg !== 'object') return null;
        const node = which === 'destination' ? seg.destination : seg.origin;
        const direct =
          (node && (node.city && (node.city.name || node.city.city_name || node.city.cityName))) ||
          (node && (node.name || node.city_name || node.cityName)) ||
          null;
        if (direct) return String(direct);
        const fallback = which === 'destination'
          ? (seg.destination_city_name || seg.destinationCityName || seg.destination_city || seg.destinationCity || null)
          : (seg.origin_city_name || seg.originCityName || seg.origin_city || seg.originCity || null);
        return fallback ? String(fallback) : null;
      } catch (_) {
        return null;
      }
    };

    const segTsForHold = (seg, which) => {
      try {
        if (!seg || typeof seg !== 'object') return null;
        const v = which === 'arrival'
          ? ((seg.arrival_time && (seg.arrival_time.timestamp || seg.arrival_time.utc || seg.arrival_time.value || seg.arrival_time)) || (seg.arrival && (seg.arrival.timestamp || seg.arrival.utc || seg.arrival.value || seg.arrival)) || null)
          : ((seg.departure_time && (seg.departure_time.timestamp || seg.departure_time.utc || seg.departure_time.value || seg.departure_time)) || (seg.departure && (seg.departure.timestamp || seg.departure.utc || seg.departure.value || seg.departure)) || null);
        if (!v) return null;
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? null : d;
      } catch (_) {
        return null;
      }
    };

    const returnOriginForHold = (() => {
      const seg = holdTripLegs && (holdTripLegs.returnFirstSeg || holdTripLegs.returnSeg);
      const fromSeg = seg ? segCityNameForHold(seg, 'origin') : null;
      if (fromSeg) return fromSeg;
      try {
        const c = holdCart || {};
        const fromCart = c.returnOrigin || (c.tripDetails && (c.tripDetails.returnOrigin || c.tripDetails.return_origin)) || null;
        if (fromCart) return String(fromCart);
      } catch (_) {}
      const fromPg = pgHoldCartFromCartsTable && pgHoldCartFromCartsTable.returnOrigin ? pgHoldCartFromCartsTable.returnOrigin : null;
      return fromPg ? String(fromPg) : null;
    })();
    const returnDestinationForHold = (() => {
      const seg = holdTripLegs && (holdTripLegs.returnLastSeg || holdTripLegs.returnSeg);
      const fromSeg = seg ? segCityNameForHold(seg, 'destination') : null;
      if (fromSeg) return fromSeg;
      try {
        const c = holdCart || {};
        const fromCart = c.returnDestination || (c.tripDetails && (c.tripDetails.returnDestination || c.tripDetails.return_destination)) || null;
        if (fromCart) return String(fromCart);
      } catch (_) {}
      const fromPg = pgHoldCartFromCartsTable && pgHoldCartFromCartsTable.returnDestination ? pgHoldCartFromCartsTable.returnDestination : null;
      return fromPg ? String(fromPg) : null;
    })();
    const returnDepartTsForHold = (() => {
      const seg = holdTripLegs && (holdTripLegs.returnFirstSeg || holdTripLegs.returnSeg);
      const fromSeg = seg ? segTsForHold(seg, 'departure') : null;
      if (fromSeg) return fromSeg;
      try {
        const c = holdCart || {};
        const fromCart = c.returnDepartAt || (c.tripDetails && (c.tripDetails.returnDepartureTime || c.tripDetails.return_departure_time || c.tripDetails.returnDepartAt)) || null;
        if (fromCart) {
          const d = new Date(fromCart);
          if (!Number.isNaN(d.getTime())) return d;
        }
      } catch (_) {}
      const fromPg = pgHoldCartFromCartsTable && pgHoldCartFromCartsTable.returnDepartAt ? pgHoldCartFromCartsTable.returnDepartAt : null;
      if (fromPg) {
        const d = new Date(fromPg);
        return Number.isNaN(d.getTime()) ? null : d;
      }
      return null;
    })();
    const returnArriveTsForHold = (() => {
      const seg = holdTripLegs && (holdTripLegs.returnLastSeg || holdTripLegs.returnSeg);
      const fromSeg = seg ? segTsForHold(seg, 'arrival') : null;
      if (fromSeg) return fromSeg;
      try {
        const c = holdCart || {};
        const fromCart = c.returnArriveAt || (c.tripDetails && (c.tripDetails.returnArrivalTime || c.tripDetails.return_arrival_time || c.tripDetails.returnArriveAt)) || null;
        if (fromCart) {
          const d = new Date(fromCart);
          if (!Number.isNaN(d.getTime())) return d;
        }
      } catch (_) {}
      const fromPg = pgHoldCartFromCartsTable && pgHoldCartFromCartsTable.returnArriveAt ? pgHoldCartFromCartsTable.returnArriveAt : null;
      if (fromPg) {
        const d = new Date(fromPg);
        return Number.isNaN(d.getTime()) ? null : d;
      }
      return null;
    })();
    const hasReturnLegForHold = !!returnOriginForHold && !!returnDestinationForHold;
    const outboundFirstSegForHold = (holdTripLegs && (holdTripLegs.outboundFirstSeg || holdTripLegs.outboundSeg)) || null;
    const outboundLastSegForHold = (holdTripLegs && (holdTripLegs.outboundLastSeg || holdTripLegs.outboundSeg)) || outboundFirstSegForHold;
    const coerceDate = (value) => {
      if (!value) return null;
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : d;
    };
    const fallbackDepartCityForHold = (() => {
      const fromSeg = segCityNameForHold(outboundFirstSegForHold, 'origin');
      if (fromSeg) return fromSeg;
      const c = holdCart || {};
      return (
        c.departCity ||
        c.originCity ||
        c.origin ||
        (c.tripDetails && (c.tripDetails.originCity || c.tripDetails.origin)) ||
        null
      );
    })();
    const fallbackArriveCityForHold = (() => {
      const fromSeg = segCityNameForHold(outboundLastSegForHold, 'destination');
      if (fromSeg) return fromSeg;
      const c = holdCart || {};
      return (
        c.arriveCity ||
        c.destinationCity ||
        c.destination ||
        (c.tripDetails && (c.tripDetails.destinationCity || c.tripDetails.destination)) ||
        null
      );
    })();
    const departTsForHold = (() => {
      const segTs = segTsForHold(outboundFirstSegForHold, 'departure');
      if (segTs) return segTs;
      const c = holdCart || {};
      const raw =
        (c.tripDetails && (c.tripDetails.departureTime || c.tripDetails.departure_time || c.tripDetails.departAt || c.tripDetails.depart_at)) ||
        c.departAt ||
        c.depart_at;
      return coerceDate(raw);
    })();
    const arriveTsForHold = (() => {
      const segTs = segTsForHold(outboundLastSegForHold, 'arrival');
      if (segTs) return segTs;
      const c = holdCart || {};
      const raw =
        (c.tripDetails && (c.tripDetails.arrivalTime || c.tripDetails.arrival_time || c.tripDetails.arriveAt || c.tripDetails.arrive_at)) ||
        c.arriveAt ||
        c.arrive_at;
      return coerceDate(raw);
    })();
    const fmt2Hold = (n) => String(n).padStart(2, '0');
    const fmtDateHold = (d) => `${fmt2Hold(d.getDate())}/${fmt2Hold(d.getMonth() + 1)}/${d.getFullYear()}`;
    const fmtTimeHold = (d) => `${fmt2Hold(d.getHours())}:${fmt2Hold(d.getMinutes())}`;
    const departDateForHold = departTsForHold ? fmtDateHold(departTsForHold) : '-';
    const departTimeForHold = departTsForHold ? fmtTimeHold(departTsForHold) : '-';
    const arriveDateForHold = arriveTsForHold ? fmtDateHold(arriveTsForHold) : '-';
    const arriveTimeForHold = arriveTsForHold ? fmtTimeHold(arriveTsForHold) : '-';
    const returnDepartDateForHold = returnDepartTsForHold ? fmtDateHold(returnDepartTsForHold) : '-';
    const returnDepartTimeForHold = returnDepartTsForHold ? fmtTimeHold(returnDepartTsForHold) : '-';
    const returnArriveDateForHold = returnArriveTsForHold ? fmtDateHold(returnArriveTsForHold) : '-';
    const returnArriveTimeForHold = returnArriveTsForHold ? fmtTimeHold(returnArriveTsForHold) : '-';
    const displayDepartCity = (departCity && String(departCity).trim()) ? departCity : (fallbackDepartCityForHold || '-');
    const displayArriveCity = (arriveCity && String(arriveCity).trim()) ? arriveCity : (fallbackArriveCityForHold || '-');
    const displayDepartDate = (departDate && String(departDate).trim()) ? departDate : departDateForHold;
    const displayDepartTime = (departTime && String(departTime).trim()) ? departTime : departTimeForHold;
    const displayArriveDate = (arriveDate && String(arriveDate).trim()) ? arriveDate : arriveDateForHold;
    const displayArriveTime = (arriveTime && String(arriveTime).trim()) ? arriveTime : arriveTimeForHold;
    const derivedOperatorForHold = (() => {
      const seg = outboundFirstSegForHold || (holdTripLegs && holdTripLegs.outboundSeg) || null;
      if (seg && seg.operator) {
        return seg.operator.name || seg.operator.operator_name || seg.operator.xid || null;
      }
      const c = holdCart || {};
      return (
        (c.trip && c.trip.operator && (c.trip.operator.name || c.trip.operator.operator_name)) ||
        (c.tripDetails && c.tripDetails.operator) ||
        (c.operator && (c.operator.name || c.operator.operator_name || c.operator)) ||
        (c.busbudResponse && c.busbudResponse.operator && (c.busbudResponse.operator.name || c.busbudResponse.operator.operator_name)) ||
        null
      );
    })();
    if (!operator || !String(operator).trim()) {
      operator = derivedOperatorForHold || '-';
    }

    const passengerCountForHold = (() => {
      try {
        const c = holdCart || {};
        const explicit = (typeof c.passengerCount === 'number' && c.passengerCount > 0)
          ? c.passengerCount
          : (c.summary && typeof c.summary.passengerCount === 'number' && c.summary.passengerCount > 0)
            ? c.summary.passengerCount
            : null;
        if (explicit != null) return explicit;
        const pArr = Array.isArray(c.passengers) ? c.passengers : [];
        if (pArr.length) return pArr.length;
        const rp = Array.isArray(c.requiredPassengers) ? c.requiredPassengers : [];
        if (rp.length) return rp.length;
      } catch (_) {}
      return 1;
    })();

    const totalAmountForHold = (() => {
      try {
        const c = holdCart || {};
        const invoiceAmount = toNumSimple(c.invoice && (c.invoice.amount_total ?? c.invoice.total ?? c.invoice.amount_untaxed));
        if (Number.isFinite(invoiceAmount)) return invoiceAmount;
        const inv2 = toNumSimple(c.invoice_data && (c.invoice_data.amount_total ?? c.invoice_data.total ?? c.invoice_data.amount_untaxed));
        if (Number.isFinite(inv2)) return inv2;
        const t1 = toNumSimple(c.totalPrice);
        if (Number.isFinite(t1)) return t1;
        const t2 = toNumSimple(c.total);
        if (Number.isFinite(t2)) return t2;
      } catch (_) {}
      const fromPriceText = toNumSimple(priceText);
      return Number.isFinite(fromPriceText) ? fromPriceText : NaN;
    })();

    const currencyPrefixForHold = (typeof priceText === 'string' && priceText.includes('$')) ? '$' : '';
    const totalPriceTextForHold = Number.isFinite(totalAmountForHold)
      ? `${currencyPrefixForHold}${Number(totalAmountForHold).toFixed(2)}`
      : (priceText || '-');
    const perPassengerPriceTextForHold = (Number.isFinite(totalAmountForHold) && passengerCountForHold > 0)
      ? `${currencyPrefixForHold}${Number(totalAmountForHold / passengerCountForHold).toFixed(2)}`
      : '-';
    const fallbackPriceBreakdownTextForHold = (Number.isFinite(totalAmountForHold) && passengerCountForHold > 0)
      ? `${perPassengerPriceTextForHold} x ${passengerCountForHold} = ${totalPriceTextForHold}`
      : totalPriceTextForHold;
    const holdPassengersForBreakdown = (() => {
      try {
        const c = holdCart || {};
        const p1 = Array.isArray(c.passengers) ? c.passengers : [];
        if (p1.length) return p1;
        const p2 = (c.passengerDetails && Array.isArray(c.passengerDetails.passengers)) ? c.passengerDetails.passengers : [];
        if (p2.length) return p2;
        const p3 = Array.isArray(c.requiredPassengers) ? c.requiredPassengers : [];
        if (p3.length) return p3;
        const p4 = (c.trip && Array.isArray(c.trip.passengers)) ? c.trip.passengers : [];
        if (p4.length) return p4;
      } catch (_) {}
      return [];
    })();
    const holdCompletePurchaseForBreakdown = (holdCart && holdCart.passengerDetails && holdCart.passengerDetails.completePurchase) || null;
    const breakdownForHold = computeHoldAdultChildBreakdown({
      passengers: holdPassengersForBreakdown,
      completePurchase: holdCompletePurchaseForBreakdown,
      totalMajor: totalAmountForHold,
      currencyPrefix: currencyPrefixForHold,
      fallbackCount: passengerCountForHold
    });
    const passengersTextForHold = (breakdownForHold && breakdownForHold.passengersText) ? breakdownForHold.passengersText : String(passengerCountForHold);
    const priceBreakdownTextForHold = (breakdownForHold && breakdownForHold.breakdownHtml) ? breakdownForHold.breakdownHtml : fallbackPriceBreakdownTextForHold;

    const holdCompactMode = hasReturnLegForHold;
    const holdZoom = holdCompactMode ? 0.92 : 1;
    const holdOuterPadY = 0;
    const holdOuterPadX = 0;
    const holdInnerPad = holdCompactMode ? 16 : 24;
    const holdSectionMargin = holdCompactMode ? 10 : 16;
    const holdBoxPad = holdCompactMode ? 8 : 12;
    const holdBaseFont = holdCompactMode ? 14 : 16;
    const holdSmallFont = holdCompactMode ? 13 : 14;
    const holdHeadingFont = holdCompactMode ? 16 : 18;
    const holdPriceFont = holdCompactMode ? 18 : 20;
    const holdOlFont = holdCompactMode ? 12 : 14;
    const holdQrSize = holdCompactMode ? 96 : 120;
    const holdQrCellWidth = holdCompactMode ? 120 : 150;
    const holdExpiryDeadlineHours = (() => {
      const raw = process.env.INSTORE_PAYMENT_DEADLINE_HOURS || '12';
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? n : 12;
    })();

    const toDateFromUnknownHold = (raw) => {
      try {
        if (!raw) return null;
        if (typeof raw === 'object' && (raw._seconds || raw.seconds)) {
          const seconds = raw._seconds || raw.seconds;
          const nanos = raw._nanoseconds || raw.nanoseconds || 0;
          const d = new Date(Number(seconds) * 1000 + Number(nanos) / 1000000);
          return Number.isNaN(d.getTime()) ? null : d;
        }
        const d = new Date(raw);
        return Number.isNaN(d.getTime()) ? null : d;
      } catch (_) {
        return null;
      }
    };

    const holdExpiryDateObj = (() => {
      const raw =
        (t && (t.expiresAt || t.expires_at || t.expiryDate || t.expiry_date || t.expirationDate || t.expiration_date || t.x_datetime)) ||
        (opt && (opt.expiresAt || opt.expires_at || opt.expiryDate || opt.expiry_date || opt.expirationDate || opt.expiration_date || opt.x_datetime)) ||
        null;
      return toDateFromUnknownHold(raw);
    })();

    const holdExpiryFallbackBase = (() => {
      const raw =
        (t && (t.updated_at || t.updatedAt || t.created_at || t.createdAt)) ||
        ticketData.updatedAt ||
        ticketData.createdAt ||
        null;
      return toDateFromUnknownHold(raw) || new Date();
    })();

    const holdExpiryFinal = holdExpiryDateObj || new Date(holdExpiryFallbackBase.getTime() + holdExpiryDeadlineHours * 60 * 60 * 1000);
    const holdExpiryText = holdExpiryFinal ? `${fmtDateHold(holdExpiryFinal)} ${fmtTimeHold(holdExpiryFinal)}` : 'the expiry time shown on your reserved ticket';

    // Build a single-card HTML that mirrors the e-ticket email card layout,
    // but with a RESERVED banner and simpler body suitable for hold tickets.
    const reservedCardHtml = `
      <div style="width:100%;background:#f6f7fb;padding:${holdOuterPadY}px ${holdOuterPadX}px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%;">
          <tbody>
            <tr>
              <td style="padding:0;margin:0;">
                <div style=\"width:100%;background:#ffffff;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;border-radius:12px;box-shadow:0 10px 25px rgba(0,0,0,0.08);overflow:hidden;border:1px solid #e5e7eb;margin-bottom:0;zoom:${holdZoom};\">
                  <div style=\"padding:${holdInnerPad}px;\">
                    <div style=\"text-align:center;margin-bottom:14px;\">
                      ${ticketLogoDataUri
                        ? `<img src=\"${ticketLogoDataUri}\" alt=\"National Tickets Global\" style=\"display:block;margin:0 auto;max-width:360px;width:100%;height:auto;object-fit:contain;\" />`
                        : `<div style=\\\"display:inline-flex;align-items:center;gap:12px;\\\"><div style=\\\"height:48px;width:48px;border-radius:10px;background:#ede9fe;display:flex;align-items:center;justify-content:center;color:#7c3aed;font-weight:800;font-size:24px;\\\">J</div><div style=\\\"font-weight:800;color:#7B1FA2;font-size:16px;\\\">National Tickets Global</div></div>`}
                    </div>

                    <div style=\"display:flex;align-items:center;gap:12px;padding:12px 14px;background:#fef3c7;border:1px solid #fbbf24;border-radius:8px;\">
                      <div style=\"height:32px;width:32px;border-radius:9999px;background:#fbbf24;display:flex;align-items:center;justify-content:center;color:#92400e;font-weight:900;\">R</div>
                      <div>
                        <div style=\"font-weight:800;color:#92400e;\">TICKET RESERVED</div>
                        <div style=\"font-size:${holdSmallFont}px;color:#92400e;font-weight:900;margin-top:4px;line-height:1.25;\">Your booking has an outstanding balance, please process payment before ${holdExpiryText} to secure your booking.</div>
                      </div>
                    </div>

                    <hr style=\"margin:${holdSectionMargin}px 0;border:0;border-top:1px dashed #e5e7eb;\" />

                    <table role=\"presentation\" cellspacing=\"0\" cellpadding=\"0\" style=\"width:100%;font-size:${holdBaseFont}px;color:#1f2937;\">
                      <tbody>
                        <tr><td style=\"padding:2px 0;color:#374151;width:38%\">Ref No:</td><td style=\"padding:2px 0;font-weight:700;\">${refNo}</td></tr>
                        <tr><td style=\"padding:2px 0;color:#374151;\">Passengers:</td><td style=\"padding:2px 0;font-weight:700;\">${passengersTextForHold}</td></tr>
                        <tr><td style=\"padding:2px 0;color:#374151;\">Price breakdown:</td><td style=\"padding:2px 0;font-weight:700;\">${priceBreakdownTextForHold}</td></tr>
                        <tr><td style=\"padding:2px 0;color:#374151;\">Operator Name:</td><td style=\"padding:2px 0;font-weight:700;\">${operator || '-'}</td></tr>
                      </tbody>
                    </table>

                    <div style=\"border:1px solid #d1d5db;padding:${holdBoxPad}px;margin:${holdSectionMargin}px 0;border-radius:6px;\">
                      <div style=\"font-weight:800;font-size:${holdHeadingFont}px;color:#1f2937;\">Depart: ${displayDepartCity}</div>
                      <div style=\"color:#374151;font-size:${holdSmallFont}px;margin-top:2px;\">${displayDepartCity}</div>
                      <div style=\"font-weight:700;color:#1f2937;margin-top:2px;\">${displayDepartDate} ${displayDepartTime}</div>
                      <div style=\"font-size:${holdSmallFont}px;color:#374151;margin-top:4px;\">Checkin 1 Hour before Departure</div>
                    </div>

                    <div style=\"border:1px solid #d1d5db;padding:${holdBoxPad}px;margin:${holdSectionMargin}px 0;border-radius:6px;\">
                      <div style=\"font-weight:800;font-size:${holdHeadingFont}px;color:#1f2937;\">Arrive: ${displayArriveCity}</div>
                      <div style=\"color:#374151;font-size:${holdSmallFont}px;margin-top:2px;\">${displayArriveCity}</div>
                      <div style=\"font-weight:700;color:#1f2937;margin-top:2px;\">${displayArriveDate} ${displayArriveTime}</div>
                    </div>

                    ${hasReturnLegForHold ? `
                    <hr style=\"margin:${holdSectionMargin}px 0;border:0;border-top:1px dashed #e5e7eb;\" />
                    <div style=\"font-weight:800;color:#111827;margin-bottom:10px;\">Return Trip</div>

                    <div style=\"border:1px solid #d1d5db;padding:${holdBoxPad}px;margin:${holdSectionMargin}px 0;border-radius:6px;\">
                      <div style=\"font-weight:800;font-size:${holdHeadingFont}px;color:#1f2937;\">Depart: ${returnOriginForHold}</div>
                      <div style=\"color:#374151;font-size:${holdSmallFont}px;margin-top:2px;\">${returnOriginForHold}</div>
                      <div style=\"font-weight:700;color:#1f2937;margin-top:2px;\">${returnDepartDateForHold} ${returnDepartTimeForHold}</div>
                      <div style=\"font-size:${holdSmallFont}px;color:#374151;margin-top:4px;\">Checkin 1 Hour before Departure</div>
                    </div>

                    <div style=\"border:1px solid #d1d5db;padding:${holdBoxPad}px;margin:${holdSectionMargin}px 0;border-radius:6px;\">
                      <div style=\"font-weight:800;font-size:${holdHeadingFont}px;color:#1f2937;\">Arrive: ${returnDestinationForHold}</div>
                      <div style=\"color:#374151;font-size:${holdSmallFont}px;margin-top:2px;\">${returnDestinationForHold}</div>
                      <div style=\"font-weight:700;color:#1f2937;margin-top:2px;\">${returnArriveDateForHold} ${returnArriveTimeForHold}</div>
                    </div>
                    ` : ''}

                    <div style=\"font-size:${holdSmallFont}px;color:#374151;\">
                      <div>Booked By: <span style=\"font-weight:600;color:#1f2937;\">${bookedByDisplay}</span></div>
                    </div>

                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:${holdSectionMargin}px;">
                      <tr>
                        <td style="vertical-align:bottom;">
                          <div style="font-weight:800;font-size:${holdPriceFont}px;color:#1f2937;">Price: ${totalPriceTextForHold}</div>
                          <div style="font-size:${holdSmallFont}px;color:#374151;margin-top:2px;">[Awaiting payment]</div>
                        </td>
                        ${qrDataUrl ? `<td style=\"vertical-align:bottom;text-align:right;width:${holdQrCellWidth}px;\">
                          <img src=\"${qrDataUrl}\" alt=\"QR Code\" width=\"${holdQrSize}\" height=\"${holdQrSize}\" style=\"display:block;border:0;outline:none;text-decoration:none;border-radius:4px;margin-left:auto;\" />
                        </td>` : ''}
                      </tr>
                    </table>

                    <div style="margin-top:${holdSectionMargin}px;padding:${holdBoxPad}px;border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb;text-align:left;">
                      <div style="font-weight:800;color:#111827;margin-bottom:8px;text-align:left;">How to Pay In-Store</div>
                      <ol style="margin:0;padding-left:18px;color:#374151;font-size:${holdOlFont}px;line-height:1.35;text-align:left;">
                        <li>Present Ref No: ${refNo} to teller.</li>
                        <li>Pay at any TM Pick n Pay BancABC kiosk.</li>
                        <li>Obtain your printed receipt and confirmation.</li>
                        <li>Check your email for your official e-ticket.</li>
                        <li>Support &amp; Payments through agent, WhatsApp: +263 783 911 611.</li>
                      </ol>
                    </div>

                    <div style="margin-top:${holdSectionMargin}px;text-align:center;font-size:${holdSmallFont}px;color:#374151;">
                      <div>Terms &amp; Conditions Apply</div>
                      <div>For Info Call +263 867790 0600</div>
                    </div>
                  </div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>`;

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8" /></head><body style="margin:0;padding:0;background:#f6f7fb;">${reservedCardHtml}</body></html>`;

    const pdfBuffer = await generatePdfFromHtml(html, isThermal
      ? {
        thermal: true,
        width: '48mm',
        autoHeight: true,
        autoHeightPadding: 0,
        printBackground: true,
        viewportWidth: 280,
        scaleToFitWidth: true,
        margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' }
      }
      : {
        format: 'A4',
        printBackground: true,
        scale: holdCompactMode ? 0.92 : 1,
        margin: holdCompactMode
          ? { top: '8mm', bottom: '8mm', left: '8mm', right: '8mm' }
          : { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
      });

    const pdfBufNormalized = Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer);
    if (!pdfBufNormalized || !pdfBufNormalized.length) {
      logger.warn(`âš ï¸ [${requestId}] Hold ticket PDF generation returned empty buffer`, { pnr });
      return res.status(502).send('Failed to generate hold ticket PDF (empty response)');
    }

    {
      const apiBase = process.env.PUBLIC_API_BASE_URL || process.env.INTERNAL_API_BASE_URL || `${req.protocol}://${req.get('host')}`;
      const url = `${apiBase}/api/ticket/pdf?pnr=${encodeURIComponent(String(pnr))}&download=1`;
      await upsertTicketPdfCache({ pnr, bookedBy: bookedByDisplay, url, which: 'hold', pdfBuffer: pdfBufNormalized }).catch(() => {});
    }

    res.status(200);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=reserved-ticket-${refNo || pnr}.pdf`);

    res.setHeader('Content-Length', pdfBufNormalized.length);
    res.end(pdfBufNormalized);

    const responseTime = Date.now() - startTime;
    logger.info(`âœ… [${requestId}] Hold ticket PDF generated in ${responseTime}ms`, { pnr });
  } catch (e) {
    const responseTime = Date.now() - startTime;
    logger.error(`âŒ [${requestId}] Failed to generate hold ticket PDF`, { pnr, error: e.message, responseTime });
    return res.status(500).json({ success: false, error: 'Failed to generate PDF', requestId });
  }
});

// Note: we import getCart from Firestore utilities; no local duplicate needed.

const usePostgresFirstForEticket = process.env.ETICKET_USE_POSTGRES_FIRST !== 'false';

const useFirestoreTicketFallback = false;

const sleepLocal = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const refreshPurchaseForTicketNumbers = async ({ pnr, purchaseId, purchaseUuid, requestId, reason }) => {
  try {
    const pid = purchaseId != null ? String(purchaseId).trim() : '';
    const puid = purchaseUuid != null ? String(purchaseUuid).trim() : '';
    const ref = String(pnr || '').trim();
    if (!pid || !puid || !ref) return null;

    const maxAttempts = 4;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const fetched = await BusbudService.getPurchase(pid, puid);
        if (fetched && typeof fetched === 'object') {
          drizzleDb
            .update(payments)
            .set({ rawResponse: fetched })
            .where(eq(payments.transactionRef, ref))
            .catch(() => {});

          const normalized = normalizeCompletePurchase(fetched) || fetched;
          const booking = normalized && normalized.booking && typeof normalized.booking === 'object' ? normalized.booking : null;
          const ticketsArr = booking && Array.isArray(booking.tickets) ? booking.tickets : [];
          if (ticketsArr.length > 0) {
            logger.info(`[${requestId}] Refreshed Busbud purchase and found booking.tickets`, {
              pnr: ref,
              attempt,
              reason: reason || null,
              ticketsCount: ticketsArr.length,
            });
            return normalized;
          }
        }
      } catch (e) {
        logger.warn(`[${requestId}] Failed to refresh Busbud purchase for ticket numbers`, {
          pnr: ref,
          attempt,
          reason: reason || null,
          error: e.message,
        });
      }

      if (attempt < maxAttempts) {
        await sleepLocal(1500 * attempt);
      }
    }
  } catch (_) {
    // ignore
  }
  return null;
};

const loadTicketCartFromPostgres = async (pnr, requestId) => {
  try {
    const pnrId = String(pnr);
    try {
      const rows = await drizzleDb
        .select({
          cartId: cartsPgTable.cartId,
          busbudCartId: cartsPgTable.busbudCartId,
          status: cartsPgTable.status,
          purchaseId: cartsPgTable.purchaseId,
          purchaseUuid: cartsPgTable.purchaseUuid,
          currency: cartsPgTable.currency,
          origin: cartsPgTable.origin,
          destination: cartsPgTable.destination,
          departAt: cartsPgTable.departAt,
          arriveAt: cartsPgTable.arriveAt,
          returnOrigin: cartsPgTable.returnOrigin,
          returnDestination: cartsPgTable.returnDestination,
          returnDepartAt: cartsPgTable.returnDepartAt,
          returnArriveAt: cartsPgTable.returnArriveAt,
          passengerCount: cartsPgTable.passengerCount,
          purchaser: cartsPgTable.purchaser,
          passengers: cartsPgTable.passengers,
          busbudResponse: cartsPgTable.busbudResponse,
          retailPrice: cartsPgTable.retailPrice,
          costPrice: cartsPgTable.costPrice,
          updatedAt: cartsPgTable.updatedAt,
          createdAt: cartsPgTable.createdAt
        })
        .from(cartsPgTable)
        .where(or(eq(cartsPgTable.cartId, pnrId), eq(cartsPgTable.busbudCartId, pnrId)))
        .limit(1);
      if (rows && rows.length) {
        const row = rows[0] || {};
        const cart = {};
        cart.busbudCartId = row.busbudCartId || null;
        cart.cartId = row.cartId || pnrId;
        cart.cart_id = row.cartId || pnrId;
        cart.pnr = row.cartId || pnrId;
        if (row.status) cart.status = row.status;
        if (row.purchaseId != null) cart.purchaseId = row.purchaseId;
        if (row.purchaseUuid != null) cart.purchaseUuid = row.purchaseUuid;
        if (row.currency) cart.currency = row.currency;
        if (row.purchaser) cart.purchaser = row.purchaser;
        const pgPassengers = (() => {
          try {
            if (row.passengers == null) return null;
            if (Array.isArray(row.passengers)) return row.passengers;
            if (typeof row.passengers === 'string' && row.passengers.trim()) {
              const parsed = JSON.parse(row.passengers);
              if (Array.isArray(parsed)) return parsed;
              if (parsed && typeof parsed === 'object' && Array.isArray(parsed.passengers)) return parsed.passengers;
            }
            if (row.passengers && typeof row.passengers === 'object' && Array.isArray(row.passengers.passengers)) return row.passengers.passengers;
          } catch (_) {
            return null;
          }
          return null;
        })();
        if (Array.isArray(pgPassengers) && pgPassengers.length) {
          cart.passengers = pgPassengers;
          cart.requiredPassengers = pgPassengers;
        }
        if (row.passengerCount != null) cart.passengerCount = row.passengerCount;
        if (row.busbudResponse) {
          const parsedBusbudResponse = (() => {
            try {
              if (row.busbudResponse == null) return null;
              if (typeof row.busbudResponse === 'string' && row.busbudResponse.trim()) {
                return JSON.parse(row.busbudResponse);
              }
              return row.busbudResponse;
            } catch (_) {
              return row.busbudResponse;
            }
          })();
          cart.busbudResponse = parsedBusbudResponse;
          cart.passengerDetails = {
            busbudResponse: parsedBusbudResponse,
            purchaser: row.purchaser || null,
            passengers: Array.isArray(pgPassengers) ? pgPassengers : null
          };
        }

        // Ticket numbers per passenger are extracted from the Busbud getPurchase response,
        // which we persist in Postgres payments.rawResponse. Hydrate it here so
        // Postgres-first ticket generation can still render per-passenger references.
        try {
          const payRows = await drizzleDb
            .select({ rawResponse: payments.rawResponse })
            .from(payments)
            .where(eq(payments.transactionRef, pnrId))
            .limit(1);
          const payRow = payRows && payRows.length ? payRows[0] : null;
          const rawPurchase = payRow && payRow.rawResponse ? payRow.rawResponse : null;
          if (rawPurchase) {
            if (!cart.passengerDetails) cart.passengerDetails = {};
            const parsedPurchase = (() => {
              try {
                if (typeof rawPurchase === 'string' && rawPurchase.trim()) return JSON.parse(rawPurchase);
                return rawPurchase;
              } catch (_) {
                return rawPurchase;
              }
            })();
            const normalized = normalizeCompletePurchase(parsedPurchase) || parsedPurchase;
            const hasItems = normalized && typeof normalized === 'object' && Array.isArray(normalized.items) && normalized.items.length;
            const hasBooking = normalized && typeof normalized === 'object' && normalized.booking && typeof normalized.booking === 'object';

            const looksLikeWrapper = (() => {
              try {
                if (!normalized || typeof normalized !== 'object') return false;
                if (Array.isArray(normalized.items)) return false;
                if (normalized.booking || normalized.trips) return false;
                return !!(
                  normalized.source === 'payments.confirm' ||
                  (normalized.payload && typeof normalized.payload === 'object')
                );
              } catch (_) {
                return false;
              }
            })();

            if (looksLikeWrapper) {
              try {
                const payload = normalized && normalized.payload && typeof normalized.payload === 'object' ? normalized.payload : {};
                const purchaseId = payload.purchaseId || payload.purchase_id || null;
                const purchaseUuid = payload.purchaseUuid || payload.purchase_uuid || null;
                if (purchaseId && purchaseUuid) {
                  const fetched = await BusbudService.getPurchase(purchaseId, purchaseUuid);
                  if (fetched && typeof fetched === 'object') {
                    const fetchedNormalized = normalizeCompletePurchase(fetched) || fetched;
                    cart.passengerDetails.completePurchase = fetchedNormalized;
                    drizzleDb
                      .update(payments)
                      .set({ rawResponse: fetched })
                      .where(eq(payments.transactionRef, pnrId))
                      .catch(() => {});
                  } else {
                    cart.passengerDetails.completePurchase = normalized;
                  }
                } else {
                  cart.passengerDetails.completePurchase = normalized;
                }
              } catch (_) {
                cart.passengerDetails.completePurchase = normalized;
              }
            } else if (!hasItems && !hasBooking && (row.purchaseId || row.purchaseUuid)) {
              const refreshed = await refreshPurchaseForTicketNumbers({
                pnr: pnrId,
                purchaseId: row.purchaseId,
                purchaseUuid: row.purchaseUuid,
                requestId,
                reason: 'payments.rawResponse missing booking/items'
              });
              cart.passengerDetails.completePurchase = refreshed || normalized;
            } else {
              cart.passengerDetails.completePurchase = normalized;
            }

            if (!cart.purchaser) {
              try {
                const cp = cart.passengerDetails && cart.passengerDetails.completePurchase ? cart.passengerDetails.completePurchase : {};
                const base = (cp && (cp.purchaser || cp.user || cp.customer)) ? (cp.purchaser || cp.user || cp.customer) : {};
                const inferred = {
                  first_name: base.first_name || base.firstName || null,
                  last_name: base.last_name || base.lastName || null,
                  email: base.email || null,
                  phone: base.phone || base.phone_number || base.phoneNumber || null,
                  opt_in_marketing: base.opt_in_marketing ?? base.optInMarketing ?? null
                };
                const hasAnyIdentity =
                  (typeof inferred.first_name === 'string' && inferred.first_name.trim()) ||
                  (typeof inferred.last_name === 'string' && inferred.last_name.trim()) ||
                  (typeof inferred.email === 'string' && inferred.email.trim()) ||
                  (typeof inferred.phone === 'string' && inferred.phone.trim()) ||
                  inferred.opt_in_marketing !== null;
                if (hasAnyIdentity) {
                  cart.purchaser = inferred;
                  if (cart.passengerDetails && !cart.passengerDetails.purchaser) cart.passengerDetails.purchaser = inferred;
                }
              } catch (_) {}
            }
          }
        } catch (_) {}

        cart.tripDetails = {
          origin: row.origin || null,
          destination: row.destination || null,
          departureTime: row.departAt || null,
          arrivalTime: row.arriveAt || null,
          returnOrigin: row.returnOrigin || null,
          returnDestination: row.returnDestination || null,
          returnDepartureTime: row.returnDepartAt || null,
          returnArrivalTime: row.returnArriveAt || null
        };
        if (row.origin != null) cart.origin = row.origin;
        if (row.destination != null) cart.destination = row.destination;
        if (row.departAt != null) cart.departAt = row.departAt;
        if (row.arriveAt != null) cart.arriveAt = row.arriveAt;
        if (row.returnOrigin != null) cart.returnOrigin = row.returnOrigin;
        if (row.returnDestination != null) cart.returnDestination = row.returnDestination;
        if (row.returnDepartAt != null) cart.returnDepartAt = row.returnDepartAt;
        if (row.returnArriveAt != null) cart.returnArriveAt = row.returnArriveAt;

        const rt = row.retailPrice != null ? Number(row.retailPrice) : NaN;
        if (Number.isFinite(rt)) {
          cart.totalPrice = rt;
          cart.totalAmount = rt;
          cart.total = rt;
        }

        cart.summary = { currency: row.currency || null };
        cart.createdAt = row.createdAt || cart.createdAt;
        cart.updatedAt = row.updatedAt || cart.updatedAt;

        return cart;
      }
    } catch (_) {}

    const rows = await drizzleDb
      .select({
        amount: payments.amount,
        method: payments.method,
        status: payments.status,
        transactionRef: payments.transactionRef,
        rawResponse: payments.rawResponse,
        createdAt: payments.createdAt
      })
      .from(payments)
      .where(eq(payments.transactionRef, String(pnr)))
      .limit(1);
    if (!rows || !rows.length) {
      return null;
    }
    const row = rows[0];
    const purchase = row.rawResponse || {};
    const booking = purchase.booking || {};

    // If the ticket PNR maps to a payment transaction, try to recover the Busbud cart ID
    // and hydrate pricing + passengers from the carts table.
    const cartIdFromPurchase = (() => {
      try {
        const candidates = [
          purchase.cartId,
          purchase.cart_id,
          purchase.busbudCartId,
          purchase.busbud_cart_id,
          purchase.cart && (purchase.cart.id || purchase.cart.cart_id || purchase.cart.cartId),
          booking.cartId,
          booking.cart_id,
          booking.busbudCartId,
          booking.busbud_cart_id,
          purchase.metadata && (purchase.metadata.cartId || purchase.metadata.cart_id || purchase.metadata.busbudCartId || purchase.metadata.busbud_cart_id),
          purchase.context && (purchase.context.cartId || purchase.context.cart_id || purchase.context.busbudCartId || purchase.context.busbud_cart_id)
        ];
        const first = candidates.find(v => typeof v === 'string' && v.trim());
        return first ? String(first).trim() : null;
      } catch (_) {
        return null;
      }
    })();

    const pgCartFromCartsTable = await (async () => {
      try {
        if (!cartIdFromPurchase) return null;
        const rows = await drizzleDb
          .select({
            cartId: cartsPgTable.cartId,
            busbudCartId: cartsPgTable.busbudCartId,
            status: cartsPgTable.status,
            currency: cartsPgTable.currency,
            origin: cartsPgTable.origin,
            destination: cartsPgTable.destination,
            departAt: cartsPgTable.departAt,
            arriveAt: cartsPgTable.arriveAt,
            returnOrigin: cartsPgTable.returnOrigin,
            returnDestination: cartsPgTable.returnDestination,
            returnDepartAt: cartsPgTable.returnDepartAt,
            returnArriveAt: cartsPgTable.returnArriveAt,
            passengerCount: cartsPgTable.passengerCount,
            purchaser: cartsPgTable.purchaser,
            passengers: cartsPgTable.passengers,
            busbudResponse: cartsPgTable.busbudResponse,
            retailPrice: cartsPgTable.retailPrice,
            costPrice: cartsPgTable.costPrice,
            updatedAt: cartsPgTable.updatedAt,
            createdAt: cartsPgTable.createdAt
          })
          .from(cartsPgTable)
          .where(or(eq(cartsPgTable.cartId, String(cartIdFromPurchase)), eq(cartsPgTable.busbudCartId, String(cartIdFromPurchase))))
          .limit(1);
        return rows && rows.length ? (rows[0] || null) : null;
      } catch (_) {
        return null;
      }
    })();

    const user = purchase.user || purchase.purchaser || {};
    const purchaser = {
      first_name: user.first_name || user.firstName || null,
      last_name: user.last_name || user.lastName || null,
      email: user.email || null,
      phone: user.phone_number || user.phone || user.phoneNumber || null
    };
    const items = Array.isArray(purchase.items) ? purchase.items : [];
    const passengers = [];
    for (const it of items) {
      if (it && it.passenger) {
        passengers.push(it.passenger);
      }
    }
    let ticketRef = null;
    if (items.length) {
      const item0 = items[0] || {};
      const fields = item0.fields || {};
      ticketRef =
        (fields.booking_reference || fields.reference) ||
        item0.reference ||
        null;
    }
    if (!ticketRef) {
      const booking = purchase.booking || {};
      ticketRef =
        booking.reference ||
        purchase.reference ||
        purchase.id ||
        purchase.uuid ||
        null;
    }
    let origin = null;
    let destination = null;
    let departureIso = null;
    let arrivalIso = null;
    let tripOperator = null;
    const firstItem = items[0] || null;
    if (firstItem && firstItem.trip) {
      const tripKey = firstItem.trip.id || firstItem.trip.trip_id || firstItem.trip.tripId;
      const tripsMap = purchase.trips && typeof purchase.trips === 'object' ? purchase.trips : {};
      const trip = tripKey && tripsMap[tripKey] ? tripsMap[tripKey] : null;
      if (trip && Array.isArray(trip.segments) && trip.segments.length) {
        const seg = trip.segments[0] || {};
        const originObj = seg.origin || {};
        const destObj = seg.destination || {};
        const originCity = originObj.city || {};
        const destCity = destObj.city || {};
        origin = originObj.name || originCity.name || origin;
        destination = destObj.name || destCity.name || destination;
        const segOperator = seg.operator || {};
        tripOperator =
          seg.operator_name ||
          (typeof seg.operator === 'string' ? seg.operator : null) ||
          segOperator.name ||
          segOperator.label ||
          segOperator.operator_name ||
          tripOperator;
        let departure = null;
        let arrival = null;
        const segDepartureTime = seg.departure_time || seg.departureTime || null;
        if (trip.departure_time && trip.departure_time.timestamp) {
          departure = trip.departure_time.timestamp;
        } else if (trip.departure_time) {
          departure = trip.departure_time;
        } else if (trip.departure_time_utc) {
          departure = trip.departure_time_utc;
        } else if (segDepartureTime && segDepartureTime.timestamp) {
          departure = segDepartureTime.timestamp;
        } else if (segDepartureTime) {
          departure = segDepartureTime;
        } else if (seg.departure_time_utc) {
          departure = seg.departure_time_utc;
        }
        const segArrivalTime = seg.arrival_time || seg.arrivalTime || null;
        if (trip.arrival_time && trip.arrival_time.timestamp) {
          arrival = trip.arrival_time.timestamp;
        } else if (trip.arrival_time) {
          arrival = trip.arrival_time;
        } else if (trip.arrival_time_utc) {
          arrival = trip.arrival_time_utc;
        } else if (segArrivalTime && segArrivalTime.timestamp) {
          arrival = segArrivalTime.timestamp;
        } else if (segArrivalTime) {
          arrival = segArrivalTime;
        } else if (seg.arrival_time_utc) {
          arrival = seg.arrival_time_utc;
        }
        if (departure) {
          const d = new Date(departure);
          if (!Number.isNaN(d.getTime())) {
            departureIso = d.toISOString();
          }
        }
        if (arrival) {
          const a = new Date(arrival);
          if (!Number.isNaN(a.getTime())) {
            arrivalIso = a.toISOString();
          }
        }
      }

      if ((!returnOrigin || !returnDestination) && cart.returnOrigin && cart.returnDestination) {
        returnOrigin = cart.returnOrigin;
        returnDestination = cart.returnDestination;
        returnDepartTs = cart.returnDepartAt ? new Date(cart.returnDepartAt) : returnDepartTs;
        returnArriveTs = cart.returnArriveAt ? new Date(cart.returnArriveAt) : returnArriveTs;
      }
    }
    if (!origin) {
      origin = purchase.origin_name || purchase.origin || 'Unknown';
    }
    if (!destination) {
      destination = purchase.destination_name || purchase.destination || 'Unknown';
    }
    const now = new Date();
    const fallbackDeparture =
      purchase.completed_at ||
      purchase.created_at ||
      purchase.updated_at ||
      (row.createdAt || now).toISOString();
    if (!departureIso) {
      const d = new Date(fallbackDeparture);
      departureIso = !Number.isNaN(d.getTime()) ? d.toISOString() : now.toISOString();
    }
    if (!arrivalIso) {
      arrivalIso = departureIso;
    }
    if (!tripOperator && Array.isArray(booking.tickets)) {
      const ticketsArr = booking.tickets;
      if (ticketsArr.length > 0) {
        const firstTicket = ticketsArr[0] || {};
        const seg = firstTicket.segment || firstTicket.trip || {};
        const segOp = seg.operator || {};
        tripOperator =
          seg.operator_name ||
          (typeof seg.operator === 'string' ? seg.operator : null) ||
          segOp.name ||
          segOp.label ||
          segOp.operator_name ||
          tripOperator;
      }
    }
    const charges = purchase.charges || {};
    const stats = purchase.stats || {};
    const summary = purchase.summary || {};
    let currency = null;
    if (charges.currency) {
      currency = charges.currency;
    } else if (stats.customer_value && stats.customer_value.currency) {
      currency = stats.customer_value.currency;
    } else if (summary.currency) {
      currency = summary.currency;
    } else {
      currency = 'USD';
    }
    const amountNumber = Number(row.amount || 0);
    const cart = {};

    // Prefer purchaser/passengers from carts table when available (canonical snapshot).
    cart.purchaser = (pgCartFromCartsTable && pgCartFromCartsTable.purchaser) ? pgCartFromCartsTable.purchaser : purchaser;
    if (pgCartFromCartsTable && Array.isArray(pgCartFromCartsTable.passengers) && pgCartFromCartsTable.passengers.length) {
      cart.requiredPassengers = pgCartFromCartsTable.passengers;
      cart.passengers = pgCartFromCartsTable.passengers;
      cart.passengerCount = pgCartFromCartsTable.passengerCount || pgCartFromCartsTable.passengers.length;
    } else {
      cart.requiredPassengers = passengers;
    }
    cart.passengerDetails = {
      completePurchase: purchase,
      busbudResponse: purchase
    };
    if (ticketRef) {
      cart.ticketNo = ticketRef;
      cart.bookingId = ticketRef;
    }
    cart.tripDetails = {
      origin: (pgCartFromCartsTable && pgCartFromCartsTable.origin) ? pgCartFromCartsTable.origin : origin,
      destination: (pgCartFromCartsTable && pgCartFromCartsTable.destination) ? pgCartFromCartsTable.destination : destination,
      departureTime: (pgCartFromCartsTable && pgCartFromCartsTable.departAt) ? pgCartFromCartsTable.departAt : departureIso,
      arrivalTime: (pgCartFromCartsTable && pgCartFromCartsTable.arriveAt) ? pgCartFromCartsTable.arriveAt : arrivalIso,
      returnOrigin: pgCartFromCartsTable ? (pgCartFromCartsTable.returnOrigin || null) : null,
      returnDestination: pgCartFromCartsTable ? (pgCartFromCartsTable.returnDestination || null) : null,
      returnDepartureTime: pgCartFromCartsTable ? (pgCartFromCartsTable.returnDepartAt || null) : null,
      returnArrivalTime: pgCartFromCartsTable ? (pgCartFromCartsTable.returnArriveAt || null) : null,
      operator: tripOperator || null
    };

    const retailFromCarts = pgCartFromCartsTable && pgCartFromCartsTable.retailPrice != null ? Number(pgCartFromCartsTable.retailPrice) : NaN;
    if (Number.isFinite(retailFromCarts)) {
      cart.totalPrice = retailFromCarts;
      cart.totalAmount = retailFromCarts;
      cart.total = retailFromCarts;
    } else {
      cart.totalAmount = Number.isFinite(amountNumber) ? amountNumber : null;
    }

    cart.summary = { currency: (pgCartFromCartsTable && pgCartFromCartsTable.currency) ? pgCartFromCartsTable.currency : currency };
    cart.paymentMethod = row.method || 'Online';
    cart.bookingTimestamp = row.createdAt || fallbackDeparture;
    return cart;
  } catch (e) {
    logger.warn(`[${requestId}] Failed to load ticket cart from Postgres`, { pnr, error: e.message });
    return null;
  }
};

// Simple Firestore ticket functions
const resolveCartDocId = async (cartId, { createIfMissing = false } = {}) => {
  const db = await getFirestore();

  // 1) Direct doc lookup by ID (PNR)
  const direct = await db.collection('carts').doc(cartId).get();
  if (direct.exists) return cartId;

  // 2) Lookup by busbudCartId or firestoreCartId fields
  const snapshot = await db.collection('carts')
    .where('busbudCartId', '==', cartId)
    .limit(1)
    .get();
  if (!snapshot.empty) {
    const doc = snapshot.docs[0];
    return doc.id;
  }
  const snapshot2 = await db.collection('carts')
    .where('firestoreCartId', '==', cartId)
    .limit(1)
    .get();
  if (!snapshot2.empty) {
    const doc = snapshot2.docs[0];
    return doc.id;
  }

  // 3) If allowed, create a new Firestore cart ID
  if (createIfMissing) {
    return await getOrCreateFirestoreCartId(cartId);
  }

  // Not found and not created
  return cartId;
};

const saveTicket = async (ticketData) => {
  if (!ticketData.id) {
    ticketData.id = `ticket_${Date.now()}`;
  }
  ticketData.updatedAt = new Date().toISOString();
  const db = await getFirestore();
  const firestoreCartId = await resolveCartDocId(ticketData.cartId, { createIfMissing: true });
  await db.collection('carts').doc(firestoreCartId).collection('tickets').doc(ticketData.id).set(ticketData);
  return ticketData;
};

const getTicket = async (cartId, ticketId) => {
  const db = await getFirestore();
  const firestoreCartId = await resolveCartDocId(cartId, { createIfMissing: false });
  const doc = await db.collection('carts').doc(firestoreCartId).collection('tickets').doc(ticketId).get();
  return doc.exists ? doc.data() : null;
};

const getTicketsByCartId = async (cartId) => {
  const db = await getFirestore();
  const firestoreCartId = await resolveCartDocId(cartId, { createIfMissing: false });
  const snapshot = await db.collection('carts').doc(firestoreCartId).collection('tickets').get();
  return snapshot.docs.map(doc => doc.data());
};

// Agent headers are managed by the frontend; do not enrich on the backend.

if (!isProduction) {
  console.log('âœ… Ticket route loaded');
}

// ================================
// ðŸŽ« FRONTEND TICKET CREATION
// ================================
// POST /api/ticket/create
// Frontend-friendly endpoint that accepts cart ID from frontend
// Expected request body: { cartId: "string", options?: object }
router.post('/create', async (req, res) => {
  const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const { cartId, options } = req.body;

  if (!isProduction) {
    console.log(`\n=== FRONTEND TICKET CREATION ===`);
    console.log(`[${requestId}] ðŸ“¨ Frontend ticket creation request`);
    console.log(`[${requestId}] ðŸ“¦ Cart ID: ${cartId}`);
    console.log(`[${requestId}] ðŸ“¦ Options:`, options);
  }

  // Validate cart ID
  if (!cartId) {
    return res.status(400).json({
      success: false,
      error: 'Missing cart ID',
      requestId,
      timestamp: new Date().toISOString(),
      suggestions: [
        'Include cartId in request body',
        'Expected format: {"cartId": "your-cart-id", "options": {...}}'
      ]
    });
  }

  try {
    if (!isProduction) {
      console.log(`[${requestId}] ðŸš€ Creating ticket...`);
    }
    const ticket = {
      id: `ticket_${Date.now()}`,
      cartId,
      options,
      status: 'pending'
    };

    // Save ticket to in-memory storage
    const savedTicket = await saveTicket(ticket);
    if (!isProduction) {
      console.log(`[${requestId}] ðŸ’¾ Ticket saved to in-memory storage`);
      console.log(`[${requestId}] ðŸ“¤ Sending response to frontend`);
      console.log(`[${requestId}] âœ… Success: true`);
      console.log(`[${requestId}] ðŸŽ« Ticket ID: ${savedTicket.id}`);
    }

    res.json({
      success: true,
      ticket: savedTicket
    });

  } catch (error) {
    if (!isProduction) {
      console.error(`[${requestId}] ðŸ’¥ Unexpected error:`, error.message);
    }

    res.status(500).json({
      success: false,
      error: {
        message: 'Internal server error during ticket creation',
        type: 'INTERNAL_ERROR',
        details: error.message
      },
      requestId,
      timestamp: new Date().toISOString()
    });
  }
});

router.post(
  '/failed/send',
  [
    body().isObject().withMessage('Body must be a JSON object'),
    body('pnr').optional().isString().trim().isLength({ min: 1 }).withMessage('pnr must be a non-empty string'),
    body('cartId').optional().isString().trim().isLength({ min: 1, max: 128 }).withMessage('cartId must be a string')
  ],
  async (req, res) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    try {
      const v = validationResult(req);
      if (!v.isEmpty()) {
        return res.status(400).json({ success: false, errors: v.array({ onlyFirstError: true }) });
      }
      const body = req.body || {};
      const lower = Object.fromEntries(Object.entries(body).map(([k, v]) => [String(k).toLowerCase(), v]));
      const pnr = lower.pnr || lower.reference || lower.firestorecartid || lower.cartid || lower.cart_id;
      const reason = lower.reason || lower.error || null;
      const purchaseStatus = lower.purchasestatus || null;

      if (!pnr) {
        return res.status(400).json({ success: false, error: 'Missing pnr', requestId, timestamp: new Date().toISOString() });
      }

      const db = await getFirestore();
      const doc = await db.collection('carts').doc(pnr).get();
      if (!doc.exists) {
        return res.status(404).json({ success: false, error: 'PNR not found', pnr, requestId, timestamp: new Date().toISOString() });
      }

      const cart = doc.data() || {};
      // Persist agent context using frontend-provided headers only
      try {
        const modeHeader = req.get('x-agent-mode');
        const resolvedMode = Boolean(modeHeader && String(modeHeader).toLowerCase() === 'true');
        const resolvedEmail = req.get('x-agent-email') || null;
        const resolvedId = req.get('x-agent-id') || null;
        const resolvedName = req.get('x-agent-name') || null;
        if (resolvedName || resolvedEmail || resolvedId || resolvedMode) {
          await updateCart(String(pnr), {
            agentMode: resolvedMode,
            agentId: resolvedId || null,
            agentEmail: resolvedEmail || null,
            agentName: resolvedName || null
          });
        }
      } catch (_) { /* noop */ }
      const purchaser = cart.purchaser || cart.purchaserDetails || (cart.passengerDetails && cart.passengerDetails.purchaser) || cart.contact_info || cart.contactInfo || {};
      const purchaserEmail = purchaser.email || purchaser.Email || (cart.contact_info && cart.contact_info.email) || (cart.contactInfo && cart.contactInfo.email) || cart.email || null;
      const purchaserName = (
        purchaser.name || purchaser.fullName ||
        [purchaser.first_name || purchaser.firstName, purchaser.last_name || purchaser.lastName].filter(Boolean).join(' ')
      ) || null;

      if (!purchaserEmail) {
        return res.status(400).json({ success: false, error: 'Purchaser email not found', pnr, requestId, timestamp: new Date().toISOString() });
      }

      const supportEmail = process.env.SUPPORT_EMAIL || process.env.EMAIL_FROM_ADDRESS || purchaserEmail;
      const appName = process.env.APP_NAME || 'Uniglade';

      const safeReason = reason || `Your purchase could not be completed${purchaseStatus ? ` (status: ${purchaseStatus})` : ''}.`;
      const html = `
        <p>Dear ${purchaserName || 'Customer'},</p>
        <p>Your ticket purchase with reference <strong>${pnr}</strong> could not be completed.</p>
        <p>${safeReason}</p>
        <p>If payment was captured, our team will review and contact you if a refund is required.</p>
        <p>You can reply to this email or contact our support team at <a href="mailto:${supportEmail}">${supportEmail}</a> for assistance.</p>
        <p>Thank you,<br/>${appName}</p>
        <p><small>Reference: ${pnr}</small></p>
      `;

      await sendEmail({
        to: purchaserEmail,
        subject: `Ticket purchase could not be completed - Ref ${pnr}`,
        html
      });

      return res.json({ success: true, requestId, timestamp: new Date().toISOString() });
    } catch (error) {
      logger.error(`[${requestId}] Failed to send failed-ticket email`, { error: error.message });
      return res.status(500).json({
        success: false,
        error: 'Internal error while sending failed-ticket email',
        requestId,
        timestamp: new Date().toISOString()
      });
    }
  }
);

router.get(
  '/view',
  [
    query('pnr').optional().isString().trim().isLength({ min: 1 }).withMessage('pnr must be a non-empty string')
  ],
  async (req, res) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    try {
      const v = validationResult(req);
      if (!v.isEmpty()) {
        return res.status(400).send('Invalid parameters');
      }

      const q = req.query || {};
      const pnr = q.pnr || q.reference || q.firestorecartid || q.cartid || q.cart_id;
      if (!pnr) {
        return res.status(400).send('Missing or invalid parameters');
      }

      const frontendBaseRaw = process.env.FRONTEND_URL || process.env.CLIENT_URL || 'https://your-app.com';
      const frontendBase = String(frontendBaseRaw || '').replace(/\/+$/, '');
      const targetBase = `${frontendBase}/tickets/${encodeURIComponent(String(pnr))}`;

      const passthrough = new URLSearchParams();
      const agentMode = q.agentMode || q.agent_mode;
      const agentEmail = q.agentEmail || q.agent_email;
      const agentId = q.agentId || q.agent_id;
      const agentName = q.agentName || q.agent_name;
      if (agentMode != null) passthrough.set('agentMode', String(agentMode));
      if (agentEmail != null) passthrough.set('agentEmail', String(agentEmail));
      if (agentId != null) passthrough.set('agentId', String(agentId));
      if (agentName != null) passthrough.set('agentName', String(agentName));

      const qs = passthrough.toString();
      const target = qs ? `${targetBase}?${qs}` : targetBase;
      return res.redirect(302, target);
    } catch (error) {
      logger.warn(`[${requestId}] Failed to render ticket view`, { error: error.message });
      return res.status(500).send('Failed to render ticket view');
    }
  }
);

// ================================
// ðŸ“§ SEND E-TICKET EMAIL (POST-PURCHASE)
// ================================
// POST /api/ticket/eticket/send
// Body: { pnr: string, cartId?: string, purchaseId?: string, purchaseUuid?: string }
router.post(
  '/eticket/send',
  [
    body().isObject().withMessage('Body must be a JSON object'),
    body('pnr').optional().isString().trim().isLength({ min: 1 }).withMessage('pnr must be a non-empty string'),
    body('cartId').optional().isString().trim().isLength({ min: 1, max: 128 }).withMessage('cartId must be a string'),
    body('purchaseId').optional().customSanitizer(v => (v == null ? v : String(v))).isLength({ max: 128 }),
    body('purchaseUuid').optional().customSanitizer(v => (v == null ? v : String(v))).isLength({ max: 128 })
  ],
  async (req, res) => {
  const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const startTime = Date.now();
  try {
    const v = validationResult(req);
    if (!v.isEmpty()) {
      return res.status(400).json({ success: false, errors: v.array({ onlyFirstError: true }) });
    }
    const body = req.body || {};
    const lower = Object.fromEntries(Object.entries(body).map(([k, v]) => [String(k).toLowerCase(), v]));
    const pnr = lower.pnr || lower.reference || lower.firestorecartid || lower.cartid || lower.cart_id;
    const providedCartId = lower.cartid || lower.cart_id || null;
    const purchaseId = lower.purchaseid || lower.purchase_id || null;
    const purchaseUuid = lower.purchaseuuid || lower.purchase_uuid || null;

    if (!pnr) {
      return res.status(400).json({ success: false, error: 'Missing pnr', requestId, timestamp: new Date().toISOString() });
    }

    const forceSend = Boolean(
      lower.force ||
      lower.resend ||
      (req.query && (req.query.force === '1' || req.query.force === 'true' || req.query.resend === '1' || req.query.resend === 'true'))
    );
    if (!forceSend) {
      const key = String(pnr);
      const last = recentEticketSendByPnr.get(key);
      if (last && (Date.now() - Number(last)) < 120000) {
        return res.json({
          success: true,
          pnr,
          skipped: true,
          reason: 'recently_sent',
          requestId,
          timestamp: new Date().toISOString()
        });
      }
      recentEticketSendByPnr.set(key, Date.now());
    }

    let cart = null;
    if (usePostgresFirstForEticket) {
      cart = await loadTicketCartFromPostgres(pnr, requestId);
    }
    if (!cart && useFirestoreTicketFallback) {
      const db = await getFirestore();
      const fsCartId = await resolveCartDocId(pnr, { createIfMissing: false });
      const doc = await db.collection('carts').doc(fsCartId).get();
      if (doc.exists) {
        cart = doc.data() || {};
      }
    }
    if (!cart) {
      return res.status(404).json({ success: false, error: 'PNR not found', pnr, requestId, timestamp: new Date().toISOString() });
    }

    cart = await hydrateEticketCartFromCartsTable(cart, { pnr, cartIdHint: providedCartId, requestId });
    if (useFirestoreTicketFallback) {
      try {
        const dbAgent = await getFirestore();
        const fsCartId2 = await resolveCartDocId(pnr, { createIfMissing: false });
        const fsDocAgent = await dbAgent.collection('carts').doc(String(fsCartId2)).get();
        if (fsDocAgent.exists) {
          const fsData = fsDocAgent.data() || {};
          if (cart.agentMode == null && fsData.agentMode != null) cart.agentMode = fsData.agentMode;
          if (cart.agentId == null && (fsData.agentId != null || (fsData.agent && fsData.agent.agentId != null))) cart.agentId = fsData.agentId != null ? fsData.agentId : (fsData.agent && fsData.agent.agentId);
          if (cart.agentEmail == null && (fsData.agentEmail != null || (fsData.agent && fsData.agent.agentEmail != null))) cart.agentEmail = fsData.agentEmail != null ? fsData.agentEmail : (fsData.agent && fsData.agent.agentEmail);
          if (cart.agentName == null && (fsData.agentName != null || (fsData.agent && fsData.agent.agentName != null))) cart.agentName = fsData.agentName != null ? fsData.agentName : (fsData.agent && fsData.agent.agentName);
          if (cart.bookingSource == null && fsData.bookingSource != null) cart.bookingSource = fsData.bookingSource;
        }
        // Also persist agent info if available on the request (headers only)
        try {
          const modeHeader = req.get('x-agent-mode');
          const resolvedMode = Boolean(modeHeader && String(modeHeader).toLowerCase() === 'true');
          const resolvedEmail = req.get('x-agent-email') || null;
          const resolvedId = req.get('x-agent-id') || null;
          const resolvedName = req.get('x-agent-name') || null;
          if (resolvedName || resolvedEmail || resolvedId || resolvedMode) {
            await updateCart(String(fsCartId2), {
              agentMode: resolvedMode,
              agentId: resolvedId || null,
              agentEmail: resolvedEmail || null,
              agentName: resolvedName || null
            });
          }
        } catch (_) { /* noop */ }
      } catch (_) {}
    }
    const purchaser = cart.purchaser || cart.purchaserDetails || (cart.passengerDetails && cart.passengerDetails.purchaser) || cart.contact_info || cart.contactInfo || {};
    const purchaserEmail = purchaser.email || purchaser.Email || (cart.contact_info && cart.contact_info.email) || (cart.contactInfo && cart.contactInfo.email) || cart.email || null;
    const purchaserName = (
      purchaser.name || purchaser.fullName ||
      [purchaser.first_name || purchaser.firstName, purchaser.last_name || purchaser.lastName].filter(Boolean).join(' ')
    ) || null;

    if (!purchaserEmail) {
      return res.status(400).json({ success: false, error: 'Purchaser email not found', pnr, requestId, timestamp: new Date().toISOString() });
    }

    const frontendBaseRaw = process.env.FRONTEND_URL || process.env.CLIENT_URL || 'https://your-app.com';
    const frontendBase = String(frontendBaseRaw || '').replace(/\/+$/, '');
    const downloadLink = `${frontendBase}/tickets/${encodeURIComponent(String(pnr))}?type=final`;
    const apiBasePublic = process.env.PUBLIC_API_BASE_URL || process.env.INTERNAL_API_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
    const viewLink = `${frontendBase}/tickets/${encodeURIComponent(String(pnr))}?type=final`;
    const pdfDownloadLink = `${apiBasePublic}/api/ticket/pdf?pnr=${encodeURIComponent(pnr)}&download=1`;

    // Derive outbound and optional return segments using Firestore cart.trip._raw structure when available
    let origin = 'Unknown';
    let destination = 'Unknown';
    let departTs = null;
    let arriveTs = null;
    let returnOrigin = null;
    let returnDestination = null;
    let returnDepartTs = null;
    let returnArriveTs = null;

    const rawTripItems = cart.trip && cart.trip._raw && Array.isArray(cart.trip._raw.items) ? cart.trip._raw.items : null;
    const rawTripItem = rawTripItems && rawTripItems.length ? rawTripItems[0] : null;
    const rawTripItemReturn = rawTripItems && rawTripItems.length > 1 ? rawTripItems[1] : null;
    const segments = rawTripItem && Array.isArray(rawTripItem.segments) ? rawTripItem.segments : ((cart.busbudResponse && (cart.busbudResponse.segments || (cart.busbudResponse.trip && cart.busbudResponse.trip.segments))) || cart.segments || []);

    // Declare outbound/return segments in outer scope so they can be used later (e.g., for operatorName)
    let outboundSeg = null;
    let returnSeg = null;
    let outboundFirstSeg = null;
    let outboundLastSeg = null;
    let returnFirstSeg = null;
    let returnLastSeg = null;

    if (Array.isArray(segments) && segments.length) {
      outboundSeg = segments[0];
      outboundFirstSeg = outboundSeg;
      outboundLastSeg = segments[segments.length - 1] || outboundSeg;

      const tripLegs = rawTripItem && Array.isArray(rawTripItem.trip_legs) ? rawTripItem.trip_legs : [];
      if (Array.isArray(tripLegs) && tripLegs.length > 1) {
        const leg1Ids = Array.isArray(tripLegs[0]?.segment_ids) ? tripLegs[0].segment_ids : null;
        const leg2Ids = Array.isArray(tripLegs[1]?.segment_ids) ? tripLegs[1].segment_ids : null;
        const outSegs = pickSegmentsByIds(segments, leg1Ids);
        const retSegs = pickSegmentsByIds(segments, leg2Ids);
        if (outSegs.length) {
          outboundFirstSeg = outSegs[0];
          outboundLastSeg = outSegs[outSegs.length - 1];
          outboundSeg = pickSegmentWithOperator(outSegs) || outboundFirstSeg;
        }
        if (retSegs.length) {
          returnFirstSeg = retSegs[0];
          returnLastSeg = retSegs[retSegs.length - 1];
          returnSeg = pickSegmentWithOperator(retSegs) || returnFirstSeg;
        }
      } else if (!rawTripItemReturn && segments.length > 1) {
        // Only infer a return leg from segments[1] when the cart is NOT itemized.
        // If the cart is itemized, segments[1] is typically a connection within the outbound leg.
        const cand = segments[1];
        const oo = segCityName(outboundSeg, 'origin');
        const od = segCityName(outboundSeg, 'destination');
        const ro = segCityName(cand, 'origin');
        const rd = segCityName(cand, 'destination');
        const norm = (s) => (s == null ? '' : String(s)).trim().toLowerCase();
        const looksLikeReturn = norm(ro) && norm(rd) && norm(oo) && norm(od) && norm(ro) === norm(od) && norm(rd) === norm(oo);
        if (looksLikeReturn) returnSeg = cand;
      }

      if (outboundSeg) {
        const first = outboundFirstSeg || outboundSeg;
        const last = outboundLastSeg || outboundSeg;
        origin = (first.origin && (first.origin.city && first.origin.city.name)) || (first.origin && first.origin.name) || origin;
        destination = (last.destination && (last.destination.city && last.destination.city.name)) || (last.destination && last.destination.name) || destination;
        const dts = (first.departure_time && (first.departure_time.timestamp || first.departure_time)) || (first.departure && first.departure.timestamp) || null;
        const ats = (last.arrival_time && (last.arrival_time.timestamp || last.arrival_time)) || (last.arrival && last.arrival.timestamp) || null;
        departTs = dts ? new Date(dts) : null;
        arriveTs = ats ? new Date(ats) : null;
      }

      if (returnSeg) {
        const first = returnFirstSeg || returnSeg;
        const last = returnLastSeg || returnSeg;
        returnOrigin = (first.origin && (first.origin.city && first.origin.city.name)) || (first.origin && first.origin.name) || null;
        returnDestination = (last.destination && (last.destination.city && last.destination.city.name)) || (last.destination && last.destination.name) || null;
        const rdts = (first.departure_time && (first.departure_time.timestamp || first.departure_time)) || (first.departure && first.departure.timestamp) || null;
        const rats = (last.arrival_time && (last.arrival_time.timestamp || last.arrival_time)) || (last.arrival && last.arrival.timestamp) || null;
        returnDepartTs = rdts ? new Date(rdts) : null;
        returnArriveTs = rats ? new Date(rats) : null;
      }

      if (!returnSeg && rawTripItemReturn && Array.isArray(rawTripItemReturn.segments) && rawTripItemReturn.segments.length) {
        const retSegs = rawTripItemReturn.segments;
        const firstRet = retSegs[0];
        const lastRet = retSegs[retSegs.length - 1];
        returnSeg = pickSegmentWithOperator(retSegs) || firstRet;
        returnFirstSeg = returnFirstSeg || firstRet;
        returnLastSeg = returnLastSeg || lastRet;
        if (!returnOrigin) returnOrigin = segCityName(firstRet, 'origin');
        if (!returnDestination) returnDestination = segCityName(lastRet, 'destination');
        if (!returnDepartTs) returnDepartTs = segTs(firstRet, 'departure');
        if (!returnArriveTs) returnArriveTs = segTs(lastRet, 'arrival');
      }
    } else if (cart.tripDetails) {
      origin = cart.tripDetails.originCity || cart.tripDetails.origin || origin;
      destination = cart.tripDetails.destinationCity || cart.tripDetails.destination || destination;
      departTs = cart.tripDetails.departureTime ? new Date(cart.tripDetails.departureTime) : null;
      arriveTs = cart.tripDetails.arrivalTime ? new Date(cart.tripDetails.arrivalTime) : null;

      returnOrigin = cart.tripDetails.returnOrigin || cart.tripDetails.return_origin || cart.tripDetails.inboundOrigin || cart.tripDetails.inbound_origin || returnOrigin;
      returnDestination = cart.tripDetails.returnDestination || cart.tripDetails.return_destination || cart.tripDetails.inboundDestination || cart.tripDetails.inbound_destination || returnDestination;
      const rd = cart.tripDetails.returnDepartAt || cart.tripDetails.return_depart_at || cart.tripDetails.returnDepartureTime || cart.tripDetails.return_departure_time || null;
      const ra = cart.tripDetails.returnArriveAt || cart.tripDetails.return_arrive_at || cart.tripDetails.returnArrivalTime || cart.tripDetails.return_arrival_time || null;
      returnDepartTs = rd ? new Date(rd) : returnDepartTs;
      returnArriveTs = ra ? new Date(ra) : returnArriveTs;
    }

    if ((!returnOrigin || !returnDestination) && cart.returnOrigin && cart.returnDestination) {
      returnOrigin = cart.returnOrigin;
      returnDestination = cart.returnDestination;
      returnDepartTs = cart.returnDepartAt ? new Date(cart.returnDepartAt) : returnDepartTs;
      returnArriveTs = cart.returnArriveAt ? new Date(cart.returnArriveAt) : returnArriveTs;
    }

    // As a final fallback, try to refine outbound and return legs using
    // Postgres tripSelections raw data (same approach as the /hold route),
    // so round trips are detected even when Firestore cart data is incomplete.
    try {
      let tsRow = null;
      const tsRowsByFs = await drizzleDb
        .select({ raw: tripSelections.raw })
        .from(tripSelections)
        .where(eq(tripSelections.firestoreCartId, String(pnr)))
        .limit(1);
      if (tsRowsByFs && tsRowsByFs.length) {
        tsRow = tsRowsByFs[0];
      } else {
        const pgCartId = providedCartId || cart.busbudCartId || cart.cartId || cart.cart_id || null;
        if (pgCartId) {
          const tsRowsByCart = await drizzleDb
            .select({ raw: tripSelections.raw })
            .from(tripSelections)
            .where(eq(tripSelections.cartId, String(pgCartId)))
            .limit(1);
          if (tsRowsByCart && tsRowsByCart.length) {
            tsRow = tsRowsByCart[0];
          }
        }
      }
      if (tsRow && tsRow.raw) {
        const tsRaw = tsRow.raw;
        let tsSegments = null;

        const tsItems = Array.isArray(tsRaw.items) ? tsRaw.items : null;
        const tsItem0 = tsItems && tsItems.length ? tsItems[0] : null;
        const tsItem1 = tsItems && tsItems.length > 1 ? tsItems[1] : null;
        const tsOutSegs = tsItem0 && Array.isArray(tsItem0.segments) ? tsItem0.segments : null;
        const tsRetSegs = tsItem1 && Array.isArray(tsItem1.segments) ? tsItem1.segments : null;

        if (tsOutSegs && tsOutSegs.length) {
          const tripLegs = tsItem0 && Array.isArray(tsItem0.trip_legs) ? tsItem0.trip_legs : [];
          if (Array.isArray(tripLegs) && tripLegs.length > 1) {
            const leg1Ids = Array.isArray(tripLegs[0]?.segment_ids) ? tripLegs[0].segment_ids : null;
            const leg2Ids = Array.isArray(tripLegs[1]?.segment_ids) ? tripLegs[1].segment_ids : null;
            const outSegs = pickSegmentsByIds(tsOutSegs, leg1Ids);
            const retSegs = pickSegmentsByIds(tsOutSegs, leg2Ids);
            if (outSegs.length) {
              const first = outSegs[0];
              const last = outSegs[outSegs.length - 1];
              origin = segCityName(first, 'origin') || origin;
              destination = segCityName(last, 'destination') || destination;
              departTs = departTs || segTs(first, 'departure');
              arriveTs = arriveTs || segTs(last, 'arrival');
              if (!outboundSeg) outboundSeg = pickSegmentWithOperator(outSegs) || first;
            }
            if (retSegs.length) {
              const first = retSegs[0];
              const last = retSegs[retSegs.length - 1];
              returnOrigin = returnOrigin || segCityName(first, 'origin');
              returnDestination = returnDestination || segCityName(last, 'destination');
              returnDepartTs = returnDepartTs || segTs(first, 'departure');
              returnArriveTs = returnArriveTs || segTs(last, 'arrival');
              if (!returnSeg) returnSeg = pickSegmentWithOperator(retSegs) || first;
            }
            tsSegments = tsOutSegs;
          } else {
            const first = tsOutSegs[0];
            const last = tsOutSegs[tsOutSegs.length - 1];
            origin = segCityName(first, 'origin') || origin;
            destination = segCityName(last, 'destination') || destination;
            departTs = departTs || segTs(first, 'departure');
            arriveTs = arriveTs || segTs(last, 'arrival');
            if (!outboundSeg) outboundSeg = pickSegmentWithOperator(tsOutSegs) || first;
            tsSegments = tsOutSegs;
          }
        }

        if (tsRetSegs && tsRetSegs.length) {
          const first = tsRetSegs[0];
          const last = tsRetSegs[tsRetSegs.length - 1];
          returnOrigin = returnOrigin || segCityName(first, 'origin');
          returnDestination = returnDestination || segCityName(last, 'destination');
          returnDepartTs = returnDepartTs || segTs(first, 'departure');
          returnArriveTs = returnArriveTs || segTs(last, 'arrival');
          if (!returnSeg) returnSeg = pickSegmentWithOperator(tsRetSegs) || first;
        }

        if (!tsSegments && Array.isArray(tsRaw.items) && tsRaw.items.length && Array.isArray(tsRaw.items[0].segments)) {
          tsSegments = tsRaw.items[0].segments;
        }
        if (!tsSegments && Array.isArray(tsRaw.segments)) {
          tsSegments = tsRaw.segments;
        }
        if (!tsSegments && tsRaw.trip && Array.isArray(tsRaw.trip.segments)) {
          tsSegments = tsRaw.trip.segments;
        }
        if (!tsSegments && tsRaw.trips && typeof tsRaw.trips === 'object') {
          const tripsArr = Array.isArray(tsRaw.trips) ? tsRaw.trips : Object.values(tsRaw.trips);
          if (tripsArr.length && Array.isArray(tripsArr[0].segments)) {
            tsSegments = tripsArr[0].segments;
          }
        }
        if (Array.isArray(tsSegments) && tsSegments.length) {
          const tsOutboundSeg = tsSegments[0];
          if (tsOutboundSeg) {
            const o = (tsOutboundSeg.origin && (tsOutboundSeg.origin.city && tsOutboundSeg.origin.city.name)) || (tsOutboundSeg.origin && tsOutboundSeg.origin.name) || null;
            const d = (tsOutboundSeg.destination && (tsOutboundSeg.destination.city && tsOutboundSeg.destination.city.name)) || (tsOutboundSeg.destination && tsOutboundSeg.destination.name) || null;
            const dts = (tsOutboundSeg.departure_time && (tsOutboundSeg.departure_time.timestamp || tsOutboundSeg.departure_time)) || (tsOutboundSeg.departure && tsOutboundSeg.departure.timestamp) || null;
            const ats = (tsOutboundSeg.arrival_time && (tsOutboundSeg.arrival_time.timestamp || tsOutboundSeg.arrival_time)) || (tsOutboundSeg.arrival && tsOutboundSeg.arrival.timestamp) || null;
            if (o) origin = o;
            if (d) destination = d;
            if (dts) {
              const dDate = new Date(dts);
              if (!Number.isNaN(dDate.getTime())) {
                departTs = dDate;
              }
            }
            if (ats) {
              const aDate = new Date(ats);
              if (!Number.isNaN(aDate.getTime())) {
                arriveTs = aDate;
              }
            }
            if (!outboundSeg) outboundSeg = tsOutboundSeg;
          }
          const tsHasItem0Segs = Array.isArray(tsRaw.items) && tsRaw.items.length && tsRaw.items[0] && Array.isArray(tsRaw.items[0].segments) && tsRaw.items[0].segments.length;
          if (!tsHasItem0Segs && tsSegments.length > 1 && (!returnOrigin || !returnDestination)) {
            const tsReturnSeg = tsSegments[1];
            if (tsReturnSeg) {
              const ro = (tsReturnSeg.origin && (tsReturnSeg.origin.city && tsReturnSeg.origin.city.name)) || (tsReturnSeg.origin && tsReturnSeg.origin.name) || null;
              const rd = (tsReturnSeg.destination && (tsReturnSeg.destination.city && tsReturnSeg.destination.city.name)) || (tsReturnSeg.destination && tsReturnSeg.destination.name) || null;
              const norm = (s) => (s == null ? '' : String(s)).trim().toLowerCase();
              const looksLikeReturn = norm(ro) && norm(rd) && norm(origin) && norm(destination) && norm(ro) === norm(destination) && norm(rd) === norm(origin);
              if (looksLikeReturn) {
                const rdts = (tsReturnSeg.departure_time && (tsReturnSeg.departure_time.timestamp || tsReturnSeg.departure_time)) || (tsReturnSeg.departure && tsReturnSeg.departure.timestamp) || null;
                const rats = (tsReturnSeg.arrival_time && (tsReturnSeg.arrival_time.timestamp || tsReturnSeg.arrival_time)) || (tsReturnSeg.arrival && tsReturnSeg.arrival.timestamp) || null;
                if (ro) returnOrigin = ro;
                if (rd) returnDestination = rd;
                if (rdts) {
                  const rdDate = new Date(rdts);
                  if (!Number.isNaN(rdDate.getTime())) {
                    returnDepartTs = rdDate;
                  }
                }
                if (rats) {
                  const raDate = new Date(rats);
                  if (!Number.isNaN(raDate.getTime())) {
                    returnArriveTs = raDate;
                  }
                }
                if (!returnSeg) returnSeg = tsReturnSeg;
              }
            }
          }
        }
      }
    } catch (e) {
      logger.warn(`[${requestId}] Failed to derive trip details from Postgres tripSelections for eticket send`, { pnr, error: e.message });
    }

    const fmt2 = (n) => String(n).padStart(2, '0');
    const fmtDate = (d) => `${fmt2(d.getDate())}/${fmt2(d.getMonth() + 1)}/${d.getFullYear()}`;
    const fmtTime = (d) => `${fmt2(d.getHours())}:${fmt2(d.getMinutes())}`;
    const fmtDateTime = (d) => `${fmtDate(d)} ${fmtTime(d)}`;

    const departTime = departTs ? fmtTime(departTs) : '-';
    const arriveTime = arriveTs ? fmtTime(arriveTs) : '-';
    const departCityTime = `${origin}${departTime && departTime !== '-' ? ` ${departTime}` : ''}`;
    const arriveCityTime = `${destination}${arriveTime && arriveTime !== '-' ? ` ${arriveTime}` : ''}`;
    const departDateTime = departTs ? fmtDateTime(departTs) : '-';
    const arriveDateTime = arriveTs ? fmtDateTime(arriveTs) : '-';

    // Consider a return leg present as soon as we know return origin/destination.
    const hasReturnLeg = !!returnOrigin && !!returnDestination;
    const returnDepartTime = returnDepartTs ? fmtTime(returnDepartTs) : '-';
    const returnArriveTime = returnArriveTs ? fmtTime(returnArriveTs) : '-';
    const returnDepartDateTime = returnDepartTs ? fmtDateTime(returnDepartTs) : '-';
    const returnArriveDateTime = returnArriveTs ? fmtDateTime(returnArriveTs) : '-';
    const returnDepartCityTime = hasReturnLeg ? `${returnOrigin}${returnDepartTime && returnDepartTime !== '-' ? ` ${returnDepartTime}` : ''}` : null;
    const returnArriveCityTime = hasReturnLeg ? `${returnDestination}${returnArriveTime && returnArriveTime !== '-' ? ` ${returnArriveTime}` : ''}` : null;

    const refNo = pnr;

    let completePurchase = cart.passengerDetails && cart.passengerDetails.completePurchase;
    let refreshedPurchaseOnce = false;
    const refreshPurchaseOnce = async () => {
      if (refreshedPurchaseOnce) return completePurchase;
      refreshedPurchaseOnce = true;
      const refreshed = await refreshPurchaseForTicketNumbers({
        pnr,
        purchaseId: purchaseId || cart.purchaseId,
        purchaseUuid: purchaseUuid || cart.purchaseUuid,
        requestId,
        reason: 'eticket.send missing ticket number'
      });
      if (refreshed) {
        if (!cart.passengerDetails) cart.passengerDetails = {};
        cart.passengerDetails.completePurchase = refreshed;
        completePurchase = refreshed;
      }
      return completePurchase;
    };

    const idx = 1;

    let ticketNoForPassenger = ticketNoForPassengerIndex(completePurchase, idx - 1, null);
    if (!isValidTicketNo(ticketNoForPassenger, refNo)) {
      await refreshPurchaseOnce();
      ticketNoForPassenger = ticketNoForPassengerIndex(completePurchase, idx - 1, null);
    }
    if (!isValidTicketNo(ticketNoForPassenger, refNo)) {
      const cp = normalizeCompletePurchase(completePurchase) || completePurchase || {};
      const ticketsArr = (() => {
        try {
          const booking = cp.booking && typeof cp.booking === 'object' ? cp.booking : null;
          const raw = booking && booking.tickets;
          if (Array.isArray(raw)) return raw;
          if (raw && typeof raw === 'object') {
            if (Array.isArray(raw.items)) return raw.items;
            if (Array.isArray(raw.data)) return raw.data;
            if (Array.isArray(raw.tickets)) return raw.tickets;
            const vals = Object.values(raw).filter(Boolean);
            if (vals.length && vals.every((x) => x && typeof x === 'object')) return vals;
          }
        } catch (_) {
          return [];
        }
        return [];
      })();
      const ticketsSample = (ticketsArr || []).slice(0, 3).map((t) => (t && typeof t === 'object') ? Object.keys(t).slice(0, 30) : []);
      const itemPassengerKeys = (() => {
        try {
          const it0 = (Array.isArray(cp.items) ? (cp.items[idx - 1] || cp.items[0]) : null) || null;
          const p0 = it0 && it0.passenger ? it0.passenger : null;
          return {
            itemKeys: it0 && typeof it0 === 'object' ? Object.keys(it0).slice(0, 40) : [],
            passengerKeys: p0 && typeof p0 === 'object' ? Object.keys(p0).slice(0, 40) : [],
          };
        } catch (_) {
          return { itemKeys: [], passengerKeys: [] };
        }
      })();
      logger.warn(`[${requestId}] Missing/invalid ticket number for print`, { pnr, idx, ticketNoForPassenger, bookingTicketsCount: Array.isArray(ticketsArr) ? ticketsArr.length : 0, bookingTicketsKeysSample: ticketsSample, itemPassengerKeys });
      throw ApiError.unprocessableEntity('Ticket number missing for passenger', [
        { field: 'ticketNo', message: 'Ticket number missing or invalid', passengerIndex: idx }
      ]);
    }
    const firstPassenger = (() => {
      if (Array.isArray(cart.passengers) && cart.passengers.length) return cart.passengers[0];
      if (cart.passengerDetails) {
        if (Array.isArray(cart.passengerDetails.passengers) && cart.passengerDetails.passengers.length) return cart.passengerDetails.passengers[0];
        const cp = completePurchase;
        if (cp) {
          if (Array.isArray(cp.items) && cp.items.length && cp.items[0].passenger) return cp.items[0].passenger;
          if (cp.user) return { first_name: cp.user.first_name, last_name: cp.user.last_name, phone: cp.user.phone_number };
          if (cp.purchaser) return { first_name: cp.purchaser.first_name, last_name: cp.purchaser.last_name, phone: cp.purchaser.phone_number };
        }
      }
      if (cart.trip && Array.isArray(cart.trip.passengers) && cart.trip.passengers.length) return cart.trip.passengers[0];
      if (Array.isArray(cart.trips) && cart.trips.length && Array.isArray(cart.trips[0].passengers) && cart.trips[0].passengers.length) return cart.trips[0].passengers[0];
      if (cart.busbudResponse && Array.isArray(cart.busbudResponse.passengers) && cart.busbudResponse.passengers.length) return cart.busbudResponse.passengers[0];
      return null;
    })();

    let pgPassengers = null;
    try {
      const idRows = await drizzleDb
        .select({ passengers: cartPassengerDetails.passengers })
        .from(cartPassengerDetails)
        .where(eq(cartPassengerDetails.firestoreCartId, String(pnr)))
        .limit(1);
      if (idRows && idRows.length && Array.isArray(idRows[0].passengers)) {
        pgPassengers = idRows[0].passengers;
      }
    } catch (e) {
      logger.warn(`[${requestId}] Failed to load passenger IDs from Postgres cartPassengerDetails`, { pnr, error: e.message });
    }
    const babyOnLap = cart.babyOnLap ? 'YES' : 'NO';
    const operatorName = (() => {
      const clean = (val) => {
        if (val == null) return null;
        const s = String(val).trim();
        if (!s || s === '-' || s.toLowerCase() === 'unknown') return null;
        return s;
      };
      const pickName = (op) => {
        if (!op) return null;
        if (typeof op === 'string') return clean(op);
        return clean(
          op.name ||
          op.operator_name ||
          op.operatorName ||
          op.label ||
          op.xid ||
          op.code ||
          op.id
        );
      };
      const busbudOperators = (() => {
        const resp = cart.busbudResponse || {};
        const direct = Array.isArray(resp.operators) ? resp.operators : [];
        const nested = resp.data && Array.isArray(resp.data.operators) ? resp.data.operators : [];
        const single = resp.operator ? [resp.operator] : [];
        return [...direct, ...nested, ...single];
      })();
      const miscOperators = Array.isArray(cart.operators) ? cart.operators : [];
      const fromCart =
        clean(cart.operatorName || cart.operator_name) ||
        clean(cart.trip && (cart.trip.operatorName || cart.trip.operator_name)) ||
        clean(cart.tripDetails && (cart.tripDetails.operatorName || cart.tripDetails.operator || cart.tripDetails.operator_name)) ||
        clean(cart.operator && (cart.operator.operatorName || cart.operator.operator_name)) ||
        pickName(cart.operator) ||
        pickName(cart.trip && cart.trip.operator) ||
        pickName(cart.tripDetails && cart.tripDetails.operator) ||
        pickName(miscOperators.find((op) => pickName(op))) ||
        pickName(Object.values(cart.trips || {}).find((trip) => pickName(trip && trip.operator))) ||
        pickName(Array.isArray(cart.tripSelections) ? cart.tripSelections.find((sel) => pickName(sel && sel.operator)) : null) ||
        null;
      if (fromCart) return fromCart;

      const seg = outboundSeg || {};
      const segOpName = pickName(seg.operator);
      if (segOpName) return segOpName;

      const candidateSegWithOperator = (() => {
        try {
          const rawItems = cart.trip && cart.trip._raw && Array.isArray(cart.trip._raw.items) ? cart.trip._raw.items : null;
          const rawItem0 = rawItems && rawItems.length ? rawItems[0] : null;
          const rawSegs = rawItem0 && Array.isArray(rawItem0.segments) ? rawItem0.segments : null;
          const bb = cart.busbudResponse || {};
          const bbSegs = Array.isArray(bb.segments)
            ? bb.segments
            : (bb.trip && Array.isArray(bb.trip.segments)
              ? bb.trip.segments
              : null);
          const segs = (Array.isArray(rawSegs) && rawSegs.length)
            ? rawSegs
            : ((Array.isArray(cart.segments) && cart.segments.length)
              ? cart.segments
              : ((Array.isArray(bbSegs) && bbSegs.length) ? bbSegs : []));
          if (!Array.isArray(segs) || !segs.length) return null;
          return pickSegmentWithOperator(segs) || segs[0] || null;
        } catch (_) {
          return null;
        }
      })();

      if (candidateSegWithOperator) {
        const opName = pickName(candidateSegWithOperator.operator);
        if (opName) return opName;
        const direct = clean(candidateSegWithOperator.operator_name || candidateSegWithOperator.operatorName);
        if (direct) return direct;
      }

      const segOperatorId = (() => {
        if (!seg) return null;
        if (seg.operator_id || seg.operatorId) return clean(seg.operator_id || seg.operatorId);
        const op = seg.operator;
        if (op && (op.id || op.operator_id || op.operatorId || op.xid)) {
          return clean(op.id || op.operator_id || op.operatorId || op.xid);
        }
        return null;
      })();
      if (segOperatorId && busbudOperators.length) {
        const found = busbudOperators.find((op) => {
          const opId = op && (op.id || op.operator_id || op.operatorId || op.xid);
          if (!opId) return false;
          return String(opId).toLowerCase() === String(segOperatorId).toLowerCase();
        });
        const foundName = pickName(found);
        if (foundName) return foundName;
      }

      const busbudFallback = pickName(busbudOperators.find((op) => pickName(op)));
      if (busbudFallback) return busbudFallback;

      return '-';
    })();
    const bookedBy = (await resolveBookedByFromPostgres(pnr)) || 'online';
    const bookingSource = cart.bookingSource || 'Online';
    const agentBooking = (() => {
      try {
        const modeHdr = (req.get && req.get('x-agent-mode')) || (req.headers && req.headers['x-agent-mode']);
        if (modeHdr && String(modeHdr).toLowerCase() === 'true') return true;
        const hdrName = (req.get && req.get('x-agent-name')) || (req.headers && req.headers['x-agent-name']);
        const hdrEmail = (req.get && req.get('x-agent-email')) || (req.headers && req.headers['x-agent-email']);
        const hdrId = (req.get && req.get('x-agent-id')) || (req.headers && req.headers['x-agent-id']);
        if (hdrName || hdrEmail || hdrId) return true;
        const qMode = (req.query && (req.query.agentMode || req.query.agent_mode));
        if (qMode && String(qMode).toLowerCase() === 'true') return true;
        const base = cart || {};
        const baseMode = base.agentMode === true || String(base.agentMode).toLowerCase() === 'true' || (base.agent && (base.agent.agentMode === true || String(base.agent.agentMode).toLowerCase() === 'true'));
        if (baseMode) return true;
      } catch (_) {}
      return false;
    })();
    const showBookingSource = (() => {
      if (agentBooking) return false;
      if (!bookingSource) return false;
      const norm = (v) => (v == null ? '' : String(v).trim().toLowerCase());
      const bs = norm(bookingSource);
      if (!bs) return false;
      if (bs === 'online') return false;
      if (bs === norm(bookedBy)) return false;
      return true;
    })();
    const normalizeTs = (ts) => {
      try {
        if (!ts) return null;
        if (typeof ts === 'string') return new Date(ts);
        if (ts._seconds) return new Date(ts._seconds * 1000 + (ts._nanoseconds || 0) / 1e6);
        if (ts.seconds) return new Date(ts.seconds * 1000);
        if (typeof ts.toDate === 'function') return ts.toDate();
        if (ts instanceof Date) return ts;
        return null;
      } catch (_) { return null; }
    };
    const rawTs = (completePurchase && (completePurchase.completed_at || completePurchase.completedAt || completePurchase.created_at || completePurchase.createdAt)) ||
                  cart.bookingTimestamp || cart.createdAt || cart.updatedAt || new Date();
    const tsDate = normalizeTs(rawTs) || new Date();
    const bookingTimestamp = `${tsDate.getFullYear()}-${fmt2(tsDate.getMonth()+1)}-${fmt2(tsDate.getDate())} ${fmt2(tsDate.getHours())}:${fmt2(tsDate.getMinutes())}:${fmt2(tsDate.getSeconds())}`;

    const priceNumber = (() => {
      // 0) If the frontend has already stored an adjusted total on the cart,
      // always prefer that so the e-ticket matches the UI exactly.
      if (typeof cart.totalAmount === 'number') return cart.totalAmount;
      if (typeof cart.totalAmount === 'string' && cart.totalAmount.trim()) {
        const m = String(cart.totalAmount).match(/[0-9]+(?:\.[0-9]+)?/);
        if (m) return parseFloat(m[0]);
      }

      const pricingMeta = (cart.passengerDetails && cart.passengerDetails.pricing_metadata) || cart.pricing_metadata;
      if (pricingMeta) {
        if (typeof pricingMeta.canonical_adjusted_total_cents === 'number' && pricingMeta.canonical_adjusted_total_cents > 0) {
          return pricingMeta.canonical_adjusted_total_cents / 100;
        }
        if (typeof pricingMeta.adjusted_total === 'number' && pricingMeta.adjusted_total > 0) {
          return pricingMeta.adjusted_total / 100;
        }
      }

      if (cart.invoice) {
        const inv = cart.invoice;
        if (typeof inv.amount_total === 'number') return inv.amount_total;
        if (typeof inv.amount_total === 'string') {
          const m = inv.amount_total.match(/[0-9]+(?:\.[0-9]+)?/);
          if (m) return parseFloat(m[0]);
        }
        if (typeof inv.amount_untaxed === 'number') return inv.amount_untaxed;
        if (typeof inv.amount_untaxed === 'string') {
          const m = inv.amount_untaxed.match(/[0-9]+(?:\.[0-9]+)?/);
          if (m) return parseFloat(m[0]);
        }
        if (typeof inv.total === 'number') return inv.total;
        if (typeof inv.total === 'string') {
          const m = inv.total.match(/[0-9]+(?:\.[0-9]+)?/);
          if (m) return parseFloat(m[0]);
        }
      }
      // Detect preferred currency for adjustments
      const prefCur = (() => {
        const cp = completePurchase;
        if (cp) {
          if (cp.charges && cp.charges.currency) return cp.charges.currency;
          const cpItem0 = Array.isArray(cp.items) && cp.items[0];
          if (cpItem0 && cpItem0.display_price && cpItem0.display_price.currency) return cpItem0.display_price.currency;
          if (cp.trips) {
            try {
              const anyTrip = Object.values(cp.trips)[0];
              if (anyTrip && Array.isArray(anyTrip.prices) && anyTrip.prices[0]) {
                const p0 = anyTrip.prices[0];
                if (p0.prices && p0.prices.currency) return p0.prices.currency;
                if (p0.details && p0.details.public_price_group && p0.details.public_price_group.prices && p0.details.public_price_group.prices.currency) return p0.details.public_price_group.prices.currency;
              }
            } catch (_) { /* noop */ }
          }
        }
        if (cart.summary && cart.summary.currency) return cart.summary.currency;
        if (cart.apiMetadata && cart.apiMetadata.currency) return cart.apiMetadata.currency;
        if (cart.trip && cart.trip.currency) return cart.trip.currency;
        return 'USD';
      })();
      const adjust = (base, cur) => {
        const b = typeof base === 'number' ? base : parseFloat(String(base).match(/[0-9]+(?:\.[0-9]+)?/)?.[0] || 'NaN');
        if (isNaN(b)) return null;
        try {
          const adj = applyPriceAdjustments(b, { currency: cur || prefCur, returnMetadata: true });
          if (adj && typeof adj.adjustedAmount === 'number') return adj.adjustedAmount;
        } catch (_) { /* noop */ }
        return b;
      };

      const directCartAmount = (() => {
        if (typeof cart.totalAmount === 'number' && Number.isFinite(cart.totalAmount) && cart.totalAmount > 0) return cart.totalAmount;
        if (typeof cart.totalPrice === 'number' && Number.isFinite(cart.totalPrice) && cart.totalPrice > 0) return cart.totalPrice;
        if (typeof cart.total === 'number' && Number.isFinite(cart.total) && cart.total > 0) return cart.total;
        if (typeof cart.totalAmount === 'string' && cart.totalAmount.trim()) {
          const m = String(cart.totalAmount).match(/[0-9]+(?:\.[0-9]+)?/);
          if (m) {
            const n = parseFloat(m[0]);
            if (Number.isFinite(n) && n > 0) return n;
          }
        }
        return null;
      })();
      if (directCartAmount != null) return directCartAmount;

      // Prefer completePurchase totals
      const cp = completePurchase;
      if (cp) {
        if (cp.charges) {
          const ch = cp.charges;
          if (ch.amount != null) {
            const v = adjust(ch.amount / 100, ch.currency);
            if (v != null) return v;
          }
          if (ch.subtotal != null) {
            const v = adjust(ch.subtotal / 100, ch.currency);
            if (v != null) return v;
          }
          if (ch.total != null) {
            const v = adjust(ch.total / 100, ch.currency);
            if (v != null) return v;
          }
        }
        const cpItem = Array.isArray(cp.items) && cp.items.length ? cp.items[0] : null;
        if (cpItem && cpItem.display_price) {
          const dp = cpItem.display_price;
          if (dp.amount != null) {
            const v = adjust(dp.amount / 100, dp.currency);
            if (v != null) return v;
          }
          if (dp.total != null) {
            const v = adjust(dp.total / 100, dp.currency);
            if (v != null) return v;
          }
        }
        if (cp.trips) {
          try {
            const tripsArr = Object.values(cp.trips);
            for (const t of tripsArr) {
              if (!t) continue;
              if (Array.isArray(t.prices) && t.prices.length) {
                const p0 = t.prices[0];
                if (p0 && p0.prices) {
                  const cur = p0.prices.currency;
                  if (p0.prices.total != null) {
                    const v = adjust(p0.prices.total / 100, cur);
                    if (v != null) return v;
                  }
                }
                const ppg = p0 && p0.details && p0.details.public_price_group && p0.details.public_price_group.prices;
                if (ppg) {
                  const cur = ppg.currency;
                  if (ppg.total != null) {
                    const v = adjust(ppg.total / 100, cur);
                    if (v != null) return v;
                  }
                }
              }
            }
          } catch (_) { /* noop */ }
        }
      }
      const pdOrig = cart.passengerDetails && cart.passengerDetails.busbudResponse && (cart.passengerDetails.busbudResponse.cost_price || cart.passengerDetails.busbudResponse.original_charges || (cart.passengerDetails.busbudResponse.retail_price && cart.passengerDetails.busbudResponse.retail_price.metadata && cart.passengerDetails.busbudResponse.retail_price.metadata.original_charges) || (cart.passengerDetails.busbudResponse.adjusted_charges && cart.passengerDetails.busbudResponse.adjusted_charges.metadata && cart.passengerDetails.busbudResponse.adjusted_charges.metadata.original_charges));
      if (pdOrig && typeof pdOrig.total === 'number') {
        const base = pdOrig.total / 100;
        const adj = applyPriceAdjustments(base, { currency: pdOrig.currency || 'USD', returnMetadata: true });
        if (adj && typeof adj.adjustedAmount === 'number') return adj.adjustedAmount;
        return base;
      }
      if (pdOrig && typeof pdOrig.total === 'string') {
        const m = pdOrig.total.match(/[0-9]+(?:\.[0-9]+)?/);
        if (m) {
          const baseCents = parseFloat(m[0]);
          const base = baseCents / 100;
          const adj = applyPriceAdjustments(base, { currency: pdOrig.currency || 'USD', returnMetadata: true });
          if (adj && typeof adj.adjustedAmount === 'number') return adj.adjustedAmount;
          return base;
        }
      }
      const pdChargesFlat = cart.passengerDetails && cart.passengerDetails.busbudResponse && cart.passengerDetails.busbudResponse.charges;
      if (pdChargesFlat) {
        if (pdChargesFlat.total != null) {
          const base = typeof pdChargesFlat.total === 'number' ? (pdChargesFlat.total / 100) : pdChargesFlat.total;
          const v = adjust(base, pdChargesFlat.currency);
          if (v != null) return v;
        }
      }
      if (cart.invoice_data && typeof cart.invoice_data.amount_total === 'number') return cart.invoice_data.amount_total;
      if (cart.invoice_data && typeof cart.invoice_data.amount_total === 'string') {
        const m = cart.invoice_data.amount_total.match(/[0-9]+(?:\.[0-9]+)?/);
        if (m) return parseFloat(m[0]);
      }
      if (typeof cart.totalPrice === 'number') return cart.totalPrice;
      if (typeof cart.total === 'number') return cart.total;
      if (cart.tripDetails && typeof cart.tripDetails.price === 'number') return cart.tripDetails.price;
      if (cart.tripDetails && typeof cart.tripDetails.price_total === 'number') return cart.tripDetails.price_total;
      if (typeof cart.finalTotal === 'number') return cart.finalTotal;
      if (typeof cart.final_total === 'number') return cart.final_total;
      if (typeof cart.totalPrice === 'string' && cart.totalPrice.trim()) {
        const m = String(cart.totalPrice).match(/[0-9]+(?:\.[0-9]+)?/);
        if (m) return parseFloat(m[0]);
      }
      if (typeof cart.total === 'string' && cart.total.trim()) {
        const m = String(cart.total).match(/[0-9]+(?:\.[0-9]+)?/);
        if (m) return parseFloat(m[0]);
      }
      if (cart.price && (typeof cart.price.total === 'number' || typeof cart.price.total === 'string')) {
        const v = adjust(cart.price.total);
        if (v != null) return v;
      }
      const pdCharges = cart.passengerDetails && cart.passengerDetails.busbudResponse && (cart.passengerDetails.busbudResponse.retail_price || cart.passengerDetails.busbudResponse.adjusted_charges);
      if (pdCharges && typeof pdCharges.total === 'number') return pdCharges.total / 100;
      const bbAdj = cart.busbudResponse && (
        cart.busbudResponse.retail_price ||
        cart.busbudResponse.adjusted_charges ||
        (cart.busbudResponse.charges && (cart.busbudResponse.charges.retail_price || cart.busbudResponse.charges.adjusted_charges))
      );
      if (bbAdj && typeof bbAdj.total === 'number') return bbAdj.total / 100;
      const bbOrig = cart.busbudResponse && (cart.busbudResponse.cost_price || cart.busbudResponse.original_charges);
      if (bbOrig && typeof bbOrig.total === 'number') {
        const base = bbOrig.total / 100;
        const adj = applyPriceAdjustments(base, { currency: bbOrig.currency || 'USD', returnMetadata: true });
        if (adj && typeof adj.adjustedAmount === 'number') return adj.adjustedAmount;
        return base;
      }
      const bbCharges = cart.busbudResponse && cart.busbudResponse.charges;
      if (bbCharges && typeof bbCharges.total === 'number') return bbCharges.total / 100;
      const fare0 = cart.busbudResponse && cart.busbudResponse.fares && cart.busbudResponse.fares[0];
      const fAmtRaw = fare0 && (fare0.price && fare0.price.total && (fare0.price.total.amount || fare0.price.total) || fare0.total_price && (fare0.total_price.amount || fare0.total_price) || fare0.amount || fare0.price);
      if (fAmtRaw != null) {
        const v = adjust(fAmtRaw, (fare0 && fare0.price && fare0.price.currency) || (fare0 && fare0.total_price && fare0.total_price.currency));
        if (v != null) return v;
      }
      return null;
    })();
    const paymentMethod = cart.paymentMethod || 'Online';
    const contactInfo = process.env.SUPPORT_PHONE || '+263 867790 0600';

    let attachments = [];
    let usedStoredTicketAttachments = false;
    let logoDataUri = null;
    try {
      const logoPath = process.env.ETICKET_LOGO_PATH;
      if (logoPath) {
        const logoBuffer = fs.readFileSync(logoPath);
        const ext = path.extname(String(logoPath)).toLowerCase();
        const logoMime = ext === '.png'
          ? 'image/png'
          : (ext === '.svg' ? 'image/svg+xml' : 'image/jpeg');
        logoDataUri = `data:${logoMime};base64,${logoBuffer.toString('base64')}`;
      }
    } catch (e) {
      logger.warn(`[${requestId}] Failed to load logo for e-ticket`, { error: e.message });
    }

    try {
      const cachedZip = await getCachedTicketPdfFromPostgres(pnr, 'final_zip');
      if (cachedZip && cachedZip.length) {
        try {
          const zip = new AdmZip(cachedZip);
          const entries = zip.getEntries() || [];
          const extracted = [];
          for (const entry of entries) {
            if (!entry || entry.isDirectory) continue;
            const entryName = entry.entryName ? String(entry.entryName) : '';
            if (!entryName || !/\.pdf$/i.test(entryName)) continue;
            const buf = entry.getData();
            if (!looksLikePdfBuffer(buf)) continue;
            extracted.push({
              filename: path.basename(entryName),
              content: buf,
              contentType: 'application/pdf'
            });
          }
          if (extracted.length) {
            attachments = extracted;
            usedStoredTicketAttachments = true;
          }
        } catch (_) {
          // ignore
        }
      }

      if (!usedStoredTicketAttachments) {
        const cachedFinal = await getCachedTicketPdfFromPostgres(pnr, 'final');
        if (cachedFinal && looksLikePdfBuffer(cachedFinal)) {
          attachments = [
            {
              filename: `eticket-${String(pnr)}.pdf`,
              content: cachedFinal,
              contentType: 'application/pdf'
            }
          ];
          usedStoredTicketAttachments = true;
        }
      }
    } catch (_) {
      // ignore
    }
      const passengersList = (() => {
        const cp = completePurchase;
        const fromCartPassengers = Array.isArray(cart.passengers) ? cart.passengers : [];
        if (fromCartPassengers.length && !hasReturnLeg) return fromCartPassengers;
        // Use only completePurchase items as the passenger source
        const fromRequired = Array.isArray(cart.requiredPassengers) ? cart.requiredPassengers : [];
        const fromSelected = !fromRequired.length && Array.isArray(cart.selectedPassengers) ? cart.selectedPassengers : [];
        const fromCP = (() => {
          if (!cp || !Array.isArray(cp.items)) return [];
          const out = [];
          for (const it of cp.items) {
            if (it && it.passenger) out.push(it.passenger);
          }
          return out;
        })();
        const candidates = (hasReturnLeg ? [fromCP, fromSelected, fromRequired] : [fromRequired, fromSelected, fromCP])
          .filter(arr => Array.isArray(arr) && arr.length);
        const source = candidates.length ? candidates[0] : [];
        if (!source.length) {
          logger.warn(`[${requestId}] No passengers found for e-ticket email`, { pnr, cartId });
          return [];
        }

        // If we have canonical passengers on the cart, do not de-duplicate by name/doc/seat.
        // De-duping can remove legitimate passengers who share identical metadata.
        if (Array.isArray(cart.passengers) && cart.passengers.length && !hasReturnLeg) {
          return source;
        }

        const normalize = (s) => typeof s === 'string' ? s.trim().toLowerCase() : (s == null ? '' : String(s).trim().toLowerCase());
        const normalizeDocCandidate = (val) => {
          if (val == null) return '';
          const raw = String(val).trim();
          if (!raw) return '';
          const looksUuidish = raw.length >= 16 && (raw.includes('-') || raw.includes('_') || /^[a-f0-9-]{16,}$/i.test(raw));
          if (looksUuidish) return '';
          if (/^[0-9]+$/.test(raw) && raw.length <= 4) return '';
          return raw;
        };
        const firstName = (p = {}) => p.first_name || p.firstName || p.given_name || p.givenName || p.name_first || '';
        const lastName = (p = {}) => p.last_name || p.lastName || p.family_name || p.familyName || p.name_last || '';
        const docNo = (p = {}) => {
          if (p.idNumber || p.id_number || p.id_no) return p.idNumber || p.id_number || p.id_no;
          if (p.passport || p.passport_number) return p.passport || p.passport_number;
          if (p.documentNumber || p.document_no) return p.documentNumber || p.document_no;
          if (Array.isArray(p.documents)) {
            const d = p.documents.find(d => d && (d.number || d.value || d.id));
            if (d) {
              if (d.number) return normalizeDocCandidate(d.number);
              if (d.value) return normalizeDocCandidate(d.value);
              if (d.id !== undefined && d.id !== null) {
                return normalizeDocCandidate(d.id);
              }
            }
          }
          if (p.id !== undefined && p.id !== null) {
            return normalizeDocCandidate(p.id);
          }
          return '';
        };
        const seatRaw = (p = {}) => {
          const ss = p && p.selected_seats && p.selected_seats[0];
          if (ss) {
            if (typeof ss.seat === 'string') return ss.seat;
            if (ss.seat && (ss.seat.label || ss.seat.code || ss.seat.name || ss.seat.id)) return ss.seat.label || ss.seat.code || ss.seat.name || ss.seat.id;
            if (ss.seat_id) return ss.seat_id;
          }
          if (p && (p.seat || p.seat_id || p.selectedSeat)) {
            if (typeof p.seat === 'string') return p.seat;
            if (p.seat && (p.seat.label || p.seat.code || p.seat.name || p.seat.id)) return p.seat.label || p.seat.code || p.seat.name || p.seat.id;
            if (p.selectedSeat) return p.selectedSeat;
            if (p.seat_id) return p.seat_id;
          }
          if (p && p.ticket && (p.ticket.seat || p.ticket.seat_id)) return p.ticket.seat || p.ticket.seat_id;
          return '';
        };
        const keyFor = (p = {}) => {
          const doc = docNo(p);
          const base = [firstName(p), lastName(p), doc].map(normalize).filter(Boolean);
          if (!base.length) {
            const fallback = [seatRaw(p)].map(normalize).filter(Boolean);
            return fallback.join('|');
          }
          if (!hasReturnLeg && !doc) {
            base.push(normalize(seatRaw(p)));
          }
          return base.filter(Boolean).join('|');
        };
        const uniq = [];
        const seen = new Set();
        for (const px of source) {
          const k = keyFor(px);
          if (!k) { uniq.push(px); continue; }
          if (seen.has(k)) continue;
          seen.add(k);
          uniq.push(px);
        }
        return uniq;
      })();
      const nameFor = (p = {}) => ([
        p.first_name || p.firstName || p.given_name || p.givenName || p.name_first,
        p.last_name || p.lastName || p.family_name || p.familyName || p.name_last
      ].filter(Boolean).join(' '));
      const idFor = (p = {}, index = 0) => {
        const fromPg = (() => {
          if (!Array.isArray(pgPassengers) || !pgPassengers.length) return null;
          const cand = pgPassengers[index] || pgPassengers[0] || {};
          const direct = cand.idNumber || cand.id_number || cand.id_no || cand.id || cand.passport || cand.passport_number || cand.nationalId || cand.national_id || cand.documentNumber || cand.document_no;
          if (direct) return direct;
          if (Array.isArray(cand.documents) && cand.documents.length) {
            const doc = cand.documents.find(d => d && (d.number || d.value || d.id));
            if (doc) return doc.number || doc.value || doc.id;
          }
          return null;
        })();
        if (fromPg) return fromPg;

        const direct = p.idNumber || p.id_number || p.id_no || p.passport || p.passport_number || p.nationalId || p.national_id || p.documentNumber || p.document_no;
        if (direct) return direct;
        if (Array.isArray(p.documents) && p.documents.length) {
          const doc = p.documents.find(d => d && (d.number || d.value || d.id));
          if (doc) return doc.number || doc.value || doc.id;
        }
        const pr = purchaser || {};
        const ci = cart.contact_info || cart.contactInfo || {};
        return pr.idNumber || pr.id_number || pr.id_no || pr.passport || pr.passport_number || pr.nationalId || pr.national_id || pr.documentNumber || pr.document_no ||
               ci.idNumber || ci.id_number || ci.id_no || ci.passport || ci.passport_number || ci.nationalId || ci.national_id || ci.documentNumber || ci.document_no || '-';
      };
      const phoneFor = (p = {}) => p.phone || p.phoneNumber || (cart.contact_info && cart.contact_info.phone) || (cart.contactInfo && cart.contactInfo.phone) || (purchaser && (purchaser.phone || purchaser.phoneNumber)) || '-';
      const expectedCount = (() => {
        const pgLen = Array.isArray(pgPassengers) ? pgPassengers.length : 0;
        if (pgLen > 0) return pgLen;

        const purchaseCount = (() => {
          try {
            const cp = normalizeCompletePurchase(completePurchase) || completePurchase || {};
            const items = Array.isArray(cp.items) ? cp.items : [];
            if (!items.length) return null;

            const ticketItems = items.filter((it) => {
              if (!it || typeof it !== 'object') return false;
              const t = it.type || it.item_type || it.itemType || null;
              return t != null && String(t).toLowerCase() === 'ticket';
            });
            if (!ticketItems.length) return null;

            const normalize = (s) => typeof s === 'string' ? s.trim().toLowerCase() : (s == null ? '' : String(s).trim().toLowerCase());
            const normalizeDocCandidate = (val) => {
              if (val == null) return '';
              const raw = String(val).trim();
              if (!raw) return '';
              const looksUuidish = raw.length >= 16 && (raw.includes('-') || raw.includes('_') || /^[a-f0-9-]{16,}$/i.test(raw));
              if (looksUuidish) return '';
              if (/^[0-9]+$/.test(raw) && raw.length <= 4) return '';
              return raw;
            };
            const firstName = (p = {}) => p.first_name || p.firstName || p.given_name || p.givenName || p.name_first || '';
            const lastName = (p = {}) => p.last_name || p.lastName || p.family_name || p.familyName || p.name_last || '';
            const docNo = (p = {}) => {
              if (p.idNumber || p.id_number || p.id_no) return p.idNumber || p.id_number || p.id_no;
              if (p.passport || p.passport_number) return p.passport || p.passport_number;
              if (p.documentNumber || p.document_no) return p.documentNumber || p.document_no;
              if (Array.isArray(p.documents)) {
                const d = p.documents.find(d => d && (d.number || d.value));
                if (d) return normalizeDocCandidate(d.number || d.value);
              }
              return '';
            };
            const keyFor = (p = {}) => {
              const doc = docNo(p);
              const base = [firstName(p), lastName(p), doc].map(normalize).filter(Boolean);
              return base.join('|');
            };

            const seen = new Set();
            for (const it of ticketItems) {
              const p = (it && (it.passenger || it.traveler || (it.details && (it.details.passenger || it.details.traveler)))) || null;
              if (!p) continue;
              const k = keyFor(p);
              if (!k) continue;
              seen.add(k);
            }

            const unique = seen.size;
            if (unique > 0) return unique;

            const n = ticketItems.length;
            if (Number.isFinite(n) && n > 0) {
              if (hasReturnLeg && n % 2 === 0) return Math.floor(n / 2);
              return n;
            }
            return null;
          } catch (_) {
            return null;
          }
        })();
        if (purchaseCount != null && purchaseCount > 0) return purchaseCount;

        const explicitCount = (typeof cart.passengerCount === 'number' && cart.passengerCount > 0)
          ? cart.passengerCount
          : (cart.summary && typeof cart.summary.passengerCount === 'number' && cart.summary.passengerCount > 0)
            ? cart.summary.passengerCount
            : null;
        if (explicitCount != null) return explicitCount;

        const rpLen = Array.isArray(cart.requiredPassengers) ? cart.requiredPassengers.length : 0;
        if (rpLen > 0) {
          return rpLen;
        }
        const spLen = Array.isArray(cart.selectedPassengers) ? cart.selectedPassengers.length : 0;
        if (spLen > 0) {
          return spLen;
        }
        if (Array.isArray(passengersList) && passengersList.length) {
          return passengersList.length;
        }
        return null;
      })();
      const baseList = passengersList.length ? passengersList : (firstPassenger ? [firstPassenger] : []);

      const canonicalBaseList = (() => {
        try {
          if (!hasReturnLeg) return baseList;
          if (!Array.isArray(baseList) || baseList.length === 0) return baseList;

          const normalize = (s) => typeof s === 'string' ? s.trim().toLowerCase() : (s == null ? '' : String(s).trim().toLowerCase());
          const firstName = (p = {}) => p.first_name || p.firstName || p.given_name || p.givenName || p.name_first || '';
          const lastName = (p = {}) => p.last_name || p.lastName || p.family_name || p.familyName || p.name_last || '';
          const keyFor = (p = {}) => [firstName(p), lastName(p)].map(normalize).filter(Boolean).join('|');

          const uniq = [];
          const seen = new Set();
          for (const px of baseList) {
            const k = keyFor(px);
            if (!k) continue;
            if (seen.has(k)) continue;
            seen.add(k);
            uniq.push(px);
            if (uniq.length >= expectedCount) break;
          }
          if (expectedCount && uniq.length === expectedCount) return uniq;
          if (baseList.length % 2 === 0 && uniq.length === (baseList.length / 2)) return uniq;
          if (expectedCount && expectedCount % 2 === 0 && uniq.length === (expectedCount / 2)) return uniq;
          return baseList;
        } catch (_) {
          return baseList;
        }
      })();

      const list = expectedCount ? canonicalBaseList.slice(0, expectedCount) : canonicalBaseList;

      try {
        const expectedTicketsCount = hasReturnLeg ? ((list && list.length ? list.length : 1) * 2) : (list && list.length ? list.length : 1);
        logger.info(`[${requestId}] E-ticket passenger resolution`, {
          pnr,
          hasReturnLeg,
          resolvedPassengerCount: Array.isArray(list) ? list.length : 0,
          expectedTicketsCount,
          usedStoredTicketAttachments
        });
      } catch (_) {
      }

      try {
        const pdfAttachmentsCount = Array.isArray(attachments)
          ? attachments.filter((a) => a && a.content && looksLikePdfBuffer(a.content)).length
          : 0;
        const expectedTicketsCount = hasReturnLeg ? ((list && list.length ? list.length : 1) * 2) : (list && list.length ? list.length : 1);
        if (usedStoredTicketAttachments && pdfAttachmentsCount > 0 && expectedTicketsCount > 0 && pdfAttachmentsCount !== expectedTicketsCount) {
          usedStoredTicketAttachments = false;
          attachments = [];
        }
      } catch (_) {
      }
      if (!Array.isArray(list) || list.length === 0) {
        logger.warn(`[${requestId}] No passenger list resolved for e-ticket; sending fallback email`, { pnr, cartId });
        const fallbackHtml = `<div><h2>${purchaserName ? `Hi ${purchaserName},` : 'Hello,'}</h2><p>Your purchase has been completed successfully and your e-ticket is ready.</p><p><strong>PNR:</strong> ${pnr}</p><p><strong>Cart ID:</strong> ${cartId}</p><p>View your ticket here: <a href="${viewLink}">Open ticket</a></p><p><small>Download PDF: <a href="${pdfDownloadLink}">Download</a></small></p><p><small>Alternative link: <a href="${downloadLink}">View booking</a></small></p></div>`;
        await sendEmail({
          to: purchaserEmail,
          subject: `Your E-ticket is ready${cart.bookingRef ? ` - Ref ${cart.bookingRef}` : ''}`,
          html: fallbackHtml
        });
        const responseTime = Date.now() - startTime;
        logger.info(`ðŸŽ« [${requestId}] E-ticket fallback email sent`, { pnr, to: purchaserEmail, cartId, responseTime: `${responseTime}ms` });
        return res.json({
          success: true,
          pnr,
          cartId,
          sentTo: purchaserEmail,
          requestId,
          timestamp: new Date().toISOString()
        });
      }
      const toNumSimple = (v) => (typeof v === 'number') ? v : (typeof v === 'string' ? parseFloat(String(v).match(/[0-9]+(?:\.[0-9]+)?/)?.[0] || 'NaN') : NaN);
      const invoiceTotal = (() => {
        const a = toNumSimple(cart.invoice && cart.invoice.amount_total);
        if (Number.isFinite(a)) return a;
        const b = toNumSimple(cart.invoice_data && cart.invoice_data.amount_total);
        if (Number.isFinite(b)) return b;
        const c = toNumSimple(cart.invoice && cart.invoice.total);
        if (Number.isFinite(c)) return c;
        const d = toNumSimple(cart.invoice && cart.invoice.amount_untaxed);
        if (Number.isFinite(d)) return d;
        return NaN;
      })();
      const totalForDivision = (priceNumber != null && Number.isFinite(Number(priceNumber)))
        ? Number(priceNumber)
        : (Number.isFinite(invoiceTotal)
          ? invoiceTotal
          : (Number.isFinite(toNumSimple(cart.totalPrice)) ? toNumSimple(cart.totalPrice)
          : (Number.isFinite(toNumSimple(cart.total)) ? toNumSimple(cart.total) : 0)));
      const passengerCount = list.length || 1;
      const perPassengerPrice = Number(totalForDivision / passengerCount);
      const perPassengerTotals = computePerPassengerTotals({ passengers: list, completePurchase, totalMajor: totalForDivision });
      const roundTripPassengerPricesArePerLeg = (() => {
        try {
          if (!hasReturnLeg) return false;
          if (!Array.isArray(perPassengerTotals) || !perPassengerTotals.length) return false;
          const sum = perPassengerTotals.reduce((acc, v) => acc + (Number.isFinite(Number(v)) ? Number(v) : 0), 0);
          if (!Number.isFinite(sum) || sum <= 0) return false;
          if (!Number.isFinite(Number(totalForDivision)) || Number(totalForDivision) <= 0) return false;
          const tol = Math.max(0.05, (list.length || 1) * 0.05);
          const diffTotal = Math.abs(sum - Number(totalForDivision));
          const diffLeg = Math.abs(sum * 2 - Number(totalForDivision));
          if (diffLeg <= tol && diffLeg < diffTotal) return true;
          return false;
        } catch (_) {
          return false;
        }
      })();
      let cardsPdfHtml = '';
      const cardsPdfHtmlByPassenger = [];
      const cardsPdfHtmlByPassengerOutbound = [];
      const cardsPdfHtmlByPassengerReturn = [];
      const apiBase = process.env.PUBLIC_API_BASE_URL || process.env.INTERNAL_API_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

      for (let idx = 0; idx < list.length; idx++) {
        const p = list[idx];
        const pName = nameFor(p) || bookedBy || purchaserName || '-';
        const pPhone = phoneFor(p);
        const pId = idFor(p, idx);
        const ticketNoForPassengerLegAt = (legKey) => ticketNoForPassengerLeg(completePurchase, idx, legKey, list.length, p);
        let ticketNoOutbound = ticketNoForPassengerLegAt('outbound');
        if (!isValidTicketNo(ticketNoOutbound, refNo)) {
          await refreshPurchaseOnce();
          ticketNoOutbound = ticketNoForPassengerLegAt('outbound');
        }
        if (!isValidTicketNo(ticketNoOutbound, refNo)) {
          const cp = normalizeCompletePurchase(completePurchase) || completePurchase || {};
          const ticketsArr = (() => {
            try {
              const booking = cp.booking && typeof cp.booking === 'object' ? cp.booking : null;
              const raw = booking && booking.tickets;
              if (Array.isArray(raw)) return raw;
              if (raw && typeof raw === 'object') {
                if (Array.isArray(raw.items)) return raw.items;
                if (Array.isArray(raw.data)) return raw.data;
                if (Array.isArray(raw.tickets)) return raw.tickets;
                const vals = Object.values(raw).filter(Boolean);
                if (vals.length && vals.every((x) => x && typeof x === 'object')) return vals;
              }
            } catch (_) {
              return [];
            }
            return [];
          })();
          const ticketsSample = (ticketsArr || []).slice(0, 3).map((t) => (t && typeof t === 'object') ? Object.keys(t).slice(0, 30) : []);
          const itemPassengerKeys = (() => {
            try {
              const it0 = (Array.isArray(cp.items) ? (cp.items[idx] || cp.items[0]) : null) || null;
              const p0 = it0 && it0.passenger ? it0.passenger : null;
              return {
                itemKeys: it0 && typeof it0 === 'object' ? Object.keys(it0).slice(0, 40) : [],
                passengerKeys: p0 && typeof p0 === 'object' ? Object.keys(p0).slice(0, 40) : [],
              };
            } catch (_) {
              return { itemKeys: [], passengerKeys: [] };
            }
          })();
          logger.warn(`[${requestId}] Missing/invalid ticket number for passenger`, { pnr, cartId, passengerIndex: idx + 1, ticketNoOutbound, bookingTicketsCount: Array.isArray(ticketsArr) ? ticketsArr.length : 0, bookingTicketsKeysSample: ticketsSample, itemPassengerKeys });
          throw ApiError.unprocessableEntity('Ticket number missing for passenger', [
            { field: 'ticketNo', message: 'Ticket number missing or invalid', passengerIndex: idx + 1 }
          ]);
        }
        const perPassengerTotal = (Array.isArray(perPassengerTotals) && Number.isFinite(Number(perPassengerTotals[idx])))
          ? Number(perPassengerTotals[idx])
          : perPassengerPrice;
        const passengerTotalCents = Math.round(Number(perPassengerTotal || 0) * 100);
        const perLegCentsFor = (legKey) => {
          if (!hasReturnLeg) return passengerTotalCents;
          if (roundTripPassengerPricesArePerLeg) return passengerTotalCents;
          const base = Math.floor(passengerTotalCents / 2);
          const rem = passengerTotalCents - (base * 2);
          const outbound = base + (rem > 0 ? 1 : 0);
          if (String(legKey || '').toLowerCase() === 'return') return passengerTotalCents - outbound;
          return outbound;
        };
        let cardsPdfHtmlForPassenger = '';

        const buildCardHtml = (
          legLabel,
          segOrigin,
          segDestination,
          segDepartCityTime,
          segArriveCityTime,
          segDepartDateTime,
          segArriveDateTime,
          qrImgSrcForLeg,
          unitPriceForLeg,
          ticketNoForCard,
          viewUrlForLeg,
          logoHtmlForCard
        ) => `
          <div style="width:100%;background:#ffffff;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;border-radius:12px;box-shadow:0 10px 25px rgba(0,0,0,0.08);overflow:hidden;border:1px solid #e5e7eb;margin-bottom:0;">
            <div style="padding:24px;">
              <div style="display:block;text-align:center;margin-bottom:12px;">
                ${logoHtmlForCard}
              </div>

              <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:#f7e9ff;border:1px solid #7B1FA2;border-radius:8px;">
                <div style="height:32px;width:32px;border-radius:9999px;background:#7B1FA2;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;">&#10003;</div>
                <div>
                  <div style="font-weight:800;color:#7B1FA2;">${legLabel ? legLabel.toUpperCase() + ' ' : ''}TICKET CONFIRMED</div>
                  <div style="font-size:14px;color:#7B1FA2;">Your ticket has been booked.</div>
                </div>
              </div>

              <hr style="margin:16px 0;border:0;border-top:1px dashed #e5e7eb;" />

              <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;font-size:16px;color:#1f2937;">
                <tbody>
                  <tr><td style="padding:2px 0;color:#374151;width:38%">Ref No:</td><td style="padding:2px 0;font-weight:700;">${refNo}</td></tr>
                  <tr><td style="padding:2px 0;color:#374151;">Ticket No:</td><td style="padding:2px 0;font-weight:700;">${ticketNoForCard || ticketNo || '-'}</td></tr>
                  <tr><td style="padding:2px 0;color:#374151;">Name:</td><td style="padding:2px 0;font-weight:700;">${pName}</td></tr>
                  <tr><td style="padding:2px 0;color:#374151;">Mobile No:</td><td style="padding:2px 0;font-weight:700;">${pPhone}</td></tr>
                  <tr><td style="padding:2px 0;color:#374151;">Passport/ID No:</td><td style="padding:2px 0;font-weight:700;">${pId}</td></tr>
                  <tr><td style="padding:2px 0;color:#374151;">Baby On Lap:</td><td style="padding:2px 0;font-weight:700;">${babyOnLap}</td></tr>
                  <tr><td style="padding:2px 0;color:#374151;">Operator Name:</td><td style="padding:2px 0;font-weight:700;">${operatorName}</td></tr>
                </tbody>
              </table>

              <div style="border:1px solid #d1d5db;padding:12px;margin:16px 0;border-radius:6px;">
                <div style="font-weight:800;font-size:18px;color:#1f2937;">Depart: ${segOrigin}</div>
                <div style="color:#374151;font-size:15px;margin-top:2px;">${segDepartCityTime}</div>
                <div style="font-weight:700;color:#1f2937;margin-top:2px;">${segDepartDateTime}</div>
                <div style="font-size:14px;color:#374151;margin-top:6px;">Checkin 1 Hour before Departure</div>
              </div>

              <div style="border:1px solid #d1d5db;padding:12px;margin:16px 0;border-radius:6px;">
                <div style="font-weight:800;font-size:18px;color:#1f2937;">Arrive: ${segDestination}</div>
                <div style="color:#374151;font-size:15px;margin-top:2px;">${segArriveCityTime}</div>
                <div style="font-weight:700;color:#1f2937;margin-top:2px;">${segArriveDateTime}</div>
              </div>

              <div style="font-size:14px;color:#374151;">
                <div>Booked By: <span style="font-weight:600;color:#1f2937;">${bookedBy}</span></div>
                <div>${bookingTimestamp}</div>
              </div>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
                <tr>
                  <td style="vertical-align:bottom;">
                    <div style="font-weight:800;font-size:20px;color:#1f2937;">Price: $${unitPriceForLeg}</div>
                    <div style="font-size:14px;color:#374151;margin-top:2px;">[${paymentMethod}]</div>
                  </td>
                  <td style="vertical-align:bottom;text-align:right;width:150px;">
                    <img src="${qrImgSrcForLeg}" alt="QR Code" width="120" height="120" style="display:block;border:0;outline:none;text-decoration:none;border-radius:4px;margin-left:auto;" />
                  </td>
                </tr>
              </table>
            </div>

            <div style="background:#f9fafb;padding:14px;text-align:center;font-size:13px;color:#374151;border-top:1px solid #e5e7eb;">
              <div>Terms &amp; Conditions Apply</div>
              <div>For Info Call ${contactInfo}</div>  
            </div>
          </div>`;

        // For each passenger, generate a separate QR and card per leg (outbound/return)
        const legsForPassenger = [];
        // Outbound leg
        legsForPassenger.push({
          key: 'outbound',
          label: hasReturnLeg ? 'Outbound' : '',
          origin,
          destination,
          departCityTime,
          arriveCityTime,
          departDateTime,
          arriveDateTime
        });

        // Return leg (for round trips). As long as we know origin/destination,
        // generate a return card; missing times show as '-'.
        if (hasReturnLeg) {
          legsForPassenger.push({
            key: 'return',
            label: 'Return',
            origin: returnOrigin,
            destination: returnDestination,
            departCityTime: returnDepartCityTime || returnOrigin,
            arriveCityTime: returnArriveCityTime || returnDestination,
            departDateTime: returnDepartDateTime,
            arriveDateTime: returnArriveDateTime
          });
        }

        // Generate QR images and accumulate cardsHtml
        let cardsPdfHtmlForPassengerOutbound = '';
        let cardsPdfHtmlForPassengerReturn = '';

        for (let legIdx = 0; legIdx < legsForPassenger.length; legIdx++) {
          const leg = legsForPassenger[legIdx];
          const isReturnLeg = String(leg && leg.key ? leg.key : '').toLowerCase() === 'return';

          let ticketNoForCard = isReturnLeg ? ticketNoForPassengerLegAt('return') : ticketNoOutbound;
          if (isReturnLeg && !isValidTicketNo(ticketNoForCard, refNo)) {
            await refreshPurchaseOnce();
            ticketNoForCard = ticketNoForPassengerLegAt('return');
          }
          if (isReturnLeg && !isValidTicketNo(ticketNoForCard, refNo)) {
            throw ApiError.unprocessableEntity('Ticket number missing for return leg', [
              { field: 'ticketNo', message: 'Ticket number missing or invalid for return leg', passengerIndex: idx + 1, leg: 'return' }
            ]);
          }

          const unitPriceText = (perLegCentsFor(leg && leg.key) / 100).toFixed(2);
          const qrText = [
            'E-TICKET',
            `Ref No: ${refNo}`,
            `Ticket No: ${ticketNoForCard}`,
            `Route: ${leg.origin} -> ${leg.destination}${leg.key ? ` (${leg.key})` : ''}`,
            `Departure: ${leg.departDateTime || '-'}`,
            `Arrival: ${leg.arriveDateTime || '-'}`,
            `Passenger: ${pName || '-'}`,
            `Phone: ${pPhone || '-'}`,
            `ID: ${pId || '-'}`,
            `Fare: $${unitPriceText} [${paymentMethod}]`
          ].join('\n');
          const pngBuffer = qr.imageSync(qrText, { type: 'png' });
          const qrDataUri = `data:image/png;base64,${pngBuffer.toString('base64')}`;

          const viewUrl = `${apiBase}/api/ticket/eticket/print?pnr=${encodeURIComponent(pnr)}&idx=${idx + 1}&leg=${encodeURIComponent(leg.key)}`;

          const fallbackLogoHtml = `<div style=\"height:48px;width:48px;border-radius:10px;background:#ede9fe;display:flex;align-items:center;justify-content:center;color:#7c3aed;font-weight:800;font-size:24px;\">J</div>`;
          const pdfLogoSrc = logoDataUri || ticketLogoDataUri;
          const pdfLogoHtml = pdfLogoSrc
            ? `<div style=\"height:72px;display:flex;align-items:center;justify-content:center;width:100%;\"><img src=\"${pdfLogoSrc}\" alt=\"National Tickets Global\" style=\"max-height:64px;max-width:340px;width:auto;display:block;margin:0 auto;object-fit:contain;\" /></div>`
            : fallbackLogoHtml;

          const cardHtml = buildCardHtml(
            leg.label,
            leg.origin,
            leg.destination,
            leg.departCityTime,
            leg.arriveCityTime,
            leg.departDateTime,
            leg.arriveDateTime,
            qrDataUri,
            unitPriceText,
            ticketNoForCard,
            viewUrl,
            pdfLogoHtml
          );
          const spacerHtml = (legIdx < (legsForPassenger.length - 1)) ? '<div style="height:16px;"></div>' : '';
          cardsPdfHtml += cardHtml + spacerHtml;
          cardsPdfHtmlForPassenger += cardHtml + spacerHtml;

          if (leg.key === 'outbound') {
            cardsPdfHtmlForPassengerOutbound += cardHtml;
          }
          if (leg.key === 'return') {
            cardsPdfHtmlForPassengerReturn += cardHtml;
          }
        }

        if (idx < (list.length - 1)) {
          cardsPdfHtml += '<div style="height:16px;"></div>';
        }

        cardsPdfHtmlByPassenger.push(cardsPdfHtmlForPassenger);
        cardsPdfHtmlByPassengerOutbound.push(cardsPdfHtmlForPassengerOutbound);
        cardsPdfHtmlByPassengerReturn.push(cardsPdfHtmlForPassengerReturn);
      }

      const html = `
      <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;padding:24px;">
        <h2 style="margin:0 0 12px 0;font-size:18px;color:#111827;">${purchaserName ? `Hi ${purchaserName},` : 'Hello,'}</h2>
        <p style="margin:0 0 10px 0;color:#374151;">Your e-ticket PDF${list.length > 1 ? 's are' : ' is'} attached to this email.</p>
        <p style="margin:0 0 10px 0;color:#374151;"><strong>PNR:</strong> ${pnr}</p>
        <p style="margin:0 0 10px 0;color:#374151;">If you have trouble opening the attachment, you can download it here:</p>
        <p style="margin:0;"><a href="${viewLink}" style="color:#111827;font-weight:700;">Open ticket</a></p>
        <p style="margin:8px 0 0 0;"><a href="${pdfDownloadLink}" style="color:#374151;">Download PDF</a></p>
        <p style="margin:8px 0 0 0;"><a href="${downloadLink}" style="color:#374151;">View booking</a></p>
      </div>`;

      // PDF attachment needs data-URI images; Puppeteer cannot resolve cid:.
      const pdfCards = `
      <div style="width:100%;background:#f6f7fb;padding:0;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%;">
          <tbody>
            <tr>
              <td style="padding:0;margin:0;">
                ${cardsPdfHtml}
              </td>
            </tr>
          </tbody>
        </table>
      </div>`;

      if (!usedStoredTicketAttachments) {
        // Generate a single PDF that matches the email cards exactly
        try {
        if (hasReturnLeg && Array.isArray(cardsPdfHtmlByPassenger) && cardsPdfHtmlByPassenger.length > 1) {
          for (let idx = 0; idx < cardsPdfHtmlByPassenger.length; idx++) {
            const outboundCards = (Array.isArray(cardsPdfHtmlByPassengerOutbound) && cardsPdfHtmlByPassengerOutbound[idx]) ? cardsPdfHtmlByPassengerOutbound[idx] : '';
            const returnCards = (Array.isArray(cardsPdfHtmlByPassengerReturn) && cardsPdfHtmlByPassengerReturn[idx]) ? cardsPdfHtmlByPassengerReturn[idx] : '';

            if (outboundCards) {
              const onePdfCards = `
              <div style="width:100%;background:#f6f7fb;padding:0;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%;">
                  <tbody>
                    <tr>
                      <td style="padding:0;margin:0;">
                        ${outboundCards}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>`;
              const pdfHtml = `<!DOCTYPE html><html><head><meta charset="utf-8" /></head><body style="margin:0;padding:0;background:#f6f7fb;">${onePdfCards}</body></html>`;
              const pdfBuffer = await generatePdfFromHtml(pdfHtml, {
                thermal: true,
                width: '48mm',
                autoHeight: true,
                autoHeightPadding: 0,
                printBackground: true,
                viewportWidth: 280,
                scaleToFitWidth: true,
                margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' },
              });
              attachments.push({
                filename: `eticket-${refNo || pnr}-passenger-${idx + 1}-outbound.pdf`,
                content: pdfBuffer,
                contentType: 'application/pdf',
              });
            }

            if (returnCards) {
              const onePdfCards = `
              <div style="width:100%;background:#f6f7fb;padding:0;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%;">
                  <tbody>
                    <tr>
                      <td style="padding:0;margin:0;">
                        ${returnCards}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>`;
              const pdfHtml = `<!DOCTYPE html><html><head><meta charset="utf-8" /></head><body style="margin:0;padding:0;background:#f6f7fb;">${onePdfCards}</body></html>`;
              const pdfBuffer = await generatePdfFromHtml(pdfHtml, {
                thermal: true,
                width: '48mm',
                autoHeight: true,
                autoHeightPadding: 0,
                printBackground: true,
                viewportWidth: 280,
                scaleToFitWidth: true,
                margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' },
              });
              attachments.push({
                filename: `eticket-${refNo || pnr}-passenger-${idx + 1}-return.pdf`,
                content: pdfBuffer,
                contentType: 'application/pdf',
              });
            }
          }
        } else if (hasReturnLeg) {
          const joinCards = (arr) => {
            const safe = Array.isArray(arr) ? arr.filter(Boolean) : [];
            return safe.join('<div style="height:16px;"></div>');
          };

          const outboundCards = joinCards(cardsPdfHtmlByPassengerOutbound);
          const returnCards = joinCards(cardsPdfHtmlByPassengerReturn);

          if (outboundCards) {
            const onePdfCards = `
            <div style="width:100%;background:#f6f7fb;padding:0;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%;">
                <tbody>
                  <tr>
                    <td style="padding:0;margin:0;">
                      ${outboundCards}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>`;
            const pdfHtml = `<!DOCTYPE html><html><head><meta charset="utf-8" /></head><body style="margin:0;padding:0;background:#f6f7fb;">${onePdfCards}</body></html>`;
            const pdfBuffer = await generatePdfFromHtml(pdfHtml, {
              thermal: true,
              width: '48mm',
              autoHeight: true,
              autoHeightPadding: 0,
              printBackground: true,
              viewportWidth: 280,
              scaleToFitWidth: true,
              margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' },
            });
            attachments.push({
              filename: `eticket-${refNo || pnr}-outbound.pdf`,
              content: pdfBuffer,
              contentType: 'application/pdf',
            });
          }

          if (returnCards) {
            const onePdfCards = `
            <div style="width:100%;background:#f6f7fb;padding:0;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%;">
                <tbody>
                  <tr>
                    <td style="padding:0;margin:0;">
                      ${returnCards}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>`;
            const pdfHtml = `<!DOCTYPE html><html><head><meta charset="utf-8" /></head><body style="margin:0;padding:0;background:#f6f7fb;">${onePdfCards}</body></html>`;
            const pdfBuffer = await generatePdfFromHtml(pdfHtml, {
              thermal: true,
              width: '48mm',
              autoHeight: true,
              autoHeightPadding: 0,
              printBackground: true,
              viewportWidth: 280,
              scaleToFitWidth: true,
              margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' },
            });
            attachments.push({
              filename: `eticket-${refNo || pnr}-return.pdf`,
              content: pdfBuffer,
              contentType: 'application/pdf',
            });
          }
        } else if (cardsPdfHtmlByPassenger.length > 1) {
          for (let idx = 0; idx < cardsPdfHtmlByPassenger.length; idx++) {
            const onePassengerCards = cardsPdfHtmlByPassenger[idx] || '';
            if (!onePassengerCards) continue;
            const onePdfCards = `
            <div style="width:100%;background:#f6f7fb;padding:0;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%;">
                <tbody>
                  <tr>
                    <td style="padding:0;margin:0;">
                      ${onePassengerCards}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>`;
            const pdfHtml = `<!DOCTYPE html><html><head><meta charset="utf-8" /></head><body style="margin:0;padding:0;background:#f6f7fb;">${onePdfCards}</body></html>`;
            const pdfBuffer = await generatePdfFromHtml(pdfHtml, {
              thermal: true,
              width: '48mm',
              autoHeight: true,
              autoHeightPadding: 0,
              printBackground: true,
              viewportWidth: 280,
              scaleToFitWidth: true,
              margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' },
            });
            attachments.push({
              filename: `eticket-${refNo || pnr}-passenger-${idx + 1}.pdf`,
              content: pdfBuffer,
              contentType: 'application/pdf',
            });
          }
        } else {
          const pdfHtml = `<!DOCTYPE html><html><head><meta charset="utf-8" /></head><body style="margin:0;padding:0;background:#f6f7fb;">${pdfCards}</body></html>`;
          const pdfBuffer = await generatePdfFromHtml(pdfHtml, {
            thermal: true,
            width: '48mm',
            autoHeight: true,
            autoHeightPadding: 0,
            printBackground: true,
            viewportWidth: 280,
            scaleToFitWidth: true,
            margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' },
          });
          attachments.push({
            filename: `eticket-${refNo || pnr}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf',
          });
        }
        } catch (e) {
          logger.warn(`[${requestId}] Failed to generate e-ticket PDF attachment`, { pnr, error: e.message });
        }
      }

      try {
        const apiBaseRaw = process.env.PUBLIC_API_BASE_URL || process.env.INTERNAL_API_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
        const apiBase = String(apiBaseRaw || '').replace(/\/+$/, '').replace(/\/api$/i, '');
        const url = `${apiBase}/api/ticket/pdf?pnr=${encodeURIComponent(String(pnr))}&download=1`;
        const pdfAttachments = Array.isArray(attachments) ? attachments.filter((a) => a && a.content && looksLikePdfBuffer(a.content)) : [];
        if (pdfAttachments.length) {
          const first = normalizeToBuffer(pdfAttachments[0].content);
          if (first && first.length) {
            await upsertTicketPdfCache({ pnr, bookedBy, url, which: 'final', pdfBuffer: first }).catch(() => {});
          }
          if (pdfAttachments.length > 1) {
            const files = pdfAttachments
              .map((a, i) => ({
                name: a.filename ? String(a.filename) : `eticket-${encodeURIComponent(String(pnr))}-${i + 1}.pdf`,
                buffer: normalizeToBuffer(a.content)
              }))
              .filter((f) => f && f.name && f.buffer && f.buffer.length);
            if (files.length) {
              const zipBuffer = await buildZipBuffer(files);
              if (zipBuffer && zipBuffer.length) {
                await upsertTicketPdfCache({ pnr, bookedBy, url, which: 'final_zip', pdfBuffer: zipBuffer }).catch(() => {});
              }
            }
          }
        }
      } catch (_) {}

      // Persist a stable ticket URL in Postgres for this PNR
 try {
  await ensureTicketsTableExists();
  const frontendBaseRaw = process.env.FRONTEND_URL || process.env.CLIENT_URL || 'https://your-app.com';
  const frontendBase = String(frontendBaseRaw || '').replace(/\/+$/, '');
  const ticketUrl = `${frontendBase}/tickets/${encodeURIComponent(String(pnr))}?type=final`;
  const bookedByForStorage = (await resolveBookedByFromPostgres(pnr)) || 'online';

  await drizzleDb
    .insert(ticketsTable)
    .values({
      pnr: String(pnr),
      bookedBy: bookedByForStorage,
      url: ticketUrl,
      createdAt: new Date()
    })
    .onConflictDoUpdate({
      target: ticketsTable.pnr,
      set: {
        bookedBy: bookedByForStorage,
        url: ticketUrl,
        createdAt: new Date()
      }
    });
} catch (e) {
  logger.warn(`[${requestId}] Failed to persist ticket URL in Postgres`, { pnr, error: e.message });
}

await sendEmail({
  to: purchaserEmail,
  subject: `Your E-ticket is ready${cart.bookingRef ? ` - Ref ${cart.bookingRef}` : ''}`,
  html,
  attachments
});

const responseTime = Date.now() - startTime;
logger.info(` [${requestId}] E-ticket email sent`, {
  pnr,
  to: purchaserEmail,
  cartId,
  responseTime: `${responseTime}ms`,
});

return res.json({
  success: true,
  pnr,
  cartId,
  sentTo: purchaserEmail,
  requestId,
  timestamp: new Date().toISOString(),
});
} catch (error) {
  try {
    if (pnr) recentEticketSendByPnr.delete(String(pnr));
  } catch (_) {}
  const responseTime = Date.now() - startTime;
  logger.error(` [${requestId}] E-ticket send error`, {
    message: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : undefined,
    responseTime: `${responseTime}ms`,
  });
  if (error instanceof ApiError) {
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.toJSON(),
      requestId,
      timestamp: new Date().toISOString(),
    });
  }
  return res.status(500).json({
    success: false,
    error: {
      message: error && error.message ? error.message : 'Failed to send e-ticket email',
      type: 'ETICKET_EMAIL_ERROR',
    },
    requestId,
    timestamp: new Date().toISOString(),
  });
}
});

router.get(
  '/eticket/pdf',
  [
    query('pnr').optional().isString().trim().isLength({ min: 1 }).withMessage('pnr must be a non-empty string')
  ],
  async (req, res) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    res.setHeader('x-ticket-eticket-pdf', 'v2');
    res.setHeader('x-ticket-eticket-request-id', requestId);
    try {
      const v = validationResult(req);
      if (!v.isEmpty()) {
        return res.status(400).send('Invalid parameters');
      }

      const q = req.query || {};
      const pnr = q.pnr || q.reference || q.firestorecartid || q.cartid || q.cart_id;
      if (!pnr) {
        return res.status(400).send('Missing or invalid parameters');
      }

      const paperRaw = (q.paper || q.format || q.size || '').toString().toLowerCase();
      const thermalOff = q.thermal === '0' || q.thermal === 0 || q.thermal === false || q.thermal === 'false';
      const explicitA4 = paperRaw === 'a4' || paperRaw === 'paper=a4' || paperRaw === 'letter' || paperRaw === 'legal';
      // Default to 48mm output unless explicitly requesting A4 or disabling thermal.
      const isThermal = !explicitA4 && !thermalOff;

      const split = (q.split === '1' || q.split === 1 || q.split === true || q.split === 'true' || q.zip === '1' || q.zip === 1 || q.zip === true || q.zip === 'true');
      let cachedZipCandidate = null;
      if (split) {
        try {
          cachedZipCandidate = await getCachedTicketPdfFromPostgres(pnr, 'final_zip');
        } catch (_) {
          cachedZipCandidate = null;
        }
      }
      const forceRegen = false;
      if (!forceRegen) {
        if (!split) {
          // Always serve cached final PDF for both thermal and A4 when available.
          const cached = await getCachedTicketPdfFromPostgres(pnr, 'final');
          if (cached) {
            if (!looksLikePdfBuffer(cached)) {
              res.setHeader('x-ticket-cache', 'invalid');
              res.setHeader('x-ticket-cache-kind', 'final');
              logger.warn(`[${requestId}] Ignoring cached finalPdfBase64 because it is not a valid PDF`, { pnr: String(pnr), size: cached.length });
            } else {
              res.setHeader('x-ticket-cache', 'hit');
              res.setHeader('x-ticket-cache-kind', 'final');
              const h = sha256Hex(cached);
              if (h) res.setHeader('x-ticket-pdf-sha256', h);
              res.setHeader('Content-Type', 'application/pdf');
              res.setHeader('Content-Disposition', `inline; filename="eticket-${encodeURIComponent(String(pnr))}.pdf"`);
              res.setHeader('Content-Length', cached.length);
              return res.end(cached);
            }
          }
        }
      }


      let cart = null;
      if (usePostgresFirstForEticket) {
        cart = await loadTicketCartFromPostgres(pnr, requestId);
      }
      if (!cart) {
        if (useFirestoreTicketFallback) {
          try {
            const db = await getFirestore();
            const fsCartId = await resolveCartDocId(pnr, { createIfMissing: false });
            const doc = await db.collection('carts').doc(fsCartId).get();
            if (doc.exists) {
              cart = doc.data() || {};
            }
          } catch (_) {
            // ignore
          }
        }
        if (!cart) {
          return res.status(404).send('Ticket not found');
        }
      }

      cart = await hydrateEticketCartFromCartsTable(cart, { pnr, cartIdHint: null, requestId });

      const cartId = cart.busbudCartId || cart.cartId || cart.cart_id || pnr;

      let logoDataUri = null;
      try {
        const logoPath = process.env.ETICKET_LOGO_PATH;
        if (logoPath) {
          const logoBuffer = fs.readFileSync(logoPath);
          const ext = path.extname(logoPath).toLowerCase();
          const logoMime = ext === '.png'
            ? 'image/png'
            : (ext === '.svg' ? 'image/svg+xml' : 'image/jpeg');
          logoDataUri = `data:${logoMime};base64,${logoBuffer.toString('base64')}`;
        }
      } catch (e) {
        logger.warn(`[${requestId}] Failed to load logo for e-ticket PDF`, { error: e.message });
      }

      let origin = 'Unknown';
      let destination = 'Unknown';
      let departTs = null;
      let arriveTs = null;
      let returnOrigin = null;
      let returnDestination = null;
      let returnDepartTs = null;
      let returnArriveTs = null;

      const rawTripItems = cart.trip && cart.trip._raw && Array.isArray(cart.trip._raw.items) ? cart.trip._raw.items : null;
      const rawTripItem = rawTripItems && rawTripItems.length ? rawTripItems[0] : null;
      const rawTripItemReturn = rawTripItems && rawTripItems.length > 1 ? rawTripItems[1] : null;
      const segments = rawTripItem && Array.isArray(rawTripItem.segments)
        ? rawTripItem.segments
        : ((cart.busbudResponse && (cart.busbudResponse.segments || (cart.busbudResponse.trip && cart.busbudResponse.trip.segments))) || cart.segments || []);

      let outboundSeg = null;
      let returnSeg = null;
      if (Array.isArray(segments) && segments.length) {
        let outboundFirstSeg = null;
        let outboundLastSeg = null;
        let returnFirstSeg = null;
        let returnLastSeg = null;

        outboundSeg = segments[0];
        outboundFirstSeg = outboundSeg;
        outboundLastSeg = segments[segments.length - 1] || outboundSeg;

        const tripLegs = rawTripItem && Array.isArray(rawTripItem.trip_legs) ? rawTripItem.trip_legs : [];
        if (Array.isArray(tripLegs) && tripLegs.length > 1) {
          const leg1Ids = Array.isArray(tripLegs[0]?.segment_ids) ? tripLegs[0].segment_ids : null;
          const leg2Ids = Array.isArray(tripLegs[1]?.segment_ids) ? tripLegs[1].segment_ids : null;
          const outSegs = pickSegmentsByIds(segments, leg1Ids);
          const retSegs = pickSegmentsByIds(segments, leg2Ids);
          if (outSegs.length) {
            outboundFirstSeg = outSegs[0];
            outboundLastSeg = outSegs[outSegs.length - 1];
            outboundSeg = pickSegmentWithOperator(outSegs) || outboundFirstSeg;
          }
          if (retSegs.length) {
            returnFirstSeg = retSegs[0];
            returnLastSeg = retSegs[retSegs.length - 1];
            returnSeg = pickSegmentWithOperator(retSegs) || returnFirstSeg;
          }
        } else if (!rawTripItemReturn && segments.length > 1) {
          const cand = segments[1];
          const oo = segCityName(outboundSeg, 'origin');
          const od = segCityName(outboundSeg, 'destination');
          const ro = segCityName(cand, 'origin');
          const rd = segCityName(cand, 'destination');
          const norm = (s) => (s == null ? '' : String(s)).trim().toLowerCase();
          const looksLikeReturn = norm(ro) && norm(rd) && norm(oo) && norm(od) && norm(ro) === norm(od) && norm(rd) === norm(oo);
          if (looksLikeReturn) {
            returnSeg = cand;
            returnFirstSeg = cand;
            returnLastSeg = cand;
          }
        }

        if (outboundSeg) {
          const first = outboundFirstSeg || outboundSeg;
          const last = outboundLastSeg || outboundSeg;
          origin = (first.origin && (first.origin.city && first.origin.city.name)) || (first.origin && first.origin.name) || origin;
          destination = (last.destination && (last.destination.city && last.destination.city.name)) || (last.destination && last.destination.name) || destination;
          const dts = (first.departure_time && (first.departure_time.timestamp || first.departure_time)) || (first.departure && first.departure.timestamp) || null;
          const ats = (last.arrival_time && (last.arrival_time.timestamp || last.arrival_time)) || (last.arrival && last.arrival.timestamp) || null;
          departTs = dts ? new Date(dts) : null;
          arriveTs = ats ? new Date(ats) : null;
        }

        if (returnSeg) {
          const first = returnFirstSeg || returnSeg;
          const last = returnLastSeg || returnSeg;
          returnOrigin = (first.origin && (first.origin.city && first.origin.city.name)) || (first.origin && first.origin.name) || null;
          returnDestination = (last.destination && (last.destination.city && last.destination.city.name)) || (last.destination && last.destination.name) || null;
          const rdts = (first.departure_time && (first.departure_time.timestamp || first.departure_time)) || (first.departure && first.departure.timestamp) || null;
          const rats = (last.arrival_time && (last.arrival_time.timestamp || last.arrival_time)) || (last.arrival && last.arrival.timestamp) || null;
          returnDepartTs = rdts ? new Date(rdts) : null;
          returnArriveTs = rats ? new Date(rats) : null;
        }

        if (!returnSeg && rawTripItemReturn && Array.isArray(rawTripItemReturn.segments) && rawTripItemReturn.segments.length) {
          const retSegs = rawTripItemReturn.segments;
          const firstRet = retSegs[0];
          const lastRet = retSegs[retSegs.length - 1];
          returnSeg = pickSegmentWithOperator(retSegs) || firstRet;
          returnFirstSeg = returnFirstSeg || firstRet;
          returnLastSeg = returnLastSeg || lastRet;
          if (!returnOrigin) returnOrigin = segCityName(firstRet, 'origin');
          if (!returnDestination) returnDestination = segCityName(lastRet, 'destination');
          const rdts = (firstRet.departure_time && (firstRet.departure_time.timestamp || firstRet.departure_time)) || (firstRet.departure && firstRet.departure.timestamp) || null;
          const rats = (lastRet.arrival_time && (lastRet.arrival_time.timestamp || lastRet.arrival_time)) || (lastRet.arrival && lastRet.arrival.timestamp) || null;
          if (!returnDepartTs) returnDepartTs = rdts ? new Date(rdts) : null;
          if (!returnArriveTs) returnArriveTs = rats ? new Date(rats) : null;
        }
      }

      const coerceDate = (value) => {
        try {
          if (!value) return null;
          const d = new Date(value);
          return Number.isNaN(d.getTime()) ? null : d;
        } catch (_) {
          return null;
        }
      };

      if (!origin || String(origin).trim().toLowerCase() === 'unknown') {
        const c = cart || {};
        origin =
          c.originCity ||
          c.origin ||
          (c.tripDetails && (c.tripDetails.originCity || c.tripDetails.origin)) ||
          origin;
      }
      if (!destination || String(destination).trim().toLowerCase() === 'unknown') {
        const c = cart || {};
        destination =
          c.destinationCity ||
          c.destination ||
          (c.tripDetails && (c.tripDetails.destinationCity || c.tripDetails.destination)) ||
          destination;
      }

      if (!departTs || Number.isNaN(departTs.getTime())) {
        const c = cart || {};
        const raw =
          (c.tripDetails && (c.tripDetails.departureTime || c.tripDetails.departure_time || c.tripDetails.departAt || c.tripDetails.depart_at)) ||
          c.departAt ||
          c.depart_at;
        departTs = coerceDate(raw);
      }
      if (!arriveTs || Number.isNaN(arriveTs.getTime())) {
        const c = cart || {};
        const raw =
          (c.tripDetails && (c.tripDetails.arrivalTime || c.tripDetails.arrival_time || c.tripDetails.arriveAt || c.tripDetails.arrive_at)) ||
          c.arriveAt ||
          c.arrive_at;
        arriveTs = coerceDate(raw);
      }

      if (!returnOrigin) {
        const c = cart || {};
        returnOrigin =
          c.returnOrigin ||
          c.return_origin ||
          (c.tripDetails && (c.tripDetails.returnOrigin || c.tripDetails.return_origin || c.tripDetails.inboundOrigin || c.tripDetails.inbound_origin)) ||
          null;
      }
      if (!returnDestination) {
        const c = cart || {};
        returnDestination =
          c.returnDestination ||
          c.return_destination ||
          (c.tripDetails && (c.tripDetails.returnDestination || c.tripDetails.return_destination || c.tripDetails.inboundDestination || c.tripDetails.inbound_destination)) ||
          null;
      }

      if (!returnDepartTs || Number.isNaN(returnDepartTs.getTime())) {
        const c = cart || {};
        const raw =
          (c.tripDetails && (c.tripDetails.returnDepartureTime || c.tripDetails.return_departure_time || c.tripDetails.returnDepartAt || c.tripDetails.return_depart_at)) ||
          c.returnDepartAt ||
          c.return_depart_at;
        returnDepartTs = coerceDate(raw);
      }
      if (!returnArriveTs || Number.isNaN(returnArriveTs.getTime())) {
        const c = cart || {};
        const raw =
          (c.tripDetails && (c.tripDetails.returnArrivalTime || c.tripDetails.return_arrival_time || c.tripDetails.returnArriveAt || c.tripDetails.return_arrive_at)) ||
          c.returnArriveAt ||
          c.return_arrive_at;
        returnArriveTs = coerceDate(raw);
      }

      const fmt2 = (n) => String(n).padStart(2, '0');
      const fmtDate = (d) => `${fmt2(d.getDate())}/${fmt2(d.getMonth() + 1)}/${d.getFullYear()}`;
      const fmtTime = (d) => `${fmt2(d.getHours())}:${fmt2(d.getMinutes())}`;
      const fmtDateTime = (d) => `${fmtDate(d)} ${fmtTime(d)}`;

      const departTime = departTs ? fmtTime(departTs) : '-';
      const arriveTime = arriveTs ? fmtTime(arriveTs) : '-';
      const departCityTime = `${origin}${departTime && departTime !== '-' ? ` ${departTime}` : ''}`;
      const arriveCityTime = `${destination}${arriveTime && arriveTime !== '-' ? ` ${arriveTime}` : ''}`;
      const departDateTime = departTs ? fmtDateTime(departTs) : '-';
      const arriveDateTime = arriveTs ? fmtDateTime(arriveTs) : '-';

      const hasReturnLeg = !!returnOrigin && !!returnDestination;
      const returnDepartTime = returnDepartTs ? fmtTime(returnDepartTs) : '-';
      const returnArriveTime = returnArriveTs ? fmtTime(returnArriveTs) : '-';
      const returnDepartDateTime = returnDepartTs ? fmtDateTime(returnDepartTs) : '-';
      const returnArriveDateTime = returnArriveTs ? fmtDateTime(returnArriveTs) : '-';
      const returnDepartCityTime = hasReturnLeg ? `${returnOrigin}${returnDepartTime && returnDepartTime !== '-' ? ` ${returnDepartTime}` : ''}` : null;
      const returnArriveCityTime = hasReturnLeg ? `${returnDestination}${returnArriveTime && returnArriveTime !== '-' ? ` ${returnArriveTime}` : ''}` : null;

      const purchaser = cart.purchaser || cart.purchaserDetails || (cart.passengerDetails && cart.passengerDetails.purchaser) || cart.contact_info || cart.contactInfo || {};
      const refNo = pnr;

      let completePurchase = cart.passengerDetails && cart.passengerDetails.completePurchase;
      let refreshedPurchaseOnce = false;
      const refreshPurchaseOnce = async () => {
        if (refreshedPurchaseOnce) return completePurchase;
        refreshedPurchaseOnce = true;
        const refreshed = await refreshPurchaseForTicketNumbers({
          pnr,
          purchaseId: cart.purchaseId,
          purchaseUuid: cart.purchaseUuid,
          requestId,
          reason: 'eticket.pdf missing ticket number'
        });
        if (refreshed) {
          if (!cart.passengerDetails) cart.passengerDetails = {};
          cart.passengerDetails.completePurchase = refreshed;
          completePurchase = refreshed;
        }
        return completePurchase;
      };

      const bookedBy = (await resolveBookedByFromPostgres(pnr)) || 'online';
      const bookingSource = cart.bookingSource || 'Online';
      const agentBooking = (() => {
        try {
          const modeHdr = (req.get && req.get('x-agent-mode')) || (req.headers && req.headers['x-agent-mode']);
          if (modeHdr && String(modeHdr).toLowerCase() === 'true') return true;
          const hdrName = (req.get && req.get('x-agent-name')) || (req.headers && req.headers['x-agent-name']);
          const hdrEmail = (req.get && req.get('x-agent-email')) || (req.headers && req.headers['x-agent-email']);
          const hdrId = (req.get && req.get('x-agent-id')) || (req.headers && req.headers['x-agent-id']);
          if (hdrName || hdrEmail || hdrId) return true;
          const qMode = (req.query && (req.query.agentMode || req.query.agent_mode));
          if (qMode && String(qMode).toLowerCase() === 'true') return true;
          const base = cart || {};
          const baseMode = base.agentMode === true || String(base.agentMode).toLowerCase() === 'true' || (base.agent && (base.agent.agentMode === true || String(base.agent.agentMode).toLowerCase() === 'true'));
          if (baseMode) return true;
        } catch (_) {}
        return false;
      })();
      const showBookingSource = (() => {
        if (agentBooking) return false;
        if (!bookingSource) return false;
        const norm = (v) => (v == null ? '' : String(v).trim().toLowerCase());
        const bs = norm(bookingSource);
        if (!bs) return false;
        if (bs === 'online') return false;
        if (bs === norm(bookedBy)) return false;
        return true;
      })();

      const normalizeTs = (ts) => {
        try {
          if (!ts) return null;
          if (typeof ts === 'string') return new Date(ts);
          if (ts._seconds) return new Date(ts._seconds * 1000 + (ts._nanoseconds || 0) / 1e6);
          if (ts.seconds) return new Date(ts.seconds * 1000);
          if (typeof ts.toDate === 'function') return ts.toDate();
          if (ts instanceof Date) return ts;
          return null;
        } catch (_) { return null; }
      };
      const rawTs = (completePurchase && (completePurchase.completed_at || completePurchase.completedAt || completePurchase.created_at || completePurchase.createdAt)) ||
                    cart.bookingTimestamp || cart.createdAt || cart.updatedAt || new Date();
      const tsDate = normalizeTs(rawTs) || new Date();
      const bookingTimestamp = `${tsDate.getFullYear()}-${fmt2(tsDate.getMonth() + 1)}-${fmt2(tsDate.getDate())} ${fmt2(tsDate.getHours())}:${fmt2(tsDate.getMinutes())}:${fmt2(tsDate.getSeconds())}`;

      const passengersList = (() => {
        const cp = completePurchase;
        const a = Array.isArray(cart.passengers) ? cart.passengers : [];
        if (a.length && !hasReturnLeg) return a;
        const r = Array.isArray(cart.requiredPassengers) ? cart.requiredPassengers : [];
        if (r.length) return r;
        const fromCPItems = (() => {
          if (!cp || !Array.isArray(cp.items) || !cp.items.length) return [];
          const normalize = (s) => typeof s === 'string' ? s.trim().toLowerCase() : (s == null ? '' : String(s).trim().toLowerCase());
          const normalizeDocCandidate = (val) => {
            if (val == null) return '';
            const raw = String(val).trim();
            if (!raw) return '';
            const looksUuidish = raw.length >= 16 && (raw.includes('-') || raw.includes('_') || /^[a-f0-9-]{16,}$/i.test(raw));
            if (looksUuidish) return '';
            if (/^[0-9]+$/.test(raw) && raw.length <= 4) return '';
            return raw;
          };
          const firstName = (p = {}) => p.first_name || p.firstName || p.given_name || p.givenName || p.name_first || '';
          const lastName = (p = {}) => p.last_name || p.lastName || p.family_name || p.familyName || p.name_last || '';
          const docNo = (p = {}, it = {}) => {
            if (p.idNumber || p.id_number || p.id_no) return p.idNumber || p.id_number || p.id_no;
            if (p.passport || p.passport_number) return p.passport || p.passport_number;
            if (p.documentNumber || p.document_no) return p.documentNumber || p.document_no;
            if (Array.isArray(p.documents)) {
              const d = p.documents.find(d => d && (d.number || d.value || d.id));
              if (d) {
                if (d.number) return normalizeDocCandidate(d.number);
                if (d.value) return normalizeDocCandidate(d.value);
                if (d.id !== undefined && d.id !== null) {
                  return normalizeDocCandidate(d.id);
                }
              }
            }
            const pid = (p && (p.id ?? p.passenger_id ?? p.passengerId)) ?? (it && (it.passenger_id ?? it.passengerId)) ?? (it && it.fields && (it.fields.passenger_id ?? it.fields.passengerId));
            if (pid !== undefined && pid !== null) {
              const raw = String(pid).trim();
              if (!raw) return '';
              const looksUuidish = raw.length >= 16 && (raw.includes('-') || raw.includes('_') || /^[a-f0-9-]{16,}$/i.test(raw));
              if (!looksUuidish) return raw;
            }
            return '';
          };
          const seatRaw = (p = {}) => {
            const ss = p && p.selected_seats && p.selected_seats[0];
            if (ss) {
              if (typeof ss.seat === 'string') return ss.seat;
              if (ss.seat && (ss.seat.label || ss.seat.code || ss.seat.name || ss.seat.id)) return ss.seat.label || ss.seat.code || ss.seat.name || ss.seat.id;
              if (ss.seat_id) return ss.seat_id;
            }
            if (p && (p.seat || p.seat_id || p.selectedSeat)) {
              if (typeof p.seat === 'string') return p.seat;
              if (p.seat && (p.seat.label || p.seat.code || p.seat.name || p.seat.id)) return p.seat.label || p.seat.code || p.seat.name || p.seat.id;
              if (p.selectedSeat) return p.selectedSeat;
              if (p.seat_id) return p.seat_id;
            }
            if (p && p.ticket && (p.ticket.seat || p.ticket.seat_id)) return p.ticket.seat || p.ticket.seat_id;
            return '';
          };
          const phoneRaw = (p = {}) => p.phone || p.phoneNumber || '';
          const keyFor = (p = {}, it = {}) => {
            const doc = docNo(p, it);
            const base = [firstName(p), lastName(p), doc, phoneRaw(p)].map(normalize).filter(Boolean);
            if (!base.length) {
              const fallback = [seatRaw(p)].map(normalize).filter(Boolean);
              return fallback.join('|');
            }
            if (!hasReturnLeg && !doc) {
              base.push(normalize(seatRaw(p)));
            }
            return base.filter(Boolean).join('|');
          };
          const uniq = [];
          const seen = new Set();
          for (const it of cp.items) {
            const p = (it && (it.passenger || it.purchaser || it.user || (it.fields && (it.fields.passenger || it.fields.purchaser)))) || null;
            if (!p) continue;
            const k = keyFor(p, it);
            if (!k) {
              uniq.push(p);
              continue;
            }
            if (seen.has(k)) continue;
            seen.add(k);
            uniq.push(p);
          }
          return uniq;
        })();
        if (fromCPItems.length) return fromCPItems;
        const b = cart.passengerDetails && Array.isArray(cart.passengerDetails.passengers) ? cart.passengerDetails.passengers : [];
        const c = cart.trip && Array.isArray(cart.trip.passengers) ? cart.trip.passengers : [];
        const e = cart.busbudResponse && Array.isArray(cart.busbudResponse.passengers) ? cart.busbudResponse.passengers : [];
        return a.length ? a : (b.length ? b : (c.length ? c : e));
      })();

      const canonicalPassengersList = (() => {
        if (!hasReturnLeg) return passengersList;
        if (!Array.isArray(passengersList) || !passengersList.length) return passengersList;
        const halved = maybeHalvePassengersForRoundTrip(passengersList);
        if (halved && halved.length) return halved;
        if (passengersList.length % 2 !== 0) return passengersList;
        const uniqByName = dedupePassengersByName(passengersList);
        if (Array.isArray(uniqByName) && uniqByName.length && passengersList.length === uniqByName.length * 2) return uniqByName;
        const uniq = dedupePassengersByIdentity(passengersList);
        if (Array.isArray(uniq) && uniq.length && passengersList.length === uniq.length * 2) return uniq;
        return passengersList;
      })();

      const expectedCount = (() => {
        const explicitCount = (typeof cart.passengerCount === 'number' && cart.passengerCount > 0)
          ? cart.passengerCount
          : (cart.summary && typeof cart.summary.passengerCount === 'number' && cart.summary.passengerCount > 0)
            ? cart.summary.passengerCount
            : null;
        if (explicitCount != null) return explicitCount;
        const rpLen = Array.isArray(cart.requiredPassengers) ? cart.requiredPassengers.length : 0;
        if (rpLen > 0) return rpLen;
        const spLen = Array.isArray(cart.selectedPassengers) ? cart.selectedPassengers.length : 0;
        if (spLen > 0) return spLen;
        if (Array.isArray(canonicalPassengersList) && canonicalPassengersList.length) return canonicalPassengersList.length;
        return null;
      })();
      const baseList = canonicalPassengersList.length ? canonicalPassengersList : [];
      const list = expectedCount ? baseList.slice(0, expectedCount) : baseList;
      if (!Array.isArray(list) || list.length === 0) {
        return res.status(404).send('No passengers found for this ticket');
      }

      const toNumSimple = (v) => (typeof v === 'number') ? v : (typeof v === 'string' ? parseFloat(String(v).match(/[0-9]+(?:\.[0-9]+)?/)?.[0] || 'NaN') : NaN);
      const totalHintMajor = (() => {
        const a = toNumSimple(cart.totalAmount);
        if (Number.isFinite(a) && a > 0) return a;
        const b = toNumSimple(cart.totalPrice);
        if (Number.isFinite(b) && b > 0) return b;
        const c = toNumSimple(cart.total);
        if (Number.isFinite(c) && c > 0) return c;
        return NaN;
      })();
      const invoiceTotal = (() => {
        const a = toNumSimple(cart.invoice && cart.invoice.amount_total);
        if (Number.isFinite(a)) return a;
        const b = toNumSimple(cart.invoice_data && cart.invoice_data.amount_total);
        if (Number.isFinite(b)) return b;
        const c = toNumSimple(cart.invoice && cart.invoice.total);
        if (Number.isFinite(c)) return c;
        const d = toNumSimple(cart.invoice && cart.invoice.amount_untaxed);
        if (Number.isFinite(d)) return d;
        return NaN;
      })();
      const priceNumber = (() => {
        try {
          if (typeof cart.totalAmount === 'number' && Number.isFinite(cart.totalAmount) && cart.totalAmount > 0) return cart.totalAmount;
          if (typeof cart.totalAmount === 'string' && cart.totalAmount.trim()) {
            const m = String(cart.totalAmount).match(/[0-9]+(?:\.[0-9]+)?/);
            if (m) {
              const n = parseFloat(m[0]);
              if (Number.isFinite(n) && n > 0) return n;
            }
          }

          const pricingMeta = (cart.passengerDetails && cart.passengerDetails.pricing_metadata) || cart.pricing_metadata;
          if (pricingMeta) {
            if (typeof pricingMeta.canonical_adjusted_total_cents === 'number' && pricingMeta.canonical_adjusted_total_cents > 0) {
              return pricingMeta.canonical_adjusted_total_cents / 100;
            }
            if (typeof pricingMeta.adjusted_total === 'number' && pricingMeta.adjusted_total > 0) {
              return pricingMeta.adjusted_total / 100;
            }
          }

          const inv = cart.invoice || cart.invoice_data;
          if (inv) {
            const invCandidate = inv.amount_total ?? inv.total ?? inv.amount_untaxed;
            const major = toMajorAmountMaybe(invCandidate, totalHintMajor);
            if (major != null && Number.isFinite(major) && major > 0) return major;
          }

          const cp = completePurchase || {};
          if (cp && cp.charges) {
            const ch = cp.charges;
            const cand = ch.amount ?? ch.total ?? ch.subtotal;
            const major = toMajorAmountMaybe(cand, totalHintMajor);
            if (major != null && Number.isFinite(major) && major > 0) return major;
          }
          const cpItem = (completePurchase && Array.isArray(completePurchase.items) && completePurchase.items.length) ? completePurchase.items[0] : null;
          if (cpItem && cpItem.display_price) {
            const dp = cpItem.display_price;
            const cand = dp.amount ?? dp.total;
            const major = toMajorAmountMaybe(cand, totalHintMajor);
            if (major != null && Number.isFinite(major) && major > 0) return major;
          }
        } catch (_) {}
        return null;
      })();

      const totalForDivision = (priceNumber != null && Number.isFinite(Number(priceNumber)) && Number(priceNumber) > 0)
        ? Number(priceNumber)
        : (Number.isFinite(invoiceTotal) && invoiceTotal > 0)
          ? invoiceTotal
          : (Number.isFinite(toNumSimple(cart.totalPrice)) ? toNumSimple(cart.totalPrice)
          : (Number.isFinite(toNumSimple(cart.total)) ? toNumSimple(cart.total) : 0));

      const passengerCount = list.length || 1;
      const perPassengerPrice = Number(totalForDivision / passengerCount);
      const perPassengerTotals = computePerPassengerTotals({ passengers: list, completePurchase, totalMajor: totalForDivision });
      const roundTripPassengerPricesArePerLeg = (() => {
        try {
          if (!hasReturnLeg) return false;
          if (!Array.isArray(perPassengerTotals) || !perPassengerTotals.length) return false;
          const sum = perPassengerTotals.reduce((acc, v) => acc + (Number.isFinite(Number(v)) ? Number(v) : 0), 0);
          if (!Number.isFinite(sum) || sum <= 0) return false;
          if (!Number.isFinite(Number(totalForDivision)) || Number(totalForDivision) <= 0) return false;
          const tol = Math.max(0.05, (list.length || 1) * 0.05);
          const diffTotal = Math.abs(sum - Number(totalForDivision));
          const diffLeg = Math.abs(sum * 2 - Number(totalForDivision));
          if (diffLeg <= tol && diffLeg < diffTotal) return true;
          return false;
        } catch (_) {
          return false;
        }
      })();

      const paymentMethod = cart.paymentMethod || cart.payment_method || cart.method || (completePurchase && (completePurchase.payment_method || completePurchase.method)) || 'Online';
      const contactInfo = process.env.SUPPORT_PHONE || '+263 867790 0600';

      const nameFor = (p = {}) => ([
        p.first_name || p.firstName || p.given_name || p.givenName || p.name_first,
        p.last_name || p.lastName || p.family_name || p.familyName || p.name_last
      ].filter(Boolean).join(' '));
      const seatFor = (p = {}) => {
        const ss = p && p.selected_seats && p.selected_seats[0];
        if (ss) {
          if (typeof ss.seat === 'string') return ss.seat;
          if (ss.seat && (ss.seat.label || ss.seat.code || ss.seat.name || ss.seat.id)) return ss.seat.label || ss.seat.code || ss.seat.name || ss.seat.id;
          if (ss.seat_id) return ss.seat_id;
        }
        if (p && (p.seat || p.seat_id || p.selectedSeat)) {
          if (typeof p.seat === 'string') return p.seat;
          if (p.seat && (p.seat.label || p.seat.code || p.seat.name || p.seat.id)) return p.seat.label || p.seat.code || p.seat.name || p.seat.id;
          if (p.selectedSeat) return p.selectedSeat;
          if (p.seat_id) return p.seat_id;
        }
        if (p && p.ticket && (p.ticket.seat || p.ticket.seat_id)) return p.ticket.seat || p.ticket.seat_id;
        return '-';
      };
      const idFor = (p = {}) => {
        const direct = p.idNumber || p.id_number || p.id_no || p.passport || p.passport_number || p.nationalId || p.national_id || p.documentNumber || p.document_no;
        if (direct) return direct;
        if (Array.isArray(p.documents) && p.documents.length) {
          const doc = p.documents.find(d => d && (d.number || d.value || d.id));
          if (doc) return doc.number || doc.value || doc.id;
        }
        const pr = purchaser || {};
        const ci = cart.contact_info || cart.contactInfo || {};
        return pr.idNumber || pr.id_number || pr.id_no || pr.passport || pr.passport_number || pr.nationalId || pr.national_id || pr.documentNumber || pr.document_no ||
               ci.idNumber || ci.id_number || ci.id_no || ci.passport || ci.passport_number || ci.nationalId || ci.national_id || ci.documentNumber || ci.document_no || '-';
      };
      const phoneFor = (p = {}) => p.phone || p.phoneNumber || (cart.contact_info && cart.contact_info.phone) || (cart.contactInfo && cart.contactInfo.phone) || (purchaser && (purchaser.phone || purchaser.phoneNumber)) || '-';
      const babyOnLap = cart.babyOnLap ? 'YES' : 'NO';
      const operatorName = (() => {
        const clean = (val) => {
          if (val == null) return null;
          const s = String(val).trim();
          if (!s || s === '-' || s === 'â€”' || s === '—' || s.toLowerCase() === 'unknown') return null;
          return s;
        };
        const pickName = (op) => {
          if (!op) return null;
          if (typeof op === 'string') return clean(op);
          return clean(
            op.name ||
              op.operator_name ||
              op.operatorName ||
              op.label ||
              op.xid ||
              op.code ||
              op.id
          );
        };

        const fromPurchase = clean(deriveOperatorFromPurchase(completePurchase));
        if (fromPurchase) return fromPurchase;

        const busbudOperators = (() => {
          const resp = cart.busbudResponse || {};
          const direct = Array.isArray(resp.operators) ? resp.operators : [];
          const nested = resp.data && Array.isArray(resp.data.operators) ? resp.data.operators : [];
          const single = resp.operator ? [resp.operator] : [];
          return [...direct, ...nested, ...single];
        })();
        const miscOperators = Array.isArray(cart.operators) ? cart.operators : [];

        const fromCart =
          clean(cart.operatorName || cart.operator_name) ||
          clean(cart.trip && (cart.trip.operatorName || cart.trip.operator_name)) ||
          clean(cart.tripDetails && (cart.tripDetails.operatorName || cart.tripDetails.operator || cart.tripDetails.operator_name)) ||
          clean(cart.operator && (cart.operator.operatorName || cart.operator.operator_name)) ||
          pickName(cart.operator) ||
          pickName(cart.trip && cart.trip.operator) ||
          pickName(cart.tripDetails && cart.tripDetails.operator) ||
          pickName(miscOperators.find((op) => pickName(op))) ||
          pickName(Object.values(cart.trips || {}).find((trip) => pickName(trip && trip.operator))) ||
          pickName(Array.isArray(cart.tripSelections) ? cart.tripSelections.find((sel) => pickName(sel && sel.operator)) : null) ||
          null;
        if (fromCart) return fromCart;

        const seg = outboundSeg || {};
        const segOpName = pickName(seg.operator);
        if (segOpName) return segOpName;

        const candidateSegWithOperator = (() => {
          try {
            const rawItems = cart.trip && cart.trip._raw && Array.isArray(cart.trip._raw.items) ? cart.trip._raw.items : null;
            const rawItem0 = rawItems && rawItems.length ? rawItems[0] : null;
            const rawSegs = rawItem0 && Array.isArray(rawItem0.segments) ? rawItem0.segments : null;
            const bb = cart.busbudResponse || {};
            const bbSegs = Array.isArray(bb.segments)
              ? bb.segments
              : (bb.trip && Array.isArray(bb.trip.segments)
                ? bb.trip.segments
                : null);
            const segs = (Array.isArray(rawSegs) && rawSegs.length)
              ? rawSegs
              : ((Array.isArray(cart.segments) && cart.segments.length)
                ? cart.segments
                : ((Array.isArray(bbSegs) && bbSegs.length) ? bbSegs : []));
            if (!Array.isArray(segs) || !segs.length) return null;
            return pickSegmentWithOperator(segs) || segs[0] || null;
          } catch (_) {
            return null;
          }
        })();

        if (candidateSegWithOperator) {
          const opName = pickName(candidateSegWithOperator.operator);
          if (opName) return opName;
          const direct = clean(candidateSegWithOperator.operator_name || candidateSegWithOperator.operatorName);
          if (direct) return direct;
        }

        const segOperatorId = (() => {
          try {
            if (!seg) return null;
            if (seg.operator_id || seg.operatorId) return clean(seg.operator_id || seg.operatorId);
            const op = seg.operator;
            if (op && (op.id || op.operator_id || op.operatorId || op.xid)) {
              return clean(op.id || op.operator_id || op.operatorId || op.xid);
            }
            return null;
          } catch (_) {
            return null;
          }
        })();
        if (segOperatorId && busbudOperators.length) {
          const found = busbudOperators.find((op) => {
            const opId = op && (op.id || op.operator_id || op.operatorId || op.xid);
            if (!opId) return false;
            return String(opId).toLowerCase() === String(segOperatorId).toLowerCase();
          });
          const foundName = pickName(found);
          if (foundName) return foundName;
        }

        const busbudFallback = pickName(busbudOperators.find((op) => pickName(op)));
        if (busbudFallback) return busbudFallback;

        return '-';
      })();

      const buildCardHtml = (
        legLabel,
        segOrigin,
        segDestination,
        segDepartCityTime,
        segArriveCityTime,
        segDepartDateTime,
        segArriveDateTime,
        qrImgSrcForLeg,
        unitPriceForLeg,
        ticketNoForCard,
        viewUrlForLeg,
        logoHtmlForCard,
        passengerSeat,
        passengerName,
        passengerPhone,
        passengerId
      ) => `
        <div style="width:100%;background:#ffffff;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;border-radius:12px;box-shadow:0 10px 25px rgba(0,0,0,0.08);overflow:hidden;border:1px solid #e5e7eb;margin-bottom:0;">
          <div style="padding:24px;">
            <div style="display:block;text-align:center;margin-bottom:12px;">
              ${logoHtmlForCard}
            </div>

            <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:#f7e9ff;border:1px solid #7B1FA2;border-radius:8px;">
              <div style="height:32px;width:32px;border-radius:9999px;background:#7B1FA2;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;">&#10003;</div>
              <div>
                <div style="font-weight:800;color:#7B1FA2;">${legLabel ? legLabel.toUpperCase() + ' ' : ''}TICKET CONFIRMED</div>
                <div style="font-size:14px;color:#7B1FA2;">Your ticket has been booked.</div>
              </div>
            </div>

            <hr style="margin:16px 0;border:0;border-top:1px dashed #e5e7eb;" />

            <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;font-size:16px;color:#1f2937;">
              <tbody>
                <tr><td style="padding:2px 0;color:#374151;width:38%">Ref No:</td><td style="padding:2px 0;font-weight:700;">${refNo}</td></tr>
                <tr><td style="padding:2px 0;color:#374151;">Ticket No:</td><td style="padding:2px 0;font-weight:700;">${ticketNoForCard || '-'}</td></tr>
                <tr><td style="padding:2px 0;color:#374151;">Name:</td><td style="padding:2px 0;font-weight:700;">${passengerName}</td></tr>
                <tr><td style="padding:2px 0;color:#374151;">Mobile No:</td><td style="padding:2px 0;font-weight:700;">${passengerPhone}</td></tr>
                <tr><td style="padding:2px 0;color:#374151;">Passport/ID No:</td><td style="padding:2px 0;font-weight:700;">${passengerId}</td></tr>
                <tr><td style="padding:2px 0;color:#374151;">Baby On Lap:</td><td style="padding:2px 0;font-weight:700;">${babyOnLap}</td></tr>
                <tr><td style="padding:2px 0;color:#374151;">Operator Name:</td><td style="padding:2px 0;font-weight:700;">${operatorName}</td></tr>
              </tbody>
            </table>

            <div style="border:1px solid #d1d5db;padding:12px;margin:16px 0;border-radius:6px;">
              <div style="font-weight:800;font-size:18px;color:#1f2937;">Depart: ${segOrigin}</div>
              <div style="color:#374151;font-size:15px;margin-top:2px;">${segDepartCityTime}</div>
              <div style="font-weight:700;color:#1f2937;margin-top:2px;">${segDepartDateTime}</div>
              <div style="font-size:14px;color:#374151;margin-top:6px;">Checkin 1 Hour before Departure</div>
            </div>

            <div style="border:1px solid #d1d5db;padding:12px;margin:16px 0;border-radius:6px;">
              <div style="font-weight:800;font-size:18px;color:#1f2937;">Arrive: ${segDestination}</div>
              <div style="color:#374151;font-size:15px;margin-top:2px;">${segArriveCityTime}</div>
              <div style="font-weight:700;color:#1f2937;margin-top:2px;">${segArriveDateTime}</div>
            </div>

            <div style="font-size:14px;color:#374151;">
              <div>Booked By: <span style="font-weight:600;color:#1f2937;">${bookedBy}</span></div>
              <div>${bookingTimestamp}</div>
            </div>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
              <tr>
                <td style="vertical-align:bottom;">
                  <div style="font-weight:800;font-size:20px;color:#1f2937;">Price: $${unitPriceForLeg}</div>
                  <div style="font-size:14px;color:#374151;margin-top:2px;">[${paymentMethod}]</div>
                </td>
                <td style="vertical-align:bottom;text-align:right;width:150px;">
                  <img src="${qrImgSrcForLeg}" alt="QR Code" width="120" height="120" style="display:block;border:0;outline:none;text-decoration:none;border-radius:4px;margin-left:auto;" />
                </td>
              </tr>
            </table>
          </div>

          <div style="background:#f9fafb;padding:14px;text-align:center;font-size:13px;color:#374151;border-top:1px solid #e5e7eb;">
            <div>Terms &amp; Conditions Apply</div>
            <div>For Info Call ${contactInfo}</div>
          </div>
        </div>`;

      const buildPassengerCardsPdfHtml = async (p = {}, idx = 0, onlyLegKey = null) => {
        const pName = nameFor(p) || bookedBy || '-';
        const pSeat = seatFor(p);
        const pPhone = phoneFor(p);
        const pId = idFor(p);
        const ticketNoForLegAt = (legKey) => ticketNoForPassengerLeg(completePurchase, idx, legKey, list.length, p) || ticketNoForPassengerIndex(completePurchase, idx, null);
        const validateLegKey = onlyLegKey || 'outbound';
        let ticketNoForPassenger = ticketNoForLegAt(validateLegKey);
        if (!isValidTicketNo(ticketNoForPassenger, refNo)) {
          // Best-effort: Busbud may report tickets_state=pending right after completion.
          // Refresh the purchase and retry before returning 422.
          await refreshPurchaseOnce();
          ticketNoForPassenger = ticketNoForLegAt(validateLegKey);
        }
        if (!isValidTicketNo(ticketNoForPassenger, refNo)) {
          const cp = normalizeCompletePurchase(completePurchase) || completePurchase || {};
          const ticketsArr = (() => {
            try {
              const booking = cp.booking && typeof cp.booking === 'object' ? cp.booking : null;
              const raw = booking && booking.tickets;
              if (Array.isArray(raw)) return raw;
              if (raw && typeof raw === 'object') {
                if (Array.isArray(raw.items)) return raw.items;
                if (Array.isArray(raw.data)) return raw.data;
                if (Array.isArray(raw.tickets)) return raw.tickets;
                const vals = Object.values(raw).filter(Boolean);
                if (vals.length && vals.every((x) => x && typeof x === 'object')) return vals;
              }
            } catch (_) {
              return [];
            }
            return [];
          })();
          const ticketsSample = (ticketsArr || []).slice(0, 3).map((t) => (t && typeof t === 'object') ? Object.keys(t).slice(0, 30) : []);
          const itemPassengerKeys = (() => {
            try {
              const it0 = (Array.isArray(cp.items) ? (cp.items[idx] || cp.items[0]) : null) || null;
              const p0 = it0 && it0.passenger ? it0.passenger : null;
              return {
                itemKeys: it0 && typeof it0 === 'object' ? Object.keys(it0).slice(0, 40) : [],
                passengerKeys: p0 && typeof p0 === 'object' ? Object.keys(p0).slice(0, 40) : [],
              };
            } catch (_) {
              return { itemKeys: [], passengerKeys: [] };
            }
          })();
          logger.warn(`[${requestId}] Missing/invalid ticket number for e-ticket PDF`, { pnr: String(pnr), passengerIndex: idx + 1, ticketNoForPassenger, bookingTicketsCount: Array.isArray(ticketsArr) ? ticketsArr.length : 0, bookingTicketsKeysSample: ticketsSample, itemPassengerKeys });
          throw ApiError.unprocessableEntity('Ticket number missing for passenger', [
            { field: 'ticketNo', message: 'Ticket number missing or invalid', passengerIndex: idx + 1 }
          ]);
        }
        const perPassengerTotal = (Array.isArray(perPassengerTotals) && Number.isFinite(Number(perPassengerTotals[idx]))) ? Number(perPassengerTotals[idx]) : (perPassengerPrice || 0);
        const passengerTotalCents = Math.round(Number(perPassengerTotal || 0) * 100);
        const perLegCentsFor = (legKey) => {
          if (!hasReturnLeg) return passengerTotalCents;
          if (roundTripPassengerPricesArePerLeg) return passengerTotalCents;
          const base = Math.floor(passengerTotalCents / 2);
          const rem = passengerTotalCents - (base * 2);
          const outbound = base + (rem > 0 ? 1 : 0);
          if (String(legKey || '').toLowerCase() === 'return') return passengerTotalCents - outbound;
          return outbound;
        };

        const legsForPassenger = [];
        legsForPassenger.push({
          key: 'outbound',
          label: hasReturnLeg ? 'Outbound' : '',
          origin,
          destination,
          departCityTime,
          arriveCityTime,
          departDateTime,
          arriveDateTime
        });
        if (hasReturnLeg) {
          legsForPassenger.push({
            key: 'return',
            label: 'Return',
            origin: returnOrigin,
            destination: returnDestination,
            departCityTime: returnDepartCityTime || returnOrigin,
            arriveCityTime: returnArriveCityTime || returnDestination,
            departDateTime: returnDepartDateTime,
            arriveDateTime: returnArriveDateTime
          });
        }

        let cardsPdfHtml = '';
        const filteredLegs = onlyLegKey
          ? legsForPassenger.filter((l) => l && l.key === onlyLegKey)
          : legsForPassenger;

        filteredLegs.forEach((leg, legIdx) => {
          const ticketNoForCard = ticketNoForLegAt(leg && leg.key) || ticketNoForPassenger;
          const unitPriceText = (perLegCentsFor(leg && leg.key) / 100).toFixed(2);
          const qrText = [
            'E-TICKET',
            `Ref No: ${refNo}`,
            `Ticket No: ${ticketNoForCard}`,
            `Route: ${leg.origin} -> ${leg.destination}${leg.key ? ` (${leg.key})` : ''}`,
            `Departure: ${leg.departDateTime || '-'}`,
            `Arrival: ${leg.arriveDateTime || '-'}`,
            `Passenger: ${pName || '-'}`,
            `Phone: ${pPhone || '-'}`,
            `ID: ${pId || '-'}`,
            `Fare: $${unitPriceText} [${paymentMethod}]`
          ].join('\n');

          const pngBuffer = qr.imageSync(qrText, { type: 'png' });
          const qrDataUri = `data:image/png;base64,${pngBuffer.toString('base64')}`;

          const fallbackLogoHtml = `<div style=\"height:48px;width:48px;border-radius:10px;background:#ede9fe;display:flex;align-items:center;justify-content:center;color:#7c3aed;font-weight:800;font-size:24px;\">J</div>`;
          const pdfLogoSrc = logoDataUri || ticketLogoDataUri;
          const pdfLogoHtml = pdfLogoSrc
            ? `<div style=\"height:72px;display:flex;align-items:center;justify-content:center;width:100%;\"><img src=\"${pdfLogoSrc}\" alt=\"National Tickets Global\" style=\"max-height:64px;max-width:340px;width:auto;display:block;margin:0 auto;object-fit:contain;\" /></div>`
            : fallbackLogoHtml;

          cardsPdfHtml += buildCardHtml(
            leg.label,
            leg.origin,
            leg.destination,
            leg.departCityTime,
            leg.arriveCityTime,
            leg.departDateTime,
            leg.arriveDateTime,
            qrDataUri,
            unitPriceText,
            ticketNoForCard,
            '',
            pdfLogoHtml,
            pSeat,
            pName,
            pPhone,
            pId
          );

          if (legIdx < (filteredLegs.length - 1)) {
            cardsPdfHtml += '<div style="height:16px;"></div>';
          }
        });

        return cardsPdfHtml;
      };

      if (split && cachedZipCandidate && cachedZipCandidate.length) {
        try {
          const expectedCount = (hasReturnLeg ? 2 : 1) * (Array.isArray(list) && list.length ? list.length : 1);
          const inZipCount = countPdfFilesInZipBuffer(cachedZipCandidate);
          if (expectedCount != null && Number.isFinite(Number(expectedCount))) {
            res.setHeader('x-ticket-zip-expected-pdfs', String(expectedCount));
          }
          if (inZipCount != null && Number.isFinite(Number(inZipCount))) {
            res.setHeader('x-ticket-zip-in-pdfs', String(inZipCount));
          }
          res.setHeader('x-ticket-zip-source', 'cache');
          if (inZipCount != null && expectedCount > 0 && inZipCount === expectedCount) {
            const zipName = `etickets-${encodeURIComponent(String(pnr))}.zip`;
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
            res.setHeader('Content-Length', cachedZipCandidate.length);
            return res.end(cachedZipCandidate);
          }
        } catch (_) {
        }
      }

      if (split && (hasReturnLeg || list.length > 1)) {
        const pdfFiles = [];
        if (hasReturnLeg) {
          const legs = ['outbound', 'return'];
          if (list.length > 1) {
            for (let idx = 0; idx < list.length; idx++) {
              const p = list[idx] || {};
              for (const leg of legs) {
                const cardsPdfHtml = await buildPassengerCardsPdfHtml(p, idx, leg);
                if (!cardsPdfHtml) continue;
                const pdfCards = `
                <div style=\"width:100%;background:#f6f7fb;padding:0;\">
                  <table role=\"presentation\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"width:100%;\">
                    <tbody>
                      <tr>
                        <td style=\"padding:0;margin:0;\">
                          ${cardsPdfHtml}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>`;
                const pdfHtml = `<!DOCTYPE html><html><head><meta charset=\"utf-8\" /></head><body style=\"margin:0;padding:0;background:#f6f7fb;\">${pdfCards}</body></html>`;

                const pdfBuffer = await generatePdfFromHtml(pdfHtml, isThermal
                  ? {
                    thermal: true,
                    width: '48mm',
                    autoHeight: true,
                    autoHeightPadding: 0,
                    printBackground: true,
                    viewportWidth: 280,
                    scaleToFitWidth: true,
                    margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' }
                  }
                  : {
                    format: 'A4',
                    printBackground: true,
                    margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' }
                  });

                const name = `eticket-${encodeURIComponent(String(pnr))}-passenger-${idx + 1}-${leg}.pdf`;
                pdfFiles.push({ name, buffer: pdfBuffer });
              }
            }
          } else {
            for (const leg of legs) {
              const p = list[0] || {};
              const cardsPdfHtml = await buildPassengerCardsPdfHtml(p, 0, leg);
              if (!cardsPdfHtml) continue;
              const pdfCards = `
              <div style=\"width:100%;background:#f6f7fb;padding:0;\">
                <table role=\"presentation\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"width:100%;\">
                  <tbody>
                    <tr>
                      <td style=\"padding:0;margin:0;\">
                        ${cardsPdfHtml}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>`;
              const pdfHtml = `<!DOCTYPE html><html><head><meta charset=\"utf-8\" /></head><body style=\"margin:0;padding:0;background:#f6f7fb;\">${pdfCards}</body></html>`;

              const pdfBuffer = await generatePdfFromHtml(pdfHtml, isThermal
                ? {
                  thermal: true,
                  width: '48mm',
                  autoHeight: true,
                  autoHeightPadding: 0,
                  printBackground: true,
                  viewportWidth: 280,
                  scaleToFitWidth: true,
                  margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' }
                }
                : {
                  format: 'A4',
                  printBackground: true,
                  margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' }
                });

              const name = `eticket-${encodeURIComponent(String(pnr))}-${leg}.pdf`;
              pdfFiles.push({ name, buffer: normalizeToBuffer(pdfBuffer) });
            }
          }
        } else {
          for (let idx = 0; idx < list.length; idx++) {
            const p = list[idx] || {};
            const cardsPdfHtml = await buildPassengerCardsPdfHtml(p, idx);
            const pdfCards = `
            <div style=\"width:100%;background:#f6f7fb;padding:0;\">
              <table role=\"presentation\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"width:100%;\">
                <tbody>
                  <tr>
                    <td style=\"padding:0;margin:0;\">
                      ${cardsPdfHtml}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>`;
            const pdfHtml = `<!DOCTYPE html><html><head><meta charset=\"utf-8\" /></head><body style=\"margin:0;padding:0;background:#f6f7fb;\">${pdfCards}</body></html>`;

            const pdfBuffer = await generatePdfFromHtml(pdfHtml, isThermal
              ? {
                thermal: true,
                width: '48mm',
                autoHeight: true,
                autoHeightPadding: 0,
                printBackground: true,
                viewportWidth: 280,
                scaleToFitWidth: true,
                margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' }
              }
              : {
                format: 'A4',
                printBackground: true,
                margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' }
              });

            const name = `eticket-${encodeURIComponent(String(pnr))}-passenger-${idx + 1}.pdf`;
            pdfFiles.push({ name, buffer: normalizeToBuffer(pdfBuffer) });
          }
        }

        let zipBuffer;
        try {
          zipBuffer = await buildZipBuffer(pdfFiles);
        } catch (e) {
          logger.error(`[${requestId}] Failed to build e-ticket ZIP`, {
            pnr: String(pnr),
            error: e && e.message,
            files: (pdfFiles || []).map((f) => ({ name: f && f.name, size: (() => { try { const b = normalizeToBuffer(f && f.buffer); return b && b.length ? b.length : 0; } catch (_) { return 0; } })() }))
          });
          return res.status(502).send('Failed to generate e-ticket ZIP');
        }
        {
          const apiBase = process.env.PUBLIC_API_BASE_URL || process.env.INTERNAL_API_BASE_URL || `${req.protocol}://${req.get('host')}`;
          const url = `${apiBase}/api/ticket/pdf?pnr=${encodeURIComponent(String(pnr))}&download=1`;
          await upsertTicketPdfCache({ pnr, bookedBy, url, which: 'final_zip', pdfBuffer: zipBuffer }).catch(() => {});
        }

        const zipName = `etickets-${encodeURIComponent(String(pnr))}.zip`;
        try {
          const expectedCount = (hasReturnLeg ? 2 : 1) * (Array.isArray(list) && list.length ? list.length : 1);
          const inZipCount = countPdfFilesInZipBuffer(zipBuffer);
          if (expectedCount != null && Number.isFinite(Number(expectedCount))) {
            res.setHeader('x-ticket-zip-expected-pdfs', String(expectedCount));
          }
          if (inZipCount != null && Number.isFinite(Number(inZipCount))) {
            res.setHeader('x-ticket-zip-in-pdfs', String(inZipCount));
          }
          res.setHeader('x-ticket-zip-source', 'generated');
        } catch (_) {}
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
        res.setHeader('Content-Length', zipBuffer.length);
        return res.end(zipBuffer);
      }

      let cardsPdfHtml = '';
      for (let idx = 0; idx < list.length; idx++) {
        const p = list[idx] || {};
        cardsPdfHtml += await buildPassengerCardsPdfHtml(p, idx);

        if (idx < (list.length - 1)) {
          cardsPdfHtml += '<div style="height:16px;"></div>';
        }
      }

      const pdfCards = `
      <div style=\"width:100%;background:#f6f7fb;padding:0;\">
        <table role=\"presentation\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"width:100%;\">
          <tbody>
            <tr>
              <td style=\"padding:0;margin:0;\">
                ${cardsPdfHtml}
              </td>
            </tr>
          </tbody>
        </table>
      </div>`;

      const pdfHtml = `<!DOCTYPE html><html><head><meta charset=\"utf-8\" /></head><body style=\"margin:0;padding:0;background:#f6f7fb;\">${pdfCards}</body></html>`;

      const pdfBuffer = await generatePdfFromHtml(pdfHtml, isThermal
        ? {
          thermal: true,
          width: '48mm',
          autoHeight: true,
          autoHeightPadding: 0,
          printBackground: true,
          viewportWidth: 280,
          scaleToFitWidth: true,
          margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' }
        }
        : {
          format: 'A4',
          printBackground: true,
          margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' }
        });

      if (!looksLikePdfBuffer(pdfBuffer)) {
        res.setHeader('x-ticket-pdf-invalid', '1');
        logger.warn(`[${requestId}] E-ticket PDF generation produced invalid PDF bytes`, { pnr: String(pnr), size: pdfBuffer && pdfBuffer.length ? pdfBuffer.length : 0 });
        return res.status(502).send('Failed to generate valid e-ticket PDF');
      }

      const pdfBufNormalized = normalizeToBuffer(pdfBuffer);
      if (!pdfBufNormalized || !pdfBufNormalized.length) {
        res.setHeader('x-ticket-pdf-invalid', '1');
        logger.warn(`[${requestId}] E-ticket PDF generation produced empty buffer after normalization`, { pnr: String(pnr) });
        return res.status(502).send('Failed to generate valid e-ticket PDF');
      }

      try {
        const apiBaseRaw = process.env.PUBLIC_API_BASE_URL || process.env.INTERNAL_API_BASE_URL || `${req.protocol}://${req.get('host')}`;
        const apiBase = String(apiBaseRaw || '').replace(/\/+$/, '').replace(/\/api$/i, '');
        const url = `${apiBase}/api/ticket/pdf?pnr=${encodeURIComponent(String(pnr))}&download=1`;
        await upsertTicketPdfCache({ pnr, bookedBy, url, which: 'final', pdfBuffer: pdfBufNormalized }).catch(() => {});
      } catch (_) {}

      res.status(200);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="eticket-${encodeURIComponent(String(pnr))}.pdf"`);
      res.setHeader('Content-Length', pdfBufNormalized.length);
      return res.end(pdfBufNormalized);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode || 500).send(error.message || 'Failed to generate e-ticket PDF');
      }
      return res.status(500).send('Failed to generate e-ticket PDF');
    }
  }
);

const unifiedTicketPdfValidators = [
  query('pnr').optional().isString().trim().isLength({ min: 1 }).withMessage('pnr must be a non-empty string')
];


async function unifiedTicketPdfHandler(req, res) {
  const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  res.setHeader('x-ticket-pdf-proxy', 'postgres-only-v1');
  res.setHeader('x-ticket-pdf-request-id', requestId);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  try {
    const v = validationResult(req);
    if (!v.isEmpty()) {
      return res.status(400).send('Invalid parameters');
    }

    const q = req.query || {};
    const pnr = q.pnr || q.reference || q.firestorecartid || q.cartid || q.cart_id;
    if (!pnr) {
      return res.status(400).send('Missing or invalid parameters');
    }

    const explicitTypeRaw = q.type || q.ticketType || q.ticket_type;
    const explicitType = explicitTypeRaw != null ? String(explicitTypeRaw).trim().toLowerCase() : null;

    const forceDownload = q.download === '1' || q.download === 1 || q.download === true || q.download === 'true';

    const wantsZip =
      q.zip === '1' || q.zip === 1 || q.zip === true || q.zip === 'true' ||
      q.downloadZip === '1' || q.download_zip === '1' ||
      q.split === '1' || q.split === 1 || q.split === true || q.split === 'true';

    await ensureTicketsTableExists();

    const metaRows = await drizzleDb
      .select({
        hasHoldPdf: sql`(${ticketsTable.holdPdfBase64} is not null and length(${ticketsTable.holdPdfBase64}) > 0)` ,
        hasFinalPdf: sql`(${ticketsTable.finalPdfBase64} is not null and length(${ticketsTable.finalPdfBase64}) > 0)` ,
        hasFinalZip: sql`(${ticketsTable.finalZipBase64} is not null and length(${ticketsTable.finalZipBase64}) > 0)` ,
      })
      .from(ticketsTable)
      .where(eq(ticketsTable.pnr, String(pnr)))
      .limit(1);

    const meta0 = metaRows && metaRows.length ? (metaRows[0] || {}) : null;

    const redirectToGenerator = () => {
      const baseUrl = req.baseUrl || '/api/ticket';
      const qs = new URLSearchParams(Object.entries(q).map(([k, v]) => [String(k), v == null ? '' : String(v)])).toString();
      if (explicitType === 'hold') {
        const target = `${baseUrl}/hold/pdf/${encodeURIComponent(String(pnr))}${qs ? `?${qs}` : ''}`;
        return res.redirect(302, target);
      }
      const target = `${baseUrl}/eticket/pdf?${new URLSearchParams({ ...Object.fromEntries(Object.entries(q).map(([k, v]) => [String(k), v])), pnr: String(pnr) }).toString()}`;
      return res.redirect(302, target);
    };

    if (!meta0) {
      return redirectToGenerator();
    }

    const hasHoldPdf = !!meta0.hasHoldPdf;
    const hasFinalPdf = !!meta0.hasFinalPdf;
    const hasFinalZip = !!meta0.hasFinalZip;

    const chooseKind = () => {
      if (explicitType === 'hold') {
        return hasHoldPdf ? 'hold' : null;
      }
      if (explicitType === 'final') {
        if (wantsZip && hasFinalZip) return 'final_zip';
        if (hasFinalPdf) return 'final';
        return null;
      }
      if (wantsZip && hasFinalZip) return 'final_zip';
      if (hasFinalPdf) return 'final';
      if (hasHoldPdf) return 'hold';
      return null;
    };

    const chosenKind = chooseKind();
    if (!chosenKind) {
      return redirectToGenerator();
    }

    const blobSelect = chosenKind === 'final_zip'
      ? { b64: ticketsTable.finalZipBase64 }
      : (chosenKind === 'final'
        ? { b64: ticketsTable.finalPdfBase64 }
        : { b64: ticketsTable.holdPdfBase64 });

    const blobRows = await drizzleDb
      .select(blobSelect)
      .from(ticketsTable)
      .where(eq(ticketsTable.pnr, String(pnr)))
      .limit(1);

    const blob0 = blobRows && blobRows.length ? (blobRows[0] || {}) : null;
    const b64 = blob0 && blob0.b64 ? blob0.b64 : null;
    if (!b64 || typeof b64 !== 'string' || !b64.trim()) {
      return redirectToGenerator();
    }

    const outBuf = (() => {
      try {
        const buf = Buffer.from(b64, 'base64');
        return buf && buf.length ? buf : null;
      } catch (_) {
        return null;
      }
    })();

    if (!outBuf || !outBuf.length) {
      return redirectToGenerator();
    }

    if (chosenKind === 'final_zip') {
      try {
        const expected = await expectedFinalZipPdfCountFromPostgres(pnr);
        if (expected == null) {
          return redirectToGenerator();
        }
        const inZipCount = countPdfFilesInZipBuffer(outBuf);
        if (expected != null && Number.isFinite(Number(expected))) {
          res.setHeader('x-ticket-zip-expected-pdfs', String(expected));
        }
        if (inZipCount != null && Number.isFinite(Number(inZipCount))) {
          res.setHeader('x-ticket-zip-in-pdfs', String(inZipCount));
        }
        res.setHeader('x-ticket-zip-source', 'postgres');
        if (expected != null && inZipCount != null && Number(inZipCount) > 0 && Number(expected) > 0 && Number(inZipCount) !== Number(expected)) {
          return redirectToGenerator();
        }
      } catch (_) {
      }
    }

    let outCt = 'application/pdf';
    let filename = `ticket-${encodeURIComponent(String(pnr))}.pdf`;
    let disposition = forceDownload ? 'attachment' : 'inline';

    if (chosenKind === 'hold') {
      filename = `reserved-ticket-${encodeURIComponent(String(pnr))}.pdf`;
    } else if (chosenKind === 'final_zip') {
      outCt = 'application/zip';
      filename = `etickets-${encodeURIComponent(String(pnr))}.zip`;
      disposition = 'attachment';
    } else {
      filename = `eticket-${encodeURIComponent(String(pnr))}.pdf`;
    }

    const h = sha256Hex(outBuf);
    if (h) res.setHeader('x-ticket-pdf-sha256', h);

    res.status(200);
    res.setHeader('Content-Type', outCt);
    res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
    res.setHeader('Content-Length', outBuf.length);
    return res.end(outBuf);
  } catch (error) {
    logger.warn(`[${requestId}] Failed to serve ticket from Postgres`, {
      pnr: String((req.query && (req.query.pnr || req.query.reference || req.query.firestorecartid || req.query.cartid || req.query.cart_id)) || ''),
      error: error && error.message ? error.message : String(error),
    });
    return res.status(500).send('Failed to download ticket. Please try again later.');
  }
}

router.get('/pdf', unifiedTicketPdfValidators, unifiedTicketPdfHandler);

router.get(
  '/pdf/:pnr',
  [
    (req, _res, next) => {
      req.query = { ...(req.query || {}), pnr: req.params.pnr };
      next();
    },
    ...unifiedTicketPdfValidators
  ],
  unifiedTicketPdfHandler
);

router.get('/ticket-url/:pnr', async (req, res) => {
  const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  try {
    const pnr = (req.params && req.params.pnr) ? String(req.params.pnr).trim() : '';
    if (!pnr) {
      return res.status(400).json({ success: false, error: 'Missing pnr', requestId, timestamp: new Date().toISOString() });
    }

    await ensureTicketsTableExists();

    const rows = await drizzleDb
      .select({
        pnr: ticketsTable.pnr,
        bookedBy: ticketsTable.bookedBy,
        url: ticketsTable.url,
        hasHoldPdf: sql`(${ticketsTable.holdPdfBase64} is not null and length(${ticketsTable.holdPdfBase64}) > 0)` ,
        hasFinalPdf: sql`(${ticketsTable.finalPdfBase64} is not null and length(${ticketsTable.finalPdfBase64}) > 0)` ,
        hasFinalZip: sql`(${ticketsTable.finalZipBase64} is not null and length(${ticketsTable.finalZipBase64}) > 0)` ,
        createdAt: ticketsTable.createdAt
      })
      .from(ticketsTable)
      .where(eq(ticketsTable.pnr, pnr))
      .limit(1);

    const frontendBaseRaw = process.env.FRONTEND_URL || process.env.CLIENT_URL || 'https://your-app.com';
    const frontendBase = String(frontendBaseRaw || '').replace(/\/+$/, '');
    const unifiedUrl = `${frontendBase}/tickets/${encodeURIComponent(String(pnr))}`;
    const inferredTypeForUrl = (row) => {
      try {
        if (row && (row.hasFinalPdf || row.hasFinalZip)) return 'final';
        if (row && row.hasHoldPdf) return 'hold';
      } catch (_) {}
      return null;
    };
    const appendTypeIfMissing = (rawUrl, ticketType) => {
      try {
        if (!rawUrl) return rawUrl;
        const s = String(rawUrl);
        if (!ticketType) return s;
        if (/([?&])type=/.test(s)) return s;
        return s.includes('?') ? `${s}&type=${encodeURIComponent(String(ticketType))}` : `${s}?type=${encodeURIComponent(String(ticketType))}`;
      } catch (_) {
        return rawUrl;
      }
    };
    const normalizedUrl = (rawUrl) => {
      if (!rawUrl) return unifiedUrl;
      const s = String(rawUrl);
      if (s.includes('/tickets/')) return s;
      return unifiedUrl;
    };

    const buildDownloadUrl = (ticketType) => {
      try {
        const apiBaseRaw = process.env.PUBLIC_API_BASE_URL || process.env.INTERNAL_API_BASE_URL || `${req.protocol}://${req.get('host')}`;
        const apiBase = String(apiBaseRaw || '').replace(/\/+$/, '').replace(/\/api$/i, '');
        const qs = new URLSearchParams();
        qs.set('pnr', String(pnr));
        qs.set('download', '1');
        if (ticketType === 'final') {
          qs.set('type', 'final');
        } else if (ticketType === 'hold') {
          qs.set('type', 'hold');
        }
        return `${apiBase}/api/ticket/pdf?${qs.toString()}`;
      } catch (_) {
        return null;
      }
    };

    if (rows && rows.length) {
      const row0 = rows[0] || {};
      const ticketType = inferredTypeForUrl(row0);
      const normalized = appendTypeIfMissing(normalizedUrl(row0.url), ticketType);
      if (normalized && row0.url && String(normalized) !== String(row0.url)) {
        try {
          await drizzleDb
            .update(ticketsTable)
            .set({ url: normalized })
            .where(eq(ticketsTable.pnr, pnr));
        } catch (e) {
          logger.warn(`[${requestId}] Failed to migrate ticket URL to unified download link`, { pnr, error: e.message });
        }
      }
      return res.json({
        success: true,
        ticket: { ...row0, url: normalized, ticketType, downloadUrl: buildDownloadUrl(ticketType) },
        stored: true,
        requestId,
        timestamp: new Date().toISOString()
      });
    }

    const url = normalizedUrl(null);
    return res.json({ success: true, ticket: { pnr, url, bookedBy: null, createdAt: null, ticketType: null, downloadUrl: buildDownloadUrl(null) }, stored: false, requestId, timestamp: new Date().toISOString() });
  } catch (error) {
    logger.warn(`[${requestId}] Failed to fetch ticket URL`, { error: error.message });
    return res.status(500).json({ success: false, error: 'Failed to fetch ticket URL', requestId, timestamp: new Date().toISOString() });
  }
});

router.get('/ticket-url/:pnr/redirect', async (req, res) => {
  const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  try {
    const pnr = (req.params && req.params.pnr) ? String(req.params.pnr).trim() : '';
    if (!pnr) {
      return res.status(400).send('Missing pnr');
    }

    const q = req.query || {};
    const frontendBaseRaw = process.env.FRONTEND_URL || process.env.CLIENT_URL || 'https://your-app.com';
    const frontendBase = String(frontendBaseRaw || '').replace(/\/+$/, '');
    const targetBase = `${frontendBase}/tickets/${encodeURIComponent(String(pnr))}`;

    const passthrough = new URLSearchParams();
    const agentMode = q.agentMode || q.agent_mode;
    const agentEmail = q.agentEmail || q.agent_email;
    const agentId = q.agentId || q.agent_id;
    const agentName = q.agentName || q.agent_name;
    const explicitType = q.type || q.ticketType || q.ticket_type;
    if (agentMode != null) passthrough.set('agentMode', String(agentMode));
    if (agentEmail != null) passthrough.set('agentEmail', String(agentEmail));
    if (agentId != null) passthrough.set('agentId', String(agentId));
    if (agentName != null) passthrough.set('agentName', String(agentName));

    const inferredType = explicitType ? String(explicitType) : await getTicketTypeFromPostgres(pnr);
    if (inferredType === 'final' || inferredType === 'hold') passthrough.set('type', inferredType);

    const qs = passthrough.toString();
    const target = qs ? `${targetBase}?${qs}` : targetBase;
    return res.redirect(302, target);
  } catch (error) {
    logger.warn(`[${requestId}] Failed to redirect to ticket URL`, { error: error.message });
    return res.status(500).send('Failed to redirect to ticket URL');
  }
});

// ================================
// ðŸ–¨ï¸ VIEW/PRINT SINGLE E-TICKET (PER PASSENGER)
// ================================
// GET /api/ticket/eticket/print?pnr=...&idx=1
router.get(
  '/eticket/print',
  [
    query('pnr').optional().isString().trim().isLength({ min: 1 }).withMessage('pnr must be a non-empty string'),
    query('idx').optional().isInt({ min: 1 }).withMessage('idx must be a positive integer')
  ],
  async (req, res) => {
  const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  try {
    const v = validationResult(req);
    if (!v.isEmpty()) {
      return res.status(400).send('Invalid parameters');
    }
    const q = req.query || {};
    const pnr = q.pnr || q.reference || q.firestorecartid || q.cartid || q.cart_id;
    const idx = parseInt(q.idx || q.index || '1', 10);
    const legParamRaw = (q.leg || '').toString().toLowerCase();
    const legKey = (legParamRaw === 'outbound' || legParamRaw === 'return') ? legParamRaw : null;
    if (!pnr || Number.isNaN(idx) || idx < 1) {
      return res.status(400).send('Missing or invalid parameters');
    }

    let cart = null;
    if (usePostgresFirstForEticket) {
      cart = await loadTicketCartFromPostgres(pnr, requestId);
    }
    if (!cart && useFirestoreTicketFallback) {
      const db = await getFirestore();
      const fsCartId = await resolveCartDocId(pnr, { createIfMissing: false });
      const doc = await db.collection('carts').doc(fsCartId).get();
      if (doc.exists) {
        cart = doc.data() || {};
      }
    }
    if (!cart) {
      return res.status(404).send('Ticket not found');
    }

    cart = await hydrateEticketCartFromCartsTable(cart, { pnr, cartIdHint: null, requestId });

    let logoBase64 = '';
    try {
      const logoPath = process.env.ETICKET_LOGO_PATH;
      if (logoPath) {
        const logoBuffer = fs.readFileSync(logoPath);
        logoBase64 = logoBuffer.toString('base64');
      }
    } catch (e) {
      logger.warn(`[${requestId}] Failed to load logo for print e-ticket`, { error: e.message });
    }

    // Extract trip details with outbound/return legs (similar to /eticket/send)
    let origin = 'Unknown';
    let destination = 'Unknown';
    let departTs = null;
    let arriveTs = null;
    let returnOrigin = null;
    let returnDestination = null;
    let returnDepartTs = null;
    let returnArriveTs = null;

    const rawTripItems = cart.trip && cart.trip._raw && Array.isArray(cart.trip._raw.items) ? cart.trip._raw.items : null;
    const rawTripItem = rawTripItems && rawTripItems.length ? rawTripItems[0] : null;
    const rawTripItemReturn = rawTripItems && rawTripItems.length > 1 ? rawTripItems[1] : null;
    const segments = rawTripItem && Array.isArray(rawTripItem.segments)
      ? rawTripItem.segments
      : ((cart.busbudResponse && (cart.busbudResponse.segments || (cart.busbudResponse.trip && cart.busbudResponse.trip.segments))) || cart.segments || []);

    let outboundSeg = null;
    let returnSeg = null;

    if (Array.isArray(segments) && segments.length) {
      let outboundFirstSeg = null;
      let outboundLastSeg = null;
      let returnFirstSeg = null;
      let returnLastSeg = null;

      outboundSeg = segments[0];
      outboundFirstSeg = outboundSeg;
      outboundLastSeg = segments[segments.length - 1] || outboundSeg;

      const tripLegs = rawTripItem && Array.isArray(rawTripItem.trip_legs) ? rawTripItem.trip_legs : [];
      if (Array.isArray(tripLegs) && tripLegs.length > 1) {
        const leg1Ids = Array.isArray(tripLegs[0]?.segment_ids) ? tripLegs[0].segment_ids : null;
        const leg2Ids = Array.isArray(tripLegs[1]?.segment_ids) ? tripLegs[1].segment_ids : null;
        const outSegs = pickSegmentsByIds(segments, leg1Ids);
        const retSegs = pickSegmentsByIds(segments, leg2Ids);
        if (outSegs.length) {
          outboundFirstSeg = outSegs[0];
          outboundLastSeg = outSegs[outSegs.length - 1];
          outboundSeg = pickSegmentWithOperator(outSegs) || outboundFirstSeg;
        }
        if (retSegs.length) {
          returnFirstSeg = retSegs[0];
          returnLastSeg = retSegs[retSegs.length - 1];
          returnSeg = pickSegmentWithOperator(retSegs) || returnFirstSeg;
        }
      } else if (segments.length > 1) {
        // No explicit trip_legs: do not treat segments[1] as return (could be a connection)
        returnSeg = null;
      }

      if (!returnSeg && !rawTripItemReturn && Array.isArray(segments) && segments.length > 1 && outboundSeg) {
        const cand = segments[1];
        const oo = segCityName(outboundFirstSeg || outboundSeg, 'origin');
        const od = segCityName(outboundLastSeg || outboundSeg, 'destination');
        const ro = segCityName(cand, 'origin');
        const rd = segCityName(cand, 'destination');
        const norm = (s) => (s == null ? '' : String(s)).trim().toLowerCase();
        const looksLikeReturn = norm(ro) && norm(rd) && norm(oo) && norm(od) && norm(ro) === norm(od) && norm(rd) === norm(oo);
        if (looksLikeReturn) returnSeg = cand;
      }

      if (outboundSeg) {
        const first = outboundFirstSeg || outboundSeg;
        const last = outboundLastSeg || outboundSeg;
        origin = (first.origin && (first.origin.city && first.origin.city.name)) || (first.origin && first.origin.name) || origin;
        destination = (last.destination && (last.destination.city && last.destination.city.name)) || (last.destination && last.destination.name) || destination;
        const dts = (first.departure_time && (first.departure_time.timestamp || first.departure_time)) || (first.departure && first.departure.timestamp) || null;
        const ats = (last.arrival_time && (last.arrival_time.timestamp || last.arrival_time)) || (last.arrival && last.arrival.timestamp) || null;
        departTs = dts ? new Date(dts) : null;
        arriveTs = ats ? new Date(ats) : null;
      }

      if (returnSeg) {
        const first = returnFirstSeg || returnSeg;
        const last = returnLastSeg || returnSeg;
        returnOrigin = (first.origin && (first.origin.city && first.origin.city.name)) || (first.origin && first.origin.name) || null;
        returnDestination = (last.destination && (last.destination.city && last.destination.city.name)) || (last.destination && last.destination.name) || null;
        const rdts = (first.departure_time && (first.departure_time.timestamp || first.departure_time)) || (first.departure && first.departure.timestamp) || null;
        const rats = (last.arrival_time && (last.arrival_time.timestamp || last.arrival_time)) || (last.arrival && last.arrival.timestamp) || null;
        returnDepartTs = rdts ? new Date(rdts) : null;
        returnArriveTs = rats ? new Date(rats) : null;
      }

      if (!returnSeg && rawTripItemReturn && Array.isArray(rawTripItemReturn.segments) && rawTripItemReturn.segments.length) {
        const retSegs = rawTripItemReturn.segments;
        const firstRet = retSegs[0];
        const lastRet = retSegs[retSegs.length - 1];
        returnSeg = pickSegmentWithOperator(retSegs) || firstRet;
        returnFirstSeg = returnFirstSeg || firstRet;
        returnLastSeg = returnLastSeg || lastRet;
        if (!returnOrigin) returnOrigin = segCityName(firstRet, 'origin');
        if (!returnDestination) returnDestination = segCityName(lastRet, 'destination');
        if (!returnDepartTs) returnDepartTs = segTs(firstRet, 'departure');
        if (!returnArriveTs) returnArriveTs = segTs(lastRet, 'arrival');
      }
    } else if (cart.tripDetails) {
      origin = cart.tripDetails.originCity || cart.tripDetails.origin || origin;
      destination = cart.tripDetails.destinationCity || cart.tripDetails.destination || destination;
      departTs = cart.tripDetails.departureTime ? new Date(cart.tripDetails.departureTime) : null;
      arriveTs = cart.tripDetails.arrivalTime ? new Date(cart.tripDetails.arrivalTime) : null;

      returnOrigin = cart.tripDetails.returnOrigin || cart.tripDetails.return_origin || cart.tripDetails.inboundOrigin || cart.tripDetails.inbound_origin || returnOrigin;
      returnDestination = cart.tripDetails.returnDestination || cart.tripDetails.return_destination || cart.tripDetails.inboundDestination || cart.tripDetails.inbound_destination || returnDestination;
      const rd = cart.tripDetails.returnDepartAt || cart.tripDetails.return_depart_at || cart.tripDetails.returnDepartureTime || cart.tripDetails.return_departure_time || null;
      const ra = cart.tripDetails.returnArriveAt || cart.tripDetails.return_arrive_at || cart.tripDetails.returnArrivalTime || cart.tripDetails.return_arrival_time || null;
      returnDepartTs = rd ? new Date(rd) : returnDepartTs;
      returnArriveTs = ra ? new Date(ra) : returnArriveTs;
    }

    if ((!returnOrigin || !returnDestination) && cart.returnOrigin && cart.returnDestination) {
      returnOrigin = cart.returnOrigin;
      returnDestination = cart.returnDestination;
      returnDepartTs = cart.returnDepartAt ? new Date(cart.returnDepartAt) : returnDepartTs;
      returnArriveTs = cart.returnArriveAt ? new Date(cart.returnArriveAt) : returnArriveTs;
    }

    // Consider a return leg present as soon as we know return origin/destination,
    // matching the /eticket/send logic.
    const hasReturnLeg = !!returnOrigin && !!returnDestination;

    // For round trips, require explicit leg selection to avoid consolidated tickets
    if (hasReturnLeg && !legKey) {
      return res.status(400).send('For round trips, you must specify leg=outbound or leg=return');
    }

    // If a specific leg is requested and we have a return leg, switch itinerary accordingly
    if (legKey === 'return' && hasReturnLeg) {
      origin = returnOrigin;
      destination = returnDestination;
      departTs = returnDepartTs;
      arriveTs = returnArriveTs;
    }

    const fmt2 = (n) => String(n).padStart(2, '0');
    const fmtDate = (d) => `${fmt2(d.getDate())}/${fmt2(d.getMonth() + 1)}/${d.getFullYear()}`;
    const fmtTime = (d) => `${fmt2(d.getHours())}:${fmt2(d.getMinutes())}`;

    const departDate = departTs ? fmtDate(departTs) : '-';
    const departTime = departTs ? fmtTime(departTs) : '-';
    const arriveDate = arriveTs ? fmtDate(arriveTs) : '-';
    const arriveTime = arriveTs ? fmtTime(arriveTs) : '-';

    const purchaser = cart.purchaser || cart.purchaserDetails || (cart.passengerDetails && cart.passengerDetails.purchaser) || cart.contact_info || cart.contactInfo || {};

    let pgPassengersPrint = null;
    try {
      const idRows = await drizzleDb
        .select({ passengers: cartPassengerDetails.passengers })
        .from(cartPassengerDetails)
        .where(eq(cartPassengerDetails.firestoreCartId, String(pnr)))
        .limit(1);
      if (idRows && idRows.length && Array.isArray(idRows[0].passengers)) {
        pgPassengersPrint = idRows[0].passengers;
      }
    } catch (e) {
      logger.warn(`[${requestId}] Failed to load passenger IDs from Postgres cartPassengerDetails for print`, { pnr, error: e.message });
    }

    // Build passengers list and pick requested passenger (1-based index)
    const passengersList = (() => {
      const a = Array.isArray(cart.passengers) ? cart.passengers : [];
      const b = cart.passengerDetails && Array.isArray(cart.passengerDetails.passengers) ? cart.passengerDetails.passengers : [];
      const c = cart.trip && Array.isArray(cart.trip.passengers) ? cart.trip.passengers : [];
      const e = cart.busbudResponse && Array.isArray(cart.busbudResponse.passengers) ? cart.busbudResponse.passengers : [];
      const cp = cart.passengerDetails && cart.passengerDetails.completePurchase;
      const fromCP = (() => {
        if (!cp || !Array.isArray(cp.items)) return [];
        const out = [];
        for (const it of cp.items) {
          if (it && it.passenger) out.push(it.passenger);
        }
        return out;
      })();
      const candidates = [fromCP, c, b, a, e].filter(arr => Array.isArray(arr) && arr.length);
      const source = candidates.length ? candidates[0] : [];
      if (!source.length) return [];
      const normalize = (s) => typeof s === 'string' ? s.trim().toLowerCase() : (s == null ? '' : String(s).trim().toLowerCase());
      const normalizeDocCandidate = (val) => {
        if (val == null) return '';
        const raw = String(val).trim();
        if (!raw) return '';
        const looksUuidish = raw.length >= 16 && (raw.includes('-') || raw.includes('_') || /^[a-f0-9-]{16,}$/i.test(raw));
        if (looksUuidish) return '';
        if (/^[0-9]+$/.test(raw) && raw.length <= 4) return '';
        return raw;
      };
      const firstName = (p = {}) => p.first_name || p.firstName || p.given_name || p.givenName || p.name_first || '';
      const lastName = (p = {}) => p.last_name || p.lastName || p.family_name || p.familyName || p.name_last || '';
      const docNo = (p = {}) => {
        if (p.idNumber || p.id_number || p.id_no) return p.idNumber || p.id_number || p.id_no;
        if (p.passport || p.passport_number) return p.passport || p.passport_number;
        if (p.documentNumber || p.document_no) return p.documentNumber || p.document_no;
        if (Array.isArray(p.documents)) {
          const d = p.documents.find(d => d && (d.number || d.value || d.id));
          if (d) {
            if (d.number) return normalizeDocCandidate(d.number);
            if (d.value) return normalizeDocCandidate(d.value);
            if (d.id !== undefined && d.id !== null) {
              return normalizeDocCandidate(d.id);
            }
          }
        }
        if (p.id !== undefined && p.id !== null) {
          return normalizeDocCandidate(p.id);
        }
        return '';
      };
      const seatRaw = (p = {}) => {
        const ss = p && p.selected_seats && p.selected_seats[0];
        if (ss && (ss.seat_id || ss.seat)) return ss.seat_id || ss.seat;
        if (p && (p.seat_id || p.seat || p.selectedSeat)) {
          if (p.seat_id) return p.seat_id;
          if (typeof p.seat === 'string') return p.seat;
          if (p.seat && (p.seat.id || p.seat.code)) return p.seat.id || p.seat.code;
          if (p.selectedSeat) return p.selectedSeat;
        }
        if (p && p.ticket && (p.ticket.seat_id || p.ticket.seat)) return p.ticket.seat_id || p.ticket.seat;
        return '';
      };
      const phoneRaw = (p = {}) => p.phone || p.phoneNumber || '';
      const keyFor = (p = {}) => {
        const doc = docNo(p);
        const base = [firstName(p), lastName(p), doc, phoneRaw(p)].map(normalize).filter(Boolean);
        if (!base.length) {
          const fallback = [seatRaw(p)].map(normalize).filter(Boolean);
          return fallback.join('|');
        }
        if (!hasReturnLeg && !doc) {
          base.push(normalize(seatRaw(p)));
        }
        return base.filter(Boolean).join('|');
      };
      const uniq = [];
      const seen = new Set();
      for (const px of source) {
        const k = keyFor(px);
        if (!k) { uniq.push(px); continue; }
        if (seen.has(k)) continue;
        seen.add(k);
        uniq.push(px);
      }
      return uniq;
    })();

    const firstPassenger = (() => {
      if (Array.isArray(cart.passengers) && cart.passengers.length) return cart.passengers[0];
      if (cart.passengerDetails) {
        if (Array.isArray(cart.passengerDetails.passengers) && cart.passengerDetails.passengers.length) return cart.passengerDetails.passengers[0];
        const cp = cart.passengerDetails.completePurchase;
        if (cp) {
          if (Array.isArray(cp.items) && cp.items.length && cp.items[0].passenger) return cp.items[0].passenger;
          if (cp.user) return { first_name: cp.user.first_name, last_name: cp.user.last_name, phone: cp.user.phone_number };
          if (cp.purchaser) return { first_name: cp.purchaser.first_name, last_name: cp.purchaser.last_name, phone: cp.purchaser.phone_number };
        }
      }
      if (cart.trip && Array.isArray(cart.trip.passengers) && cart.trip.passengers.length) return cart.trip.passengers[0];
      if (Array.isArray(cart.trips) && cart.trips.length && Array.isArray(cart.trips[0].passengers) && cart.trips[0].passengers.length) return cart.trips[0].passengers[0];
      if (cart.busbudResponse && Array.isArray(cart.busbudResponse.passengers) && cart.busbudResponse.passengers.length) return cart.busbudResponse.passengers[0];
      return null;
    })();

    const nameFor = (p = {}) => ([
      p.first_name || p.firstName || p.given_name || p.givenName || p.name_first,
      p.last_name || p.lastName || p.family_name || p.familyName || p.name_last
    ].filter(Boolean).join(' '));
    const idFor = (p = {}, index = 0) => {
      const fromPg = (() => {
        if (!Array.isArray(pgPassengersPrint) || !pgPassengersPrint.length) return null;
        const cand = pgPassengersPrint[index] || pgPassengersPrint[0] || {};
        const direct = cand.idNumber || cand.id_number || cand.id_no || cand.id || cand.passport || cand.passport_number || cand.nationalId || cand.national_id || cand.documentNumber || cand.document_no;
        if (direct) return direct;
        if (Array.isArray(cand.documents) && cand.documents.length) {
          const doc = cand.documents.find(d => d && (d.number || d.value || d.id));
          if (doc) return doc.number || doc.value || doc.id;
        }
        return null;
      })();
      if (fromPg) return fromPg;

      const direct = p.idNumber || p.id_number || p.id_no || p.passport || p.passport_number || p.nationalId || p.national_id || p.documentNumber || p.document_no;
      if (direct) return direct;
      if (Array.isArray(p.documents) && p.documents.length) {
        const doc = p.documents.find(d => d && (d.number || d.value || d.id));
        if (doc) return doc.number || doc.value || doc.id;
      }
      const ci = cart.contact_info || cart.contactInfo || {};
      return purchaser.idNumber || purchaser.id_number || purchaser.id_no || purchaser.passport || purchaser.passport_number || purchaser.nationalId || purchaser.national_id || purchaser.documentNumber || purchaser.document_no ||
             ci.idNumber || ci.id_number || ci.id_no || ci.passport || ci.passport_number || ci.nationalId || ci.national_id || ci.documentNumber || ci.document_no || '-';
    };

    const phoneFor = (p = {}) => p.phone || p.phoneNumber || (cart.contact_info && cart.contact_info.phone) || (cart.contactInfo && cart.contactInfo.phone) || (purchaser && (purchaser.phone || purchaser.phoneNumber)) || '-';

    const expectedCount = (() => {
      const s = (cart.summary && (cart.summary.passengerCount || cart.summary.passengers)) || cart.passengerCount;
      if (typeof s === 'number' && s > 0) return s;
      if (Array.isArray(passengersList) && passengersList.length) return passengersList.length;
      const cands = [];
      if (cart.trip && Array.isArray(cart.trip.passengers)) cands.push(cart.trip.passengers.length);
      if (cart.passengerDetails && Array.isArray(cart.passengerDetails.passengers)) cands.push(cart.passengerDetails.passengers.length);
      if (Array.isArray(cart.passengers)) cands.push(cart.passengers.length);
      if (Array.isArray(cart.trips) && cart.trips.length && Array.isArray(cart.trips[0].passengers)) cands.push(cart.trips[0].passengers.length);
      if (cart.busbudResponse && Array.isArray(cart.busbudResponse.passengers)) cands.push(cart.busbudResponse.passengers.length);
      const n = cands.find(n => typeof n === 'number' && n > 0);
      return n || null;
    })();
    const baseList = passengersList.length ? passengersList : (firstPassenger ? [firstPassenger] : []);
    const list = expectedCount ? baseList.slice(0, expectedCount) : baseList;
    const passenger = list[idx - 1] || list[0] || firstPassenger || {};

    const passengerName = nameFor(passenger) || '-';
    const passengerPhone = phoneFor(passenger);
    const passengerId = idFor(passenger, idx - 1);

    const refNo = pnr;

    const toNumSimple = (v) => (typeof v === 'number') ? v : (typeof v === 'string' ? parseFloat(String(v).match(/[0-9]+(?:\.[0-9]+)?/)?.[0] || 'NaN') : NaN);
    const totalHintMajorPrint = (() => {
      const a = toNumSimple(cart.totalAmount);
      if (Number.isFinite(a) && a > 0) return a;
      const b = toNumSimple(cart.totalPrice);
      if (Number.isFinite(b) && b > 0) return b;
      const c = toNumSimple(cart.total);
      if (Number.isFinite(c) && c > 0) return c;
      return NaN;
    })();
    const invoiceTotalPrint = (() => {
      const a = toNumSimple(cart.invoice && cart.invoice.amount_total);
      if (Number.isFinite(a)) return a;
      const b = toNumSimple(cart.invoice_data && cart.invoice_data.amount_total);
      if (Number.isFinite(b)) return b;
      const c = toNumSimple(cart.invoice && cart.invoice.total);
      if (Number.isFinite(c)) return c;
      const d = toNumSimple(cart.invoice && cart.invoice.amount_untaxed);
      if (Number.isFinite(d)) return d;
      return NaN;
    })();
    const completePurchase = cart.passengerDetails && cart.passengerDetails.completePurchase;
    const priceNumberPrint = (() => {
      try {
        if (typeof cart.totalAmount === 'number' && Number.isFinite(cart.totalAmount) && cart.totalAmount > 0) return cart.totalAmount;
        if (typeof cart.totalAmount === 'string' && cart.totalAmount.trim()) {
          const m = String(cart.totalAmount).match(/[0-9]+(?:\.[0-9]+)?/);
          if (m) {
            const n = parseFloat(m[0]);
            if (Number.isFinite(n) && n > 0) return n;
          }
        }

        const pricingMeta = (cart.passengerDetails && cart.passengerDetails.pricing_metadata) || cart.pricing_metadata;
        if (pricingMeta) {
          if (typeof pricingMeta.canonical_adjusted_total_cents === 'number' && pricingMeta.canonical_adjusted_total_cents > 0) {
            return pricingMeta.canonical_adjusted_total_cents / 100;
          }
          if (typeof pricingMeta.adjusted_total === 'number' && pricingMeta.adjusted_total > 0) {
            return pricingMeta.adjusted_total / 100;
          }
        }

        const inv = cart.invoice || cart.invoice_data;
        if (inv) {
          const invCandidate = inv.amount_total ?? inv.total ?? inv.amount_untaxed;
          const major = toMajorAmountMaybe(invCandidate, totalHintMajorPrint);
          if (major != null && Number.isFinite(major) && major > 0) return major;
        }

        const cp = completePurchase || {};
        if (cp && cp.charges) {
          const ch = cp.charges;
          const cand = ch.amount ?? ch.total ?? ch.subtotal;
          const major = toMajorAmountMaybe(cand, totalHintMajorPrint);
          if (major != null && Number.isFinite(major) && major > 0) return major;
        }
        const cpItem = (completePurchase && Array.isArray(completePurchase.items) && completePurchase.items.length) ? completePurchase.items[0] : null;
        if (cpItem && cpItem.display_price) {
          const dp = cpItem.display_price;
          const cand = dp.amount ?? dp.total;
          const major = toMajorAmountMaybe(cand, totalHintMajorPrint);
          if (major != null && Number.isFinite(major) && major > 0) return major;
        }
      } catch (_) {}
      return null;
    })();

    const totalForDivisionPrint = (priceNumberPrint != null && Number.isFinite(Number(priceNumberPrint)) && Number(priceNumberPrint) > 0)
      ? Number(priceNumberPrint)
      : (Number.isFinite(invoiceTotalPrint) && invoiceTotalPrint > 0)
        ? invoiceTotalPrint
        : (Number.isFinite(toNumSimple(cart.totalPrice)) ? toNumSimple(cart.totalPrice)
        : (Number.isFinite(toNumSimple(cart.total)) ? toNumSimple(cart.total) : 0));
    const perPassengerTotalsPrint = computePerPassengerTotals({ passengers: list, completePurchase, totalMajor: totalForDivisionPrint });
    const passengerCountPrint = list.length || 1;
    let perPassengerPrint = (Array.isArray(perPassengerTotalsPrint) && Number.isFinite(Number(perPassengerTotalsPrint[idx - 1])))
      ? Number(perPassengerTotalsPrint[idx - 1])
      : Number(totalForDivisionPrint / passengerCountPrint);
    if (!Number.isFinite(perPassengerPrint)) perPassengerPrint = 0;
    let perLegPrint = perPassengerPrint;
    const roundTripPassengerPricesArePerLegPrint = (() => {
      try {
        if (!hasReturnLeg) return false;
        if (!Array.isArray(perPassengerTotalsPrint) || !perPassengerTotalsPrint.length) return false;
        const sum = perPassengerTotalsPrint.reduce((acc, v) => acc + (Number.isFinite(Number(v)) ? Number(v) : 0), 0);
        if (!Number.isFinite(sum) || sum <= 0) return false;
        if (!Number.isFinite(Number(totalForDivisionPrint)) || Number(totalForDivisionPrint) <= 0) return false;
        const tol = Math.max(0.05, (list.length || 1) * 0.05);
        const diffTotal = Math.abs(sum - Number(totalForDivisionPrint));
        const diffLeg = Math.abs(sum * 2 - Number(totalForDivisionPrint));
        if (diffLeg <= tol && diffLeg < diffTotal) return true;
        return false;
      } catch (_) {
        return false;
      }
    })();
    if (legKey && hasReturnLeg && !roundTripPassengerPricesArePerLegPrint) {
      const passengerTotalCents = Math.round(Number(perPassengerPrint || 0) * 100);
      const base = Math.floor(passengerTotalCents / 2);
      const rem = passengerTotalCents - (base * 2);
      const outbound = base + (rem > 0 ? 1 : 0);
      const legCents = String(legKey || '').toLowerCase() === 'return'
        ? (passengerTotalCents - outbound)
        : outbound;
      perLegPrint = legCents / 100;
    }
    const unitPriceText = Number(perLegPrint).toFixed(2);
    const paymentMethod = cart.paymentMethod || 'Online';
    const ticketUuid = (cart.passengerDetails && cart.passengerDetails.completePurchase && (cart.passengerDetails.completePurchase.uuid || cart.passengerDetails.completePurchase.id)) || (cart.purchase && (cart.purchase.uuid || cart.purchase.id)) || refNo;
    const bookedByName = (await resolveBookedByFromPostgres(refNo)) || 'online';

    // Build QR Data URL
    const ticketNoForQr = (() => {
      try {
        const idx0 = (typeof idx === 'number' && Number.isFinite(idx)) ? (idx - 1) : 0;
        const passengerCount = Array.isArray(list) ? list.length : null;
        return ticketNoForPassengerLeg(completePurchase, idx0, legKey, passengerCount, passenger) || ticketNoForPassenger;
      } catch (_) {
        return ticketNoForPassenger;
      }
    })();

    const qrText = [
      'E-TICKET',
      `Ref No: ${refNo}`,
      `Ticket No: ${ticketNoForQr}`,
      `Route: ${origin} -> ${destination}${legKey ? ` (${legKey})` : ''}`,
      `Departure: ${(`${departDate} ${departTime}`).trim() || '-'}`,
      `Arrival: ${(`${arriveDate} ${arriveTime}`).trim() || '-'}`,
      `Passenger: ${passengerName || '-'}`,
      `Phone: ${passengerPhone || '-'}`,
      `ID: ${passengerId || '-'}`,
      `Fare: $${unitPriceText} [${paymentMethod}]`
    ].join('\n');
    const qrPng = qr.imageSync(qrText, { type: 'png' });
    const qrDataUrl = `data:image/png;base64,${qrPng.toString('base64')}`;

    // Determine mode for print label
    const agentBooking = (() => {
      try {
        const modeHdr = (req.get && req.get('x-agent-mode')) || (req.headers && req.headers['x-agent-mode']);
        if (modeHdr && String(modeHdr).toLowerCase() === 'true') return true;
        const hdrName = (req.get && req.get('x-agent-name')) || (req.headers && req.headers['x-agent-name']);
        const hdrEmail = (req.get && req.get('x-agent-email')) || (req.headers && req.headers['x-agent-email']);
        const hdrId = (req.get && req.get('x-agent-id')) || (req.headers && req.headers['x-agent-id']);
        if (hdrName || hdrEmail || hdrId) return true;
        const qMode = (req.query && (req.query.agentMode || req.query.agent_mode));
        if (qMode && String(qMode).toLowerCase() === 'true') return true;
        const bMode = (req.body && (req.body.agentMode || req.body.agent_mode));
        if (bMode && String(bMode).toLowerCase() === 'true') return true;
        const base = cart || {};
        const baseMode = base.agentMode === true || String(base.agentMode).toLowerCase() === 'true' || (base.agent && (base.agent.agentMode === true || String(base.agent.agentMode).toLowerCase() === 'true'));
        if (baseMode) return true;
      } catch (_) {}
      return false;
    })();
    const bookedByDisplay = bookedByName;

    // Render EJS template
    res.setHeader('Content-Type', 'text/html');
    return res.render('ticket', {
      ticket: {
        ticket_no: ticketNoForQr,
        ref_no: refNo,
        price: `$${unitPriceText} [${paymentMethod}]`,
        booked_by: bookedByDisplay,
        uuid: ticketUuid
      },
      passenger: {
        name: passengerName,
        phone: passengerPhone,
        id: passengerId
      },
      itinerary: {
        depart_city: origin,
        depart_date: departDate,
        depart_time: departTime,
        arrive_city: destination,
        arrive_date: arriveDate,
        arrive_time: arriveTime
      },
      contact: {
        phone: process.env.SUPPORT_PHONE || '+263 867790 0600'
      },
      qrDataUrl,
      assets: { logoBase64 }
    });
  } catch (error) {
    logger.error(`[${requestId}] Print ticket error`, { message: error.message, stack: error.stack });
    if (error instanceof ApiError) {
      return res.status(error.statusCode || 500).send(error.message || 'Failed to render ticket');
    }
    return res.status(500).send('Failed to render ticket');
  }
});

// ================================
// ðŸ“‹ GET TICKET DETAILS
// ================================
// GET /api/ticket/cart/:cartId/:ticketId
// Gets ticket details from the cart's tickets subcollection
// Query params: ?purchaseId=string (optional)
router.get('/cart/:cartId/:ticketId', async (req, res) => {
  const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const startTime = Date.now();
  const { cartId, ticketId } = req.params;
  const { purchaseId } = req.query;

  if (!isProduction) {
    console.log(`\n=== TICKET DETAILS REQUEST ===`);
    console.log(`[${requestId}] ðŸ“¨ HTTP Method: ${req.method}`);
    console.log(`[${requestId}] ðŸ”— URL: ${req.originalUrl}`);
    console.log(`[${requestId}] ðŸ“¦ Params:`, JSON.stringify(req.params, null, 2));
    console.log(`[${requestId}] ðŸ“¦ Query:`, JSON.stringify(req.query, null, 2));
  }

  logger.info(`ðŸ“‹ [${requestId}] Ticket details request`, {
    cartId,
    ticketId,
    purchaseId,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    params: req.params,
    query: req.query
  });

  if (!cartId || !ticketId) {
    if (!isProduction) {
      console.log(`[${requestId}] âŒ VALIDATION ERROR: Missing cart ID or ticket ID`);
    }
    return res.status(400).json({
      success: false,
      error: 'Missing cart ID or ticket ID',
      requestId,
      timestamp: new Date().toISOString(),
      suggestions: [
        'Ensure cartId and ticketId are included in URL path',
        'Check frontend code for cartId and ticketId parameters'
      ]
    });
  }

  try {
    if (!isProduction) {
      console.log(`[${requestId}] ðŸ“ž Getting ticket from Firestore...`);
    }
    const ticket = await getTicket(cartId, ticketId);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        error: 'Ticket not found',
        requestId,
        timestamp: new Date().toISOString()
      });
    }

    if (!isProduction) {
      console.log(`[${requestId}] ðŸ“¥ Ticket retrieved successfully`);
    }

    const responseTime = Date.now() - startTime;
    logger.info(`âœ… [${requestId}] Ticket details retrieved in ${responseTime}ms`);

    res.json({
      success: true,
      ticket
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;
    if (!isProduction) {
      console.log(`[${requestId}] âŒ Ticket details error after ${responseTime}ms:`);
      console.log(`[${requestId}] Error:`, error.message);
    }

    logger.error(`âŒ [${requestId}] Ticket details error:`, {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cartId,
      ticketId,
      purchaseId
    });

    const errorResponse = {
      success: false,
      error: {
        message: error.message,
        type: 'TICKET_DETAILS_ERROR'
      },
      requestId,
      timestamp: new Date().toISOString()
    };

    const statusCode = error.code === 'NOT_FOUND' ? 404 : 500;
    return res.status(statusCode).json(errorResponse);
  }
});

// ================================
// ðŸŽ« GET TICKETS BY CART
// ================================
// GET /api/ticket/cart/:cartId
// Gets all tickets for a specific cart/purchase
router.get('/cart/:cartId', async (req, res) => {
  const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const startTime = Date.now();
  const { cartId } = req.params;

  if (!isProduction) {
    console.log(`\n=== TICKETS BY CART REQUEST ===`);
    console.log(`[${requestId}] ðŸ“¨ Getting tickets for cart: ${cartId}`);
  }

  logger.info(`ðŸŽ« [${requestId}] Tickets by cart request`, {
    cartId,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  if (!cartId) {
    return res.status(400).json({
      success: false,
      error: 'Missing cart ID',
      requestId,
      timestamp: new Date().toISOString(),
      suggestions: [
        'Ensure cartId is included in URL path',
        'Check frontend code for cartId parameter'
      ]
    });
  }

  try {
    if (!isProduction) {
      console.log(`[${requestId}] ðŸ“ž Getting tickets from in-memory storage...`);
    }
    const ticketsForCart = await getTicketsByCartId(cartId);

    if (!isProduction) {
      console.log(`[${requestId}] ðŸ“¥ Found ${ticketsForCart.length} tickets`);
    }

    const responseTime = Date.now() - startTime;
    logger.info(`âœ… [${requestId}] Tickets retrieved in ${responseTime}ms`);

    res.json({
      success: true,
      tickets: ticketsForCart
    });

  } catch (error) {
    if (!isProduction) {
      console.log(`[${requestId}] âŒ Error getting tickets for cart:`, error.message);
    }

    logger.error(`âŒ [${requestId}] Tickets by cart error:`, {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cartId
    });

    res.status(500).json({
      success: false,
      error: {
        message: error.message,
        type: 'TICKET_RETRIEVAL_ERROR'
      },
      cart_id: cartId,
      tickets: [],
      requestId,
      timestamp: new Date().toISOString()
    });
  }
});

// ================================
// ðŸ“§ HOLD ROUTE
// ================================
// POST /api/ticket/hold
// Emails the PNR and trip itinerary to the purchaser's email
router.post('/hold', async (req, res) => {
  const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const startTime = Date.now();
  try {
    const body = req.body || {};
    const lower = Object.fromEntries(Object.entries(body).map(([k, v]) => [String(k).toLowerCase(), v]));
    let pnr = lower.pnr || lower.firestorecartid || lower.cartid || lower.cart_id;
    const providedCartId = lower.cartid || lower.cart_id || null;
    const debugHold = Boolean(lower.debug || lower._debug || lower.debughold || lower.debug_hold || (req.query && (req.query.debug === '1' || req.query.debug === 'true')));
    if (!pnr) {
      return res.status(400).json({
        success: false,
        error: 'Missing pnr (firestoreCartId)',
        requestId,
        timestamp: new Date().toISOString()
      });
    }

    const db = await getFirestore();
    const fsCartId = await resolveCartDocId(pnr, { createIfMissing: false });
    const firestoreCartIdForPg = String(fsCartId || pnr);
    const doc = await db.collection('carts').doc(fsCartId).get();
    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        error: 'PNR not found',
        pnr,
        requestId,
        timestamp: new Date().toISOString()
      });
    }

    const cart = doc.data() || {};
    let purchaser = cart.purchaser || cart.purchaserDetails || (cart.passengerDetails && cart.passengerDetails.purchaser) || cart.contact_info || cart.contactInfo || {};
    let email = (purchaser && (purchaser.email || purchaser.Email)) || (cart.contact_info && cart.contact_info.email) || (cart.contactInfo && cart.contactInfo.email) || cart.email;

    let pgPassengers = null;
    try {
      const pgRows = await drizzleDb
        .select({
          purchaserFirstName: cartPassengerDetails.purchaserFirstName,
          purchaserLastName: cartPassengerDetails.purchaserLastName,
          purchaserEmail: cartPassengerDetails.purchaserEmail,
          purchaserPhone: cartPassengerDetails.purchaserPhone,
          passengers: cartPassengerDetails.passengers,
          purchaserRaw: cartPassengerDetails.purchaser,
          cartId: cartPassengerDetails.cartId
        })
        .from(cartPassengerDetails)
        .where(eq(cartPassengerDetails.firestoreCartId, firestoreCartIdForPg))
        .limit(1);
      if (pgRows && pgRows.length) {
        const row = pgRows[0];
        if (Array.isArray(row.passengers)) {
          pgPassengers = row.passengers;
        }
        const basePurchaser = row.purchaserRaw && typeof row.purchaserRaw === 'object' ? row.purchaserRaw : {};
        const fullName = [row.purchaserFirstName, row.purchaserLastName].filter(Boolean).join(' ');
        const pgPurchaser = {
          ...basePurchaser,
          first_name: row.purchaserFirstName || basePurchaser.first_name || basePurchaser.firstName,
          last_name: row.purchaserLastName || basePurchaser.last_name || basePurchaser.lastName,
          name: basePurchaser.name || fullName || undefined,
          email: row.purchaserEmail || basePurchaser.email || basePurchaser.Email,
          phone: row.purchaserPhone || basePurchaser.phone || basePurchaser.phone_number || basePurchaser.phoneNumber
        };
        purchaser = { ...purchaser, ...pgPurchaser };
        email = row.purchaserEmail || email || pgPurchaser.email || pgPurchaser.Email || email;
      }
    } catch (e) {
      logger.warn(`[${requestId}] Failed to derive purchaser from Postgres cartPassengerDetails`, { pnr, error: e.message });
    }

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Purchaser email not found',
        pnr,
        requestId,
        timestamp: new Date().toISOString()
      });
    }

    let origin = 'Unknown';
    let destination = 'Unknown';
    let departTs = null;
    let arriveTs = null;
    let returnOrigin = null;
    let returnDestination = null;
    let returnDepartTs = null;
    let returnArriveTs = null;

    const rawTripItems = cart.trip && cart.trip._raw && Array.isArray(cart.trip._raw.items) ? cart.trip._raw.items : null;
    const rawTripItem = rawTripItems && rawTripItems.length ? rawTripItems[0] : null;
    const rawTripItemReturn = rawTripItems && rawTripItems.length > 1 ? rawTripItems[1] : null;
    const segments = rawTripItem && Array.isArray(rawTripItem.segments)
      ? rawTripItem.segments
      : ((cart.busbudResponse && (cart.busbudResponse.segments || (cart.busbudResponse.trip && cart.busbudResponse.trip.segments))) || cart.segments || []);

    let outboundSeg = null;
    let returnSeg = null;

    if (Array.isArray(segments) && segments.length) {
      let outboundFirstSeg = null;
      let outboundLastSeg = null;
      let returnFirstSeg = null;
      let returnLastSeg = null;

      outboundSeg = segments[0];
      outboundFirstSeg = outboundSeg;
      outboundLastSeg = segments[segments.length - 1] || outboundSeg;

      const tripLegs = rawTripItem && Array.isArray(rawTripItem.trip_legs) ? rawTripItem.trip_legs : [];
      if (Array.isArray(tripLegs) && tripLegs.length > 1) {
        const leg1Ids = Array.isArray(tripLegs[0]?.segment_ids) ? tripLegs[0].segment_ids : null;
        const leg2Ids = Array.isArray(tripLegs[1]?.segment_ids) ? tripLegs[1].segment_ids : null;
        const outSegs = pickSegmentsByIds(segments, leg1Ids);
        const retSegs = pickSegmentsByIds(segments, leg2Ids);
        if (outSegs.length) {
          outboundFirstSeg = outSegs[0];
          outboundLastSeg = outSegs[outSegs.length - 1];
          outboundSeg = pickSegmentWithOperator(outSegs) || outboundFirstSeg;
        }
        if (retSegs.length) {
          returnFirstSeg = retSegs[0];
          returnLastSeg = retSegs[retSegs.length - 1];
          returnSeg = pickSegmentWithOperator(retSegs) || returnFirstSeg;
        }
      } else if (segments.length > 1) {
        // No explicit trip_legs: do not treat segments[1] as return (could be a connection)
        returnSeg = null;
      }

      if (outboundSeg) {
        const first = outboundFirstSeg || outboundSeg;
        const last = outboundLastSeg || outboundSeg;
        origin = (first.origin && (first.origin.city && first.origin.city.name)) || (first.origin && first.origin.name) || origin;
        destination = (last.destination && (last.destination.city && last.destination.city.name)) || (last.destination && last.destination.name) || destination;
        const dts = (first.departure_time && (first.departure_time.timestamp || first.departure_time)) || (first.departure && first.departure.timestamp) || null;
        const ats = (last.arrival_time && (last.arrival_time.timestamp || last.arrival_time)) || (last.arrival && last.arrival.timestamp) || null;
        departTs = dts ? new Date(dts) : null;
        arriveTs = ats ? new Date(ats) : null;
      }

      if (returnSeg) {
        const first = returnFirstSeg || returnSeg;
        const last = returnLastSeg || returnSeg;
        returnOrigin = (first.origin && (first.origin.city && first.origin.city.name)) || (first.origin && first.origin.name) || null;
        returnDestination = (last.destination && (last.destination.city && last.destination.city.name)) || (last.destination && last.destination.name) || null;
        const rdts = (first.departure_time && (first.departure_time.timestamp || first.departure_time)) || (first.departure && first.departure.timestamp) || null;
        const rats = (last.arrival_time && (last.arrival_time.timestamp || last.arrival_time)) || (last.arrival && last.arrival.timestamp) || null;
        returnDepartTs = rdts ? new Date(rdts) : null;
        returnArriveTs = rats ? new Date(rats) : null;
      }

      if (!returnSeg && rawTripItemReturn && Array.isArray(rawTripItemReturn.segments) && rawTripItemReturn.segments.length) {
        const retSegs = rawTripItemReturn.segments;
        const firstRet = retSegs[0];
        const lastRet = retSegs[retSegs.length - 1];
        returnSeg = pickSegmentWithOperator(retSegs) || firstRet;
        returnFirstSeg = returnFirstSeg || firstRet;
        returnLastSeg = returnLastSeg || lastRet;
        if (!returnOrigin) returnOrigin = segCityName(firstRet, 'origin');
        if (!returnDestination) returnDestination = segCityName(lastRet, 'destination');
        if (!returnDepartTs) returnDepartTs = segTs(firstRet, 'departure');
        if (!returnArriveTs) returnArriveTs = segTs(lastRet, 'arrival');
      }
    } else if (cart.tripDetails) {
      origin = cart.tripDetails.originCity || cart.tripDetails.origin || origin;
      destination = cart.tripDetails.destinationCity || cart.tripDetails.destination || destination;
      departTs = cart.tripDetails.departureTime ? new Date(cart.tripDetails.departureTime) : null;
      arriveTs = cart.tripDetails.arrivalTime ? new Date(cart.tripDetails.arrivalTime) : null;

      returnOrigin = cart.tripDetails.returnOrigin || cart.tripDetails.return_origin || cart.tripDetails.inboundOrigin || cart.tripDetails.inbound_origin || returnOrigin;
      returnDestination = cart.tripDetails.returnDestination || cart.tripDetails.return_destination || cart.tripDetails.inboundDestination || cart.tripDetails.inbound_destination || returnDestination;
      const rd = cart.tripDetails.returnDepartAt || cart.tripDetails.return_depart_at || cart.tripDetails.returnDepartureTime || cart.tripDetails.return_departure_time || null;
      const ra = cart.tripDetails.returnArriveAt || cart.tripDetails.return_arrive_at || cart.tripDetails.returnArrivalTime || cart.tripDetails.return_arrival_time || null;
      returnDepartTs = rd ? new Date(rd) : returnDepartTs;
      returnArriveTs = ra ? new Date(ra) : returnArriveTs;
    }

    if ((!returnOrigin || !returnDestination) && cart.returnOrigin && cart.returnDestination) {
      returnOrigin = cart.returnOrigin;
      returnDestination = cart.returnDestination;
      returnDepartTs = cart.returnDepartAt ? new Date(cart.returnDepartAt) : returnDepartTs;
      returnArriveTs = cart.returnArriveAt ? new Date(cart.returnArriveAt) : returnArriveTs;
    }

    if (true) {
      try {
        let tsRow = null;
        const rowsByFs = await drizzleDb
          .select({ raw: tripSelections.raw })
          .from(tripSelections)
          .where(eq(tripSelections.firestoreCartId, firestoreCartIdForPg))
          .limit(1);
        if (rowsByFs && rowsByFs.length) {
          tsRow = rowsByFs[0];
        } else {
          const pgCartId = providedCartId || cart.busbudCartId || cart.cartId || cart.cart_id || null;
          if (pgCartId) {
            const rowsByCart = await drizzleDb
              .select({ raw: tripSelections.raw })
              .from(tripSelections)
              .where(eq(tripSelections.cartId, String(pgCartId)))
              .limit(1);
            if (rowsByCart && rowsByCart.length) {
              tsRow = rowsByCart[0];
            }
          }
        }
        if (tsRow && tsRow.raw) {
          const tsRaw = tsRow.raw;
          let tsSegments = null;

          const tsItems = Array.isArray(tsRaw.items) ? tsRaw.items : null;
          const tsItem0 = tsItems && tsItems.length ? tsItems[0] : null;
          const tsItem1 = tsItems && tsItems.length > 1 ? tsItems[1] : null;
          const tsOutSegs = tsItem0 && Array.isArray(tsItem0.segments) ? tsItem0.segments : null;
          const tsRetSegs = tsItem1 && Array.isArray(tsItem1.segments) ? tsItem1.segments : null;

          if (tsOutSegs && tsOutSegs.length) {
            const tripLegs = tsItem0 && Array.isArray(tsItem0.trip_legs) ? tsItem0.trip_legs : [];
            if (Array.isArray(tripLegs) && tripLegs.length > 1) {
              const leg1Ids = Array.isArray(tripLegs[0]?.segment_ids) ? tripLegs[0].segment_ids : null;
              const leg2Ids = Array.isArray(tripLegs[1]?.segment_ids) ? tripLegs[1].segment_ids : null;
              const outSegs = pickSegmentsByIds(tsOutSegs, leg1Ids);
              const retSegs = pickSegmentsByIds(tsOutSegs, leg2Ids);
              if (outSegs.length) {
                const first = outSegs[0];
                const last = outSegs[outSegs.length - 1];
                origin = segCityName(first, 'origin') || origin;
                destination = segCityName(last, 'destination') || destination;
                departTs = departTs || segTs(first, 'departure');
                arriveTs = arriveTs || segTs(last, 'arrival');
                if (!outboundSeg || !segmentHasOperator(outboundSeg)) outboundSeg = pickSegmentWithOperator(outSegs) || first;
              }
              if (retSegs.length) {
                const first = retSegs[0];
                const last = retSegs[retSegs.length - 1];
                returnOrigin = returnOrigin || segCityName(first, 'origin');
                returnDestination = returnDestination || segCityName(last, 'destination');
                returnDepartTs = returnDepartTs || segTs(first, 'departure');
                returnArriveTs = returnArriveTs || segTs(last, 'arrival');
                if (!returnSeg || !segmentHasOperator(returnSeg)) returnSeg = pickSegmentWithOperator(retSegs) || first;
              }
              tsSegments = tsOutSegs;
            } else {
              const first = tsOutSegs[0];
              const last = tsOutSegs[tsOutSegs.length - 1];
              origin = segCityName(first, 'origin') || origin;
              destination = segCityName(last, 'destination') || destination;
              departTs = departTs || segTs(first, 'departure');
              arriveTs = arriveTs || segTs(last, 'arrival');
              tsSegments = tsOutSegs;
            }
          }

          if (tsRetSegs && tsRetSegs.length) {
            const first = tsRetSegs[0];
            const last = tsRetSegs[tsRetSegs.length - 1];
            returnOrigin = returnOrigin || segCityName(first, 'origin');
            returnDestination = returnDestination || segCityName(last, 'destination');
            returnDepartTs = returnDepartTs || segTs(first, 'departure');
            returnArriveTs = returnArriveTs || segTs(last, 'arrival');
            if (!returnSeg || !segmentHasOperator(returnSeg)) returnSeg = pickSegmentWithOperator(tsRetSegs) || first;
          }

          // Some Busbud payloads represent round trips as raw.trips = [outboundTrip, returnTrip]
          // rather than raw.items = [outboundItem, returnItem]. Support that shape as a fallback.
          if (tsRaw.trips && typeof tsRaw.trips === 'object') {
            const tripsArr = Array.isArray(tsRaw.trips) ? tsRaw.trips : Object.values(tsRaw.trips);
            const t0 = tripsArr && tripsArr.length ? tripsArr[0] : null;
            const t1 = tripsArr && tripsArr.length > 1 ? tripsArr[1] : null;
            const t0Segs = t0 && Array.isArray(t0.segments) ? t0.segments : null;
            const t1Segs = t1 && Array.isArray(t1.segments) ? t1.segments : null;

            if ((!tsOutSegs || !tsOutSegs.length) && t0Segs && t0Segs.length) {
              const first = t0Segs[0];
              const last = t0Segs[t0Segs.length - 1];
              origin = segCityName(first, 'origin') || origin;
              destination = segCityName(last, 'destination') || destination;
              departTs = departTs || segTs(first, 'departure');
              arriveTs = arriveTs || segTs(last, 'arrival');
              if (!outboundSeg || !segmentHasOperator(outboundSeg)) outboundSeg = pickSegmentWithOperator(t0Segs) || first;
              if (!tsSegments) tsSegments = t0Segs;
            }

            if ((!tsRetSegs || !tsRetSegs.length) && t1Segs && t1Segs.length) {
              const first = t1Segs[0];
              const last = t1Segs[t1Segs.length - 1];
              returnOrigin = returnOrigin || segCityName(first, 'origin');
              returnDestination = returnDestination || segCityName(last, 'destination');
              returnDepartTs = returnDepartTs || segTs(first, 'departure');
              returnArriveTs = returnArriveTs || segTs(last, 'arrival');
              if (!returnSeg || !segmentHasOperator(returnSeg)) returnSeg = pickSegmentWithOperator(t1Segs) || first;
            }
          }

          if (!tsSegments && Array.isArray(tsRaw.items) && tsRaw.items.length && Array.isArray(tsRaw.items[0].segments)) {
            tsSegments = tsRaw.items[0].segments;
          }
          if (!tsSegments && Array.isArray(tsRaw.segments)) {
            tsSegments = tsRaw.segments;
          }
          if (!tsSegments && tsRaw.trip && Array.isArray(tsRaw.trip.segments)) {
            tsSegments = tsRaw.trip.segments;
          }
          if (!tsSegments && tsRaw.trips && typeof tsRaw.trips === 'object') {
            const tripsArr = Array.isArray(tsRaw.trips) ? tsRaw.trips : Object.values(tsRaw.trips);
            if (tripsArr.length && Array.isArray(tripsArr[0].segments)) {
              tsSegments = tripsArr[0].segments;
            }
          }
          if (Array.isArray(tsSegments) && tsSegments.length) {
            const tsOutboundSeg = tsSegments[0];
            if (tsOutboundSeg) {
              const segHasOperator = (s) => {
                if (!s) return false;
                if (s.operator_name || s.operatorName) return true;
                if (typeof s.operator === 'string' && String(s.operator).trim()) return true;
                const op = s.operator || {};
                return !!(op.name || op.label || op.operator_name || op.operatorName || op.xid);
              };
              const o = (tsOutboundSeg.origin && (tsOutboundSeg.origin.city && tsOutboundSeg.origin.city.name)) || (tsOutboundSeg.origin && tsOutboundSeg.origin.name) || null;
              const d = (tsOutboundSeg.destination && (tsOutboundSeg.destination.city && tsOutboundSeg.destination.city.name)) || (tsOutboundSeg.destination && tsOutboundSeg.destination.name) || null;
              const dts = (tsOutboundSeg.departure_time && (tsOutboundSeg.departure_time.timestamp || tsOutboundSeg.departure_time)) || (tsOutboundSeg.departure && tsOutboundSeg.departure.timestamp) || null;
              const ats = (tsOutboundSeg.arrival_time && (tsOutboundSeg.arrival_time.timestamp || tsOutboundSeg.arrival_time)) || (tsOutboundSeg.arrival && tsOutboundSeg.arrival.timestamp) || null;
              if (o) origin = o;
              if (d) destination = d;
              if (!outboundSeg || !segHasOperator(outboundSeg)) outboundSeg = tsOutboundSeg;
              if (dts) {
                const dDate = new Date(dts);
                if (!Number.isNaN(dDate.getTime())) {
                  departTs = dDate;
                }
              }
              if (ats) {
                const aDate = new Date(ats);
                if (!Number.isNaN(aDate.getTime())) {
                  arriveTs = aDate;
                }
              }
            }
            const tsHasItem0Segs = Array.isArray(tsRaw.items) && tsRaw.items.length && tsRaw.items[0] && Array.isArray(tsRaw.items[0].segments) && tsRaw.items[0].segments.length;
            if (!tsHasItem0Segs && tsSegments.length > 1 && (!returnOrigin || !returnDestination)) {
              const tsReturnSeg = tsSegments[1];
              if (tsReturnSeg) {
                const segHasOperator = (s) => {
                  if (!s) return false;
                  if (s.operator_name || s.operatorName) return true;
                  if (typeof s.operator === 'string' && String(s.operator).trim()) return true;
                  const op = s.operator || {};
                  return !!(op.name || op.label || op.operator_name || op.operatorName || op.xid);
                };
                const ro = (tsReturnSeg.origin && (tsReturnSeg.origin.city && tsReturnSeg.origin.city.name)) || (tsReturnSeg.origin && tsReturnSeg.origin.name) || null;
                const rd = (tsReturnSeg.destination && (tsReturnSeg.destination.city && tsReturnSeg.destination.city.name)) || (tsReturnSeg.destination && tsReturnSeg.destination.name) || null;
                const norm = (s) => (s == null ? '' : String(s)).trim().toLowerCase();
                const looksLikeReturn = norm(ro) && norm(rd) && norm(origin) && norm(destination) && norm(ro) === norm(destination) && norm(rd) === norm(origin);
                if (looksLikeReturn) {
                  const rdts = (tsReturnSeg.departure_time && (tsReturnSeg.departure_time.timestamp || tsReturnSeg.departure_time)) || (tsReturnSeg.departure && tsReturnSeg.departure.timestamp) || null;
                  const rats = (tsReturnSeg.arrival_time && (tsReturnSeg.arrival_time.timestamp || tsReturnSeg.arrival_time)) || (tsReturnSeg.arrival && tsReturnSeg.arrival.timestamp) || null;
                  if (ro) returnOrigin = ro;
                  if (rd) returnDestination = rd;
                  if (!returnSeg || !segHasOperator(returnSeg)) returnSeg = tsReturnSeg;
                  if (rdts) {
                    const rdDate = new Date(rdts);
                    if (!Number.isNaN(rdDate.getTime())) {
                      returnDepartTs = rdDate;
                    }
                  }
                  if (rats) {
                    const raDate = new Date(rats);
                    if (!Number.isNaN(raDate.getTime())) {
                      returnArriveTs = raDate;
                    }
                  }
                }
              }
            }
          }
        }
      } catch (e) {
        logger.warn(`[${requestId}] Failed to derive trip details from Postgres tripSelections`, { pnr, error: e.message });
      }
    }

    const departStr = departTs ? new Date(departTs).toLocaleString() : 'Unknown';
    const arriveStr = arriveTs ? new Date(arriveTs).toLocaleString() : 'Unknown';
    const hasReturnLeg = !!returnOrigin && !!returnDestination;
    const returnDepartStr = returnDepartTs ? new Date(returnDepartTs).toLocaleString() : 'Unknown';
    const returnArriveStr = returnArriveTs ? new Date(returnArriveTs).toLocaleString() : 'Unknown';

    const debugTrip = debugHold ? {
      inputPnr: String(pnr),
      fsCartId: String(fsCartId || ''),
      firestoreCartIdForPg: String(firestoreCartIdForPg || ''),
      providedCartId: providedCartId ? String(providedCartId) : null,
      cartBusbudCartId: cart && (cart.busbudCartId || cart.cartId || cart.cart_id) ? String(cart.busbudCartId || cart.cartId || cart.cart_id) : null,
      origin,
      destination,
      departTs: departTs ? new Date(departTs).toISOString() : null,
      arriveTs: arriveTs ? new Date(arriveTs).toISOString() : null,
      returnOrigin,
      returnDestination,
      returnDepartTs: returnDepartTs ? new Date(returnDepartTs).toISOString() : null,
      returnArriveTs: returnArriveTs ? new Date(returnArriveTs).toISOString() : null,
      hasReturnLeg,
      rawTripItemsLen: Array.isArray(rawTripItems) ? rawTripItems.length : 0,
      rawTripItemHasTripLegs: !!(rawTripItem && Array.isArray(rawTripItem.trip_legs) && rawTripItem.trip_legs.length),
      rawTripItemSegmentsLen: rawTripItem && Array.isArray(rawTripItem.segments) ? rawTripItem.segments.length : 0,
      rawTripItemReturnSegmentsLen: rawTripItemReturn && Array.isArray(rawTripItemReturn.segments) ? rawTripItemReturn.segments.length : 0,
      cartSegmentsLen: Array.isArray(cart && cart.segments) ? cart.segments.length : 0,
      busbudResponseSegmentsLen: Array.isArray(cart && cart.busbudResponse && cart.busbudResponse.segments) ? cart.busbudResponse.segments.length : 0
    } : null;

    const toNumSimple = (v) => (typeof v === 'number'
      ? v
      : (typeof v === 'string'
        ? parseFloat(String(v).match(/[0-9]+(?:\.[0-9]+)?/)?.[0] || 'NaN')
        : NaN));
    const priceCurrency = (() => {
      const pdAdj = cart.passengerDetails && cart.passengerDetails.busbudResponse && (cart.passengerDetails.busbudResponse.retail_price || cart.passengerDetails.busbudResponse.adjusted_charges);
      const pdOrig = cart.passengerDetails && cart.passengerDetails.busbudResponse && (cart.passengerDetails.busbudResponse.cost_price || cart.passengerDetails.busbudResponse.original_charges);
      const bbAdj = cart.busbudResponse && (cart.busbudResponse.retail_price || cart.busbudResponse.adjusted_charges);
      const bbOrig = cart.busbudResponse && (cart.busbudResponse.cost_price || cart.busbudResponse.original_charges);
      if (pdAdj && pdAdj.currency) return pdAdj.currency;
      if (pdOrig && pdOrig.currency) return pdOrig.currency;
      if (bbAdj && bbAdj.currency) return bbAdj.currency;
      if (bbOrig && bbOrig.currency) return bbOrig.currency;
      if (cart.summary && cart.summary.currency) return cart.summary.currency;
      if (cart.apiMetadata && cart.apiMetadata.currency) return cart.apiMetadata.currency;
      if (cart.trip && cart.trip.currency) return cart.trip.currency;
      return 'USD';
    })();
    let totalPriceNumber = null;
    if (typeof cart.totalAmount === 'number') {
      totalPriceNumber = cart.totalAmount;
    } else if (typeof cart.totalAmount === 'string' && cart.totalAmount.trim()) {
      const n = toNumSimple(cart.totalAmount);
      if (Number.isFinite(n)) totalPriceNumber = n;
    }

    if (totalPriceNumber == null) {
      const pdAdj = cart.passengerDetails && cart.passengerDetails.busbudResponse && (cart.passengerDetails.busbudResponse.retail_price || cart.passengerDetails.busbudResponse.adjusted_charges);
      if (pdAdj && pdAdj.total != null) {
        const n = toNumSimple(pdAdj.total);
        if (Number.isFinite(n)) totalPriceNumber = n / 100;
      }
    }

    if (totalPriceNumber == null) {
      const pdOrig = cart.passengerDetails && cart.passengerDetails.busbudResponse && (cart.passengerDetails.busbudResponse.cost_price || cart.passengerDetails.busbudResponse.original_charges);
      if (pdOrig && pdOrig.total != null) {
        const base = toNumSimple(pdOrig.total);
        if (Number.isFinite(base)) {
          try {
            const adj = applyPriceAdjustments(base / 100, { currency: pdOrig.currency || priceCurrency, returnMetadata: true });
            if (adj && typeof adj.adjustedAmount === 'number') {
              totalPriceNumber = adj.adjustedAmount;
            } else {
              totalPriceNumber = base / 100;
            }
          } catch (_) {
            totalPriceNumber = base / 100;
          }
        }
      }
    }

    if (totalPriceNumber == null) {
      const bbAdj = cart.busbudResponse && (cart.busbudResponse.retail_price || cart.busbudResponse.adjusted_charges);
      if (bbAdj && bbAdj.total != null) {
        const n = toNumSimple(bbAdj.total);
        if (Number.isFinite(n)) totalPriceNumber = n / 100;
      }
    }

    const totalPriceText = totalPriceNumber != null && Number.isFinite(Number(totalPriceNumber))
      ? `${Number(totalPriceNumber).toFixed(2)} ${priceCurrency}`
      : null;

    let priceText = totalPriceText;

    const completePurchase = cart.passengerDetails && cart.passengerDetails.completePurchase;
    const firstPassenger = (() => {
      if (Array.isArray(cart.passengers) && cart.passengers.length) return cart.passengers[0];
      if (cart.passengerDetails) {
        if (Array.isArray(cart.passengerDetails.passengers) && cart.passengerDetails.passengers.length) return cart.passengerDetails.passengers[0];
        const cp = completePurchase;
        if (cp) {
          if (Array.isArray(cp.items) && cp.items.length && cp.items[0].passenger) return cp.items[0].passenger;
          if (cp.user) return { first_name: cp.user.first_name, last_name: cp.user.last_name, phone: cp.user.phone_number };
          if (cp.purchaser) return { first_name: cp.purchaser.first_name, last_name: cp.purchaser.last_name, phone: cp.purchaser.phone_number };
        }
      }
      if (cart.trip && Array.isArray(cart.trip.passengers) && cart.trip.passengers.length) return cart.trip.passengers[0];
      if (Array.isArray(cart.trips) && cart.trips.length && Array.isArray(cart.trips[0].passengers) && cart.trips[0].passengers.length) return cart.trips[0].passengers[0];
      if (cart.busbudResponse && Array.isArray(cart.busbudResponse.passengers) && cart.busbudResponse.passengers.length) return cart.busbudResponse.passengers[0];
      return null;
    })();

    const passengerName = (firstPassenger && [
      firstPassenger.first_name || firstPassenger.firstName,
      firstPassenger.last_name || firstPassenger.lastName
    ].filter(Boolean).join(' ')) || null;

    const operatorName = (() => {
      const fromPurchase = deriveOperatorFromPurchase(completePurchase);
      if (fromPurchase) return fromPurchase;
      const fromCart =
        (cart.trip && (
          cart.trip.operator_name ||
          cart.trip.operatorName ||
          (typeof cart.trip.operator === 'string' ? cart.trip.operator : null) ||
          (cart.trip.operator && (cart.trip.operator.name || cart.trip.operator.operator_name || cart.trip.operator.operatorName || cart.trip.operator.label || cart.trip.operator.xid))
        )) ||
        (cart.tripDetails && (cart.tripDetails.operator || cart.tripDetails.operator_name || cart.tripDetails.operatorName)) ||
        (typeof cart.operator === 'string' ? cart.operator : null) ||
        (cart.operator && (cart.operator.name || cart.operator.operator_name || cart.operator.operatorName || cart.operator.label || cart.operator.xid)) ||
        null;
      if (fromCart) return fromCart;

      const seg = outboundSeg || {};
      const segOp = seg.operator || {};
      return (
        seg.operator_name ||
        seg.operatorName ||
        (typeof seg.operator === 'string' ? seg.operator : null) ||
        segOp.name ||
        segOp.label ||
        segOp.operator_name ||
        segOp.operatorName ||
        segOp.xid ||
        '-'
      );
    })();

    let savedHoldTicket = null;
    try {
      const busbudCartId = cart.busbudCartId || cart.cartId || cart.cart_id || null;
      const cartDocId = pnr || busbudCartId;
      if (cartDocId) {
        const fmt2 = (n) => String(n).padStart(2, '0');
        const fmtDate = (d) => `${fmt2(d.getDate())}/${fmt2(d.getMonth() + 1)}/${d.getFullYear()}`;
        const fmtTime = (d) => `${fmt2(d.getHours())}:${fmt2(d.getMinutes())}`;

        const departDate = departTs ? fmtDate(departTs) : '-';
        const departTime = departTs ? fmtTime(departTs) : '-';
        const arriveDate = arriveTs ? fmtDate(arriveTs) : '-';
        const arriveTime = arriveTs ? fmtTime(arriveTs) : '-';

        let qrDataUrl = null;
        try {
          const qrPayload = { pnr, passenger: { index: 1, name: passengerName || null } };
          const qrPng = qr.imageSync(JSON.stringify(qrPayload), { type: 'png' });
          qrDataUrl = `data:image/png;base64,${qrPng.toString('base64')}`;
        } catch (e) {
          logger.warn(`[${requestId}] Failed to generate QR for hold ticket`, { pnr, error: e.message });
        }

        const contactPhone = process.env.SUPPORT_PHONE || '+263 867790 0600';

        // Derive seat number and passenger id similar to final ticket logic

        const passengerId = (() => {
          const p = (firstPassenger || {})
          const direct = p.idNumber || p.id_number || p.id_no || p.id || p.passport || p.passport_number || p.nationalId || p.national_id || p.documentNumber || p.document_no;
          if (direct) return direct;
          if (Array.isArray(p.documents)) {
            const doc = p.documents.find(d => d && (d.number || d.value || d.id));
            if (doc) return doc.number || doc.value || doc.id;
          }
          if (Array.isArray(pgPassengers) && pgPassengers.length) {
            const cand = pgPassengers[0] || {};
            const d = cand.idNumber || cand.id_number || cand.id_no || cand.id || cand.passport || cand.passport_number || cand.nationalId || cand.national_id || cand.documentNumber || cand.document_no;
            if (d) return d;
            if (Array.isArray(cand.documents)) {
              const doc = cand.documents.find(d => d && (d.number || d.value || d.id));
              if (doc) return doc.number || doc.value || doc.id;
            }
          }
          const pr = purchaser || {};
          const ci = cart.contact_info || cart.contactInfo || {};
          return pr.idNumber || pr.id_number || pr.id_no || pr.passport || pr.passport_number || pr.nationalId || pr.national_id || pr.documentNumber || pr.document_no ||
                 ci.idNumber || ci.id_number || ci.id_no || ci.passport || ci.passport_number || ci.nationalId || ci.national_id || ci.documentNumber || ci.document_no || '-';
        })();

        // Compute a unit price per leg similar to final ticket view
        const toNumSimple = (v) => (typeof v === 'number') ? v : (typeof v === 'string' ? parseFloat(String(v).match(/[0-9]+(?:\.[0-9]+)?/)?.[0] || 'NaN') : NaN);
        const passengerCount = (() => {
          const s = (cart.summary && (cart.summary.passengerCount || cart.summary.passengers)) || cart.passengerCount;
          if (typeof s === 'number' && s > 0) return s;
          const cands = [];
          if (cart.trip && Array.isArray(cart.trip.passengers)) cands.push(cart.trip.passengers.length);
          if (cart.passengerDetails && Array.isArray(cart.passengerDetails.passengers)) cands.push(cart.passengerDetails.passengers.length);
          if (Array.isArray(cart.passengers)) cands.push(cart.passengers.length);
          if (Array.isArray(cart.trips) && cart.trips.length && Array.isArray(cart.trips[0].passengers)) cands.push(cart.trips[0].passengers.length);
          if (cart.busbudResponse && Array.isArray(cart.busbudResponse.passengers)) cands.push(cart.busbudResponse.passengers.length);
          const n = cands.find(n => typeof n === 'number' && n > 0);
          return n || 1;
        })();
        const totalForDivision = Number.isFinite(Number(totalPriceNumber)) ? Number(totalPriceNumber) : (Number.isFinite(toNumSimple(cart.totalPrice)) ? toNumSimple(cart.totalPrice) : (Number.isFinite(toNumSimple(cart.total)) ? toNumSimple(cart.total) : 0));
        const perPassenger = passengerCount > 0 ? (totalForDivision / passengerCount) : totalForDivision;
        const unitPriceText = Number.isFinite(perPassenger) ? perPassenger.toFixed(2) : null;
        const paymentMethod = cart.paymentMethod || 'Awaiting payment';

        const ticketOptions = {
          pnr,
          ref_no: pnr,
          ticket: {
            ref_no: pnr,
            ticket_no: null,
            price: unitPriceText ? `$${unitPriceText} [${paymentMethod}]` : (priceText || null),
            booked_by: (await resolveBookedByFromPostgres(pnr)) || 'online'
          },
          passenger: {
            name: passengerName || null,
            id: passengerId,
            phone: (purchaser && (purchaser.phone || purchaser.phoneNumber)) || null
          },
          itinerary: {
            depart_city: origin,
            depart_date: departDate,
            depart_time: departTime,
            arrive_city: destination,
            arrive_date: arriveDate,
            arrive_time: arriveTime
          },
          contact: {
            phone: contactPhone
          },
          qrDataUrl,
          price: priceText || null,
          operatorName
        };

        const ticketId = `ticket_${Date.now()}`;
        savedHoldTicket = {
          id: ticketId,
          cartId: cartDocId,
          status: 'pending',
          type: 'hold',
          isHold: true,
          pnr,
          options: ticketOptions
        };

        // Fire-and-forget save; response still returns the generated ticket even if save fails.
        saveTicket(savedHoldTicket).catch(err => {
          logger.warn(`[${requestId}] Failed to persist hold e-ticket`, { pnr, error: err.message });
        });
      }
    } catch (e) {
      logger.warn(`[${requestId}] Failed to save hold e-ticket for frontend`, { pnr, error: e.message });
    }

    const passengerCountForHoldEmail = (() => {
      try {
        const c = cart || {};
        const s = (c.summary && (c.summary.passengerCount || c.summary.passengers)) || c.passengerCount;
        if (typeof s === 'number' && s > 0) return s;
        const cands = [];
        if (c.trip && Array.isArray(c.trip.passengers)) cands.push(c.trip.passengers.length);
        if (c.passengerDetails && Array.isArray(c.passengerDetails.passengers)) cands.push(c.passengerDetails.passengers.length);
        if (Array.isArray(c.passengers)) cands.push(c.passengers.length);
        if (Array.isArray(c.trips) && c.trips.length && Array.isArray(c.trips[0].passengers)) cands.push(c.trips[0].passengers.length);
        if (c.busbudResponse && Array.isArray(c.busbudResponse.passengers)) cands.push(c.busbudResponse.passengers.length);
        const n = cands.find(n => typeof n === 'number' && n > 0);
        return n || 1;
      } catch (_) {
        return 1;
      }
    })();

    const passengersForHoldEmail = (() => {
      try {
        if (Array.isArray(pgPassengers) && pgPassengers.length) return pgPassengers;
        const c = cart || {};
        const p1 = Array.isArray(c.passengers) ? c.passengers : [];
        if (p1.length) return p1;
        const p2 = (c.passengerDetails && Array.isArray(c.passengerDetails.passengers)) ? c.passengerDetails.passengers : [];
        if (p2.length) return p2;
        const p3 = (c.trip && Array.isArray(c.trip.passengers)) ? c.trip.passengers : [];
        if (p3.length) return p3;
        const p4 = Array.isArray(c.requiredPassengers) ? c.requiredPassengers : [];
        if (p4.length) return p4;
      } catch (_) {}
      return [];
    })();

    const totalForDivision = (() => {
      const toNumSimple = (v) => (typeof v === 'number')
        ? v
        : (typeof v === 'string'
          ? parseFloat(String(v).match(/[0-9]+(?:\.[0-9]+)?/)?.[0] || 'NaN')
          : NaN);
      const fromTotalPriceNumber = Number(totalPriceNumber);
      if (Number.isFinite(fromTotalPriceNumber)) return fromTotalPriceNumber;
      const fromCartTotalPrice = toNumSimple(cart && cart.totalPrice);
      if (Number.isFinite(fromCartTotalPrice)) return fromCartTotalPrice;
      const fromCartTotal = toNumSimple(cart && cart.total);
      if (Number.isFinite(fromCartTotal)) return fromCartTotal;
      const fromPriceText = toNumSimple(priceText);
      return Number.isFinite(fromPriceText) ? fromPriceText : NaN;
    })();

    const currencyPrefixForHold = (typeof priceText === 'string' && priceText.includes('$')) ? '$' : '';
    const totalPriceTextForHold = Number.isFinite(Number(totalForDivision))
      ? `${currencyPrefixForHold}${Number(totalForDivision).toFixed(2)}`
      : (priceText || '-');
    const perPassengerPriceTextForHold = (Number.isFinite(Number(totalForDivision)) && passengerCountForHoldEmail > 0)
      ? `${currencyPrefixForHold}${Number(totalForDivision / passengerCountForHoldEmail).toFixed(2)}`
      : null;
    const fallbackPriceBreakdownTextForHoldEmail = (perPassengerPriceTextForHold && passengerCountForHoldEmail > 0)
      ? `${perPassengerPriceTextForHold} x ${passengerCountForHoldEmail} = ${totalPriceTextForHold}`
      : totalPriceTextForHold;
    const breakdownForHoldEmail = computeHoldAdultChildBreakdown({
      passengers: passengersForHoldEmail,
      completePurchase,
      totalMajor: totalForDivision,
      currencyPrefix: currencyPrefixForHold,
      fallbackCount: passengerCountForHoldEmail
    });
    const passengersTextForHoldEmail = (breakdownForHoldEmail && breakdownForHoldEmail.passengersText) ? breakdownForHoldEmail.passengersText : String(passengerCountForHoldEmail);
    const priceBreakdownTextPlainForHoldEmail = (breakdownForHoldEmail && breakdownForHoldEmail.breakdownPlain) ? breakdownForHoldEmail.breakdownPlain : fallbackPriceBreakdownTextForHoldEmail;
    const priceBreakdownTextHtmlForHoldEmail = (breakdownForHoldEmail && breakdownForHoldEmail.breakdownHtml) ? breakdownForHoldEmail.breakdownHtml : fallbackPriceBreakdownTextForHoldEmail;

    const subject = `Your Reservation is Confirmed - PNR ${pnr}`;
    let text = `Success! Your booking is confirmed and your ticket is reserved. Simply use the reservation number below at any Pick n Pay store to purchase and collect your tickets. This ticket is valid for 12hrs.\n\nPNR: ${pnr}`;
    text += `\nPassengers: ${passengersTextForHoldEmail}`;
    text += `\nPrice breakdown: ${priceBreakdownTextPlainForHoldEmail}`;
    if (operatorName && operatorName !== '-') {
      text += `\nOperator: ${operatorName}`;
    }

    const frontendBaseRaw = process.env.FRONTEND_URL || process.env.CLIENT_URL || 'https://your-app.com';
    const frontendBase = String(frontendBaseRaw || '').replace(/\/+$/, '');
    const ticketViewLink = `${frontendBase}/tickets/${encodeURIComponent(String(pnr))}?type=hold`;

    text += `\n\nHow to Pay In-Store`;
    text += `\n1. Present Ref No: ${pnr} to teller.`;
    text += `\n2. Pay at any TM Pick n Pay BancABC kiosk.`;
    text += `\n3. Obtain your printed receipt and confirmation.`;
    text += `\n4. Check your email for your official e-ticket.`;
    text += `\n5. Support & Payments through agent, WhatsApp: +263 783 911 611.`;

    text += `\n\nView your reservation online:`;
    text += `\n${ticketViewLink}`;

    // Outbound leg block
    text += `\n\nOutbound:\nFrom: ${origin}\nTo: ${destination}\nDeparture: ${departStr}\nArrival: ${arriveStr}`;

    // Return leg details (round trips only)
    if (hasReturnLeg && returnOrigin && returnDestination) {
      text += `\n\nReturn Trip:\nFrom: ${returnOrigin}\nTo: ${returnDestination}\nDeparture: ${returnDepartStr}\nArrival: ${returnArriveStr}`;
    }

    let html = `<div><h2>Reservation Confirmed</h2><p>Success! Your booking is confirmed and your ticket is reserved. Simply use the reservation number below at any Pick n Pay store to purchase and collect your tickets. This ticket is valid for 12hrs.</p><p><strong>PNR:</strong> ${pnr}</p>`;
    html += `<p><strong>Passengers:</strong> ${passengersTextForHoldEmail}</p>`;
    html += `<p><strong>Price breakdown:</strong> ${priceBreakdownTextHtmlForHoldEmail}</p>`;
    if (operatorName && operatorName !== '-') {
      html += `<p><strong>Operator:</strong> ${operatorName}</p>`;
    }

    html += `<h3 style="text-align:left;">How to Pay In-Store</h3>`;
    html += `<ol style="text-align:left;">`;
    html += `<li>Present Ref No: ${pnr} to teller.</li>`;
    html += `<li>Pay at any TM Pick n Pay BancABC kiosk.</li>`;
    html += `<li>Obtain your printed receipt and confirmation.</li>`;
    html += `<li>Check your email for your official e-ticket.</li>`;
    html += `<li>Support &amp; Payments through agent, WhatsApp: +263 783 911 611.</li>`;
    html += `</ol>`;

    html += `<p style="margin:12px 0 0 0;"><strong>View your reservation online:</strong> <a href="${ticketViewLink}">${ticketViewLink}</a></p>`;

    // Outbound leg block
    html += `<p><strong>Outbound:</strong><br/><strong>From:</strong> ${origin}<br/><strong>To:</strong> ${destination}</p><p><strong>Departure:</strong> ${departStr}<br/><strong>Arrival:</strong> ${arriveStr}</p>`;

    if (hasReturnLeg && returnOrigin && returnDestination) {
      html += `<hr/><p><strong>Return:</strong><br/><strong>From:</strong> ${returnOrigin}<br/><strong>To:</strong> ${returnDestination}</p><p><strong>Departure:</strong> ${returnDepartStr}<br/><strong>Arrival:</strong> ${returnArriveStr}</p>`;
    }
    html += `</div>`;

    const attachments = [];
    try {
      const refNo = pnr;
      const departCity = origin;
      const arriveCity = destination;
      const fmt2 = (n) => String(n).padStart(2, '0');
      const fmtDate = (d) => `${fmt2(d.getDate())}/${fmt2(d.getMonth() + 1)}/${d.getFullYear()}`;
      const fmtTime = (d) => `${fmt2(d.getHours())}:${fmt2(d.getMinutes())}`;
      const departDate = departTs ? fmtDate(departTs) : '-';
      const departTime = departTs ? fmtTime(departTs) : '-';
      const arriveDate = arriveTs ? fmtDate(arriveTs) : '-';
      const arriveTime = arriveTs ? fmtTime(arriveTs) : '-';
      const returnDepartDate = returnDepartTs ? fmtDate(returnDepartTs) : '-';
      const returnDepartTime = returnDepartTs ? fmtTime(returnDepartTs) : '-';
      const returnArriveDate = returnArriveTs ? fmtDate(returnArriveTs) : '-';
      const returnArriveTime = returnArriveTs ? fmtTime(returnArriveTs) : '-';

      let qrDataUrl = null;
      try {
        const qrPayload = { pnr, passenger: { index: 1, name: passengerName || null } };
        const qrPng = qr.imageSync(JSON.stringify(qrPayload), { type: 'png' });
        qrDataUrl = `data:image/png;base64,${qrPng.toString('base64')}`;
      } catch (_) {}

      const looksLikeEmail = (v) => {
        if (!v) return false;
        const s = String(v).trim();
        return /@/.test(s) && /\./.test(s);
      };

      let bookedByDisplay = (await resolveBookedByFromPostgres(pnr)) || 'online';
      if (!bookedByDisplay) bookedByDisplay = 'online';
      if (looksLikeEmail(bookedByDisplay)) {
        bookedByDisplay = String(bookedByDisplay);
      }

      const holdCompactMode = !!(hasReturnLeg && returnOrigin && returnDestination);
      const holdZoom = holdCompactMode ? 0.92 : 1;
      const holdOuterPadY = 0;
      const holdOuterPadX = 0;
      const holdInnerPad = holdCompactMode ? 16 : 24;
      const holdSectionMargin = holdCompactMode ? 10 : 16;
      const holdBoxPad = holdCompactMode ? 8 : 12;
      const holdBaseFont = holdCompactMode ? 14 : 16;
      const holdSmallFont = holdCompactMode ? 13 : 14;
      const holdHeadingFont = holdCompactMode ? 16 : 18;
      const holdPriceFont = holdCompactMode ? 18 : 20;
      const holdOlFont = holdCompactMode ? 12 : 14;
      const holdQrSize = holdCompactMode ? 96 : 120;
      const holdQrCellWidth = holdCompactMode ? 120 : 150;
      const holdExpiryDeadlineHours = (() => {
        const raw = process.env.INSTORE_PAYMENT_DEADLINE_HOURS || '12';
        const n = Number(raw);
        return Number.isFinite(n) && n > 0 ? n : 12;
      })();

      const toDateFromUnknownHold = (raw) => {
        try {
          if (!raw) return null;
          if (typeof raw === 'object' && (raw._seconds || raw.seconds)) {
            const seconds = raw._seconds || raw.seconds;
            const nanos = raw._nanoseconds || raw.nanoseconds || 0;
            const d = new Date(Number(seconds) * 1000 + Number(nanos) / 1000000);
            return Number.isNaN(d.getTime()) ? null : d;
          }
          const d = new Date(raw);
          return Number.isNaN(d.getTime()) ? null : d;
        } catch (_) {
          return null;
        }
      };

      const holdExpiryDateObj = (() => {
        const tt = (savedHoldTicket && savedHoldTicket.options && savedHoldTicket.options.ticket) ? savedHoldTicket.options.ticket : null;
        const oo = (savedHoldTicket && savedHoldTicket.options) ? savedHoldTicket.options : null;
        const raw =
          (tt && (tt.expiresAt || tt.expires_at || tt.expiryDate || tt.expiry_date || tt.expirationDate || tt.expiration_date || tt.x_datetime)) ||
          (oo && (oo.expiresAt || oo.expires_at || oo.expiryDate || oo.expiry_date || oo.expirationDate || oo.expiration_date || oo.x_datetime)) ||
          null;
        return toDateFromUnknownHold(raw);
      })();

      const holdExpiryFallbackBase = (() => {
        const raw = (savedHoldTicket && (savedHoldTicket.updatedAt || savedHoldTicket.createdAt)) || (cart && (cart.updatedAt || cart.createdAt)) || null;
        return toDateFromUnknownHold(raw) || new Date();
      })();

      const holdExpiryFinal = holdExpiryDateObj || new Date(holdExpiryFallbackBase.getTime() + holdExpiryDeadlineHours * 60 * 60 * 1000);
      const holdExpiryText = holdExpiryFinal ? `${fmtDate(holdExpiryFinal)} ${fmtTime(holdExpiryFinal)}` : 'the expiry time shown on your reserved ticket';

      const reservedCardHtml = `
      <div style="width:100%;background:#f6f7fb;padding:${holdOuterPadY}px ${holdOuterPadX}px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%;">
          <tbody>
            <tr>
              <td style="padding:0;margin:0;">
                <div style=\"width:100%;background:#ffffff;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;border-radius:12px;box-shadow:0 10px 25px rgba(0,0,0,0.08);overflow:hidden;border:1px solid #e5e7eb;margin-bottom:0;zoom:${holdZoom};\">
                  <div style=\"padding:${holdInnerPad}px;\">
                    <div style=\"text-align:center;margin-bottom:14px;\">
                      ${ticketLogoDataUri
                        ? `<img src=\"${ticketLogoDataUri}\" alt=\"National Tickets Global\" style=\"display:block;margin:0 auto;max-width:360px;width:100%;height:auto;object-fit:contain;\" />`
                        : `<div style=\\\"display:inline-flex;align-items:center;gap:12px;\\\"><div style=\\\"height:48px;width:48px;border-radius:10px;background:#ede9fe;display:flex;align-items:center;justify-content:center;color:#7c3aed;font-weight:800;font-size:24px;\\\">J</div><div style=\\\"font-weight:800;color:#7B1FA2;font-size:16px;\\\">National Tickets Global</div></div>`}
                    </div>

                    <div style=\"display:flex;align-items:center;gap:12px;padding:12px 14px;background:#fef3c7;border:1px solid #fbbf24;border-radius:8px;\">
                      <div style=\"height:32px;width:32px;border-radius:9999px;background:#fbbf24;display:flex;align-items:center;justify-content:center;color:#92400e;font-weight:900;\">R</div>
                      <div>
                        <div style=\"font-weight:800;color:#92400e;\">TICKET RESERVED</div>
                        <div style=\"font-size:${holdSmallFont}px;color:#92400e;font-weight:900;margin-top:4px;line-height:1.25;\">Your booking has an outstanding balance, please process payment before ${holdExpiryText} to secure your booking.</div>
                      </div>
                    </div>

                    <hr style=\"margin:${holdSectionMargin}px 0;border:0;border-top:1px dashed #e5e7eb;\" />

                    <table role=\"presentation\" cellspacing=\"0\" cellpadding=\"0\" style=\"width:100%;font-size:${holdBaseFont}px;color:#1f2937;\">
                      <tbody>
                        <tr><td style=\"padding:2px 0;color:#374151;width:38%\">Ref No:</td><td style=\"padding:2px 0;font-weight:700;\">${refNo}</td></tr>
                        <tr><td style=\"padding:2px 0;color:#374151;\">Passengers:</td><td style=\"padding:2px 0;font-weight:700;\">${passengersTextForHoldEmail}</td></tr>
                        <tr><td style=\"padding:2px 0;color:#374151;\">Price breakdown:</td><td style=\"padding:2px 0;font-weight:700;\">${priceBreakdownTextHtmlForHoldEmail}</td></tr>
                        <tr><td style=\"padding:2px 0;color:#374151;\">Operator Name:</td><td style=\"padding:2px 0;font-weight:700;\">${operatorName || '-'}</td></tr>
                      </tbody>
                    </table>

                    <div style=\"border:1px solid #d1d5db;padding:${holdBoxPad}px;margin:${holdSectionMargin}px 0;border-radius:6px;\">
                      <div style=\"font-weight:800;font-size:${holdHeadingFont}px;color:#1f2937;\">Depart: ${departCity}</div>
                      <div style=\"color:#374151;font-size:${holdSmallFont}px;margin-top:2px;\">${departCity}</div>
                      <div style=\"font-weight:700;color:#1f2937;margin-top:2px;\">${departDate} ${departTime}</div>
                      <div style=\"font-size:${holdSmallFont}px;color:#374151;margin-top:4px;\">Checkin 1 Hour before Departure</div>
                    </div>

                    <div style=\"border:1px solid #d1d5db;padding:${holdBoxPad}px;margin:${holdSectionMargin}px 0;border-radius:6px;\">
                      <div style=\"font-weight:800;font-size:${holdHeadingFont}px;color:#1f2937;\">Arrive: ${arriveCity}</div>
                      <div style=\"color:#374151;font-size:${holdSmallFont}px;margin-top:2px;\">${arriveCity}</div>
                      <div style=\"font-weight:700;color:#1f2937;margin-top:2px;\">${arriveDate} ${arriveTime}</div>
                    </div>

                    ${hasReturnLeg && returnOrigin && returnDestination ? `
                    <hr style=\"margin:${holdSectionMargin}px 0;border:0;border-top:1px dashed #e5e7eb;\" />
                    <div style=\"font-weight:800;color:#111827;margin-bottom:10px;\">Return Trip</div>

                    <div style=\"border:1px solid #d1d5db;padding:${holdBoxPad}px;margin:${holdSectionMargin}px 0;border-radius:6px;\">
                      <div style=\"font-weight:800;font-size:${holdHeadingFont}px;color:#1f2937;\">Depart: ${returnOrigin}</div>
                      <div style=\"color:#374151;font-size:${holdSmallFont}px;margin-top:2px;\">${returnOrigin}</div>
                      <div style=\"font-weight:700;color:#1f2937;margin-top:2px;\">${returnDepartDate} ${returnDepartTime}</div>
                      <div style=\"font-size:${holdSmallFont}px;color:#374151;margin-top:4px;\">Checkin 1 Hour before Departure</div>
                    </div>

                    <div style=\"border:1px solid #d1d5db;padding:${holdBoxPad}px;margin:${holdSectionMargin}px 0;border-radius:6px;\">
                      <div style=\"font-weight:800;font-size:${holdHeadingFont}px;color:#1f2937;\">Arrive: ${returnDestination}</div>
                      <div style=\"color:#374151;font-size:${holdSmallFont}px;margin-top:2px;\">${returnDestination}</div>
                      <div style=\"font-weight:700;color:#1f2937;margin-top:2px;\">${returnArriveDate} ${returnArriveTime}</div>
                    </div>
                    ` : ''}

                    <div style=\"font-size:${holdSmallFont}px;color:#374151;\">
                      <div>Booked By: <span style=\"font-weight:600;color:#1f2937;\">${bookedByDisplay}</span></div>
                    </div>

                    <table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin-top:${holdSectionMargin}px;\">
                      <tr>
                        <td style=\"vertical-align:bottom;\">
                          <div style=\"font-weight:800;font-size:${holdPriceFont}px;color:#1f2937;\">Price: ${totalPriceTextForHold}</div>
                          <div style=\"font-size:${holdSmallFont}px;color:#374151;margin-top:2px;\">[Awaiting payment]</div>
                        </td>
                        ${qrDataUrl ? `<td style=\"vertical-align:bottom;text-align:right;width:${holdQrCellWidth}px;\">
                          <img src=\"${qrDataUrl}\" alt=\"QR Code\" width=\"${holdQrSize}\" height=\"${holdQrSize}\" style=\"display:block;border:0;outline:none;text-decoration:none;border-radius:4px;margin-left:auto;\" />
                        </td>` : ''}
                      </tr>
                    </table>

                    <div style=\"margin-top:${holdSectionMargin}px;padding:${holdBoxPad}px;border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb;text-align:left;\">
                      <div style=\"font-weight:800;color:#111827;margin-bottom:8px;text-align:left;\">How to pay in-store:</div>
                      <ol style=\"margin:0;padding-left:18px;color:#374151;font-size:${holdOlFont}px;line-height:1.35;text-align:left;\">
                        <li>Show Ref No: ${refNo}</li>
                        <li>Make payment at TM PicknPay / partner POS</li>
                        <li>Receive confirmed ticket</li>
                        <li>Check your email for the e-ticket</li>
                        <li>If you wish to pay through our agents whatsapp/call +263 783 911 611</li>
                      </ol>
                    </div>

                    <div style=\"margin-top:${holdSectionMargin}px;text-align:center;font-size:${holdSmallFont}px;color:#374151;\">
                      <div>Terms &amp; Conditions Apply</div>
                    </div>
                  </div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>`;

      const pdfHtml = `<!DOCTYPE html><html><head><meta charset="utf-8" /></head><body style="margin:0;padding:0;background:#f6f7fb;">${reservedCardHtml}</body></html>`;
      const pdfBuffer = await generatePdfFromHtml(pdfHtml, {
        thermal: true,
        width: '48mm',
        autoHeight: true,
        autoHeightPadding: 0,
        printBackground: true,
        viewportWidth: 280,
        scaleToFitWidth: true,
        margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' },
      });
      try {
        const normalized = normalizeToBuffer(pdfBuffer);
        if (normalized && normalized.length && looksLikePdfBuffer(normalized)) {
          const apiBaseRaw = process.env.PUBLIC_API_BASE_URL || process.env.INTERNAL_API_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
          const apiBase = String(apiBaseRaw || '').replace(/\/+$/, '').replace(/\/api$/i, '');
          const url = `${apiBase}/api/ticket/pdf?pnr=${encodeURIComponent(String(pnr))}&download=1`;
          await upsertTicketPdfCache({ pnr, bookedBy: bookedByDisplay, url, which: 'hold', pdfBuffer: normalized });
        }
      } catch (_) {}
      attachments.push({
        filename: `reserved-ticket-${encodeURIComponent(String(refNo || pnr))}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf'
      });
    } catch (e) {
      logger.warn(`[${requestId}] Failed to generate hold PDF attachment`, { pnr, error: e.message });
    }

    try {
      await ensureTicketsTableExists();
      const frontendBaseRaw = process.env.FRONTEND_URL || process.env.CLIENT_URL || 'https://your-app.com';
      const frontendBase = String(frontendBaseRaw || '').replace(/\/+$/, '');
      const ticketUrl = `${frontendBase}/tickets/${encodeURIComponent(String(pnr))}?type=hold`;
      const bookedByForStorage = (await resolveBookedByFromPostgres(pnr)) || 'online';
      await drizzleDb
        .insert(ticketsTable)
        .values({
          pnr: String(pnr),
          bookedBy: String(bookedByForStorage),
          url: ticketUrl,
          createdAt: new Date()
        })
        .onConflictDoUpdate({
          target: ticketsTable.pnr,
          set: {
            bookedBy: String(bookedByForStorage),
            url: ticketUrl,
            createdAt: new Date()
          }
        });
    } catch (e) {
      logger.warn(`[${requestId}] Failed to persist unified ticket URL in Postgres (hold)`, { pnr, error: e.message });
    }

    await sendEmail({ to: email, subject, text, html, attachments });

    const __base = process.env.INTERNAL_API_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
    const __interval = parseInt(process.env.PAYMENT_AUTO_POLL_INTERVAL_MS || '15000', 10);
    const __timeout = parseInt(process.env.PAYMENT_AUTO_POLL_TIMEOUT_MS || '900000', 10);
    (async () => {
      const __start = Date.now();
      const __cart = cart && (cart.busbudCartId || cart.cartId || cart.cart_id || '');
      while (Date.now() - __start < __timeout) {
        try {
          const url = __cart
            ? `${__base}/api/payments/poll/${encodeURIComponent(pnr)}?cartId=${encodeURIComponent(__cart)}`
            : `${__base}/api/payments/poll/${encodeURIComponent(pnr)}`;
          const r = await axios.get(url);
          const s = r.data && r.data.status;
          if (s === 'confirmed' || s === 'cancelled' || s === 'payment_failed' || s === 'already_processed') break;
        } catch (e) {}
        await new Promise(r => setTimeout(r, __interval));
      }
    })();

    const responseTime = Date.now() - startTime;
    logger.info(`ðŸ“§ [${requestId}] Hold email sent`, { pnr, to: email, responseTime: `${responseTime}ms` });

    return res.json({
      success: true,
      pnr,
      cartId: pnr,
      ticketId: savedHoldTicket ? savedHoldTicket.id : undefined,
      ticket: savedHoldTicket || undefined,
      sentTo: email,
      requestId,
      debugTrip: debugTrip || undefined,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`âŒ [${requestId}] Hold route error`, {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
    return res.status(500).json({
      success: false,
      error: {
        message: error.message,
        type: 'HOLD_EMAIL_ERROR'
      },
      requestId,
      timestamp: new Date().toISOString()
    });
  }
});

export default router;
