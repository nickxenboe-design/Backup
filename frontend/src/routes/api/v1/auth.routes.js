import express from 'express';
import { body } from 'express-validator';
import { login, signup, refreshToken, forgotPassword, resetPassword, logout, getMe } from '../../../api/v1/auth/auth.controller.js';
import { validateRequest } from '../../../middlewares/validateRequest.js';
import { requireUserAuth } from '../../../middleware/userAuth.js';

const router = express.Router();

// User registration
router.post(
  '/signup',
  validateRequest([
    body('email')
      .trim()
      .notEmpty()
      .withMessage('Email is required')
      .bail()
      .isEmail()
      .withMessage('Please provide a valid email address'),
    body('password')
      .notEmpty()
      .withMessage('Password is required')
      .bail()
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters long')
  ]),
  signup
);

// User login
router.post(
  '/login',
  validateRequest([
    body('email')
      .trim()
      .notEmpty()
      .withMessage('Email is required')
      .bail()
      .isEmail()
      .withMessage('Please provide a valid email address'),
    body('password')
      .notEmpty()
      .withMessage('Password is required')
  ]),
  login
);

// Current user
router.get('/me', requireUserAuth, getMe);

// Logout
router.post('/logout', logout);

// Refresh access token
router.post('/refresh-token', refreshToken);

// Forgot password
router.post(
  '/forgot-password',
  validateRequest([
    body('email')
      .trim()
      .notEmpty()
      .withMessage('Email is required')
      .bail()
      .isEmail()
      .withMessage('Please provide a valid email address')
  ]),
  forgotPassword
);

// Reset password
router.patch(
  '/reset-password/:token',
  validateRequest([
    body('password')
      .notEmpty()
      .withMessage('Password is required')
      .bail()
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters long'),
    body('passwordConfirm')
      .notEmpty()
      .withMessage('Please confirm your password')
  ]),
  resetPassword
);

export default router;
