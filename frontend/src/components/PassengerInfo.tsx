import React, { useState, useEffect, useRef } from 'react';
import { BusRoute, SearchQuery, getCartData } from '@/utils/api';
import { BookingDetails, Passenger, ContactInfo } from '@/types';
import SeatMap from './SeatMap';

import { 
    ChevronLeftIcon, 
    ArrowRightIcon, 
    CreditCardIcon, 
    StoreIcon, 
    UserCircleIcon, 
    AtSymbolIcon, 
    PhoneIcon, 
    CheckIcon, 
    CalendarIcon, 
    LockClosedIcon, 
    LocationIcon, 
    ChevronDownIcon
} from './icons';
import TripSummary from './TripSummary';
import CalendarPopover from './CalendarPopover';
import { nationalities } from './Nationalities';

interface PassengerInfoProps {
    booking: { outbound: BusRoute; inbound: BusRoute | null };
    query: SearchQuery;
    onBack: () => void;
    onReview: (details: BookingDetails) => void;
}

type PassengerWithAnswers = Passenger & { questionAnswers: Record<string, string> };

const FormField: React.FC<{
  id: string;
  label: string;
  icon: React.ReactNode;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder: string;
  type?: string;
  error?: string;
  disabled?: boolean;
}> = ({ id, label, icon, value, onChange, placeholder, type = 'text', error, disabled = false }) => (
    <div>
        <div className={`relative flex-1 p-1.5 group rounded-md transition-colors duration-200 bg-gray-100 hover:bg-gray-200 focus-within:ring-2 focus-within:ring-inset dark:bg-gray-700 dark:hover:bg-gray-600 ${disabled ? 'opacity-70 cursor-not-allowed' : ''} ${error ? 'ring-2 ring-red-500/80' : 'focus-within:ring-[#652D8E] dark:focus-within:ring-purple-500'}`}>
            <label htmlFor={id} className="block text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-0.5">
                {label}
            </label>
            <div className="flex items-center">
                {icon}
                <input
                    id={id}
                    type={type}
                    value={value}
                    onChange={onChange}
                    placeholder={placeholder}
                    disabled={disabled}
                    className="w-full ml-2 text-sm bg-transparent focus:outline-none text-black dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
                    autoComplete="off"
                />
            </div>
        </div>
        {error && <p className="text-red-500 text-[10px] mt-1 pl-1">{error}</p>}
    </div>
);

const CustomSelectField: React.FC<{
  id: string;
  label: string;
  icon: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  options: { value: string; label: string }[];
  placeholder: string;
  searchable?: boolean;
  disabled?: boolean;
}> = ({ id, label, icon, value, onChange, error, options, placeholder, searchable, disabled = false }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setSearchTerm('');
    }
  }, [isOpen]);

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
  };
  
  const selectedLabel = options.find(opt => opt.value === value)?.label || placeholder;
  const filteredOptions = !searchable || !searchTerm
    ? options
    : options.filter(opt => opt.label.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <div ref={containerRef} className="relative">
      <div>
        <button
          type="button"
          onClick={() => !disabled && setIsOpen(!isOpen)}
          onKeyDown={(e) => {
            if (disabled) return;
            if (!searchable) return;
            const key = e.key;
            if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
              e.preventDefault();
              setIsOpen(true);
              setSearchTerm(key);
            } else if ((key === 'Enter' || key === 'ArrowDown') && !isOpen) {
              e.preventDefault();
              setIsOpen(true);
            }
          }}
          disabled={disabled}
          className={`relative w-full text-left p-1.5 group rounded-md transition-colors duration-200 bg-gray-100 hover:bg-gray-200 focus:outline-none focus-within:ring-2 focus-within:ring-inset dark:bg-gray-700 dark:hover:bg-gray-600 ${error ? 'ring-2 ring-red-500/80' : 'focus-within:ring-[#652D8E] dark:focus-within:ring-purple-500'}`}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
        >
          <label className="block text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-0.5">
            {label}
          </label>
          <div className="flex items-center">
            {icon}
            <span className={`w-full ml-2 text-sm truncate ${value ? 'text-black dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>
              {selectedLabel}
            </span>
            <ChevronDownIcon className={`h-4 w-4 text-gray-400 ml-2 transition-transform duration-200 ${isOpen ? 'transform rotate-180' : ''}`} />
          </div>
        </button>
        {error && <p className="text-red-500 text-[10px] mt-1 pl-1">{error}</p>}
      </div>
      
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-full bg-white rounded-lg shadow-xl border border-gray-200 z-20 animate-fade-in-down max-h-56 overflow-y-auto dark:bg-gray-800 dark:border-gray-600" role="listbox">
            {searchable && (
              <div className="sticky top-0 bg-white dark:bg-gray-800 p-1.5 border-b border-gray-200 dark:border-gray-600">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const first = filteredOptions[0];
                      if (first) handleSelect(first.value);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setIsOpen(false);
                    }
                  }}
                  placeholder={placeholder}
                  className="w-full px-2 py-1 text-xs bg-gray-50 dark:bg-gray-700 text-black dark:text-white rounded outline-none placeholder-gray-500 dark:placeholder-gray-400"
                  autoFocus
                />
              </div>
            )}
            <ul>
                {filteredOptions.length > 0 ? (
                  filteredOptions.map((option) => (
                    <li
                        key={option.value}
                        onClick={() => handleSelect(option.value)}
                        className={`px-3 py-1.5 cursor-pointer hover:bg-gray-100 text-[#652D8E] text-xs font-medium dark:text-purple-300 dark:hover:bg-gray-700 ${value === option.value ? 'bg-gray-100 dark:bg-gray-700 font-bold' : ''}`}
                        role="option"
                        aria-selected={value === option.value}
                    >
                        {option.label}
                    </li>
                  ))
                ) : (
                  <li className="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400">No results</li>
                )}
            </ul>
        </div>
      )}
    </div>
  );
};

const DateFormField: React.FC<{
  id: string;
  label: string;
  icon: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  placeholder: string;
  maxDate?: Date;
  minDate?: Date;
}> = ({ id, label, icon, value, onChange, error, placeholder, maxDate, minDate }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedDate = value ? new Date(value + 'T00:00:00') : null;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleDateSelect = (date: Date) => {
    const dateString = date.toISOString().split('T')[0];
    onChange(dateString);
    setIsOpen(false);
  };

  const formattedDate = selectedDate?.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div ref={containerRef} className="relative">
      <div>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={`relative w-full text-left p-2 group rounded-md transition-colors duration-200 bg-gray-100 hover:bg-gray-200 focus:outline-none focus-within:ring-2 focus-within:ring-inset dark:bg-gray-700 dark:hover:bg-gray-600 ${error ? 'ring-2 ring-red-500/80' : 'focus-within:ring-[#652D8E] dark:focus-within:ring-purple-500'}`}
          aria-haspopup="true"
          aria-expanded={isOpen}
        >
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-0.5">
            {label}
          </label>
          <div className="flex items-center">
            {icon}
            <span className={`w-full ml-2 text-sm truncate ${value ? 'text-black dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>
              {value ? formattedDate : placeholder}
            </span>
            <ChevronDownIcon className={`h-4 w-4 text-gray-400 ml-2 transition-transform duration-200 ${isOpen ? 'transform rotate-180' : ''}`} />
          </div>
        </button>
        {error && <p className="text-red-500 text-[10px] mt-1 pl-1">{error}</p>}
      </div>
      
      {isOpen && (
        <CalendarPopover
            selectedDate={selectedDate}
            onDateSelect={handleDateSelect}
            onClose={() => setIsOpen(false)}
            maxDate={maxDate}
            minDate={minDate}
        />
      )}
    </div>
  );
};

const PassengerInfo: React.FC<PassengerInfoProps> = ({ booking, query, onBack, onReview }) => {
    const isEaglelinerTrip = (() => {
        const o: any = (booking as any)?.outbound;
        const provider = String(o?.provider || '').toLowerCase();
        const id = String(o?.id || '');
        if (provider === 'eagleliner') return true;
        if (id.startsWith('eagleliner:')) return true;
        const raw = o?.raw || o?._eagleliner;
        if (raw && Array.isArray(raw?.FairPrice) && raw.FairPrice.length > 0) return true;
        return false;
    })();
    const eaglelinerFairPriceList = (() => {
        if (!isEaglelinerTrip) return [] as any[];
        const o: any = (booking as any)?.outbound;
        const raw = o?._eagleliner?.FairPrice || o?.raw?.FairPrice || o?.raw?.fairPrice;
        return Array.isArray(raw) ? raw : [];
    })();

    const classifyEaglelinerPassenger = (name: string) => {
        const n = String(name || '').toLowerCase();
        if (n.includes('child')) return { type: 'child' as const };
        return { type: 'adult' as const };
    };

    const computeEaglelinerTotalFromCounts = (counts: Record<string, number> | null) => {
        try {
            if (!counts) return null;
            if (!Array.isArray(eaglelinerFairPriceList) || eaglelinerFairPriceList.length === 0) return null;
            let total = 0;
            for (const item of eaglelinerFairPriceList) {
                const id = String(item?.id);
                const qty = Number(counts[id] || 0);
                const unit = Number(item?.price);
                if (!Number.isFinite(qty) || qty <= 0) continue;
                if (!Number.isFinite(unit) || unit < 0) continue;
                total += unit * qty;
            }
            return Number.isFinite(total) ? total : null;
        } catch {
            return null;
        }
    };

    const eaglelinerSelectedCounts = (() => {
        const raw = (() => {
            const fromQuery = query?.eaglelinerPassengerCounts;
            if (fromQuery && typeof fromQuery === 'object') return fromQuery;
            try {
                const cart = getCartData();
                const fromCart = cart && (cart as any).eaglelinerPassengerCounts;
                if (fromCart && typeof fromCart === 'object') return fromCart;
            } catch {}
            return null;
        })();
        if (!raw || typeof raw !== 'object') return null;
        const next: Record<string, number> = {};
        for (const [k, v] of Object.entries(raw)) {
            const n = Number(v);
            if (Number.isFinite(n) && n > 0) next[String(k)] = Math.floor(n);
        }
        return Object.keys(next).length ? next : null;
    })();

    const queryForSummary = (isEaglelinerTrip && eaglelinerSelectedCounts)
        ? { ...query, eaglelinerPassengerCounts: eaglelinerSelectedCounts }
        : query;
    const inferredInfantCount = (() => {
        if (!isEaglelinerTrip) return 0;
        const ages = Array.isArray(query?.passengers?.childrenAges) ? query.passengers.childrenAges : [];
        return ages
            .map((a) => Number(a))
            .filter((a) => Number.isFinite(a) && a >= 0 && a < 2)
            .length;
    })();
    const hideInfantToggle = isEaglelinerTrip;

    const initialPassengers: PassengerWithAnswers[] = (() => {
        if (isEaglelinerTrip && eaglelinerSelectedCounts && Array.isArray(eaglelinerFairPriceList) && eaglelinerFairPriceList.length > 0) {
            const out: PassengerWithAnswers[] = [];
            for (const item of eaglelinerFairPriceList) {
                const id = String(item?.id);
                const qty = Number((eaglelinerSelectedCounts as any)[id] || 0);
                if (!Number.isFinite(qty) || qty <= 0) continue;
                const label = String(item?.name || 'Passenger');
                const kind = classifyEaglelinerPassenger(label);
                for (let i = 0; i < qty; i++) {
                    out.push({
                        title: 'Mr',
                        firstName: '',
                        lastName: '',
                        type: kind.type,
                        dob: '',
                        gender: '',
                        idType: '',
                        idNumber: '',
                        nationality: '',
                        emergencyContactName: '',
                        emergencyContactNumber: '',
                        withInfant: false,
                        infantFirstName: '',
                        infantLastName: '',
                        questionAnswers: {},
                        eaglelinerTypeId: Number(item?.id),
                        eaglelinerTypeName: label,
                    });
                }
            }

            if (out.length > 0 && inferredInfantCount > 0) {
                let used = 0;
                for (const p of out) {
                    if (p.type === 'child') continue;
                    if (used >= inferredInfantCount) break;
                    (p as any).withInfant = true;
                    used++;
                }
            }

            if (out.length > 0) return out;
        }

        return [
            ...Array.from({ length: query.passengers.adults }, (_, i) => ({
                title: 'Mr',
                firstName: '',
                lastName: '',
                type: 'adult' as const,
                dob: '',
                gender: '',
                idType: '',
                idNumber: '',
                nationality: '',
                emergencyContactName: '',
                emergencyContactNumber: '',
                withInfant: isEaglelinerTrip ? i < inferredInfantCount : false,
                infantFirstName: '',
                infantLastName: '',
                questionAnswers: {}
            })),
            ...Array.from({ length: ((query.passengers as any)?.seniors || 0) }, (_, i) => ({
                title: 'Mr',
                firstName: '',
                lastName: '',
                type: 'adult' as const,
                dob: '',
                gender: '',
                idType: '',
                idNumber: '',
                nationality: '',
                emergencyContactName: '',
                emergencyContactNumber: '',
                withInfant: isEaglelinerTrip ? (Number(query.passengers?.adults || 0) + i) < inferredInfantCount : false,
                infantFirstName: '',
                infantLastName: '',
                questionAnswers: {}
            })),
            ...Array.from({ length: ((query.passengers as any)?.students || 0) }, (_, i) => ({
                title: 'Mr',
                firstName: '',
                lastName: '',
                type: 'adult' as const,
                dob: '',
                gender: '',
                idType: '',
                idNumber: '',
                nationality: '',
                emergencyContactName: '',
                emergencyContactNumber: '',
                withInfant: isEaglelinerTrip
                    ? (Number(query.passengers?.adults || 0) + Number((query.passengers as any)?.seniors || 0) + i) < inferredInfantCount
                    : false,
                infantFirstName: '',
                infantLastName: '',
                questionAnswers: {}
            })),
            ...Array.from({ length: query.passengers.children }, (_, i) => ({
                title: 'Mr',
                firstName: '',
                lastName: '',
                type: 'child' as const,
                dob: '',
                gender: '',
                idType: '',
                idNumber: '',
                nationality: '',
                emergencyContactName: '',
                emergencyContactNumber: '',
                withInfant: false,
                infantFirstName: '',
                infantLastName: '',
                questionAnswers: {}
            }))
        ];
    })();

    const inStoreDeadlineHours = (() => {
        const raw = (import.meta as any)?.env?.VITE_INSTORE_PAYMENT_DEADLINE_HOURS;
        const n = Number(raw);
        return Number.isFinite(n) && n > 0 ? n : 12;
    })();

    const [passengers, setPassengers] = useState<PassengerWithAnswers[]>(initialPassengers);
    const [requiredQuestionKeys, setRequiredQuestionKeys] = useState<Set<string>>(() => new Set());
    const [allowedQuestionKeys, setAllowedQuestionKeys] = useState<Set<string> | null>(null);

    const [contactInfo, setContactInfo] = useState<ContactInfo>(() => {
        const first = initialPassengers[0];
        return {
            firstName: first?.firstName || '',
            lastName: first?.lastName || '',
            email: '',
            phone: '',
            country: '',
            optInMarketing: false,
        };
    });
    const [contactDirty, setContactDirty] = useState<{ firstName: boolean; lastName: boolean; country: boolean }>({
        firstName: false,
        lastName: false,
        country: false,
    });
    const [purchaserSameAsPassenger1, setPurchaserSameAsPassenger1] = useState(true);
    const [isDirty, setIsDirty] = useState(false);
    const [paymentMethod, setPaymentMethod] = useState('In-Store');
    const [errors, setErrors] = useState<any>({});

    const totalPassengersCount = (() => {
        if (isEaglelinerTrip && eaglelinerSelectedCounts) {
            const sum = Object.values(eaglelinerSelectedCounts).reduce((acc, v) => acc + (Number(v) > 0 ? Number(v) : 0), 0);
            if (sum > 0) return sum;
        }
        return Math.max(
            1,
            (query?.passengers?.adults || 0) +
            (query?.passengers?.children || 0) +
            ((query?.passengers as any)?.seniors || 0) +
            ((query?.passengers as any)?.students || 0)
        );
    })();
    const [selectedSeatIds, setSelectedSeatIds] = useState<string[]>([]);

    const titleOptions = [
        { value: 'Mr', label: 'Mr' },
        { value: 'Mrs', label: 'Mrs' },
        { value: 'Ms', label: 'Ms' },
        { value: 'Miss', label: 'Miss' },
        { value: 'Dr', label: 'Dr' },
    ];

    const genderOptionsEagleliner = [
        { value: "male", label: "Male" },
        { value: "female", label: "Female" },
    ];

    const genderOptions = [
        { value: "male", label: "Male" },
        { value: "female", label: "Female" },
        { value: "other", label: "Other" },
        { value: "prefer_not_to_say", label: "Prefer not to say" },
    ];

    const idTypeOptions = [
        { value: "passport", label: "Passport" },
        { value: "national_id", label: "National ID Card" },
        { value: "drivers_license", label: "Driver's License" },
    ];

    const normalizeQuestionKeyLocal = (value: string) => {
        try {
            const raw = String(value || '').trim();
            if (!raw) return '';

            // Convert camelCase / PascalCase to snake_case before lowercasing.
            const withUnderscores = raw.replace(/([a-z0-9])([A-Z])/g, '$1_$2');
            const normalized = withUnderscores
                .trim()
                .toLowerCase()
                .replace(/[\s-]+/g, '_')
                .replace(/[^a-z0-9_]/g, '');

            // Handle common collapsed keys from upstream payloads.
            if (normalized === 'idtype') return 'id_type';
            if (normalized === 'idnumber') return 'id_number';

            return normalized;
        } catch {
            return '';
        }
    };

    useEffect(() => {
        try {
            const cart = getCartData();
            const schema: any = cart && (cart as any).passengerQuestions ? (cart as any).passengerQuestions : null;
            const requiredArr: string[] = schema && Array.isArray(schema.required) ? schema.required : [];
            const allArr: string[] = schema && Array.isArray(schema.all) ? schema.all : [];

            const effectiveRequiredArr = (!requiredArr || requiredArr.length === 0) && allArr && allArr.length ? allArr : requiredArr;
            const reqSet = new Set(effectiveRequiredArr.map((k) => normalizeQuestionKeyLocal(k)).filter(Boolean));
            setRequiredQuestionKeys(reqSet);

            if (allArr && allArr.length) {
                setAllowedQuestionKeys(new Set(allArr.map((k) => normalizeQuestionKeyLocal(k)).filter(Boolean)));
            } else {
                setAllowedQuestionKeys(null);
            }
        } catch {
            setRequiredQuestionKeys(new Set());
            setAllowedQuestionKeys(null);
        }
    }, [booking?.outbound?.id]);

    const isRequiredKey = (k: string) => requiredQuestionKeys.has(normalizeQuestionKeyLocal(k));
    const isAllowedKey = (k: string) => (allowedQuestionKeys ? allowedQuestionKeys.has(normalizeQuestionKeyLocal(k)) : true);

    const questionLabelFromKey = (key: string) => {
        const k = String(key || '').trim();
        if (!k) return 'Additional detail';
        return k
            .replace(/[_-]+/g, ' ')
            .split(' ')
            .filter(Boolean)
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');
    };

    const knownQuestionKeys = new Set(['dob', 'gender', 'id_type', 'id_number', 'nationality']);

    const getDynamicQuestionKeys = () => {
        return Array.from(requiredQuestionKeys)
            .map((k) => normalizeQuestionKeyLocal(k))
            .filter((k) => k && !knownQuestionKeys.has(k));
    };

    const handleQuestionAnswerChange = (index: number, questionKey: string, value: string) => {
        const qk = normalizeQuestionKeyLocal(questionKey);
        if (!qk) return;
        const next = [...passengers];
        const current = next[index];
        if (!current) return;
        next[index] = {
            ...current,
            questionAnswers: {
                ...(current.questionAnswers || {}),
                [qk]: value,
            },
        };
        setPassengers(next);
        setIsDirty(true);
    };

    const handlePassengerChange = (
        index: number,
        field: keyof Omit<PassengerWithAnswers, 'type' | 'questionAnswers'>,
        value: string | boolean
    ) => {
        const newPassengers = [...passengers];
        const current = newPassengers[index];
        if (!current) return;

        if (field === 'withInfant') {
            const nextWithInfant = Boolean(value);
            newPassengers[index] = {
                ...current,
                withInfant: nextWithInfant,
                ...(nextWithInfant ? {} : { infantFirstName: '', infantLastName: '' }),
            };
        } else {
            newPassengers[index] = { ...current, [field]: value as any };
        }

        setPassengers(newPassengers);
        setIsDirty(true);

        // Keep contact info in sync with the first passenger's core details
        if (index === 0) {
            if (field === 'firstName' && (!contactDirty.firstName || purchaserSameAsPassenger1)) {
                setContactInfo(prev => ({ ...prev, firstName: String(value) }));
            } else if (field === 'lastName' && (!contactDirty.lastName || purchaserSameAsPassenger1)) {
                setContactInfo(prev => ({ ...prev, lastName: String(value) }));
            }
        }
    };

    const handleContactChange = (field: keyof ContactInfo, value: string | boolean) => {
        setContactInfo(prev => ({ ...prev, [field]: value }));
        setIsDirty(true);
        // Mark fields as user-overridden to stop auto-sync from Passenger 1
        if (field === 'firstName') {
            setContactDirty(prev => ({ ...prev, firstName: true }));
        } else if (field === 'lastName') {
            setContactDirty(prev => ({ ...prev, lastName: true }));
        } else if (field === 'country') {
            setContactDirty(prev => ({ ...prev, country: true }));
        }
    };

    useEffect(() => {
        try {
            const raw = sessionStorage.getItem('passenger_info_draft_v1');
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (!parsed || parsed.tripId !== booking?.outbound?.id) return;
            if (Array.isArray(parsed.passengers)) setPassengers(parsed.passengers);
            if (Array.isArray(parsed.selectedSeatIds)) setSelectedSeatIds(parsed.selectedSeatIds);
            if (parsed.contactInfo) setContactInfo(parsed.contactInfo);
            if (typeof parsed.paymentMethod === 'string') setPaymentMethod(parsed.paymentMethod);
            if (typeof parsed.purchaserSameAsPassenger1 === 'boolean') setPurchaserSameAsPassenger1(parsed.purchaserSameAsPassenger1);
        } catch {}
    }, [booking?.outbound?.id]);

    useEffect(() => {
        if (!isEaglelinerTrip) return;
        setPassengers((prev) => {
            const next = Array.isArray(prev) ? [...prev] : [];
            const adultIndices = next
                .map((p, idx) => (p && p.type !== 'child' ? idx : -1))
                .filter((idx) => idx >= 0);
            const activeAdultIndices = adultIndices.slice(0, Math.max(0, inferredInfantCount));

            let changed = false;
            for (const idx of adultIndices) {
                const p: any = next[idx];
                if (!p) continue;
                const should = activeAdultIndices.includes(idx);
                const current = Boolean(p.withInfant);
                if (current === should) continue;
                changed = true;
                next[idx] = {
                    ...p,
                    withInfant: should,
                    ...(should ? {} : { infantFirstName: '', infantLastName: '' }),
                };
            }
            return changed ? next : prev;
        });
    }, [isEaglelinerTrip, inferredInfantCount]);

    useEffect(() => {
        if (!isDirty) return;
        const t = window.setTimeout(() => {
            try {
                sessionStorage.setItem('passenger_info_draft_v1', JSON.stringify({
                    tripId: booking?.outbound?.id,
                    passengers,
                    selectedSeatIds,
                    contactInfo,
                    paymentMethod,
                    purchaserSameAsPassenger1,
                    ts: Date.now(),
                }));
            } catch {}
        }, 250);
        return () => window.clearTimeout(t);
    }, [isDirty, passengers, selectedSeatIds, contactInfo, paymentMethod, purchaserSameAsPassenger1, booking?.outbound?.id]);

    useEffect(() => {
        if (!isDirty) return;
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = 'Are you sure? Your entered details will be lost.';
            return 'Are you sure? Your entered details will be lost.';
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [isDirty]);

    useEffect(() => {
        if (!purchaserSameAsPassenger1) return;
        const first = passengers[0];
        if (!first) return;
        setContactInfo(prev => ({ ...prev, firstName: first.firstName || prev.firstName, lastName: first.lastName || prev.lastName }));
        setContactDirty(prev => ({ ...prev, firstName: false, lastName: false }));
    }, [purchaserSameAsPassenger1, passengers]);

    const validate = () => {
        const newErrors: any = { passengers: [] };
        let isValid = true;
        const phoneRegex = /^\+?[0-9\s-()]{7,20}$/;

        const dynamicKeys = getDynamicQuestionKeys();

        passengers.forEach((p, i) => {
            newErrors.passengers[i] = {};

            if (!String(p?.firstName || '').trim()) { newErrors.passengers[i].firstName = 'First name is required.'; isValid = false; }
            if (!String(p?.lastName || '').trim()) { newErrors.passengers[i].lastName = 'Last name is required.'; isValid = false; }

            if (isEaglelinerTrip) {
                if (p.type !== 'child') {
                    if (!String((p as any)?.title || '').trim()) { newErrors.passengers[i].title = 'Title is required.'; isValid = false; }
                    if (!p.gender) { newErrors.passengers[i].gender = 'Gender is required.'; isValid = false; }
                    else {
                        const gv = String(p.gender || '').trim().toLowerCase();
                        if (!(gv === 'male' || gv === 'female' || gv === 'm' || gv === 'f')) {
                            newErrors.passengers[i].gender = 'Gender must be Male or Female.';
                            isValid = false;
                        }
                    }
                    if (!p.idType) { newErrors.passengers[i].idType = 'ID type is required.'; isValid = false; }
                    if (!String(p.idNumber || '').trim()) { newErrors.passengers[i].idNumber = 'ID number is required.'; isValid = false; }

                    const nok = String((p as any)?.emergencyContactNumber || '').trim();
                    if (!nok) {
                        newErrors.passengers[i].emergencyContactNumber = 'Next of kin phone number is required.';
                        isValid = false;
                    } else if (!phoneRegex.test(nok)) {
                        newErrors.passengers[i].emergencyContactNumber = 'Invalid phone number format.';
                        isValid = false;
                    }

                    if ((p as any)?.withInfant) {
                        const infantFirst = String((p as any)?.infantFirstName || '').trim();
                        const infantLast = String((p as any)?.infantLastName || '').trim();
                        if (!infantFirst) { newErrors.passengers[i].infantFirstName = 'Infant first name is required.'; isValid = false; }
                        if (!infantLast) { newErrors.passengers[i].infantLastName = 'Infant surname is required.'; isValid = false; }
                    }
                }
            } else {
                if (isAllowedKey('id_type') && isRequiredKey('id_type') && !p.idType) { newErrors.passengers[i].idType = 'ID type is required.'; isValid = false; }
                if (isAllowedKey('id_number') && isRequiredKey('id_number') && !String(p.idNumber || '').trim()) { newErrors.passengers[i].idNumber = 'ID number is required.'; isValid = false; }
                if (isAllowedKey('nationality') && isRequiredKey('nationality') && !p.nationality) { newErrors.passengers[i].nationality = 'Nationality is required.'; isValid = false; }
                if (isAllowedKey('dob') && isRequiredKey('dob') && !p.dob) { newErrors.passengers[i].dob = 'Date of birth is required.'; isValid = false; }
                if (isAllowedKey('gender') && isRequiredKey('gender') && !p.gender) { newErrors.passengers[i].gender = 'Gender is required.'; isValid = false; }

                for (const k of dynamicKeys) {
                    if (!isAllowedKey(k) || !isRequiredKey(k)) continue;
                    const v = (p.questionAnswers && typeof p.questionAnswers === 'object') ? (p.questionAnswers as any)[k] : '';
                    if (!String(v || '').trim()) {
                        newErrors.passengers[i][`q_${k}`] = `${questionLabelFromKey(k)} is required.`;
                        isValid = false;
                    }
                }
            }
        });

        if (!purchaserSameAsPassenger1) {
            if (!contactInfo.firstName.trim()) { newErrors.contactFirstName = 'First name is required.'; isValid = false; }
            if (!contactInfo.lastName.trim()) { newErrors.contactLastName = 'Last name is required.'; isValid = false; }
        }

        if (!contactInfo.email.trim()) { newErrors.contactEmail = 'Email is required.'; isValid = false; }
        else if (!/\S+@\S+\.\S+/.test(contactInfo.email)) { newErrors.contactEmail = 'Email is invalid.'; isValid = false; }

        if (!contactInfo.phone.trim()) { newErrors.contactPhone = 'Phone number is required.'; isValid = false; }
        else if (!phoneRegex.test(contactInfo.phone)) { newErrors.contactPhone = 'Invalid phone number format.'; isValid = false; }

        if (!contactInfo.country) { newErrors.contactCountry = 'Country is required.'; isValid = false; }

        if (isEaglelinerTrip) {
            const selectedCount = Array.isArray(selectedSeatIds) ? selectedSeatIds.length : 0;
            if (selectedCount !== totalPassengersCount) {
                newErrors.selectedSeatIds = `Please select ${totalPassengersCount} seat(s).`;
                isValid = false;
            }
        }

        setErrors(newErrors);
        return isValid;
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const derivedContactInfo = purchaserSameAsPassenger1
            ? {
                ...contactInfo,
                firstName: (passengers[0]?.firstName || contactInfo.firstName || '').trim(),
                lastName: (passengers[0]?.lastName || contactInfo.lastName || '').trim(),
            }
            : contactInfo;

        if (validate() && booking?.outbound?.id) {
            const eaglelinerEstimatedTotal = (() => {
                if (!isEaglelinerTrip) return undefined;
                const computed = computeEaglelinerTotalFromCounts(eaglelinerSelectedCounts);
                if (typeof computed === 'number' && Number.isFinite(computed)) return computed;
                try {
                    const cart = getCartData();
                    const quoted = typeof cart?.quotedTotal === 'number' ? cart.quotedTotal : null;
                    if (quoted != null && Number.isFinite(quoted)) return quoted;
                } catch {}
                return undefined;
            })();

            onReview({
                contactInfo: derivedContactInfo,
                passengers,
                paymentMethod,
                tripId: booking.outbound.id,
                ...(isEaglelinerTrip ? { selectedSeatIds } : {}),
                ...(isEaglelinerTrip && eaglelinerEstimatedTotal != null ? { estimatedTotal: eaglelinerEstimatedTotal } : {}),
                searchQuery: query
            });
        }
    };

    const handleBackRequested = () => {
        if (isDirty) {
            const ok = window.confirm('Leave this page? Your details will be saved.');
            if (!ok) return;
        }
        onBack();
    };

    const paymentOptions = [
        { 
            value: 'In-Store',
            label: 'Pay In-Store', 
            icon: <StoreIcon className={`h-6 w-6 ${paymentMethod === 'In-Store' ? 'text-white' : 'text-gray-600 dark:text-gray-300'}`} />,
            disabled: false
        },
        { 
            value: 'Ecocash',
            label: 'Ecocash', 
            icon: (
                <div className="relative h-9 w-9 -m-1.5 flex items-center justify-center">
                    <div className="h-full w-full flex items-center justify-center opacity-50">
                        <img 
                            src="/ecocash-logo.png" 
                            alt="Ecocash" 
                            className="h-full w-auto object-contain"
                        />
                    </div>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-[8px] font-bold text-center text-gray-600 dark:text-gray-400 bg-white/90 dark:bg-gray-800/90 px-1 rounded">COMING SOON</span>
                    </div>
                </div>
            ),
            disabled: true
        },
        { 
            value: 'Credit Card',
            label: 'Credit Card', 
            icon: (
                <div className="relative h-6 w-6">
                    <CreditCardIcon className="h-full w-full opacity-50" />
                    <span className="absolute -bottom-1.5 left-1/2 transform -translate-x-1/2 text-[8px] font-bold text-gray-600 dark:text-gray-400 bg-white/90 dark:bg-gray-800/90 px-1 rounded whitespace-nowrap">COMING SOON</span>
                </div>
            ),
            disabled: true
        }
    ];

    return (
        <div className="max-w-6xl mx-auto animate-fade-in">
            <div className="mb-4">
                <button onClick={handleBackRequested} className="flex items-center text-[#652D8E] dark:text-purple-300 hover:opacity-80 font-semibold text-xs transition-colors">
                    <ChevronLeftIcon className="h-4 w-4 mr-1" />
                    Change selected trip
                </button>
            </div>

            <form onSubmit={handleSubmit}>
                <div className="lg:grid lg:grid-cols-3 lg:gap-4">
                    {/* Main Details Column */}
                    <div className="lg:col-span-2 space-y-4">
                        {/* Passenger Details */}
                        <div className="bg-white dark:bg-gray-800 p-3 rounded-2xl shadow-md border border-gray-200 dark:border-gray-700">
                            <div className="flex items-center justify-between gap-2 mb-1.5 border-b border-gray-200 dark:border-gray-700 pb-1.5">
                                <h2 className="text-xs font-bold text-[#652D8E] dark:text-purple-300">Passenger Details</h2>
                                {(() => {
                                    const ok = passengers.every(p => {
                                        if (!p.firstName.trim() || !p.lastName.trim()) return false;
                                        if (isEaglelinerTrip) {
                                            if (p.type !== 'child') {
                                                if (!String((p as any)?.title || '').trim()) return false;
                                                if (!p.gender) return false;
                                                if (!p.idType) return false;
                                                if (!p.idNumber.trim()) return false;
                                                const nok = String((p as any)?.emergencyContactNumber || '').trim();
                                                if (!nok) return false;
                                                if ((p as any)?.withInfant) {
                                                    if (!String((p as any)?.infantFirstName || '').trim()) return false;
                                                    if (!String((p as any)?.infantLastName || '').trim()) return false;
                                                }
                                            }
                                            return true;
                                        }

                                        if (isAllowedKey('id_type') && isRequiredKey('id_type') && !p.idType) return false;
                                        if (isAllowedKey('id_number') && isRequiredKey('id_number') && !p.idNumber.trim()) return false;
                                        const needDob = (p.type === 'child') || (isAllowedKey('dob') && isRequiredKey('dob'));
                                        if (needDob && !(p.dob && p.dob.trim())) return false;
                                        if (isAllowedKey('gender') && isRequiredKey('gender') && !p.gender) return false;
                                        if (isAllowedKey('nationality') && isRequiredKey('nationality') && !p.nationality) return false;
                                        const dyn = getDynamicQuestionKeys();
                                        for (const k of dyn) {
                                            if (!isAllowedKey(k) || !isRequiredKey(k)) continue;
                                            const v = (p.questionAnswers && typeof p.questionAnswers === 'object') ? p.questionAnswers[k] : '';
                                            if (!String(v || '').trim()) return false;
                                        }
                                        return true;
                                    });
                                    return ok ? <CheckIcon className="h-4 w-4 text-green-600 dark:text-green-300" /> : null;
                                })()}
                            </div>

                            <div className="text-[11px] text-gray-600 dark:text-gray-300 mb-2">
                                Only the essentials are required now. Some details may be requested later by the operator.
                            </div>
                            <div className="space-y-4">
                                {isEaglelinerTrip ? (
                                    <div className="rounded-2xl border border-gray-200/80 dark:border-gray-700/80 p-3 bg-gray-50/60 dark:bg-gray-900/30">
                                        <div className="flex items-center justify-between gap-2 mb-2">
                                            <h3 className="font-semibold text-sm text-[#652D8E] dark:text-purple-300">Seat selection</h3>
                                            <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">
                                                Select {totalPassengersCount} seat(s)
                                            </span>
                                        </div>
                                        <SeatMap
                                            route={booking.outbound}
                                            departDate={query?.departureDate}
                                            selectable
                                            selectedSeatIds={selectedSeatIds}
                                            maxSelectable={totalPassengersCount}
                                            onSelectedSeatIdsChange={setSelectedSeatIds}
                                        />
                                        {errors.selectedSeatIds ? (
                                            <p className="text-red-500 text-[10px] mt-1 pl-1">{errors.selectedSeatIds}</p>
                                        ) : null}
                                    </div>
                                ) : null}
                                {passengers.map((passenger, index) => (
                                    <div key={index} className="border-t border-gray-200/80 dark:border-gray-700/80 pt-3 first:pt-0 first:border-t-0">
                                        <h3 className="font-semibold text-sm text-[#652D8E] dark:text-purple-300 mb-1.5">Passenger {index + 1} <span className="text-xs capitalize text-gray-600 dark:text-gray-400 font-medium">({passenger.type})</span></h3>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">

                                            {isEaglelinerTrip && passenger.type !== 'child' ? (
                                                <CustomSelectField
                                                    id={`p${index}-title`}
                                                    label="Title"
                                                    icon={<UserCircleIcon className="h-4 w-4 text-gray-400" />}
                                                    value={String((passenger as any)?.title || '')}
                                                    onChange={(value) => handlePassengerChange(index, 'title', value)}
                                                    error={errors.passengers?.[index]?.title}
                                                    options={titleOptions}
                                                    placeholder="Select title"
                                                />
                                            ) : null}

                                            <FormField
                                                id={`p${index}-firstName`}
                                                label="First Name"
                                                icon={<UserCircleIcon className="h-4 w-4 text-gray-400" />}
                                                value={passenger.firstName}
                                                onChange={(e) => handlePassengerChange(index, 'firstName', e.target.value)}
                                                placeholder="John"
                                                error={errors.passengers?.[index]?.firstName}
                                            />
                                            <FormField
                                                id={`p${index}-lastName`}
                                                label="Last Name"
                                                icon={<UserCircleIcon className="h-4 w-4 text-gray-400" />}
                                                value={passenger.lastName}
                                                onChange={(e) => handlePassengerChange(index, 'lastName', e.target.value)}
                                                placeholder="Doe"
                                                error={errors.passengers?.[index]?.lastName}
                                            />
                                            {((isEaglelinerTrip && passenger.type !== 'child') || (isAllowedKey('id_type') && isRequiredKey('id_type'))) && (
                                                <CustomSelectField
                                                    id={`p${index}-idType`}
                                                    label="ID Type"
                                                    icon={<CreditCardIcon className="h-4 w-4 text-gray-400" />}
                                                    value={passenger.idType}
                                                    onChange={(value) => handlePassengerChange(index, 'idType', value)}
                                                    error={errors.passengers?.[index]?.idType}
                                                    options={idTypeOptions}
                                                    placeholder="Select ID Type"
                                                />
                                            )}
                                            {((isEaglelinerTrip && passenger.type !== 'child') || (isAllowedKey('id_number') && isRequiredKey('id_number'))) && (
                                                <FormField
                                                    id={`p${index}-idNumber`}
                                                    label="ID Number"
                                                    icon={<CreditCardIcon className="h-4 w-4 text-gray-400" />}
                                                    value={passenger.idNumber}
                                                    onChange={(e) => handlePassengerChange(index, 'idNumber', e.target.value)}
                                                    placeholder="ID Number"
                                                    error={errors.passengers?.[index]?.idNumber}
                                                />
                                            )}

                                            {isEaglelinerTrip && passenger.type !== 'child' ? (
                                                <CustomSelectField
                                                    id={`p${index}-gender`}
                                                    label="Gender"
                                                    icon={<UserCircleIcon className="h-4 w-4 text-gray-400" />}
                                                    value={passenger.gender}
                                                    onChange={(value) => handlePassengerChange(index, 'gender', value)}
                                                    error={errors.passengers?.[index]?.gender}
                                                    options={genderOptionsEagleliner}
                                                    placeholder="Select Gender"
                                                />
                                            ) : null}

                                            {isEaglelinerTrip && passenger.type !== 'child' ? (
                                                <FormField
                                                    id={`p${index}-nok-phone`}
                                                    label="Next of kin phone"
                                                    type="tel"
                                                    icon={<PhoneIcon className="h-4 w-4 text-gray-400" />}
                                                    value={String((passenger as any)?.emergencyContactNumber || '')}
                                                    onChange={(e) => handlePassengerChange(index, 'emergencyContactNumber', e.target.value)}
                                                    placeholder="+263 ..."
                                                    error={errors.passengers?.[index]?.emergencyContactNumber}
                                                />
                                            ) : null}

                                            {isEaglelinerTrip && passenger.type !== 'child' && !hideInfantToggle ? (
                                                <div className="sm:col-span-2">
                                                    <label htmlFor={`p${index}-withInfant`} className="flex items-center cursor-pointer select-none group">
                                                        <div className="relative">
                                                            <input
                                                                id={`p${index}-withInfant`}
                                                                type="checkbox"
                                                                className="sr-only"
                                                                checked={Boolean((passenger as any)?.withInfant)}
                                                                onChange={(e) => {
                                                                    handlePassengerChange(index, 'withInfant', e.target.checked);
                                                                }}
                                                            />
                                                            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all duration-200 ${
                                                                (passenger as any)?.withInfant
                                                                    ? 'bg-[#652D8E] border-[#652D8E] dark:bg-purple-600 dark:border-purple-600'
                                                                    : 'bg-white border-gray-400 group-hover:border-gray-500 dark:bg-gray-600 dark:border-gray-500'
                                                            }`}>
                                                                {(passenger as any)?.withInfant && (
                                                                    <CheckIcon className="h-3 w-3 text-white" />
                                                                )}
                                                            </div>
                                                        </div>
                                                        <span className="ml-2 text-xs text-gray-700 dark:text-gray-300">
                                                            Travelling with an infant
                                                        </span>
                                                    </label>
                                                </div>
                                            ) : null}

                                            {isEaglelinerTrip && passenger.type !== 'child' && (passenger as any)?.withInfant ? (
                                                <>
                                                    <FormField
                                                        id={`p${index}-infant-first`}
                                                        label="Infant First Name"
                                                        icon={<UserCircleIcon className="h-4 w-4 text-gray-400" />}
                                                        value={String((passenger as any)?.infantFirstName || '')}
                                                        onChange={(e) => handlePassengerChange(index, 'infantFirstName', e.target.value)}
                                                        placeholder="Infant first name"
                                                        error={errors.passengers?.[index]?.infantFirstName}
                                                    />
                                                    <FormField
                                                        id={`p${index}-infant-last`}
                                                        label="Infant Surname"
                                                        icon={<UserCircleIcon className="h-4 w-4 text-gray-400" />}
                                                        value={String((passenger as any)?.infantLastName || '')}
                                                        onChange={(e) => handlePassengerChange(index, 'infantLastName', e.target.value)}
                                                        placeholder="Infant surname"
                                                        error={errors.passengers?.[index]?.infantLastName}
                                                    />
                                                </>
                                            ) : null}

                                            {!isEaglelinerTrip ? getDynamicQuestionKeys().filter((k) => isRequiredKey(k)).map((k) => (
                                                <FormField
                                                    key={`p${index}-${k}`}
                                                    id={`p${index}-${k}`}
                                                    label={questionLabelFromKey(k)}
                                                    icon={<UserCircleIcon className="h-4 w-4 text-gray-400" />}
                                                    value={(passenger.questionAnswers && passenger.questionAnswers[k]) ? passenger.questionAnswers[k] : ''}
                                                    onChange={(e) => handleQuestionAnswerChange(index, k, e.target.value)}
                                                    placeholder={questionLabelFromKey(k)}
                                                    error={errors.passengers?.[index]?.[`q_${k}`]}
                                                />
                                            )) : null}

                                            {!isEaglelinerTrip && ((passenger.type === 'child') || (isAllowedKey('dob') && isRequiredKey('dob'))) ? (
                                                <DateFormField
                                                    id={`p${index}-dob`}
                                                    label="Date of Birth (as on ID)"
                                                    icon={<CalendarIcon className="h-4 w-4 text-gray-400" />}
                                                    value={passenger.dob}
                                                    onChange={(value) => handlePassengerChange(index, 'dob', value)}
                                                    placeholder="Select Date"
                                                    error={errors.passengers?.[index]?.dob}
                                                    maxDate={new Date()}
                                                />
                                            ) : null}

                                            {!isEaglelinerTrip && isAllowedKey('gender') && isRequiredKey('gender') && (
                                                <CustomSelectField
                                                    id={`p${index}-gender`}
                                                    label="Gender"
                                                    icon={<UserCircleIcon className="h-4 w-4 text-gray-400" />}
                                                    value={passenger.gender}
                                                    onChange={(value) => handlePassengerChange(index, 'gender', value)}
                                                    error={errors.passengers?.[index]?.gender}
                                                    options={genderOptions}
                                                    placeholder="Select Gender"
                                                />
                                            )}

                                            {!isEaglelinerTrip && isAllowedKey('nationality') && isRequiredKey('nationality') && (
                                                <div className="sm:col-span-2">
                                                    <CustomSelectField
                                                        id={`p${index}-nationality`}
                                                        label="Nationality (as on ID)"
                                                        icon={<LocationIcon className="h-4 w-4 text-gray-400" />}
                                                        value={passenger.nationality}
                                                        onChange={(value) => handlePassengerChange(index, 'nationality', value)}
                                                        error={errors.passengers?.[index]?.nationality}
                                                        options={nationalities}
                                                        placeholder="Select Nationality"
                                                        searchable
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Contact Information */}
                        <div className="bg-white dark:bg-gray-800 p-3 rounded-2xl shadow-md border border-gray-200 dark:border-gray-700">
                             <div className="flex items-center justify-between gap-2 mb-1.5 border-b border-gray-200 dark:border-gray-700 pb-1.5">
                                 <h2 className="text-xs font-bold text-[#652D8E] dark:text-purple-300">Purchaser Information</h2>
                                 {(() => {
                                     const ok = Boolean(contactInfo.firstName.trim() && contactInfo.lastName.trim() && contactInfo.email.trim() && contactInfo.phone.trim() && contactInfo.country);
                                     return ok ? <CheckIcon className="h-4 w-4 text-green-600 dark:text-green-300" /> : null;
                                 })()}
                             </div>
                             <label htmlFor="c-sameAsP1" className="flex items-center cursor-pointer select-none group mb-2">
                                 <div className="relative">
                                     <input
                                         id="c-sameAsP1"
                                         type="checkbox"
                                         className="sr-only"
                                         checked={purchaserSameAsPassenger1}
                                         onChange={(e) => {
                                             setPurchaserSameAsPassenger1(e.target.checked);
                                             setIsDirty(true);
                                         }}
                                     />
                                     <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all duration-200 ${
                                         purchaserSameAsPassenger1
                                             ? 'bg-[#652D8E] border-[#652D8E] dark:bg-purple-600 dark:border-purple-600'
                                             : 'bg-white border-gray-400 group-hover:border-gray-500 dark:bg-gray-600 dark:border-gray-500'
                                     }`}>
                                         {purchaserSameAsPassenger1 && (
                                             <CheckIcon className="h-3 w-3 text-white" />
                                         )}
                                     </div>
                                 </div>
                                 <span className="ml-2 text-xs text-gray-700 dark:text-gray-300">
                                     Purchaser is the same as Passenger 1
                                 </span>
                             </label>
                             <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {!purchaserSameAsPassenger1 ? (
                                    <>
                                        <FormField
                                            id="c-firstName"
                                            label="First Name"
                                            icon={<UserCircleIcon className="h-4 w-4 text-gray-400" />}
                                            value={contactInfo.firstName}
                                            onChange={(e) => handleContactChange('firstName', e.target.value)}
                                            placeholder="Jane"
                                            error={errors.contactFirstName}
                                        />
                                        <FormField
                                            id="c-lastName"
                                            label="Last Name"
                                            icon={<UserCircleIcon className="h-4 w-4 text-gray-400" />}
                                            value={contactInfo.lastName}
                                            onChange={(e) => handleContactChange('lastName', e.target.value)}
                                            placeholder="Smith"
                                            error={errors.contactLastName}
                                        />
                                    </>
                                ) : (
                                    <div className="sm:col-span-2 rounded-lg bg-gray-50 dark:bg-gray-800/60 border border-gray-200/70 dark:border-gray-700 p-2 text-[11px] text-gray-700 dark:text-gray-200">
                                        Using Passenger 1 details: <span className="font-semibold">{(passengers[0]?.firstName || '').trim() || 'First name'} {(passengers[0]?.lastName || '').trim() || 'Last name'}</span>
                                    </div>
                                )}
                                <FormField
                                    id="c-email"
                                    label="Email"
                                    type="email"
                                    icon={<AtSymbolIcon className="h-4 w-4 text-gray-400" />}
                                    value={contactInfo.email}
                                    onChange={(e) => handleContactChange('email', e.target.value)}
                                    placeholder="you@example.com"
                                    error={errors.contactEmail}
                                />
                                <FormField
                                    id="c-phone"
                                    label="Phone"
                                    type="tel"
                                    icon={<PhoneIcon className="h-4 w-4 text-gray-400" />}
                                    value={contactInfo.phone}
                                    onChange={(e) => handleContactChange('phone', e.target.value)}
                                    placeholder="(555) 123-4567"
                                    error={errors.contactPhone}
                                />
                                <div className="sm:col-span-2">
                                    <CustomSelectField
                                        id="c-country"
                                        label="Country of residence"
                                        icon={<LocationIcon className="h-4 w-4 text-gray-400" />}
                                        value={contactInfo.country}
                                        onChange={(value) => handleContactChange('country', value)}
                                        options={nationalities}
                                        placeholder="Select country"
                                        error={errors.contactCountry}
                                        searchable
                                    />
                                </div>
                             </div>
                        </div>
                        
                         {/* Payment Method */}
                        <div className="bg-white dark:bg-gray-800 p-3 rounded-2xl shadow-md border border-gray-200 dark:border-gray-700">
                             <div className="flex items-center justify-between gap-2 mb-1.5 border-b border-gray-200 dark:border-gray-700 pb-1.5">
                                 <h2 className="text-xs font-bold text-[#652D8E] dark:text-purple-300">Payment Method</h2>
                                 {paymentMethod ? <CheckIcon className="h-4 w-4 text-green-600 dark:text-green-300" /> : null}
                             </div>
                             <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                {paymentOptions.map(option => (
                                    <div key={option.value} className="relative">
                                        <button 
                                            type="button" 
                                            onClick={() => {
                                                if (option.disabled) return;
                                                setPaymentMethod(option.value);
                                                setIsDirty(true);
                                            }}
                                            disabled={option.disabled}
                                            className={`w-full p-2 rounded-lg border-2 flex flex-col items-center justify-center gap-1.5 transition-all duration-200 ${
                                                paymentMethod === option.value 
                                                ? 'bg-[#652D8E] dark:bg-purple-600 border-[#652D8E] dark:border-purple-600 shadow-lg' 
                                                : option.disabled
                                                    ? 'border-gray-200 bg-gray-50 dark:bg-gray-800/50 dark:border-gray-700 cursor-not-allowed' 
                                                    : 'border-gray-300 bg-white hover:border-gray-400 dark:bg-gray-700/50 dark:border-gray-600 dark:hover:border-gray-500'
                                            } ${option.disabled ? 'opacity-70' : ''}`}
                                        >
                                            {paymentMethod === option.value && !option.disabled && (
                                                <div className="absolute top-1.5 right-1.5 bg-white rounded-full p-0.5">
                                                    <CheckIcon className="h-3 w-3 text-[#652D8E]" />
                                                </div>
                                            )}
                                            {option.icon}
                                            <span className={`font-semibold text-[11px] ${paymentMethod === option.value ? 'text-white' : option.disabled ? 'text-gray-400 dark:text-gray-500' : 'text-gray-800 dark:text-gray-200'}`}>
                                                {option.label}
                                            </span>
                                        </button>
                                    </div>
                                ))}
                             </div>
                             {paymentMethod === 'In-Store' ? (
                                <div className="mt-2 text-[11px] text-gray-600 dark:text-gray-300">
                                    Reserve your ticket now, pay later. You’ll receive a reference number to pay at a partner outlet within {inStoreDeadlineHours} hours.
                                </div>
                             ) : null}
                             {paymentMethod === 'Credit Card' && (
                                <div className="mt-4 space-y-3 animate-fade-in-down">
                                    <h3 className="text-base font-semibold text-[#652D8E] dark:text-purple-300 pt-3 border-t border-gray-200/80 dark:border-gray-700/80">Credit Card Details</h3>
                                    <FormField
                                        id="cc-number"
                                        label="Card Number"
                                        icon={<CreditCardIcon className="h-4 w-4 text-gray-400" />}
                                        value=""
                                        onChange={() => {}}
                                        placeholder="0000 0000 0000 0000"
                                    />
                                    <div className="grid grid-cols-2 gap-3">
                                        <FormField
                                            id="cc-expiry"
                                            label="Expiry Date"
                                            icon={<CalendarIcon className="h-4 w-4 text-gray-400" />}
                                            value=""
                                            onChange={() => {}}
                                            placeholder="MM / YY"
                                        />
                                        <FormField
                                            id="cc-cvc"
                                            label="CVC"
                                            icon={<LockClosedIcon className="h-4 w-4 text-gray-400" />}
                                            value=""
                                            onChange={() => {}}
                                            placeholder="123"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Summary Column */}
                    <div className="lg:col-span-1 mt-4 lg:mt-0">
                        <div className="sticky top-24">
                            <div className="bg-white dark:bg-gray-800 p-3 rounded-2xl shadow-md border border-gray-200 dark:border-gray-700">
                                <h3 className="text-xs font-bold text-[#652D8E] dark:text-purple-300 mb-1.5 border-b border-gray-200 dark:border-gray-700 pb-1.5">Trip Summary</h3>
                                <TripSummary booking={booking} query={queryForSummary} onChangeRequested={() => {}} />
                                {/* One-way ad placeholder */}
                                {!booking.inbound && !query.returnDate && (
                                    <div className="mt-2 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-2 text-[11px] text-gray-500 dark:text-gray-400">
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[#652D8E]/10 text-[10px] font-semibold text-[#652D8E] dark:text-purple-300">
                                            Ad
                                        </span>
                                        <p className="mt-1 text-[11px] text-gray-600 dark:text-gray-300">
                                            Ad placeholder
                                        </p>
                                    </div>
                                )}
                                <button type="submit" className="btn-primary mt-2 w-full flex items-center justify-center gap-1.5 py-1.5 px-3 transform hover:scale-105 shadow-lg text-xs">
                                    <span>Review & Confirm</span>
                                    <ArrowRightIcon className="h-3.5 w-3.5" />
                                </button>
                                <div className="mt-1 text-[10px] text-gray-600 dark:text-gray-300">
                                    You will review all details before confirming your booking.
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </form>
        </div>
    );
};

export default PassengerInfo;