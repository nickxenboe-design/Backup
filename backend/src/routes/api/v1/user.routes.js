import express from 'express';
import { body, param } from 'express-validator';
import { 
  getUserProfile,
  updateProfile,
  changePassword,
  updatePreferences,
  getBookingHistory,
  getPaymentMethods,
  addPaymentMethod,
  deletePaymentMethod,
  getNotifications,
  markNotificationAsRead,
  deleteAccount
} from '../../../api/v1/user/user.controller.js';
import { validateRequest } from '../../../middlewares/validateRequest.js';
import { authenticate } from '../../../middlewares/auth.js';
import upload from '../../../middlewares/upload.js';

const router = express.Router();

// All routes after this middleware are protected
router.use(authenticate);

// Get user profile
router.get('/profile', getUserProfile);

// Update user profile
router.patch(
  '/profile',
  upload.single('avatar'),
  [
    body('firstName').optional().isString().trim(),
    body('lastName').optional().isString().trim(),
    body('phone').optional().isString().trim(),
    body('dateOfBirth').optional().isISO8601().toDate()
  ],
  validateRequest,
  updateProfile
);

// Change password
router.patch(
  '/change-password',
  [
    body('currentPassword').notEmpty().withMessage('Current password is required'),
    body('newPassword')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters long')
  ],
  validateRequest,
  changePassword
);

// Update user preferences
router.patch(
  '/preferences',
  [
    body('notifications.email').optional().isBoolean(),
    body('notifications.sms').optional().isBoolean(),
    body('notifications.push').optional().isBoolean(),
    body('preferredSeat').optional().isString().trim(),
    body('preferredPaymentMethod').optional().isString().trim()
  ],
  validateRequest,
  updatePreferences
);

// Get booking history
router.get('/bookings', getBookingHistory);

// Payment methods
router.route('/payment-methods')
  .get(getPaymentMethods)
  .post(
    [
      body('type')
        .isIn(['card', 'mobile_money', 'bank_account'])
        .withMessage('Valid payment method type is required'),
      body('details').isObject().withMessage('Payment details are required')
    ],
    validateRequest,
    addPaymentMethod
  );

router.delete(
  '/payment-methods/:paymentMethodId',
  [param('paymentMethodId').isMongoId().withMessage('Valid payment method ID is required')],
  validateRequest,
  deletePaymentMethod
);

// Notifications
router.get('/notifications', getNotifications);
router.patch(
  '/notifications/:notificationId/read',
  [param('notificationId').isMongoId().withMessage('Valid notification ID is required')],
  validateRequest,
  markNotificationAsRead
);

// Delete account
router.delete(
  '/delete-account',
  [
    body('password').notEmpty().withMessage('Password is required for account deletion'),
    body('reason').optional().isString().trim()
  ],
  validateRequest,
  deleteAccount
);

export default router;
