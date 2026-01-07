import React, { useState, useEffect, useRef } from 'react';
import { BusRoute, SearchQuery } from '@/utils/api';
import { BookingDetails, Passenger, ContactInfo } from '@/types';
import { 
    ChevronLeftIcon, 
    ArrowRightIcon, 
    CreditCardIcon, 
    PayPalIcon, 
    GooglePayIcon, 
    StoreIcon, 
    UserCircleIcon, 
    AtSymbolIcon, 
    PhoneIcon, 
    CheckIcon, 
    CalendarIcon, 
    LockClosedIcon, 
    LocationIcon, 
    ChevronDownIcon,
    EcocashIcon
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

const FormField: React.FC<{
  id: string;
  label: string;
  icon: React.ReactNode;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder: string;
  type?: string;
  error?: string;
}> = ({ id, label, icon, value, onChange, placeholder, type = 'text', error }) => (
    <div>
        <div className={`relative flex-1 p-1.5 group rounded-md transition-colors duration-200 bg-gray-100 hover:bg-gray-200 focus-within:ring-2 focus-within:ring-inset dark:bg-gray-700 dark:hover:bg-gray-600 ${error ? 'ring-2 ring-red-500/80' : 'focus-within:ring-[#652D8E] dark:focus-within:ring-purple-500'}`}>
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
}> = ({ id, label, icon, value, onChange, error, options, placeholder, searchable }) => {
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
          onClick={() => setIsOpen(!isOpen)}
          onKeyDown={(e) => {
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
    const initialPassengers: Passenger[] = [
        ...Array.from({ length: query.passengers.adults }, (_, i) => ({ 
            firstName: `John`, 
            lastName: `Doe`, 
            type: 'adult' as const, 
            dob: '1985-05-15', 
            gender: 'male', 
            idType: 'passport', 
            idNumber: `P1234567${i}`, 
            nationality: 'ZW', 
            emergencyContactName: 'Jane Doe', 
            emergencyContactNumber: '+15551234567' 
        })),
        ...Array.from({ length: query.passengers.children }, (_, i) => ({ 
            firstName: `Jimmy`, 
            lastName: `Doe`, 
            type: 'child' as const, 
            dob: '2010-10-20', 
            gender: 'male', 
            idType: 'passport', 
            idNumber: `C8765432${i}`, 
            nationality: 'ZW', 
            emergencyContactName: 'Jane Doe', 
            emergencyContactNumber: '+15551234567' 
        }))
    ];

    const [passengers, setPassengers] = useState<Passenger[]>(initialPassengers);
    const [contactInfo, setContactInfo] = useState<ContactInfo>(() => {
        const first = initialPassengers[0];
        return {
            firstName: first?.firstName || '',
            lastName: first?.lastName || '',
            email: '',
            phone: '',
            country: first?.nationality || '',
            optInMarketing: true,
        };
    });
    const [contactDirty, setContactDirty] = useState<{ firstName: boolean; lastName: boolean; country: boolean }>({
        firstName: false,
        lastName: false,
        country: false,
    });
    const [paymentMethod, setPaymentMethod] = useState('In-Store');
    const [errors, setErrors] = useState<any>({});
    const [uploadingDocIndex, setUploadingDocIndex] = useState<number | null>(null);
    const [uploadDocError, setUploadDocError] = useState<string | null>(null);
    const [uploadDocErrorIndex, setUploadDocErrorIndex] = useState<number | null>(null);
    
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


    const handlePassengerChange = (index: number, field: keyof Omit<Passenger, 'type'>, value: string) => {
        const newPassengers = [...passengers];
        newPassengers[index] = { ...newPassengers[index], [field]: value };
        setPassengers(newPassengers);

        // Keep contact info in sync with the first passenger's core details
        if (index === 0) {
            if (field === 'firstName' && !contactDirty.firstName) {
                setContactInfo(prev => ({ ...prev, firstName: value }));
            } else if (field === 'lastName' && !contactDirty.lastName) {
                setContactInfo(prev => ({ ...prev, lastName: value }));
            } else if (field === 'nationality' && !contactDirty.country) {
                setContactInfo(prev => ({ ...prev, country: value }));
            }
        }
    };

    const handleDocumentUpload = async (index: number, file: File | null) => {
        if (!file) return;
        setUploadDocError(null);
        setUploadDocErrorIndex(null);
        setUploadingDocIndex(index);

        try {
            const formData = new FormData();
            formData.append('file', file);

            const res = await fetch('/api/passengers/extract-from-document', {
                method: 'POST',
                body: formData,
                credentials: 'include',
            });

            const json = await res.json().catch(() => null);

            if (!res.ok || !json || !json.success || !json.data) {
                const message = (json && (json.error || json.message)) || 'Unable to read document. Please check the image quality.';
                setUploadDocError(message);
                setUploadDocErrorIndex(index);
                return;
            }

            const data = json.data as {
                documentType?: string;
                fullName?: string;
                dateOfBirth?: string;
                nationality?: string;
                documentNumber?: string;
                expiryDate?: string;
            };

            setPassengers(prev => {
                const next = [...prev];
                const current = next[index];
                if (!current) return prev;

                let firstName = current.firstName;
                let lastName = current.lastName;

                if (data.fullName && typeof data.fullName === 'string') {
                    const parts = data.fullName.trim().split(/\s+/).filter(Boolean);
                    if (parts.length === 1) {
                        firstName = parts[0];
                    } else if (parts.length > 1) {
                        lastName = parts[parts.length - 1];
                        firstName = parts.slice(0, -1).join(' ');
                    }
                }

                let idType = current.idType;
                if (data.documentType === 'passport') {
                    idType = 'passport';
                } else if (data.documentType === 'national_id') {
                    idType = 'national_id';
                } else if (data.documentType === 'drivers_licence') {
                    idType = 'drivers_license';
                }

                next[index] = {
                    ...current,
                    firstName,
                    lastName,
                    dob: data.dateOfBirth || current.dob,
                    nationality: data.nationality || current.nationality,
                    idType,
                    idNumber: data.documentNumber || current.idNumber,
                };

                return next;
            });
        } catch (e: any) {
            const message = e?.message || 'Failed to process document. Please try again.';
            setUploadDocError(message);
            setUploadDocErrorIndex(index);
        } finally {
            setUploadingDocIndex(null);
        }
    };

    const handleContactChange = (field: keyof ContactInfo, value: string | boolean) => {
        setContactInfo(prev => ({ ...prev, [field]: value }));
        // Mark fields as user-overridden to stop auto-sync from Passenger 1
        if (field === 'firstName') {
            setContactDirty(prev => ({ ...prev, firstName: true }));
        } else if (field === 'lastName') {
            setContactDirty(prev => ({ ...prev, lastName: true }));
        } else if (field === 'country') {
            setContactDirty(prev => ({ ...prev, country: true }));
        }
    };

    const validate = () => {
        const newErrors: any = { passengers: [] };
        let isValid = true;
        
        const phoneRegex = /^\+?[0-9\s-()]{7,20}$/;

        passengers.forEach((p, i) => {
            newErrors.passengers[i] = {};
            if (!p.firstName.trim()) { newErrors.passengers[i].firstName = 'First name is required.'; isValid = false; }
            if (!p.lastName.trim()) { newErrors.passengers[i].lastName = 'Last name is required.'; isValid = false; }
            
            if (!p.dob) { 
                newErrors.passengers[i].dob = 'Date of birth is required.'; 
                isValid = false; 
            } else if (new Date(p.dob) > new Date()) {
                newErrors.passengers[i].dob = 'Date of birth cannot be in the future.';
                isValid = false;
            }

            if (!p.gender) { newErrors.passengers[i].gender = 'Gender is required.'; isValid = false; }
            if (!p.nationality) { newErrors.passengers[i].nationality = 'Nationality is required.'; isValid = false; }
            if (!p.idType) { newErrors.passengers[i].idType = 'ID type is required.'; isValid = false; }
            if (!p.idNumber.trim()) { newErrors.passengers[i].idNumber = 'ID number is required.'; isValid = false; }
            if (!p.emergencyContactName.trim()) { newErrors.passengers[i].emergencyContactName = 'Emergency contact name is required.'; isValid = false; }
            
            if (!p.emergencyContactNumber.trim()) { 
                newErrors.passengers[i].emergencyContactNumber = 'Emergency contact number is required.'; 
                isValid = false; 
            } else if (!phoneRegex.test(p.emergencyContactNumber)) {
                newErrors.passengers[i].emergencyContactNumber = 'Invalid phone number format.';
                isValid = false;
            }
        });

        if (!contactInfo.firstName.trim()) { newErrors.contactFirstName = 'First name is required.'; isValid = false; }
        if (!contactInfo.lastName.trim()) { newErrors.contactLastName = 'Last name is required.'; isValid = false; }
        
        if (!contactInfo.email.trim()) { 
            newErrors.contactEmail = 'Email is required.'; 
            isValid = false; 
        } else if (!/\S+@\S+\.\S+/.test(contactInfo.email)) { 
            newErrors.contactEmail = 'Email is invalid.'; 
            isValid = false; 
        }

        if (!contactInfo.phone.trim()) { 
            newErrors.contactPhone = 'Phone number is required.'; 
            isValid = false; 
        } else if (!phoneRegex.test(contactInfo.phone)) {
            newErrors.contactPhone = 'Invalid phone number format.';
            isValid = false;
        }

        if (!contactInfo.country) { newErrors.contactCountry = 'Country is required.'; isValid = false; }

        setErrors(newErrors);
        return isValid;
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (validate() && booking?.outbound?.id) {
            onReview({
                contactInfo,
                passengers,
                paymentMethod,
                tripId: booking.outbound.id,
                searchQuery: query
            });
        }
    };
    
    const paymentOptions = [
        { 
            name: 'In-Store', 
            icon: <StoreIcon className={`h-6 w-6 ${paymentMethod === 'In-Store' ? 'text-white' : 'text-gray-600 dark:text-gray-300'}`} />,
            disabled: false
        },
        { 
            name: 'Ecocash', 
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
            name: 'Credit Card', 
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
                <button onClick={onBack} className="flex items-center text-[#652D8E] dark:text-purple-300 hover:opacity-80 font-semibold text-xs transition-colors">
                    <ChevronLeftIcon className="h-4 w-4 mr-1" />
                    Back to results
                </button>
            </div>

            <form onSubmit={handleSubmit}>
                <div className="lg:grid lg:grid-cols-3 lg:gap-4">
                    {/* Main Details Column */}
                    <div className="lg:col-span-2 space-y-4">
                        {/* Passenger Details */}
                        <div className="bg-white dark:bg-gray-800 p-3 rounded-2xl shadow-md border border-gray-200 dark:border-gray-700">
                            <h2 className="text-xs font-bold text-[#652D8E] dark:text-purple-300 mb-1.5 border-b border-gray-200 dark:border-gray-700 pb-1.5">Passenger Details</h2>
                            <div className="space-y-4">
                                {passengers.map((passenger, index) => (
                                    <div key={index} className="border-t border-gray-200/80 dark:border-gray-700/80 pt-3 first:pt-0 first:border-t-0">
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
                                            <DateFormField
                                                id={`p${index}-dob`}
                                                label="Date of Birth"
                                                icon={<CalendarIcon className="h-4 w-4 text-gray-400" />}
                                                value={passenger.dob}
                                                onChange={(value) => handlePassengerChange(index, 'dob', value)}
                                                placeholder="Select Date"
                                                error={errors.passengers?.[index]?.dob}
                                                maxDate={new Date()}
                                            />
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
                                            <div className="sm:col-span-2">
                                                <CustomSelectField
                                                    id={`p${index}-nationality`}
                                                    label="Nationality"
                                                    icon={<LocationIcon className="h-4 w-4 text-gray-400" />}
                                                    value={passenger.nationality}
                                                    onChange={(value) => handlePassengerChange(index, 'nationality', value)}
                                                    error={errors.passengers?.[index]?.nationality}
                                                    options={nationalities}
                                                    placeholder="Select Nationality"
                                                    searchable
                                                />
                                            </div>
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
                                            <FormField
                                                id={`p${index}-idNumber`}
                                                label="ID Number"
                                                icon={<CreditCardIcon className="h-4 w-4 text-gray-400" />}
                                                value={passenger.idNumber}
                                                onChange={(e) => handlePassengerChange(index, 'idNumber', e.target.value)}
                                                placeholder="ID Number"
                                                error={errors.passengers?.[index]?.idNumber}
                                            />
                                            <div className="sm:col-span-2 flex flex-col gap-1 text-[11px] mt-0.5">
                                                <label className="text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                                    Upload ID / Passport (PDF or image)
                                                </label>
                                                <div className="flex flex-col sm:flex-row sm:items-center sm:gap-2">
                                                    <input
                                                        type="file"
                                                        accept=".pdf,image/*"
                                                        className="block w-full text-[11px] text-gray-700 dark:text-gray-200 file:mr-2 file:py-1 file:px-2 file:rounded-md file:border-0 file:text-[11px] file:font-semibold file:bg-[#652D8E]/10 file:text-[#652D8E] dark:file:bg-purple-700/40 dark:file:text-purple-100"
                                                        onChange={(e) => handleDocumentUpload(index, e.target.files && e.target.files[0] ? e.target.files[0] : null)}
                                                    />
                                                    {uploadingDocIndex === index && (
                                                        <span className="mt-1 sm:mt-0 text-[10px] text-gray-500 dark:text-gray-400">
                                                            Reading document…
                                                        </span>
                                                    )}
                                                </div>
                                                {uploadDocError && uploadDocErrorIndex === index && (
                                                    <p className="text-[10px] text-red-500 mt-0.5">
                                                        {uploadDocError}
                                                    </p>
                                                )}
                                            </div>
                                            <div className="sm:col-span-2 border-t border-gray-200/80 dark:border-gray-700/80 pt-2.5 mt-1">
                                                <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">Emergency Contact</h4>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                    <FormField
                                                        id={`p${index}-emergencyContactName`}
                                                        label="Full Name"
                                                        icon={<UserCircleIcon className="h-4 w-4 text-gray-400" />}
                                                        value={passenger.emergencyContactName}
                                                        onChange={(e) => handlePassengerChange(index, 'emergencyContactName', e.target.value)}
                                                        placeholder="Jane Smith"
                                                        error={errors.passengers?.[index]?.emergencyContactName}
                                                    />
                                                    <FormField
                                                        id={`p${index}-emergencyContactNumber`}
                                                        label="Phone Number"
                                                        type="tel"
                                                        icon={<PhoneIcon className="h-4 w-4 text-gray-400" />}
                                                        value={passenger.emergencyContactNumber}
                                                        onChange={(e) => handlePassengerChange(index, 'emergencyContactNumber', e.target.value)}
                                                        placeholder="(555) 987-6543"
                                                        error={errors.passengers?.[index]?.emergencyContactNumber}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Contact Information */}
                        <div className="bg-white dark:bg-gray-800 p-3 rounded-2xl shadow-md border border-gray-200 dark:border-gray-700">
                             <h2 className="text-xs font-bold text-[#652D8E] dark:text-purple-300 mb-1.5 border-b border-gray-200 dark:border-gray-700 pb-1.5">Purchaser Information</h2>
                             <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
                                        label="Country"
                                        icon={<LocationIcon className="h-4 w-4 text-gray-400" />}
                                        value={contactInfo.country}
                                        onChange={(value) => handleContactChange('country', value)}
                                        options={nationalities}
                                        placeholder="Select Country"
                                        error={errors.contactCountry}
                                        searchable
                                    />
                                </div>
                             </div>
                             <div className="mt-3 pt-3 border-t border-gray-200/80 dark:border-gray-700/80">
                                <label htmlFor="c-optInMarketing" className="flex items-center cursor-pointer select-none group">
                                    <div className="relative">
                                        <input
                                            id="c-optInMarketing"
                                            type="checkbox"
                                            className="sr-only"
                                            checked={contactInfo.optInMarketing}
                                            onChange={(e) => handleContactChange('optInMarketing', e.target.checked)}
                                        />
                                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all duration-200 ${
                                            contactInfo.optInMarketing
                                                ? 'bg-[#652D8E] border-[#652D8E] dark:bg-purple-600 dark:border-purple-600'
                                                : 'bg-white border-gray-400 group-hover:border-gray-500 dark:bg-gray-600 dark:border-gray-500'
                                        }`}>
                                            {contactInfo.optInMarketing && (
                                                <CheckIcon className="h-3 w-3 text-white" />
                                            )}
                                        </div>
                                    </div>
                                    <span className="ml-2 text-xs text-gray-700 dark:text-gray-300">
                                        Receive marketing emails and special offers.
                                    </span>
                                </label>
                            </div>
                        </div>
                        
                         {/* Payment Method */}
                        <div className="bg-white dark:bg-gray-800 p-3 rounded-2xl shadow-md border border-gray-200 dark:border-gray-700">
                             <h2 className="text-xs font-bold text-[#652D8E] dark:text-purple-300 mb-1.5 border-b border-gray-200 dark:border-gray-700 pb-1.5">Payment Method</h2>
                             <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                {paymentOptions.map(option => (
                                    <div key={option.name} className="relative">
                                        <button 
                                            type="button" 
                                            onClick={() => !option.disabled && setPaymentMethod(option.name)}
                                            disabled={option.disabled}
                                            className={`w-full p-2 rounded-lg border-2 flex flex-col items-center justify-center gap-1.5 transition-all duration-200 ${
                                                paymentMethod === option.name 
                                                ? 'bg-[#652D8E] dark:bg-purple-600 border-[#652D8E] dark:border-purple-600 shadow-lg' 
                                                : option.disabled
                                                    ? 'border-gray-200 bg-gray-50 dark:bg-gray-800/50 dark:border-gray-700 cursor-not-allowed' 
                                                    : 'border-gray-300 bg-white hover:border-gray-400 dark:bg-gray-700/50 dark:border-gray-600 dark:hover:border-gray-500'
                                            } ${option.disabled ? 'opacity-70' : ''}`}
                                        >
                                            {paymentMethod === option.name && !option.disabled && (
                                                <div className="absolute top-1.5 right-1.5 bg-white rounded-full p-0.5">
                                                    <CheckIcon className="h-3 w-3 text-[#652D8E]" />
                                                </div>
                                            )}
                                            {option.icon}
                                            <span className={`font-semibold text-[11px] ${paymentMethod === option.name ? 'text-white' : option.disabled ? 'text-gray-400 dark:text-gray-500' : 'text-gray-800 dark:text-gray-200'}`}>
                                                {option.name}
                                            </span>
                                        </button>
                                    </div>
                                ))}
                             </div>
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
                            </div>
                        </div>
                    </div>
                </div>
            </form>
        </div>
    );
};

export default PassengerInfo;