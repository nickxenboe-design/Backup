import jwt from 'jsonwebtoken';
import { ApiError } from '../utils/apiError.js';
import { getUserById } from '../services/user.service.js';

const getJwtSecret = () => {
  return process.env.JWT_SECRET;
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
      throw new ApiError('Not authenticated', 401);
    }

    const decoded = jwt.verify(token, getJwtSecret());
    if (!decoded || !decoded.id) {
      throw new ApiError('Invalid token', 401);
    }

    const user = await getUserById(decoded.id);
    if (!user) {
      throw new ApiError('User no longer exists', 401);
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export async function requireAgentAuth(req, res, next) {
  try {
    let token = null;

    if (req.headers && typeof req.headers.authorization === 'string') {
      const [scheme, value] = req.headers.authorization.split(' ');
      if (scheme && scheme.toLowerCase() === 'bearer' && value) {
        token = value.trim();
      }
    }

    if (!token && req.cookies && typeof req.cookies.agent_jwt === 'string') {
      token = req.cookies.agent_jwt;
    }

    if (!token) {
      throw new ApiError('Not authenticated', 401);
    }

    const decoded = jwt.verify(token, getJwtSecret());
    if (!decoded || !decoded.id) {
      throw new ApiError('Invalid token', 401);
    }

    const user = await getUserById(decoded.id);
    if (!user) {
      throw new ApiError('User no longer exists', 401);
    }

    const role = (user && user.role) ? String(user.role).toLowerCase() : '';
    if (role !== 'agent') {
      throw new ApiError('Not authorized', 403);
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export async function optionalUserAuth(req, res, next) {
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
      return next();
    }

    const decoded = jwt.verify(token, getJwtSecret());
    if (!decoded || !decoded.id) {
      return next();
    }

    const user = await getUserById(decoded.id);
    if (!user) {
      return next();
    }

    req.user = user;
    next();
  } catch (err) {
    next();
  }
}
