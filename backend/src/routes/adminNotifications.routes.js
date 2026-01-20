import express from 'express';
import verifyFirebaseAuth from '../middleware/firebaseAuth.js';
import { requireRegisteredAdminApi } from '../middleware/adminAccess.js';
import { createAgentNotificationForEmail, listAdminNotifications, markAdminNotificationRead } from '../services/notification.service.js';

const router = express.Router();

router.use(verifyFirebaseAuth, requireRegisteredAdminApi);

router.get('/', async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 30) || 30, 1), 200);
    const unreadOnly = String(req.query.unreadOnly || '').toLowerCase() === 'true';
    const email = req.user && req.user.email;
    if (!email) return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });

    const rows = await listAdminNotifications(email, { limit, unreadOnly });
    const unreadCount = rows.filter((r) => r && r.read !== true).length;
    return res.json({ success: true, data: { unreadCount, rows } });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'LIST_ADMIN_NOTIFICATIONS_FAILED', message: err.message });
  }
});

router.patch('/:id/read', async (req, res) => {
  try {
    const email = req.user && req.user.email;
    if (!email) return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });

    const result = await markAdminNotificationRead(email, req.params.id);
    return res.json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'MARK_READ_FAILED', message: err.message });
  }
});

// Admin -> Agent message
router.post('/agent-message', async (req, res) => {
  try {
    const body = req.body || {};
    const toEmail = typeof body.toEmail === 'string' ? body.toEmail.trim() : '';
    if (!toEmail) {
      return res.status(400).json({ success: false, error: 'MISSING_TO_EMAIL', message: 'toEmail is required' });
    }

    const title = typeof body.title === 'string' ? body.title : 'Message from admin';
    const message = typeof body.message === 'string' ? body.message : '';

    const from = req.user && req.user.email ? String(req.user.email) : null;

    const created = await createAgentNotificationForEmail(toEmail, {
      title,
      message,
      category: 'admin_message',
      level: 'info',
      meta: {
        from,
      },
    });

    return res.status(201).json({ success: true, data: created });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'CREATE_AGENT_MESSAGE_FAILED', message: err.message });
  }
});

export default router;
