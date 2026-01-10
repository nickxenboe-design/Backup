import { jest } from '@jest/globals';
import admin from 'firebase-admin';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// Mock firebase-admin
jest.mock('firebase-admin', () => ({
  apps: [],
  initializeApp: jest.fn(),
  credential: {
    cert: jest.fn()
  },
  firestore: jest.fn()
}));

// Mock firebase-admin/firestore
const mockFirestore = {
  collection: jest.fn().mockReturnThis(),
  doc: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  settings: jest.fn(),
  get: jest.fn(),
  update: jest.fn().mockResolvedValue(),
  set: jest.fn().mockResolvedValue()
};

// Mock FieldValue
const mockFieldValue = {
  serverTimestamp: jest.fn(() => 'mock-timestamp')
};

// Setup mocks before importing the module
beforeAll(async () => {
  // Mock getFirestore to return our mock Firestore
  getFirestore.mockImplementation(() => mockFirestore);
  
  // Mock FieldValue
  FieldValue.serverTimestamp = mockFieldValue.serverTimestamp;
  
  // Import the module after setting up mocks
  const firestoreModule = await import('../utils/firestore.js');
  
  // Assign the functions to variables for testing
  getCart = firestoreModule.getCart;
  updateCart = firestoreModule.updateCart;
  checkCartExists = firestoreModule.checkCartExists;
});

// Variables to hold the functions
let getCart, updateCart, checkCartExists;

describe('Firestore Operations', () => {
  const mockCartData = {
    busbudCartId: 'test-cart-123',
    tripId: 'trip-456',
    status: 'pending'
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getCart', () => {
    it('should retrieve a cart by ID', async () => {
      const cartId = 'test-cart-123';
      const mockCart = { id: cartId, ...mockCartData };
      
      // Mock the document reference
      mockFirestore.doc.mockReturnValueOnce({
        get: jest.fn().mockResolvedValueOnce({
          exists: true,
          data: () => mockCart
        })
      });

      const result = await getCart(cartId);
      
      expect(result).toBeDefined();
      expect(result.id).toBe(cartId);
      expect(mockFirestore.collection).toHaveBeenCalledWith('carts');
      expect(mockFirestore.doc).toHaveBeenCalledWith(cartId);
    });

    it('should return null for non-existent cart', async () => {
      const cartId = 'non-existent-id';
      
      // Mock non-existent document
      mockFirestore.doc.mockReturnValueOnce({
        get: jest.fn().mockResolvedValueOnce({ exists: false })
      });
      
      const result = await getCart(cartId);
      expect(result).toBeNull();
    });
  });

  describe('updateCart', () => {
    it('should update an existing cart', async () => {
      const cartId = 'test-cart-123';
      const updates = { status: 'completed' };
      
      // Mock document reference with update method
      const mockUpdate = jest.fn().mockResolvedValue();
      mockFirestore.doc.mockReturnValueOnce({
        update: mockUpdate
      });
      
      await updateCart(cartId, updates);
      
      expect(mockFirestore.collection).toHaveBeenCalledWith('carts');
      expect(mockFirestore.doc).toHaveBeenCalledWith(cartId);
      expect(mockUpdate).toHaveBeenCalledWith({
        ...updates,
        updatedAt: 'mock-timestamp'
      });
    });
  });

  describe('checkCartExists', () => {
    it('should check if a cart with given Busbud ID exists', async () => {
      const busbudCartId = 'test-cart-123';
      const mockCart = { id: 'doc-123', busbudCartId };
      
      // Mock query snapshot
      mockFirestore.get.mockResolvedValueOnce({
        empty: false,
        docs: [{
          id: 'doc-123',
          data: () => mockCart
        }]
      });
      
      const result = await checkCartExists(busbudCartId);
      
      expect(mockFirestore.collection).toHaveBeenCalledWith('carts');
      expect(mockFirestore.where).toHaveBeenCalledWith('busbudCartId', '==', busbudCartId);
      expect(mockFirestore.limit).toHaveBeenCalledWith(1);
      expect(result).toEqual({
        exists: true,
        cartId: 'doc-123',
        cartData: mockCart
      });
    });

    it('should return exists false when no cart is found', async () => {
      const busbudCartId = 'non-existent-cart';
      
      // Mock empty query result
      mockFirestore.get.mockResolvedValueOnce({
        empty: true,
        docs: []
      });
      
      const result = await checkCartExists(busbudCartId);
      
      expect(result).toEqual({
        exists: false,
        cartId: null,
        cartData: null
      });
    });
  });
});
