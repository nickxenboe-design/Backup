 import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { ApiError } from '../../../utils/apiError.js';
import { createUser, getUserByEmail, updateUser } from '../../../services/user.service.js';
import { getAgentByEmail, upsertAgentForUser } from '../../../services/agent.service.js';
import drizzleDb, { branches as branchesTable } from '../../../db/drizzleClient.js';
import { eq } from 'drizzle-orm';

const getCookieSecure = (req) => {
  const xfProto = (req.headers['x-forwarded-proto'] || '').toString();
  const isHttps = req.secure || xfProto.includes('https');
  const envOverride = typeof process.env.COOKIE_SECURE === 'string' ? process.env.COOKIE_SECURE.trim().toLowerCase() : '';
  return envOverride ? ['true','1','yes','on'].includes(envOverride) : isHttps;
};

const getJwtSecret = () => process.env.JWT_SECRET;
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

const shouldPersistCookie = (scope, req) => {
	if (scope !== 'agent') return true;
	const rememberRaw = req?.body?.remember ?? req?.query?.remember;
	if (rememberRaw === true) return true;
	const s = typeof rememberRaw === 'string' ? rememberRaw.trim().toLowerCase() : '';
	return ['true', '1', 'yes', 'on'].includes(s);
};

const resolveRedirectTarget = (req) => {
	const redirect = req?.query?.redirect || req?.body?.redirect;
	if (redirect && typeof redirect === 'string') return redirect;
	return null;
};

const resolveClientBase = () => {
	const raw = typeof process.env.CLIENT_URL === 'string' ? process.env.CLIENT_URL.trim() : '';
	return raw;
};

const resolveSafeClientRedirect = (redirectRaw, fallbackPath = '/') => {
	const base = resolveClientBase();
	const baseNoSlash = base && base.endsWith('/') ? base.slice(0, -1) : base;
	const fallback = baseNoSlash ? `${baseNoSlash}${fallbackPath}` : fallbackPath;
	if (!redirectRaw || typeof redirectRaw !== 'string') return fallback;
	const r = redirectRaw.trim();
	if (!r) return fallback;
	// Allow relative redirects (to client)
	if (r.startsWith('/') && !r.startsWith('//')) {
		return baseNoSlash ? `${baseNoSlash}${r}` : r;
	}
	// Allow absolute redirect only if it matches client base
	if (baseNoSlash && r.startsWith(baseNoSlash)) return r;
	return fallback;
};

const cookieNameForScope = (scope) => {
	return scope === 'agent' ? 'agent_jwt' : 'jwt';
};

const resolveCookieDomain = () => {
	const raw = typeof process.env.COOKIE_DOMAIN === 'string' ? process.env.COOKIE_DOMAIN.trim() : '';
	return raw || (process.env.NODE_ENV === 'production' ? 'bus.nationaltickets.co.za' : undefined);
};

const createAndSendToken = (user, statusCode, res, scope = 'user') => {
	const token = signToken(user.id);
	const secure = getCookieSecure(res.req);
	const cookieOptions = {
		httpOnly: true,
		secure,
		sameSite: secure ? 'none' : 'lax',
		domain: resolveCookieDomain(),
		path: '/',
	};
	if (shouldPersistCookie(scope, res.req)) {
		cookieOptions.maxAge = cookieExpiresMs();
	}
	res.cookie(cookieNameForScope(scope), token, cookieOptions);

	// Build a safe user payload
	const safe = { ...(user || {}) };
	delete safe.passwordHash;
	delete safe.password;
	delete safe.passwordConfirm;
	delete safe.passwordResetToken;
	delete safe.passwordResetExpires;
	return res.status(statusCode).json(safe);
};

const createAndSendTokenWithRedirect = (user, statusCode, req, res, scope = 'user') => {
	const redirectTarget = resolveRedirectTarget(req);
	if (!redirectTarget) {
		return createAndSendToken(user, statusCode, res, scope);
	}

	const token = signToken(user.id);
	const secure = getCookieSecure(req);
	const cookieOptions = {
		httpOnly: true,
		secure,
		sameSite: secure ? 'none' : 'lax',  // 'none' for HTTPS cross-site, 'lax' for HTTP
		domain: resolveCookieDomain(),
		path: '/',
	};
	if (shouldPersistCookie(scope, req)) {
		cookieOptions.maxAge = cookieExpiresMs();
	}
	res.cookie(cookieNameForScope(scope), token, cookieOptions);
	return res.redirect(redirectTarget);
};

const googleClient = () => {
	const clientId = process.env.GOOGLE_CLIENT_ID;
	const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
	if (!clientId || !clientSecret) {
		throw new Error('Missing Google OAuth credentials');
	}
	return new OAuth2Client({
		clientId,
		clientSecret,
	});
};

const resolveGoogleRedirectUri = (req) => {
	// Prefer explicit env override
	if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
	const host = req.get('host');
	const protocol = req.protocol || 'https';
	return `${protocol}://${host}/api/v1/auth/google/callback`;
};

export const googleStart = async (req, res, next) => {
	try {
		const client = googleClient();
		const redirectUri = resolveGoogleRedirectUri(req);
		const state = crypto.randomBytes(16).toString('hex');
		const secure = getCookieSecure(req);
		const requestedRole = typeof req.query?.role === 'string' ? req.query.role : '';
		const redirect = typeof req.query?.redirect === 'string' ? req.query.redirect : '';
		const branchId = typeof req.query?.branchId === 'string' ? req.query.branchId : '';

		res.cookie('g_oauth_state', state, {
			httpOnly: true,
			secure,
			sameSite: 'lax',
			maxAge: 10 * 60 * 1000, // 10 minutes
			path: '/',
		});

		if (requestedRole) {
			res.cookie('g_oauth_role', String(requestedRole), {
				httpOnly: true,
				secure,
				sameSite: 'lax',
				maxAge: 10 * 60 * 1000,
				path: '/',
			});
		}
		if (redirect) {
			res.cookie('g_oauth_redirect', String(redirect), {
				httpOnly: true,
				secure,
				sameSite: 'lax',
				maxAge: 10 * 60 * 1000,
				path: '/',
			});
		}
		if (branchId) {
			res.cookie('g_oauth_branch_id', String(branchId), {
				httpOnly: true,
				secure,
				sameSite: 'lax',
				maxAge: 10 * 60 * 1000,
				path: '/',
			});
		}

		const authUrl = client.generateAuthUrl({
			access_type: 'offline',
			prompt: 'consent',
			scope: ['openid', 'email', 'profile'],
			state,
			redirect_uri: redirectUri,
		});

		return res.redirect(authUrl);
	} catch (error) {
		next(error);
	}
};

const isAllowedGoogleRole = (requestedRole) => {
	if (!requestedRole) return 'user';
	const role = String(requestedRole);
	if (['user'].includes(role)) return 'user';
	// Only allow agent/admin escalation if explicitly enabled via env
	if (role === 'agent' && process.env.ALLOW_GOOGLE_AGENT === 'true') return 'agent';
	if (role === 'admin' && process.env.ALLOW_GOOGLE_ADMIN === 'true') return 'admin';
	return 'user';
};

export const googleCallback = async (req, res, next) => {
	try {
		const { code, state } = req.query || {};
		const storedState = req.cookies?.g_oauth_state;
		if (!state || !storedState || state !== storedState) {
			throw ApiError.badRequest('Invalid OAuth state');
		}

		const client = googleClient();
		const redirectUri = resolveGoogleRedirectUri(req);
		const { tokens } = await client.getToken({ code, redirect_uri: redirectUri });
		if (!tokens || !tokens.id_token) {
			throw ApiError.badRequest('Failed to complete Google login');
		}

		const ticket = await client.verifyIdToken({
			idToken: tokens.id_token,
			audience: process.env.GOOGLE_CLIENT_ID,
		});
		const payload = ticket.getPayload() || {};
		const email = payload.email;
		const sub = payload.sub;
		if (!email || !sub) {
			throw ApiError.badRequest('Google account is missing email');
		}

		const requestedRole = isAllowedGoogleRole(req.query?.role ?? req.cookies?.g_oauth_role);
		const redirectRaw = (req.cookies?.g_oauth_redirect || req.query?.redirect || req.body?.redirect || '')
			.toString();

		const branchIdRaw = (req.query?.branchId ?? req.cookies?.g_oauth_branch_id ?? '').toString().trim();
		const isUuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
		let agentBranchId = null;
		if (branchIdRaw && isUuid(branchIdRaw)) {
			try {
				const rows = await drizzleDb.select().from(branchesTable).where(eq(branchesTable.id, branchIdRaw)).limit(1);
				const branch = rows && rows.length ? rows[0] : null;
				if (branch && branch.active !== false) {
					agentBranchId = branchIdRaw;
				}
			} catch {
			}
		}

		let user = await getUserByEmail(email);
		if (!user) {
			user = await createUser({
				email,
				firstName: payload.given_name || '',
				lastName: payload.family_name || '',
				phone: '',
				role: requestedRole,
			});
		}

		// If Google login was initiated for a specific role, update existing accounts to that role
		if (user && requestedRole && String(requestedRole).toLowerCase() === 'agent') {
			const role = String(user.role || '').toLowerCase();
			if (role !== 'agent') {
				try {
					const updated = await updateUser(user.id, { role: 'agent' });
					user = updated || user;
				} catch {
					// ignore
				}
			}
		}

		const finalRole = String(user?.role || '').toLowerCase();
		if (finalRole === 'agent') {
			try {
				await upsertAgentForUser({
					id: user?.id,
					email: user?.email,
					firstName: user?.firstName || payload.given_name || '',
					lastName: user?.lastName || payload.family_name || '',
					phone: user?.phone || '',
					branchId: agentBranchId,
				});
			} catch {
				// ignore agent upsert failures; cookie auth will still work
			}
		}

		// Clear state cookie
		res.clearCookie('g_oauth_state', { path: '/' });
		res.clearCookie('g_oauth_role', { path: '/' });
		res.clearCookie('g_oauth_redirect', { path: '/' });

		const scope = finalRole === 'agent' ? 'agent' : 'user';
		const redirectTarget = finalRole === 'agent'
			? resolveSafeClientRedirect(redirectRaw, '/agent-dashboard')
			: resolveSafeClientRedirect(redirectRaw, '/');
		try {
			if (!req.query || typeof req.query !== 'object') req.query = {};
			req.query.redirect = redirectTarget;
		} catch {
			// ignore
		}

		createAndSendTokenWithRedirect(user, 200, req, res, scope);
	} catch (error) {
		next(error);
	}
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
			// Allow claiming pre-created accounts without a password by setting one now
			if (!existing.passwordHash) {
				const passwordHash = await bcrypt.hash(String(password), 12);
				const claimed = await updateUser(existing.id, {
					passwordHash,
					firstName: firstName || existing.firstName || '',
					lastName: lastName || existing.lastName || '',
					phone: phone || existing.phone || ''
				});
				return createAndSendTokenWithRedirect(claimed || existing, 200, req, res);
			}
			throw ApiError.badRequest('An account with this email already exists');
		}

		const passwordHash = await bcrypt.hash(String(password), 12);
		const created = await createUser({
			email,
			passwordHash,
			firstName,
			lastName,
			phone,
			role: 'user',
		});

		createAndSendTokenWithRedirect(created, 201, req, res);
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

		createAndSendTokenWithRedirect(user, 200, req, res, 'user');
	} catch (error) {
		next(error);
	}
};

export const agentLogin = async (req, res, next) => {
	try {
		const { email, password } = req.body || {};
		if (!email || !password) {
			throw ApiError.badRequest('Email and password are required');
		}

		const user = await getUserByEmail(email);
		if (!user || !user.passwordHash) {
			throw ApiError.unauthorized('Incorrect email or password');
		}

		const role = String(user.role || '').toLowerCase();
		if (role !== 'agent') {
			throw ApiError.unauthorized('Agent account required');
		}

		const isMatch = await bcrypt.compare(String(password), String(user.passwordHash));
		if (!isMatch) {
			throw ApiError.unauthorized('Incorrect email or password');
		}

		createAndSendTokenWithRedirect(user, 200, req, res, 'agent');
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

export const agentRefreshToken = async (req, res, next) => {
	try {
		const token = req.cookies && req.cookies.agent_jwt;
		if (!token) throw ApiError.unauthorized('Not authenticated');
		const decoded = jwt.verify(token, getJwtSecret());
		if (!decoded || !decoded.id) throw ApiError.unauthorized('Invalid token');
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
	const secure = getCookieSecure(req);
	res.clearCookie('jwt', {
		httpOnly: true,
		secure,
		sameSite: secure ? 'none' : 'lax',
		domain: resolveCookieDomain(),
		path: '/',
	});
	res.status(200).json({ status: 'success' });
};

export const agentLogout = (req, res) => {
	const secure = getCookieSecure(req);
	res.clearCookie('agent_jwt', {
		httpOnly: true,
		secure,
		sameSite: secure ? 'none' : 'lax',
		domain: resolveCookieDomain(),
		path: '/',
	});
	res.status(200).json({ status: 'success' });
};

export const getMe = (req, res, next) => {
	try {
		if (!req.user) throw ApiError.unauthorized('Not authenticated');
		const safe = { ...(req.user || {}) };
		delete safe.passwordHash;
		delete safe.password;
		delete safe.passwordConfirm;
		delete safe.passwordResetToken;
		delete safe.passwordResetExpires;
		return res.status(200).json({
			...safe,
			role: safe?.role
		});
	} catch (error) {
		next(error);
	}
};

export const agentGetMe = async (req, res, next) => {
	try {
		if (!req.user) throw ApiError.unauthorized('Not authenticated');
		const safe = { ...(req.user || {}) };
		delete safe.passwordHash;
		delete safe.password;
		delete safe.passwordConfirm;
		delete safe.passwordResetToken;
		delete safe.passwordResetExpires;
		const role = String(safe?.role || '').toLowerCase();
		if (role !== 'agent') throw ApiError.unauthorized('Agent account required');
		let active = false;
		let agentId = null;
		try {
			const agent = await getAgentByEmail(safe?.email);
			if (agent) {
				active = agent.active !== false;
				agentId = agent.id || null;
			}
		} catch {
			// ignore agent lookup errors
		}
		return res.status(200).json({
			...safe,
			role: safe?.role,
			active,
			agentId
		});
	} catch (error) {
		next(error);
	}
};
