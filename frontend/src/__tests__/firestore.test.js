import { jest } from '@jest/globals';
import admin from 'firebase-admin';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// Mock firebase-admin
jest.mock('firebase-admin');
jest.mock('firebase-admin/firestore');

// Mock implementations
const mockDoc = (data) => ({
  exists: !!data,
  data: () => data,
  id: data?.id || 'test-doc-id'
});

const mockQuerySnapshot = (docs) => ({
  empty: docs.length === 0,
  docs: docs.map(doc => ({
    id: doc.id || 'test-doc-id',
    data: () => doc,
    exists: true
  }))
});

// Mock Firestore collection
const mockCollection = {
  doc: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  get: jest.fn()
};

// Mock Firestore document
const mockDocument = {
  get: jest.fn(),
  set: jest.fn().mockResolvedValue(),
  update: jest.fn().mockResolvedValue()
};

// Setup mocks
beforeEach(() => {
  jest.clearAllMocks();
  
  // Mock Firestore instance
  const mockFirestore = {
    collection: jest.fn().mockReturnValue(mockCollection),
    settings: jest.fn()
  };
  
  // Mock Firestore getFirestore
  getFirestore.mockReturnValue(mockFirestore);
  
  // Mock FieldValue
  FieldValue.serverTimestamp = jest.fn(() => 'mock-timestamp');
  
  // Mock document operations
  mockCollection.doc.mockReturnValue(mockDocument);
  mockDocument.get.mockResolvedValue(mockDoc({ id: 'test-cart-123', ...mockCartData }));
  
  // Mock query
  mockCollection.get.mockResolvedValue(mockQuerySnapshot([{ id: 'test-cart-123', ...mockCartData }]));
  
  // Mock admin.apps
  admin.apps = [];
  admin.initializeApp = jest.fn();
  admin.firestore = jest.fn().mockReturnValue(mockFirestore);
  
  // Import the module after setting up mocks
  return import('../utils/firestore.js').then(module => {
    // Get the actual implementations
    getCart = module.getCart;
    updateCart = module.updateCart;
    checkCartExists = module.checkCartExists;
  });
});

// Variables to hold the actual implementations
let getCart, updateCart, checkCartExists;

describe('Firestore Operations', () => {
  const mockCartData = {
    busbudCartId: 'test-cart-123',
    tripId: 'trip-456',
    status: 'pending',
    createdAt: '2025-10-27T14:30:00Z',
    updatedAt: '2025-10-27T14:30:00Z'
  };

  describe('getCart', () => {
    it('should retrieve a cart by ID', async () => {
      const cartId = 'test-cart-123';
      mockDocument.get.mockResolvedValueOnce(mockDoc({ id: cartId, ...mockCartData }));
      
      const result = await getCart(cartId);
      
      expect(result).toBeDefined();
      expect(result.id).toBe(cartId);
      expect(result.busbudCartId).toBe(mockCartData.busbudCartId);
      expect(mockCollection.doc).toHaveBeenCalledWith(cartId);
    });

    it('should return null for non-existent cart', async () => {
      mockDocument.get.mockResolvedValueOnce({ exists: false });
      
      const result = await getCart('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('updateCart', () => {
    it('should update an existing cart', async () => {
      const updates = { status: 'completed' };
      const cartId = 'test-cart-123';
      
      await updateCart(cartId, updates);
      
      expect(mockCollection.doc).toHaveBeenCalledWith(cartId);
      expect(mockDocument.update).toHaveBeenCalledWith({
        ...updates,
        updatedAt: 'mock-timestamp'
      });
    });
  });

  describe('checkCartExists', () => {
    it('should check if a cart with given Busbud ID exists', async () => {
      const busbudCartId = 'test-cart-123';
      const mockCart = { id: 'doc-123', busbudCartId };
      
      mockCollection.get.mockResolvedValueOnce({
        empty: false,
        docs: [{
          id: 'doc-123',
          data: () => mockCart
        }]
      });
      
      const result = await checkCartExists(busbudCartId);
      
      expect(mockCollection.where).toHaveBeenCalledWith('busbudCartId', '==', busbudCartId);
      expect(mockCollection.limit).toHaveBeenCalledWith(1);
      expect(result).toEqual({
        exists: true,
        cartId: 'doc-123',
        cartData: mockCart
      });
    });
    
    it('should return exists false when no cart is found', async () => {
      const busbudCartId = 'non-existent-cart';
      
      mockCollection.get.mockResolvedValueOnce({
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
