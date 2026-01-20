import express from 'express';
import verifyFirebaseAuth from '../middleware/firebaseAuth.js';
import { requireRegisteredAdminApi } from '../middleware/adminAccess.js';
import drizzleDb, { branches as branchesTable } from '../db/drizzleClient.js';
import { eq } from 'drizzle-orm';

const router = express.Router();

router.use(verifyFirebaseAuth, requireRegisteredAdminApi);

const DEFAULT_BRANCHES = [
  { code: '01', name: 'Online' },
  { code: '02', name: 'Chatbot' },
  { code: '03', name: 'Harare' },
  { code: '04', name: 'Gweru' },
];

async function ensureDefaultBranches() {
  for (const b of DEFAULT_BRANCHES) {
    const existing = await drizzleDb.select().from(branchesTable).where(eq(branchesTable.code, b.code)).limit(1);
    if (existing && existing.length) continue;
    try {
      await drizzleDb.insert(branchesTable).values({ code: b.code, name: b.name, active: true });
    } catch (_) {
      // ignore unique constraint races
    }
  }
}

router.get('/', async (_req, res) => {
  try {
    await ensureDefaultBranches();
    const rows = await drizzleDb.select().from(branchesTable);
    const data = (rows || []).map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      active: r.active,
      createdAt: r.createdAt || null,
      updatedAt: r.updatedAt || null,
    }));
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'LIST_BRANCHES_FAILED', message: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    await ensureDefaultBranches();
    const codeRaw = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    const nameRaw = typeof req.body?.name === 'string' ? req.body.name.trim() : '';

    if (!/^\d{2}$/.test(codeRaw)) {
      return res.status(400).json({ success: false, error: 'INVALID_CODE', message: 'Branch code must be exactly 2 digits' });
    }
    if (!nameRaw) {
      return res.status(400).json({ success: false, error: 'INVALID_NAME', message: 'Branch name is required' });
    }

    const existing = await drizzleDb.select().from(branchesTable).where(eq(branchesTable.code, codeRaw)).limit(1);
    if (existing && existing.length) {
      return res.status(409).json({ success: false, error: 'CODE_ALREADY_EXISTS' });
    }

    const inserted = await drizzleDb
      .insert(branchesTable)
      .values({ code: codeRaw, name: nameRaw, active: true })
      .returning();

    const b = inserted && inserted.length ? inserted[0] : null;
    return res.status(201).json({
      success: true,
      data: b
        ? { id: b.id, code: b.code, name: b.name, active: b.active, createdAt: b.createdAt || null, updatedAt: b.updatedAt || null }
        : null,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'CREATE_BRANCH_FAILED', message: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    await ensureDefaultBranches();
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ success: false, error: 'INVALID_ID' });

    const updates = {};

    if (typeof req.body?.name === 'string') {
      const name = req.body.name.trim();
      if (!name) return res.status(400).json({ success: false, error: 'INVALID_NAME' });
      updates.name = name;
    }

    if (req.body?.active != null) {
      updates.active = req.body.active === true || req.body.active === 'true' || req.body.active === 1 || req.body.active === '1';
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, error: 'NO_UPDATES' });
    }

    updates.updatedAt = new Date();

    const updated = await drizzleDb
      .update(branchesTable)
      .set(updates)
      .where(eq(branchesTable.id, id))
      .returning();

    const b = updated && updated.length ? updated[0] : null;
    if (!b) return res.status(404).json({ success: false, error: 'BRANCH_NOT_FOUND' });

    return res.status(200).json({
      success: true,
      data: { id: b.id, code: b.code, name: b.name, active: b.active, createdAt: b.createdAt || null, updatedAt: b.updatedAt || null },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'UPDATE_BRANCH_FAILED', message: err.message });
  }
});

export default router;
