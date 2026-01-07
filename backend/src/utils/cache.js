export class Cache {
  constructor() {
    this.store = new Map();
  }

  get(key) {
    const item = this.store.get(key);
    if (!item) return null;

    if (item.expiry < Date.now()) {
      this.store.delete(key);
      return null;
    }

    return item.value;
  }

  set(key, value, ttl = 300) {
    this.store.set(key, {
      value,
      expiry: Date.now() + ttl * 1000
    });
  }

  delete(key) {
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }
}

const cache = new Cache();
export default cache;
