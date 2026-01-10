import { logger } from '../utils/logger.js';
import { fileURLToPath } from 'url';
import path from 'path';
import { promises as fs } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_DIR = path.join(process.cwd(), '.cache');
const LOCATIONS_FILE = path.join(CACHE_DIR, 'locations.json');

class LocationService {
  constructor() {
    this.locations = [];
    this.cities = [];
    this.citiesCache = new Map();
    this.searchLimit = 50;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    
    try {
      // Ensure .cache directory exists
      await fs.mkdir(CACHE_DIR, { recursive: true });
      
      // Try to read the locations file
      try {
        const data = await fs.readFile(LOCATIONS_FILE, 'utf8');
        const locations = JSON.parse(data);
        
        if (Array.isArray(locations) && locations.length > 0) {
          this.locations = locations;
          this.cities = locations;
          
          // Build cities cache
          this.citiesCache.clear();
          this.cities.forEach(city => {
            if (city && city.id) {
              this.citiesCache.set(city.id, city);
            }
          });
          
          console.log(`Loaded ${this.locations.length} locations from cache`);
          this.initialized = true;
          return;
        } else {
          throw new Error('Locations file is empty');
        }
      } catch (error) {
        console.error('Error loading locations from cache:', error.message);
        throw new Error('Failed to load locations. Please ensure the locations cache is properly set up.');
      }
      
    } catch (error) {
      console.error('Failed to initialize location service:', error);
      throw error;
    }
  }

  async searchLocations(query, limit = this.searchLimit) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return [];
    }

    const searchTerm = query.toLowerCase().trim();
    
    try {
      // First try exact matches on name, city, or region
      let results = this.locations.filter(location => {
        if (!location || typeof location !== 'object') return false;
        
        const fieldsToSearch = [
          location.name,
          location.city,
          location.region,
          location.country
        ].filter(Boolean).map(f => f.toLowerCase());
        
        return fieldsToSearch.some(field => field.includes(searchTerm));
      });

      // If no exact matches, try partial matches on all string fields
      if (results.length === 0) {
        results = this.locations.filter(location => {
          if (!location || typeof location !== 'object') return false;
          
          // Get all string values from the location
          const stringValues = Object.values(location)
            .filter(val => typeof val === 'string')
            .map(val => val.toLowerCase());
            
          return stringValues.some(val => val.includes(searchTerm));
        });
      }

      // Sort by population (descending) to show larger cities first
      results.sort((a, b) => (b.population || 0) - (a.population || 0));
      
      // Limit results
      return results.slice(0, limit);
      
    } catch (error) {
      console.error('Error in searchLocations:', error);
      return [];
    }
  }

  async getLocationById(id) {
    if (!this.initialized) {
      await this.initialize();
    }
    
    // Try to find by ID (string or number)
    const location = this.locations.find(loc => {
      // Try direct match
      if (loc.id === id || loc.id?.toString() === id?.toString()) {
        return true;
      }
      
      // Try case-insensitive match for string IDs
      if (typeof loc.id === 'string' && typeof id === 'string') {
        return loc.id.toLowerCase() === id.toLowerCase();
      }
      
      // Try matching with city_id or location_id
      if (loc.city_id === id || loc.location_id === id) {
        return true;
      }
      
      return false;
    });
    
    if (!location) {
      console.error(`Location not found for ID: ${id}`);
      const sampleLocations = this.locations.slice(0, 5).map(loc => ({
        id: loc.id,
        city_id: loc.city_id,
        location_id: loc.location_id,
        name: loc.name || loc.city_name || loc.location_name
      }));
      console.error('Available location IDs:', JSON.stringify(sampleLocations, null, 2));
      return null;
    }
    
    return location;
  }
  
  async listLocationIds(limit = 10) {
    if (!this.initialized) {
      await this.initialize();
    }
    
    return this.locations.slice(0, limit).map(loc => ({
      id: loc.id,
      city_id: loc.city_id,
      location_id: loc.location_id,
      name: loc.name || loc.city_name || loc.location_name,
      city: loc.city_name,
      region: loc.region_name,
      country: loc.country_name
    }));
  }
}

export default new LocationService();
