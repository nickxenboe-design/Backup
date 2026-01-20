import express from 'express';
import bcrypt from 'bcryptjs';
import verifyFirebaseAuth from '../middleware/firebaseAuth.js';
import { requireRegisteredAdminApi } from '../middleware/adminAccess.js';
import drizzleDb, { users as usersTable, agents as agentsTable } from '../db/drizzleClient.js';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import { createUser, getUserByEmail, getUserById, normalizeEmail, updateUser } from '../services/user.service.js';

const router = express.Router();

router.use(verifyFirebaseAuth, requireRegisteredAdminApi);

const safeUser = (u) => {
  if (!u || typeof u !== 'object') return u;
  const { passwordHash, password, passwordConfirm, passwordResetToken, passwordResetExpires, ...rest } = u;
  return rest;
};

router.get('/', async (req, res) => {
  try {
    const searchRaw = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const roleRaw = typeof req.query.role === 'string' ? req.query.role.trim() : '';
    const limit = Math.min(Math.max(Number(req.query.limit || 200) || 200, 1), 1000);

    const whereClauses = [];

    if (roleRaw) {
      whereClauses.push(eq(usersTable.role, roleRaw));
    }

    if (searchRaw) {
      const pattern = `%${searchRaw.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
      whereClauses.push(
        or(
          sql`${usersTable.emailLower} ILIKE ${pattern}`,
          sql`${usersTable.email} ILIKE ${pattern}`,
          sql`${usersTable.firstName} ILIKE ${pattern}`,
          sql`${usersTable.lastName} ILIKE ${pattern}`,
          sql`${usersTable.phone} ILIKE ${pattern}`
        )
      );
    }

    let q = drizzleDb.select().from(usersTable);
    if (whereClauses.length) {
      q = q.where(and(...whereClauses));
    }
    const rows = await q.orderBy(desc(usersTable.createdAt)).limit(limit);

    return res.json({ success: true, data: (rows || []).map(safeUser) });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'LIST_USERS_FAILED', message: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ success: false, error: 'MISSING_ID' });
    const user = await getUserById(id);
    if (!user) return res.status(404).json({ success: false, error: 'USER_NOT_FOUND' });
    return res.json({ success: true, data: safeUser(user) });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'GET_USER_FAILED', message: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const emailLower = normalizeEmail(body.email);
    if (!emailLower) return res.status(400).json({ success: false, error: 'INVALID_EMAIL' });

    const existing = await getUserByEmail(emailLower);
    if (existing) {
      return res.status(409).json({ success: false, error: 'EMAIL_ALREADY_EXISTS' });
    }

    const password = typeof body.password === 'string' ? body.password : '';
    const passwordHash = password && password.length >= 8 ? await bcrypt.hash(password, 12) : null;

    const created = await createUser({
      email: emailLower,
      passwordHash,
      firstName: typeof body.firstName === 'string' ? body.firstName : '',
      lastName: typeof body.lastName === 'string' ? body.lastName : '',
      phone: typeof body.phone === 'string' ? body.phone : '',
      role: typeof body.role === 'string' && body.role.trim() ? body.role.trim() : 'user'
    });

    return res.status(201).json({ success: true, data: safeUser(created) });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'CREATE_USER_FAILED', message: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ success: false, error: 'MISSING_ID' });

    const body = req.body || {};
    const updates = {};

    if (typeof body.email === 'string' && body.email.trim()) updates.email = body.email.trim();
    if (typeof body.firstName === 'string') updates.firstName = body.firstName;
    if (typeof body.lastName === 'string') updates.lastName = body.lastName;
    if (typeof body.phone === 'string') updates.phone = body.phone;
    if (typeof body.role === 'string' && body.role.trim()) updates.role = body.role.trim();

    const updated = await updateUser(id, updates);
    if (!updated) return res.status(404).json({ success: false, error: 'USER_NOT_FOUND' });
    return res.json({ success: true, data: safeUser(updated) });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'UPDATE_USER_FAILED', message: err.message });
  }
});

router.post('/:id/password', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!id) return res.status(400).json({ success: false, error: 'MISSING_ID' });
    if (!password || password.length < 8) {
      return res.status(400).json({ success: false, error: 'INVALID_PASSWORD', message: 'Password must be at least 8 characters' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const updated = await updateUser(id, { passwordHash });
    if (!updated) return res.status(404).json({ success: false, error: 'USER_NOT_FOUND' });

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'SET_PASSWORD_FAILED', message: err.message });
  }
});

router.post('/:id/make-agent', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ success: false, error: 'MISSING_ID' });

    const user = await getUserById(id);
    if (!user) return res.status(404).json({ success: false, error: 'USER_NOT_FOUND' });

    const emailLower = normalizeEmail(user.emailLower || user.email);
    if (!emailLower) return res.status(400).json({ success: false, error: 'USER_EMAIL_MISSING' });

    // Ensure user has role agent
    try {
      await updateUser(id, { role: 'agent' });
    } catch (_) {
    }

    // Upsert agent record
    const inserted = await drizzleDb
      .insert(agentsTable)
      .values({
        userId: String(user.id),
        emailLower,
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        phone: user.phone || '',
        active: false
      })
      .onConflictDoUpdate({
        target: agentsTable.emailLower,
        set: {
          userId: String(user.id),
          firstName: user.firstName || '',
          lastName: user.lastName || '',
          phone: user.phone || ''
        }
      })
      .returning();

    const agent = inserted && inserted.length ? inserted[0] : null;
    return res.json({ success: true, data: { user: safeUser(user), agent } });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'MAKE_AGENT_FAILED', message: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ success: false, error: 'MISSING_ID' });

    const deleted = await drizzleDb
      .delete(usersTable)
      .where(eq(usersTable.id, id))
      .returning();

    if (!deleted || !deleted.length) {
      return res.status(404).json({ success: false, error: 'USER_NOT_FOUND' });
    }

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'DELETE_USER_FAILED', message: err.message });
  }
});

export default router;
