/**
 * In-Memory Storage Utility
 * 
 * Provides thread-safe in-memory storage with TTL (Time To Live) support.
 * This is a singleton instance to maintain a single source of truth for in-memory data.
 */

class InMemoryStorage {
  constructor() {
    this.storage = new Map();
    this.timers = new Map();
  }

  /**
   * Store a value with optional TTL (in milliseconds)
   * @param {string} key - The key to store the value under
   * @param {*} value - The value to store
   * @param {number} [ttl] - Optional TTL in milliseconds
   * @returns {boolean} - True if stored successfully
   */
  set(key, value, ttl) {
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
      this.timers.delete(key);
    }

    this.storage.set(key, {
      value,
      timestamp: Date.now(),
      ttl: ttl || null
    });

    if (ttl && ttl > 0) {
      const timer = setTimeout(() => {
        this.storage.delete(key);
        this.timers.delete(key);
      }, ttl);
      this.timers.set(key, timer);
    }

    return true;
  }

  /**
   * Get a stored value
   * @param {string} key - The key to retrieve
   * @returns {*|null} - The stored value or null if not found/expired
   */
  get(key) {
    const item = this.storage.get(key);
    if (!item) return null;

    // Check if item has expired
    if (item.ttl && (Date.now() - item.timestamp > item.ttl)) {
      this.storage.delete(key);
      if (this.timers.has(key)) {
        clearTimeout(this.timers.get(key));
        this.timers.delete(key);
      }
      return null;
    }

    return item.value;
  }

  /**
   * Delete a stored value
   * @param {string} key - The key to delete
   * @returns {boolean} - True if the key existed and was deleted
   */
  delete(key) {
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
      this.timers.delete(key);
    }
    return this.storage.delete(key);
  }

  /**
   * Check if a key exists in storage
   * @param {string} key - The key to check
   * @returns {boolean} - True if the key exists and is not expired
   */
  has(key) {
    const item = this.storage.get(key);
    if (!item) return false;

    if (item.ttl && (Date.now() - item.timestamp > item.ttl)) {
      this.storage.delete(key);
      if (this.timers.has(key)) {
        clearTimeout(this.timers.get(key));
        this.timers.delete(key);
      }
      return false;
    }

    return true;
  }

  /**
   * Clear all stored data
   */
  clear() {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.storage.clear();
    this.timers.clear();
  }

  /**
   * Get all keys in storage
   * @returns {string[]} - Array of all keys
   */
  keys() {
    return Array.from(this.storage.keys());
  }

  /**
   * Get the number of items in storage
   * @returns {number} - Number of items
   */
  size() {
    return this.storage.size;
  }
}

// Create a singleton instance
const inMemoryStorage = new InMemoryStorage();

// Cart-specific methods
const cartStorage = {
  // Store cart data
  saveCart: (cartData, ttl) => {
    if (!cartData.id) {
      cartData.id = `cart_${Date.now()}`;
    }
    cartData.updatedAt = new Date().toISOString();
    return inMemoryStorage.set(`cart_${cartData.id}`, cartData, ttl);
  },

  // Get cart by ID
  getCart: (cartId) => {
    return inMemoryStorage.get(`cart_${cartId}`);
  },

  // Delete cart
  deleteCart: (cartId) => {
    return inMemoryStorage.delete(`cart_${cartId}`);
  },

  // Check if cart exists
  hasCart: (cartId) => {
    return inMemoryStorage.has(`cart_${cartId}`);
  },

  // Get all carts (for debugging/admin purposes)
  getAllCarts: () => {
    return inMemoryStorage.keys()
      .filter(key => key.startsWith('cart_'))
      .map(key => inMemoryStorage.get(key));
  },

  // Clear all carts (for testing)
  clearAllCarts: () => {
    inMemoryStorage.keys()
      .filter(key => key.startsWith('cart_'))
      .forEach(key => inMemoryStorage.delete(key));
  }
};

export { inMemoryStorage, cartStorage };
export default inMemoryStorage;
