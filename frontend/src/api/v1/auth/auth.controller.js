import jwt from 'jsonwebtoken';
import { promisify } from 'util';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import logger from '../../../utils/logger.js';
import { ApiError } from '../../../utils/apiError.js';
import { createUser, getUserByEmail } from '../../../services/user.service.js';

const getJwtSecret = () => process.env.JWT_SECRET || 'change-me-in-env';
const getJwtExpiresIn = () => process.env.JWT_EXPIRES_IN || process.env.JWT_EXPIRE || '30d';

const signToken = (id) => {
	return jwt.sign({ id }, getJwtSecret(), {
		expiresIn: getJwtExpiresIn(),
	});
};

const cookieExpiresMs = () => {
	const daysStr = process.env.JWT_COOKIE_EXPIRE || process.env.JWT_COOKIE_EXPIRES_IN || '30';
	const days = Number(daysStr) || 30;
	return days * 24 * 60 * 60 * 1000;
};

const createAndSendToken = (user, statusCode, res) => {
	const token = signToken(user.id);
	const secure = process.env.NODE_ENV === 'production';
	res.cookie('jwt', token, {
		httpOnly: true,
		secure,
		sameSite: 'lax',
		maxAge: cookieExpiresMs(),
		path: '/',
	});

	// Build a safe user payload
	const { passwordHash, password, passwordConfirm, passwordResetToken, passwordResetExpires, ...safe } = user;
	return res.status(statusCode).json(safe);
};

export const signup = async (req, res, next) => {
	try {
		const { email, password, firstName, lastName, phone } = req.body || {};
		if (!email || !password) {
			throw ApiError.badRequest('Email and password are required');
		}
		if (String(password).length < 8) {
			throw ApiError.badRequest('Password must be at least 8 characters long');
		}

		const existing = await getUserByEmail(email);
		if (existing) {
			throw ApiError.badRequest('An account with this email already exists');
		}

		const passwordHash = await bcrypt.hash(String(password), 12);
		const created = await createUser({
			email,
			passwordHash,
			firstName,
			lastName,
			phone,
		});

		createAndSendToken(created, 201, res);
	} catch (error) {
		next(error);
	}
};

export const login = async (req, res, next) => {
	try {
		const { email, password } = req.body || {};
		if (!email || !password) {
			throw ApiError.badRequest('Email and password are required');
		}

		const user = await getUserByEmail(email);
		if (!user || !user.passwordHash) {
			throw ApiError.unauthorized('Incorrect email or password');
		}

		const isMatch = await bcrypt.compare(String(password), String(user.passwordHash));
		if (!isMatch) {
			throw ApiError.unauthorized('Incorrect email or password');
		}

		createAndSendToken(user, 200, res);
	} catch (error) {
		next(error);
	}
};

export const refreshToken = async (req, res, next) => {
	try {
		// Simple implementation: if a valid jwt cookie exists, just confirm it
		const token = req.cookies && req.cookies.jwt;
		if (!token) throw ApiError.unauthorized('Not authenticated');
		const decoded = jwt.verify(token, getJwtSecret());
		if (!decoded || !decoded.id) throw ApiError.unauthorized('Invalid token');
		// Return same token for now
		return res.status(200).json({ token });
	} catch (error) {
		next(error);
	}
};

export const forgotPassword = async (req, res, next) => {
	try {
		// Not implemented for now
		throw new ApiError('Password reset is not configured', 501);
	} catch (error) {
		next(error);
	}
};

export const resetPassword = async (req, res, next) => {
	try {
		// Not implemented for now
		throw new ApiError('Password reset is not configured', 501);
	} catch (error) {
		next(error);
	}
};

export const logout = (req, res) => {
	res.cookie('jwt', 'logout', {
		expires: new Date(Date.now() + 10 * 1000),
		httpOnly: true,
		path: '/',
	});
	res.status(200).json({ status: 'success' });
};

export const getMe = (req, res, next) => {
	try {
		if (!req.user) throw ApiError.unauthorized('Not authenticated');
		const { passwordHash, password, passwordConfirm, passwordResetToken, passwordResetExpires, ...safe } = req.user;
		return res.status(200).json(safe);
	} catch (error) {
		next(error);
	}
};
