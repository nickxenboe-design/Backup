import { jest } from '@jest/globals';
import unifiedCartService from '../services/unifiedCart.service.js';

// Mock the Firestore utilities
jest.mock('../utils/firestore.js', () => ({
  getCart: jest.fn(),
  updateCart: jest.fn(),
  checkCartExists: jest.fn(),
  getCartsByUserId: jest.fn(),
  getCartByBusbudId: jest.fn(),
  getAllCarts: jest.fn(),
  deleteCart: jest.fn()
}));

// Mock BusbudService
jest.mock('../services/busbud.service.mjs', () => ({
  default: {
    createCart: jest.fn(),
    addTripToCart: jest.fn(),
    getTripDetails: jest.fn()
  }
}));

describe('UnifiedCartService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createCart', () => {
    it('should create a Busbud cart', async () => {
      const mockBusbudCart = {
        id: 'busbud-cart-123',
        status: 'active',
        charges: { total: 100, currency: 'USD' }
      };

      // Mock BusbudService.createCart
      const { default: BusbudService } = await import('../services/busbud.service.mjs');
      BusbudService.createCart.mockResolvedValue(mockBusbudCart);

      const result = await unifiedCartService.createCart({
        type: 'busbud',
        currency: 'USD',
        metadata: { source: 'test' }
      });

      expect(result).toBeDefined();
      expect(result.type).toBe('busbud');
      expect(result.busbudCartId).toBe('busbud-cart-123');
      expect(result.firestoreId).toBeNull(); // Should not save to Firestore
      expect(BusbudService.createCart).toHaveBeenCalledWith('USD');
    });

    it('should create a shopping cart', async () => {
      const result = await unifiedCartService.createCart({
        type: 'shopping',
        userId: 'user-123',
        metadata: { source: 'test' }
      });

      expect(result).toBeDefined();
      expect(result.type).toBe('shopping');
      expect(result.userId).toBe('user-123');
      expect(result.firestoreId).toBeNull(); // Should not save to Firestore
    });
  });

  describe('addTripToCart', () => {
    it('should add a trip to a Busbud cart', async () => {
      const mockCart = {
        id: 'cart-123',
        type: 'busbud',
        busbudCartId: 'busbud-cart-123',
        firestoreId: 'firestore-cart-456'
      };

      const mockUpdatedCart = {
        ...mockCart,
        trips: [{ id: 'trip-456' }],
        status: 'trip_added'
      };

      // Mock getCart
      const { getCart } = await import('../utils/firestore.js');
      getCart.mockResolvedValue(mockCart);

      // Mock BusbudService.addTripToCart
      const { default: BusbudService } = await import('../services/busbud.service.mjs');
      BusbudService.addTripToCart.mockResolvedValue({
        id: 'busbud-cart-123',
        trips: [{ id: 'trip-456' }]
      });

      // Mock updateCart
      const { updateCart } = await import('../utils/firestore.js');
      updateCart.mockResolvedValue();

      const result = await unifiedCartService.addTripToCart('cart-123', 'trip-456', []);

      expect(result).toBeDefined();
      expect(BusbudService.addTripToCart).toHaveBeenCalledWith('busbud-cart-123', 'trip-456', []);
      expect(updateCart).toHaveBeenCalled();
    });
  });

  describe('addItemToCart', () => {
    it('should add an item to a shopping cart', async () => {
      const mockCart = {
        id: 'cart-123',
        type: 'shopping',
        userId: 'user-123',
        items: [],
        totalItems: 0,
        totalAmount: 0
      };

      const mockUpdatedCart = {
        ...mockCart,
        items: [{ id: 'item-456', name: 'Test Item', price: 10, quantity: 1 }],
        totalItems: 1,
        totalAmount: 10
      };

      // Mock getCart
      const { getCart } = await import('../utils/firestore.js');
      getCart.mockResolvedValue(mockCart);

      // Mock updateCart
      const { updateCart } = await import('../utils/firestore.js');
      updateCart.mockResolvedValue();

      const item = { id: 'item-456', name: 'Test Item', price: 10 };
      const result = await unifiedCartService.addItemToCart('cart-123', item, 1);

      expect(result).toBeDefined();
      expect(updateCart).toHaveBeenCalledWith('cart-123', expect.objectContaining({
        items: expect.arrayContaining([expect.objectContaining(item)]),
        totalItems: 1,
        totalAmount: 10
      }));
    });
  });

  describe('normalizeCartData', () => {
    it('should normalize cart data correctly', () => {
      const rawCart = {
        id: 'cart-123',
        createdAt: { toDate: () => new Date('2025-01-01') },
        updatedAt: { toDate: () => new Date('2025-01-02') },
        metadata: {}
      };

      const normalized = unifiedCartService.normalizeCartData(rawCart);

      expect(normalized).toBeDefined();
      expect(normalized.createdAt).toBe('2025-01-01T00:00:00.000Z');
      expect(normalized.updatedAt).toBe('2025-01-02T00:00:00.000Z');
      expect(normalized.metadata).toBeDefined();
    });
  });
});
