import { getAdminAuth } from '../config/firebase.config.mjs';
import { getAdminByEmail } from '../services/admin.service.js';

const buildRedirect = (req, reason = '') => {
  const next = encodeURIComponent(req.originalUrl || '/admin');
  const r = reason ? `&reason=${encodeURIComponent(reason)}` : '';
  return `/admin/login?next=${next}${r}`;
};

export const verifyFirebaseAuthPage = async (req, res, next) => {
  try {
    const auth = await getAdminAuth();

    const cookieToken = req.cookies?.session;
    const header = req.headers.authorization || '';
    const m = header.match(/^Bearer\s+(.+)$/i);

    let decoded = null;
    if (cookieToken) {
      decoded = await auth.verifySessionCookie(cookieToken, true);
    } else if (m && m[1]) {
      decoded = await auth.verifyIdToken(m[1], true);
    }

    if (!decoded) {
      return res.redirect(buildRedirect(req, 'unauthorized'));
    }

    req.user = {
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name,
      picture: decoded.picture,
      email_verified: decoded.email_verified,
      claims: decoded
    };

    const adminRecord = await getAdminByEmail(req.user.email);
    if (!adminRecord || adminRecord.active === false) {
      return res.redirect(buildRedirect(req, 'not_admin'));
    }

    return next();
  } catch (err) {
    return res.redirect(buildRedirect(req, 'error'));
  }
};

export default verifyFirebaseAuthPage;
