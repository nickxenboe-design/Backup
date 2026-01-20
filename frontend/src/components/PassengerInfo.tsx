import React, { useState, useEffect, useRef } from 'react';
import { BusRoute, SearchQuery, getCartData } from '@/utils/api';
import { BookingDetails, Passenger, ContactInfo } from '@/types';
import { hasAgentSessionStarted, isAgentModeActive } from '@/utils/agentHeaders';

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
import { countries } from './Countries';

interface PassengerInfoProps {
    booking: { outbound: BusRoute; inbound: BusRoute | null };
    query: SearchQuery;
    onBack: () => void;
    onReview: (details: BookingDetails) => void;
}

type PassengerWithAnswers = Passenger & { questionAnswers: Record<string, string> };

const flagEmojiFromCode = (code: string): string => {
    const c = String(code || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(c)) return '';
    const A = 0x1f1e6;
    return String.fromCodePoint(...c.split('').map((ch) => A + (ch.charCodeAt(0) - 65)));
};

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
  options: { value: string; label: string; code?: string; rightLabel?: string }[];
  placeholder: string;
  searchable?: boolean;
  disabled?: boolean;
  selectedDisplay?: (option: { value: string; label: string; code?: string; rightLabel?: string } | undefined) => React.ReactNode;
}> = ({ id, label, icon, value, onChange, error, options, placeholder, searchable, disabled = false, selectedDisplay }) => {
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
  
  const selectedOption = options.find(opt => opt.value === value);
  const selectedLabel = selectedOption?.label || placeholder;
  const selectedFlag = selectedOption?.code ? flagEmojiFromCode(selectedOption.code) : '';
  const selectedRight = selectedOption?.rightLabel ? String(selectedOption.rightLabel) : '';
  const selectedContent = selectedDisplay ? selectedDisplay(selectedOption) : (
    <>
      {selectedFlag ? `${selectedFlag} ` : ''}
      {selectedLabel}
      {selectedRight ? ` ${selectedRight}` : ''}
    </>
  );
  const filteredOptions = !searchable || !searchTerm
    ? options
    : options.filter(opt => {
        const q = searchTerm.toLowerCase();
        return (
          opt.label.toLowerCase().includes(q) ||
          (opt.rightLabel ? String(opt.rightLabel).toLowerCase().includes(q) : false)
        );
      });

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
              {selectedContent}
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
                  placeholder="Search"
                  className="w-full px-2 py-1 text-xs bg-gray-50 dark:bg-gray-700 text-black dark:text-white rounded outline-none placeholder-gray-500 dark:placeholder-gray-400"
                  autoFocus
                />
              </div>
            )}
            <ul>
                {filteredOptions.length > 0 ? (
                  filteredOptions.map((option) => (
                    <li
                        key={`${option.value}-${option.code || ''}-${option.rightLabel || ''}`}
                        onClick={() => handleSelect(option.value)}
                        className={`px-3 py-1.5 cursor-pointer hover:bg-gray-100 text-[#652D8E] text-xs font-medium dark:text-purple-300 dark:hover:bg-gray-700 ${value === option.value ? 'bg-gray-100 dark:bg-gray-700 font-bold' : ''}`}
                        role="option"
                        aria-selected={value === option.value}
                    >
                        <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0 truncate">
                                <span className="mr-2">{option.code ? flagEmojiFromCode(option.code) : ''}</span>
                                <span className="truncate">{option.label}</span>
                            </div>
                            {option.rightLabel ? (
                                <span className="shrink-0 text-gray-600 dark:text-gray-300">{option.rightLabel}</span>
                            ) : null}
                        </div>
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
    const initialPassengers: PassengerWithAnswers[] = [
        ...Array.from({ length: query.passengers.adults }, (_, i) => ({ 
            firstName: '', 
            lastName: '', 
            type: 'adult' as const, 
            dob: '', 
            gender: '', 
            idType: '', 
            idNumber: '', 
            nationality: 'ZW', 
            emergencyContactName: '', 
            emergencyContactNumber: '',
            questionAnswers: {}
        })),
        ...Array.from({ length: query.passengers.children }, (_, i) => ({ 
            firstName: '', 
            lastName: '', 
            type: 'child' as const, 
            dob: '', 
            gender: '', 
            idType: '', 
            idNumber: '', 
            nationality: 'ZW', 
            emergencyContactName: '', 
            emergencyContactNumber: '',
            questionAnswers: {}
        }))
    ];

    const inStoreDeadlineHours = (() => {
        const raw = (import.meta as any)?.env?.VITE_INSTORE_PAYMENT_DEADLINE_HOURS;
        const n = Number(raw);
        return Number.isFinite(n) && n > 0 ? n : 12;
    })();

    const [passengers, setPassengers] = useState<PassengerWithAnswers[]>(initialPassengers);
    const [requiredQuestionKeys, setRequiredQuestionKeys] = useState<Set<string>>(() => new Set());
    const [allowedQuestionKeys, setAllowedQuestionKeys] = useState<Set<string>>(() => new Set());

    const [contactInfo, setContactInfo] = useState<ContactInfo>(() => {
        const first = initialPassengers[0];
        return {
            firstName: first?.firstName || '',
            lastName: first?.lastName || '',
            email: '',
            phone: '',
            country: 'ZW',
            optInMarketing: false,
        };
    });
    const dialCodeByCountry = (countryCode: string): string => {
        const code = String(countryCode || '').toUpperCase();
        const hit = countries.find((c) => String(c.code || '').toUpperCase() === code);
        const dial = hit?.dialCode ? String(hit.dialCode).trim() : '';
        return dial || '+263';
    };

    const countryOptions = countries
        .filter((c) => c && c.code && c.name)
        .map((c) => ({ value: c.code, label: c.name, code: c.code }));

    const callingCodeOptions = countries
        .filter((c) => c && c.code && c.name && c.dialCode)
        .map((c) => ({ value: c.code, label: c.name, code: c.code, rightLabel: String(c.dialCode) }));

    const countryFromDialCode = (dialCode: string): string | null => {
        const raw = String(dialCode || '').trim();
        if (!raw) return null;
        const normalized = raw.replace(/\s+/g, '');
        const hit = countries.find((c) => String(c.dialCode || '').replace(/\s+/g, '') === normalized);
        return hit?.code || null;
    };

    const parsePhoneParts = (rawPhone: string): { dialCode: string; local: string; countryCode: string } => {
        const raw = String(rawPhone || '').trim();
        if (!raw) {
            const cc = contactInfo.country || 'ZW';
            return { dialCode: dialCodeByCountry(cc), local: '', countryCode: cc };
        }
        const match = raw.match(/^\s*(\+\d[\d\s]{0,8}\d|\+\d{1,4})\s*(.*)$/);
        if (match) {
            const dial = String(match[1] || '').trim();
            const cc = countryFromDialCode(dial) || contactInfo.country || 'ZW';
            return { dialCode: dial, local: (match[2] || '').trim(), countryCode: cc };
        }
        const cc = contactInfo.country || 'ZW';
        return { dialCode: dialCodeByCountry(cc), local: raw, countryCode: cc };
    };

    const buildPhone = (countryCode: string, local: string): string => {
        const d = dialCodeByCountry(countryCode);
        const l = String(local || '').trim();
        return `${d} ${l}`.trim();
    };

    const [phoneCountryCode, setPhoneCountryCode] = useState<string>(() => 'ZW');
    const [phoneLocal, setPhoneLocal] = useState<string>('');
    const [phoneDialDirty, setPhoneDialDirty] = useState(false);
    const [phoneLocalDirty, setPhoneLocalDirty] = useState(false);

    const [contactDirty, setContactDirty] = useState<{ firstName: boolean; lastName: boolean; country: boolean }>({
        firstName: false,
        lastName: false,
        country: false,
    });

    const [purchaserSameAsPassenger1, setPurchaserSameAsPassenger1] = useState(true);
    const [isDirty, setIsDirty] = useState(false);
    const [paymentMethod, setPaymentMethod] = useState('In-Store');
    const [errors, setErrors] = useState<any>({});
    const agentMode = isAgentModeActive() || hasAgentSessionStarted();

    useEffect(() => {
        if (agentMode) {
            if (paymentMethod !== 'In-Store') {
                setPaymentMethod('In-Store');
            }
        }
    }, [agentMode, paymentMethod]);

    const genderOptions = [
        { value: 'male', label: 'Male' },
        { value: 'female', label: 'Female' },
        { value: 'other', label: 'Other' },
        { value: 'prefer_not_to_say', label: 'Prefer not to say' },
    ];

    const idTypeOptions = [
        { value: 'passport', label: 'Passport' },
        { value: 'national_id', label: 'National ID Card' },
        { value: 'drivers_license', label: "Driver's License" },
    ];

    const normalizeQuestionKeyLocal = (value: string) => {
        try {
            const raw = String(value || '').trim();
            if (!raw) return '';

            const withUnderscores = raw.replace(/([a-z0-9])([A-Z])/g, '$1_$2');
            const normalized = withUnderscores
                .trim()
                .toLowerCase()
                .replace(/[\s-]+/g, '_')
                .replace(/[^a-z0-9_]/g, '');

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
            const optionalArr: string[] = schema && Array.isArray(schema.optional) ? schema.optional : [];
            const allArr: string[] = schema && Array.isArray(schema.all) ? schema.all : [];

            const effectiveRequiredArr = (!requiredArr || requiredArr.length === 0) && allArr && allArr.length ? allArr : requiredArr;
            const reqSet = new Set(effectiveRequiredArr.map((k) => normalizeQuestionKeyLocal(k)).filter(Boolean));
            setRequiredQuestionKeys(reqSet);

            const allowedSource = (allArr && allArr.length)
                ? allArr
                : [...requiredArr, ...optionalArr];
            setAllowedQuestionKeys(new Set(allowedSource.map((k) => normalizeQuestionKeyLocal(k)).filter(Boolean)));
        } catch {
            setRequiredQuestionKeys(new Set());
            setAllowedQuestionKeys(new Set());
        }
    }, [booking?.outbound?.id]);

    const isRequiredKey = (k: string) => requiredQuestionKeys.has(normalizeQuestionKeyLocal(k));
    const isAllowedKey = (k: string) => allowedQuestionKeys.has(normalizeQuestionKeyLocal(k));

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
        return Array.from(allowedQuestionKeys)
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
        value: string
    ) => {
        const next = [...passengers];
        const current = next[index];
        if (!current) return;
        next[index] = { ...current, [field]: value };
        setPassengers(next);
        setIsDirty(true);

        if (index === 0) {
            if (field === 'firstName' && (!contactDirty.firstName || purchaserSameAsPassenger1)) {
                setContactInfo((prev) => ({ ...prev, firstName: value }));
            } else if (field === 'lastName' && (!contactDirty.lastName || purchaserSameAsPassenger1)) {
                setContactInfo((prev) => ({ ...prev, lastName: value }));
            } else if (field === 'nationality' && (!contactDirty.country || purchaserSameAsPassenger1)) {
                setContactInfo((prev) => ({ ...prev, country: value }));
            }
        }
    };

    const handleContactChange = (field: keyof ContactInfo, value: string | boolean) => {
        setContactInfo((prev) => ({ ...prev, [field]: value }));
        setIsDirty(true);

        if (field === 'firstName') {
            setContactDirty((prev) => ({ ...prev, firstName: true }));
        } else if (field === 'lastName') {
            setContactDirty((prev) => ({ ...prev, lastName: true }));
        } else if (field === 'country') {
            setContactDirty((prev) => ({ ...prev, country: true }));
        }
    };

    useEffect(() => {
        if (phoneDialDirty || phoneLocalDirty) return;
        const parsed = parsePhoneParts(contactInfo.phone);
        setPhoneCountryCode(parsed.countryCode);
        setPhoneLocal(parsed.local);
    }, [contactInfo.phone, phoneDialDirty, phoneLocalDirty]);

    useEffect(() => {
        if (phoneDialDirty) return;
        const suggested = String(contactInfo.country || '').toUpperCase() || 'ZW';
        if (!suggested || suggested === phoneCountryCode) return;
        setPhoneCountryCode(suggested);
        const next = buildPhone(suggested, phoneLocal);
        if (next !== (contactInfo.phone || '')) {
            setContactInfo(prev => ({ ...prev, phone: next }));
        }
    }, [contactInfo.country, phoneDialDirty, phoneCountryCode, phoneLocal, contactInfo.phone]);

    useEffect(() => {
        try {
            const raw = sessionStorage.getItem('passenger_info_draft_v1');
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (!parsed || parsed.tripId !== booking?.outbound?.id) return;
            if (Array.isArray(parsed.passengers)) {
                setPassengers(parsed.passengers.map((p: any) => ({
                    ...p,
                    nationality: typeof p?.nationality === 'string' && p.nationality.trim() ? p.nationality : 'ZW',
                })));
            }
            if (parsed.contactInfo) {
                setContactInfo({
                    ...parsed.contactInfo,
                    country:
                        typeof parsed.contactInfo?.country === 'string' && parsed.contactInfo.country.trim()
                            ? parsed.contactInfo.country
                            : 'ZW',
                });
            }
            if (typeof parsed.paymentMethod === 'string') setPaymentMethod(parsed.paymentMethod);
            if (typeof parsed.purchaserSameAsPassenger1 === 'boolean') setPurchaserSameAsPassenger1(parsed.purchaserSameAsPassenger1);
        } catch {}
    }, [booking?.outbound?.id]);

    useEffect(() => {
        if (!isDirty) return;
        const t = window.setTimeout(() => {
            try {
                sessionStorage.setItem('passenger_info_draft_v1', JSON.stringify({
                    tripId: booking?.outbound?.id,
                    passengers,
                    contactInfo,
                    paymentMethod,
                    purchaserSameAsPassenger1,
                    ts: Date.now(),
                }));
            } catch {}
        }, 250);
        return () => window.clearTimeout(t);
    }, [isDirty, passengers, contactInfo, paymentMethod, purchaserSameAsPassenger1, booking?.outbound?.id]);

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
            if (!p.firstName.trim()) { newErrors.passengers[i].firstName = 'First name is required.'; isValid = false; }
            if (!p.lastName.trim()) { newErrors.passengers[i].lastName = 'Last name is required.'; isValid = false; }
            if (isAllowedKey('id_type') && isRequiredKey('id_type') && !p.idType) { newErrors.passengers[i].idType = 'ID type is required.'; isValid = false; }
            if (isAllowedKey('id_number') && isRequiredKey('id_number') && !p.idNumber.trim()) { newErrors.passengers[i].idNumber = 'ID number is required.'; isValid = false; }

            if (p.dob) {
                if (new Date(p.dob) > new Date()) { newErrors.passengers[i].dob = 'Date of birth cannot be in the future.'; isValid = false; }
            } else {
                const needDob = (p.type === 'child') || (isAllowedKey('dob') && isRequiredKey('dob'));
                if (needDob) { newErrors.passengers[i].dob = 'Date of birth is required.'; isValid = false; }
            }
            if (isAllowedKey('gender') && isRequiredKey('gender') && !p.gender) { newErrors.passengers[i].gender = 'Gender is required.'; isValid = false; }
            if (isAllowedKey('nationality') && isRequiredKey('nationality') && !p.nationality) { newErrors.passengers[i].nationality = 'Nationality is required.'; isValid = false; }

            for (const k of dynamicKeys) {
                if (!isAllowedKey(k) || !isRequiredKey(k)) continue;
                const v = (p.questionAnswers && typeof p.questionAnswers === 'object') ? p.questionAnswers[k] : '';
                if (!String(v || '').trim()) {
                    newErrors.passengers[i][`q_${k}`] = `${questionLabelFromKey(k)} is required.`;
                    isValid = false;
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
            onReview({
                contactInfo: derivedContactInfo,
                passengers,
                paymentMethod,
                tripId: booking.outbound.id,
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
                                {passengers.map((passenger, index) => (
                                    <div key={index} className="border-t border-gray-200/80 dark:border-gray-700/80 pt-3 first:pt-0 first:border-t-0 first:border-t-0">
                                        <h3 className="font-semibold text-sm text-[#652D8E] dark:text-purple-300 mb-1.5">Passenger {index + 1} <span className="text-xs capitalize text-gray-600 dark:text-gray-400 font-medium">({passenger.type})</span></h3>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">

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
                                            {isAllowedKey('id_type') && (
                                                <CustomSelectField
                                                    id={`p${index}-idType`}
                                                    label="ID Type"
                                                    icon={<CreditCardIcon className="h-4 w-4 text-gray-400" />}
                                                    value={passenger.idType}
                                                    onChange={(value) => handlePassengerChange(index, 'idType', value)}
                                                    error={isRequiredKey('id_type') ? errors.passengers?.[index]?.idType : undefined}
                                                    options={idTypeOptions}
                                                    placeholder="Select ID Type"
                                                />
                                            )}
                                            {isAllowedKey('id_number') && (
                                                <FormField
                                                    id={`p${index}-idNumber`}
                                                    label="ID Number"
                                                    icon={<CreditCardIcon className="h-4 w-4 text-gray-400" />}
                                                    value={passenger.idNumber}
                                                    onChange={(e) => handlePassengerChange(index, 'idNumber', e.target.value)}
                                                    placeholder="ID Number"
                                                    error={isRequiredKey('id_number') ? errors.passengers?.[index]?.idNumber : undefined}
                                                />
                                            )}

                                            {getDynamicQuestionKeys().map((k) => (
                                                <FormField
                                                    key={`p${index}-${k}`}
                                                    id={`p${index}-${k}`}
                                                    label={questionLabelFromKey(k)}
                                                    icon={<UserCircleIcon className="h-4 w-4 text-gray-400" />}
                                                    value={(passenger.questionAnswers && passenger.questionAnswers[k]) ? passenger.questionAnswers[k] : ''}
                                                    onChange={(e) => handleQuestionAnswerChange(index, k, e.target.value)}
                                                    placeholder={questionLabelFromKey(k)}
                                                    error={isRequiredKey(k) ? errors.passengers?.[index]?.[`q_${k}`] : undefined}
                                                />
                                            ))}

                                            {(passenger.type === 'child') || isAllowedKey('dob') ? (
                                                <DateFormField
                                                    id={`p${index}-dob`}
                                                    label="Date of Birth (as on ID)"
                                                    icon={<CalendarIcon className="h-4 w-4 text-gray-400" />}
                                                    value={passenger.dob}
                                                    onChange={(value) => handlePassengerChange(index, 'dob', value)}
                                                    placeholder="Select Date"
                                                    error={(passenger.type === 'child') || isRequiredKey('dob') ? errors.passengers?.[index]?.dob : undefined}
                                                    maxDate={new Date()}
                                                />
                                            ) : null}

                                            {isAllowedKey('gender') && (
                                                <CustomSelectField
                                                    id={`p${index}-gender`}
                                                    label="Gender"
                                                    icon={<UserCircleIcon className="h-4 w-4 text-gray-400" />}
                                                    value={passenger.gender}
                                                    onChange={(value) => handlePassengerChange(index, 'gender', value)}
                                                    error={isRequiredKey('gender') ? errors.passengers?.[index]?.gender : undefined}
                                                    options={genderOptions}
                                                    placeholder="Select Gender"
                                                />
                                            )}

                                            {isAllowedKey('nationality') && (
                                                <div className="sm:col-span-2">
                                                    <CustomSelectField
                                                        id={`p${index}-nationality`}
                                                        label="Nationality (as on ID)"
                                                        icon={<LocationIcon className="h-4 w-4 text-gray-400" />}
                                                        value={passenger.nationality}
                                                        onChange={(value) => handlePassengerChange(index, 'nationality', value)}
                                                        error={isRequiredKey('nationality') ? errors.passengers?.[index]?.nationality : undefined}
                                                        options={countryOptions}
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
                                <div>
                                    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-2">
                                        <CustomSelectField
                                            id="c-phone-code"
                                            label="Code"
                                            icon={<span className="w-4" />}
                                            value={phoneCountryCode}
                                            onChange={(value) => {
                                                setPhoneDialDirty(true);
                                                setPhoneCountryCode(value);
                                                handleContactChange('phone', buildPhone(value, phoneLocal));
                                            }}
                                            options={callingCodeOptions}
                                            placeholder="+263"
                                            searchable
                                            selectedDisplay={(opt) => {
                                                const code = opt?.code ? flagEmojiFromCode(opt.code) : '';
                                                const dial = opt?.rightLabel ? String(opt.rightLabel) : '';
                                                return (
                                                    <>
                                                        {code ? `${code} ` : ''}{dial || '+263'}
                                                    </>
                                                );
                                            }}
                                        />

                                        <div>
                                            <FormField
                                                id="c-phone"
                                                label="Phone"
                                                type="tel"
                                                icon={<PhoneIcon className="h-4 w-4 text-gray-400" />}
                                                value={phoneLocal}
                                                onChange={(e) => {
                                                    const v = e.target.value;
                                                    setPhoneLocalDirty(true);
                                                    setPhoneLocal(v);
                                                    handleContactChange('phone', buildPhone(phoneCountryCode, v));
                                                }}
                                                placeholder="77 123 4567"
                                                error={errors.contactPhone}
                                            />
                                        </div>
                                    </div>
                                </div>
                                <div className="sm:col-span-2">
                                    <CustomSelectField
                                        id="c-country"
                                        label="Country of residence"
                                        icon={<LocationIcon className="h-4 w-4 text-gray-400" />}
                                        value={contactInfo.country}
                                        onChange={(value) => handleContactChange('country', value)}
                                        options={countryOptions}
                                        placeholder="Select country"
                                        error={errors.contactCountry}
                                        searchable
                                    />

                                </div>
                             </div>
                        </div>
                        
                         {!agentMode && (
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
                        )}
                    </div>

                    {/* Summary Column */}
                    <div className="lg:col-span-1 mt-4 lg:mt-0">
                        <div className="sticky top-24">
                            <div className="bg-white dark:bg-gray-800 p-3 rounded-2xl shadow-md border border-gray-200 dark:border-gray-700">
                                <h3 className="text-xs font-bold text-[#652D8E] dark:text-purple-300 mb-1.5 border-b border-gray-200 dark:border-gray-700 pb-1.5">Trip Summary</h3>
                                <TripSummary booking={booking} query={query} compact />
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