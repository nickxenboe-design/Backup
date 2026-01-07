import React, { useState, useRef, useEffect } from 'react';
import { searchLocations, type LocationSuggestion } from '../utils/api';

const POPULAR_LOCATIONS: LocationSuggestion[] = [
  { id: 'zw-harare', name: 'Harare', city: 'Harare', region: 'Harare', country: 'Zimbabwe' },
  { id: 'zw-bulawayo', name: 'Bulawayo', city: 'Bulawayo', region: 'Bulawayo', country: 'Zimbabwe' },
  { id: 'zw-mutare', name: 'Mutare', city: 'Mutare', region: 'Manicaland', country: 'Zimbabwe' },
  { id: 'zw-gweru', name: 'Gweru', city: 'Gweru', region: 'Midlands', country: 'Zimbabwe' },
  { id: 'zw-masvingo', name: 'Masvingo', city: 'Masvingo', region: 'Masvingo', country: 'Zimbabwe' },
  { id: 'za-johannesburg', name: 'Johannesburg', city: 'Johannesburg', region: 'Gauteng', country: 'South Africa' },
  { id: 'za-pretoria', name: 'Pretoria', city: 'Pretoria', region: 'Gauteng', country: 'South Africa' },
  { id: 'za-cape-town', name: 'Cape Town', city: 'Cape Town', region: 'Western Cape', country: 'South Africa' },
  { id: 'za-durban', name: 'Durban', city: 'Durban', region: 'KwaZulu-Natal', country: 'South Africa' },
  { id: 'za-polokwane', name: 'Polokwane', city: 'Polokwane', region: 'Limpopo', country: 'South Africa' },
];

interface LocationInputProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  icon: React.ReactNode;
  showAllOnFocus?: boolean;
}

const LocationInput: React.FC<LocationInputProps> = ({ id, label, value, onChange, icon, showAllOnFocus }) => {
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isShowingPopular, setIsShowingPopular] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastQueryRef = useRef<string>('');

  const PRIORITY_COUNTRIES = ['zimbabwe', 'south africa', 'zw', 'za', 'zwe', 'zaf'];

  const isPriorityLocation = (location: LocationSuggestion): boolean => {
    const fields: any[] = [
      (location as any)?.country,
      (location as any)?.countryCode,
      (location as any)?.country_code,
      (location as any)?.countryName,
      (location as any)?.country_name,
      location.name,
      location.city,
      location.region,
    ];

    const combined = fields
      .filter((value) => value != null && value !== '')
      .map((value) => String(value).toLowerCase())
      .join(' ');

    if (!combined) return false;

    return PRIORITY_COUNTRIES.some((token) => combined.includes(token));
  };

  const prioritizeLocations = (items: LocationSuggestion[]): LocationSuggestion[] => {
    const priority: LocationSuggestion[] = [];
    const others: LocationSuggestion[] = [];

    for (const item of items) {
      if (isPriorityLocation(item)) {
        priority.push(item);
      } else {
        others.push(item);
      }
    }

    return [...priority, ...others];
  };

  const getRecentLocations = (): LocationSuggestion[] => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem('natticks_recent_locations');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as LocationSuggestion[]) : [];
    } catch {
      return [];
    }
  };

  const storeRecentLocation = (suggestion: LocationSuggestion) => {
    if (typeof window === 'undefined') return;
    try {
      const existing = getRecentLocations();
      const makeKey = (loc: any) =>
        (loc && loc.id) || `${loc?.name || ''}|${loc?.city || ''}|${loc?.region || ''}|${loc?.country || ''}`;

      const key = makeKey(suggestion as any);
      const filtered = existing.filter((item) => makeKey(item) !== key);
      const updated = [{ ...suggestion }, ...filtered].slice(0, 10);

      window.localStorage.setItem('natticks_recent_locations', JSON.stringify(updated));
    } catch {
      // Ignore storage failures so autocomplete still works
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadSuggestions = async (inputValue: string, allowEmpty = false) => {
    const trimmed = inputValue.trim();

    if (!trimmed) {
      if (!allowEmpty) {
        setSuggestions([]);
        setShowSuggestions(false);
        setIsShowingPopular(false);
        return;
      }

      const recent = getRecentLocations();
      if (recent.length > 0) {
        const orderedRecent = prioritizeLocations(recent);
        setSuggestions(orderedRecent);
        setShowSuggestions(true);
        setIsShowingPopular(false);
        return;
      }

      const popular = prioritizeLocations(POPULAR_LOCATIONS);
      setSuggestions(popular);
      setShowSuggestions(popular.length > 0);
      setIsShowingPopular(popular.length > 0);
      return;
    }

    // For very short input (single letter), aggressively suggest from recents/popular to minimise time
    if (trimmed.length === 1) {
      const recent = getRecentLocations();
      if (recent.length > 0) {
        const lower = trimmed.toLowerCase();
        const labelFor = (loc: LocationSuggestion) => {
          const parts = [loc.name || loc.city, loc.region, loc.country].filter(Boolean);
          return parts.join(', ');
        };

        const filtered = recent.filter((loc) =>
          labelFor(loc).toLowerCase().includes(lower)
        );

        const base = filtered.length > 0 ? filtered : recent;
        const orderedRecent = prioritizeLocations(base);
        setSuggestions(orderedRecent);
        setShowSuggestions(true);
        setIsShowingPopular(false);
        return;
      }

      const popular = prioritizeLocations(POPULAR_LOCATIONS);
      setSuggestions(popular);
      setShowSuggestions(popular.length > 0);
      setIsShowingPopular(popular.length > 0);
      return;
    }

    lastQueryRef.current = trimmed;
    const results = await searchLocations(trimmed, 10);
    if (lastQueryRef.current !== trimmed) return;

    const ordered = prioritizeLocations(results);
    setSuggestions(ordered);
    setShowSuggestions(ordered.length > 0);
    setIsShowingPopular(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;
    onChange(inputValue);
    void loadSuggestions(inputValue, false);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const shouldAutoComplete = (e.key === 'Enter' || e.key === 'Tab') && showSuggestions && suggestions.length > 0;

    if (shouldAutoComplete) {
      e.preventDefault();
      const suggestion = suggestions[0];
      if (suggestion) {
        handleSuggestionClick(suggestion);
      }
    }
  };

  const handleSuggestionClick = (suggestion: LocationSuggestion) => {
    const labelText = suggestion.name || suggestion.city || '';
    onChange(labelText);
    storeRecentLocation(suggestion);
    setShowSuggestions(false);
    setIsShowingPopular(false);
  };

  return (
    <div ref={containerRef} className="relative flex-1 p-2.5 group rounded-md lg:rounded-none transition-colors duration-200 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700/50 dark:hover:bg-gray-700">
      <label htmlFor={id} className="block text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase mb-0.5">
        {label}
      </label>
      <div className="flex items-center">
        {icon}
        <div className="relative w-full ml-2">
          {showSuggestions &&
            suggestions.length > 0 &&
            value.trim().length > 0 &&
            (suggestions[0].name || suggestions[0].city || '')
              .toLowerCase()
              .startsWith(value.trim().toLowerCase()) && (
              <div className="absolute inset-0 flex items-center pointer-events-none select-none whitespace-nowrap">
                <span className="text-transparent text-sm font-semibold">{value}</span>
                <span className="text-sm font-semibold text-gray-400 dark:text-gray-500">
                  {(suggestions[0].name || suggestions[0].city || '').slice(value.length)}
                </span>
              </div>
            )}
          <input
            id={id}
            type="text"
            value={value}
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            onFocus={() => {
              if (showAllOnFocus) {
                void loadSuggestions(value || '', true);
              } else if (value) {
                setShowSuggestions(suggestions.length > 0);
              }
            }}
            placeholder={`Enter a ${label.toLowerCase()}`}
            className="relative w-full text-sm font-semibold bg-transparent focus:outline-none text-[#652D8E] dark:text-purple-200 placeholder-gray-500 dark:placeholder-gray-400"
            autoComplete="off"
          />
        </div>
      </div>
      {showSuggestions && (
        <ul className="absolute left-0 mt-4 w-full bg-white border border-gray-300 rounded-lg shadow-lg z-20 max-h-60 overflow-y-auto dark:bg-gray-800 dark:border-gray-600">
          {isShowingPopular && (
            <li className="px-4 pt-2 pb-1 text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              Popular Zimbabwean &amp; South African locations
            </li>
          )}
          {suggestions.map((suggestion, index) => {
            const labelText = suggestion.name || suggestion.city || '';
            return (
              <li
                key={suggestion.id ?? labelText}
                onClick={() => handleSuggestionClick(suggestion)}
                className={`px-4 py-2 cursor-pointer flex items-center justify-between gap-2 text-[#652D8E] dark:text-purple-300 font-semibold hover:bg-[#652D8E]/10 dark:hover:bg-purple-900/60 ${index === 0 ? 'bg-[#652D8E]/5 dark:bg-purple-900/40' : ''}`}
              >
                <span className="truncate">{labelText}</span>
                {suggestion.country && (
                  <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#652D8E]/10 text-[#652D8E] dark:bg-purple-500/20 dark:text-purple-100">
                    {suggestion.country}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default LocationInput;
