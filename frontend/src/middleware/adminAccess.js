import { getAdminByEmail } from '../services/admin.service.js';

export const requireRegisteredAdminApi = async (req, res, next) => {
  try {
    const email = req.user?.email;
    if (!email) return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
    const adm = await getAdminByEmail(email);
    if (!adm || adm.active === false) return res.status(403).json({ success: false, error: 'ADMIN_NOT_REGISTERED' });
    return next();
  } catch (err) {
    return res.status(500).json({ success: false, error: 'ADMIN_CHECK_FAILED', message: err.message });
  }
};
