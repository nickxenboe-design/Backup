import { getAdminAuth } from '../config/firebase.config.mjs';

export const verifyFirebaseAuth = async (req, res, next) => {
  try {
    const auth = await getAdminAuth();

    let decoded = null;

    // Prefer Authorization: Bearer <token>
    const authHeader = req.headers.authorization || '';
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match && match[1]) {
      decoded = await auth.verifyIdToken(match[1], true);
    } else if (req.cookies && req.cookies.session) {
      // Fallback to Firebase session cookie
      decoded = await auth.verifySessionCookie(req.cookies.session, true);
    }

    if (!decoded) {
      return res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Missing or invalid Firebase credentials'
      });
    }

    req.user = {
      uid: decoded.uid,
      email: decoded.email,
      email_verified: decoded.email_verified,
      phone_number: decoded.phone_number,
      name: decoded.name,
      picture: decoded.picture,
      auth_time: decoded.auth_time,
      firebase: decoded.firebase,
      claims: decoded
    };

    return next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: 'INVALID_TOKEN',
      message: err.message
    });
  }
};

export default verifyFirebaseAuth;
