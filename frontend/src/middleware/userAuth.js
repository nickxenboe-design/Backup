import jwt from 'jsonwebtoken';
import { ApiError } from '../utils/apiError.js';
import { getUserById } from '../services/user.service.js';

const getJwtSecret = () => {
  return process.env.JWT_SECRET || 'change-me-in-env';
};

export async function requireUserAuth(req, res, next) {
  try {
    let token = null;

    if (req.headers && typeof req.headers.authorization === 'string') {
      const [scheme, value] = req.headers.authorization.split(' ');
      if (scheme && scheme.toLowerCase() === 'bearer' && value) {
        token = value.trim();
      }
    }

    if (!token && req.cookies && typeof req.cookies.jwt === 'string') {
      token = req.cookies.jwt;
    }

    if (!token) {
      throw new ApiError(401, 'Not authenticated');
    }

    const decoded = jwt.verify(token, getJwtSecret());
    if (!decoded || !decoded.id) {
      throw new ApiError(401, 'Invalid token');
    }

    const user = await getUserById(decoded.id);
    if (!user) {
      throw new ApiError(401, 'User no longer exists');
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}
