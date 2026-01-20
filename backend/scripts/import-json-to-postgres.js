#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';
import db, { cities } from '../src/db/drizzleClient.js';
import { query as pgQuery } from '../src/config/postgres.js';

// Simple console colors
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function usage() {
  console.log(`\nUsage: node scripts/import-json-to-postgres.js --file <path/to/cities.json>\n`);
  console.log(`Notes:`);
  console.log(`- The JSON can be an array of city objects, or an object with a top-level 'cities' array.`);
  console.log(`- Recognized fields per item (case-insensitive, optional variants):`);
  console.log(`  name | city | title`);
  console.log(`  countryCode | country_code | country | iso2 | iso3`);
  console.log(`  region | state | admin1`);
  console.log(`  latitude | lat`);
  console.log(`  longitude | lon | lng`);
  console.log(`  timeZone | timezone | tz`);
  console.log(`  slug (optional; if omitted, a slug will be derived)`);
  console.log(`Options:`);
  console.log(`  --defaultCountry=ZW   Use this ISO2/ISO3 code when a row is missing a country code or has a full country name`);
  console.log(`  --recreate            Drop and recreate the cities table before import (DANGEROUS: deletes existing cities data)`);
  console.log(`  --truncate            Truncate the cities table before import (deletes all rows, keeps table schema)`);
}

function toSlug(str) {
  if (!str) return '';
  return String(str)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

function coerceNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function canon(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function pick(obj, keys) {
  const objKeys = Object.keys(obj);
  const canonMap = new Map(objKeys.map(k => [canon(k), k]));
  for (const k of keys) {
    // direct hit
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
    // canonicalized match (handles spaces/underscores/dashes/casing)
    const foundKey = canonMap.get(canon(k));
    if (foundKey && obj[foundKey] !== undefined && obj[foundKey] !== null && obj[foundKey] !== '') {
      return obj[foundKey];
    }
  }
  return undefined;
}

function normalizeCity(item, defaultCountry) {
  // Map incoming keys to exactly the DB columns we defined
  let countryCode2 = pick(item, ['country_code2', 'countryCode2']);
  if ((!countryCode2 || String(countryCode2).trim() === '') && defaultCountry) {
    countryCode2 = defaultCountry;
  }
  const cityName = pick(item, ['city_name', 'cityName', 'name', 'city']);
  const cityId = pick(item, ['city_id', 'cityId']);
  const cityGeohash = pick(item, ['city_geohash', 'cityGeohash']);
  const cityLat = coerceNumber(pick(item, ['city_lat', 'latitude', 'lat']));
  const cityLon = coerceNumber(pick(item, ['city_lon', 'longitude', 'lon', 'lng']));
  const cityUriTemplate = pick(item, ['city_uri_template', 'cityUriTemplate']);

  // Build row with only the allowed columns
  const row = {
    countryCode2: countryCode2 ? String(countryCode2) : null,
    cityName: cityName ? String(cityName) : null,
    cityId: cityId ? String(cityId) : null,
    cityGeohash: cityGeohash ? String(cityGeohash) : null,
    cityLat: cityLat,
    cityLon: cityLon,
    cityUriTemplate: cityUriTemplate ? String(cityUriTemplate) : null,
  };
  return row;
}

async function readJsonArray(filePath) {
  const buf = await fs.readFile(filePath);
  const raw = JSON.parse(buf.toString('utf8'));
  // Direct array
  if (Array.isArray(raw)) return raw;
  // Common wrappers
  if (raw && Array.isArray(raw.cities)) return raw.cities;
  if (raw && raw.data && Array.isArray(raw.data)) return raw.data;
  throw new Error('JSON must be an array or an object containing an array under cities/data');
}

function arrayRowsToObjects(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  if (!Array.isArray(rows[0])) return rows; // already objects
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => String(h).trim());
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!Array.isArray(r)) continue;
    const obj = {};
    for (let j = 0; j < header.length; j++) {
      const key = header[j] || `col_${j}`;
      obj[key] = r[j];
    }
    out.push(obj);
  }
  return out;
}

async function ensureCitiesTable(opts = {}) {
  // Create table if not exists with the exact columns requested
  if (opts.recreate) {
    await pgQuery('DROP TABLE IF EXISTS cities');
  }
  await pgQuery(`
    CREATE TABLE IF NOT EXISTS cities (
      country_code2 VARCHAR(3),
      city_name TEXT,
      city_id TEXT,
      city_geohash TEXT,
      city_lat NUMERIC(10,7),
      city_lon NUMERIC(10,7),
      city_uri_template TEXT
    )
  `);
  if (opts.truncate) {
    await pgQuery('TRUNCATE TABLE cities');
  }
}

async function importCities(filePath, opts = {}) {
  console.log(yellow(`\nStarting cities import from ${filePath} ...`));
  const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  let items = await readJsonArray(abs);
  // Support array-of-arrays with header row
  if (Array.isArray(items) && Array.isArray(items[0])) {
    items = arrayRowsToObjects(items);
  }
  console.log(`Loaded ${items.length} records from JSON`);

  const normalized = items
    .map((it) => normalizeCity(it, opts.defaultCountry))
    .filter(Boolean);
  console.log(`Prepared ${normalized.length} city rows for upsert`);
  if (normalized.length === 0 && items.length > 0) {
    const sample = items[0];
    console.log(yellow('No rows prepared. Showing keys of first record to help map fields:'));
    console.log(Object.keys(sample));
  }

  // Ensure table exists
  await ensureCitiesTable({ recreate: !!opts.recreate, truncate: !!opts.truncate });

  const batchSize = 1000;
  let insertedTotal = 0;
  for (let i = 0; i < normalized.length; i += batchSize) {
    const batch = normalized.slice(i, i + batchSize);
    await db
      .insert(cities)
      .values(batch);
    insertedTotal += batch.length;
    console.log(green(`Inserted ${insertedTotal}/${normalized.length}`));
  }

  console.log(green(`\n✅ Cities import complete. Inserted ${normalized.length} rows.`));
}

async function main() {
  try {
    const args = process.argv.slice(2);
    const fileArgIdx = args.findIndex((a) => a === '--file');
    const filePath = fileArgIdx >= 0 ? args[fileArgIdx + 1] : null;

    // Parse --defaultCountry (supports --defaultCountry=ZW or --defaultCountry ZW)
    let defaultCountry = null;
    const dcEq = args.find((a) => a.startsWith('--defaultCountry='));
    if (dcEq) {
      defaultCountry = dcEq.split('=')[1];
    } else {
      const dcIdx = args.findIndex((a) => a === '--defaultCountry');
      if (dcIdx >= 0 && args[dcIdx + 1]) {
        defaultCountry = args[dcIdx + 1];
      }
    }
    if (defaultCountry) defaultCountry = String(defaultCountry).trim().toUpperCase();

    const recreate = args.includes('--recreate');
    const truncate = args.includes('--truncate');

    if (!filePath) {
      usage();
      process.exit(1);
    }

    await importCities(filePath, { defaultCountry, recreate, truncate });
    process.exit(0);
  } catch (err) {
    console.error(red(`\nImport failed: ${err && err.message}`));
    process.exit(1);
  }
}

main();
