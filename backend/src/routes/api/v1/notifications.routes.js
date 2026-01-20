import express from 'express';
import { requireAgentAuth } from '../../../middleware/userAuth.js';
import { listAgentNotifications, markAgentNotificationRead } from '../../../services/notification.service.js';

const router = express.Router();

router.use(requireAgentAuth);

router.get('/', async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 30) || 30, 1), 200);
    const unreadOnly = String(req.query.unreadOnly || '').toLowerCase() === 'true';
    const email = req.user && req.user.email;
    if (!email) return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });

    const rows = await listAgentNotifications(email, { limit, unreadOnly });
    const unreadCount = rows.filter((r) => r && r.read !== true).length;
    return res.json({ success: true, data: { unreadCount, rows } });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'LIST_NOTIFICATIONS_FAILED', message: err.message });
  }
});

router.patch('/:id/read', async (req, res) => {
  try {
    const email = req.user && req.user.email;
    if (!email) return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
    const result = await markAgentNotificationRead(email, req.params.id);
    return res.json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'MARK_READ_FAILED', message: err.message });
  }
});

export default router;
