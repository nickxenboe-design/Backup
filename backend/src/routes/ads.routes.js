import express from 'express';
import { query as pgQuery } from '../config/postgres.js';
import verifyFirebaseAuth from '../middleware/firebaseAuth.js';
import { requireRegisteredAdminApi } from '../middleware/adminAccess.js';

const router = express.Router();

let adsConfigTableEnsured = false;
const ensureAdsConfigTableExists = async () => {
  if (adsConfigTableEnsured) return;
  await pgQuery(`
    CREATE TABLE IF NOT EXISTS ads_config (
      id serial PRIMARY KEY,
      key text NOT NULL UNIQUE,
      ads jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  adsConfigTableEnsured = true;
};

router.get('/', async (req, res) => {
  try {
    await ensureAdsConfigTableExists();
    const result = await pgQuery('SELECT ads FROM ads_config WHERE key = $1 LIMIT 1', ['default']);
    const ads = result && result.rows && result.rows.length ? result.rows[0].ads : null;
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ success: true, data: Array.isArray(ads) ? ads : [] });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'ADS_LOAD_FAILED', message: err?.message || 'Failed to load ads' });
  }
});

router.put('/', verifyFirebaseAuth, requireRegisteredAdminApi, async (req, res) => {
  try {
    await ensureAdsConfigTableExists();
    const body = req.body;
    if (!Array.isArray(body)) {
      return res.status(400).json({ success: false, error: 'INVALID_BODY', message: 'Expected an array of ads' });
    }

    const normalized = body
      .filter((a) => a && typeof a === 'object')
      .map((a) => {
        const id = String(a.id || '').trim();
        const label = String(a.label || '').trim();
        const title = String(a.title || '').trim();
        const description = String(a.description || '').trim();
        const href = String(a.href || '').trim();
        const ctaLabel = (a.ctaLabel == null) ? null : String(a.ctaLabel).trim();
        const imageDataUrl = (a.imageDataUrl == null) ? null : String(a.imageDataUrl).trim();
        return {
          id,
          label,
          title,
          description,
          href,
          ...(ctaLabel ? { ctaLabel } : {}),
          ...(imageDataUrl ? { imageDataUrl } : {})
        };
      })
      .filter((a) => a && a.id && a.title && a.href);

    await pgQuery(
      `
        INSERT INTO ads_config (key, ads, updated_at)
        VALUES ($1, $2::jsonb, now())
        ON CONFLICT (key)
        DO UPDATE SET ads = EXCLUDED.ads, updated_at = now();
      `,
      ['default', JSON.stringify(normalized)]
    );

    res.setHeader('Cache-Control', 'no-store');
    return res.json({ success: true, data: normalized });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'ADS_SAVE_FAILED', message: err?.message || 'Failed to save ads' });
  }
});

export default router;
