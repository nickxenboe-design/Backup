import React, { useState, useEffect, useRef } from 'react';
import { BusRoute, SearchQuery } from '../utils/api';
import { BookingDetails, Passenger, ContactInfo } from '../types';
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
        <div className={`relative flex-1 p-2 group rounded-md transition-colors duration-200 bg-gray-100 hover:bg-gray-200 focus-within:ring-2 focus-within:ring-inset dark:bg-gray-700 dark:hover:bg-gray-600 ${error ? 'ring-2 ring-red-500/80' : 'focus-within:ring-[#652D8E] dark:focus-within:ring-purple-500'}`}>
            <label htmlFor={id} className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-0.5">
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
                    className="w-full ml-2 text-base bg-transparent focus:outline-none text-black dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
                    autoComplete="off"
                />
            </div>
        </div>
        {error && <p className="text-red-500 text-xs mt-1 pl-1">{error}</p>}
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
}> = ({ id, label, icon, value, onChange, error, options, placeholder }) => {
  const [isOpen, setIsOpen] = useState(false);
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

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
  };
  
  const selectedLabel = options.find(opt => opt.value === value)?.label || placeholder;

  return (
    <div ref={containerRef} className="relative">
      <div>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={`relative w-full text-left p-2 group rounded-md transition-colors duration-200 bg-gray-100 hover:bg-gray-200 focus:outline-none focus-within:ring-2 focus-within:ring-inset dark:bg-gray-700 dark:hover:bg-gray-600 ${error ? 'ring-2 ring-red-500/80' : 'focus-within:ring-[#652D8E] dark:focus-within:ring-purple-500'}`}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
        >
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-0.5">
            {label}
          </label>
          <div className="flex items-center">
            {icon}
            <span className={`w-full ml-2 text-base truncate ${value ? 'text-black dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>
              {selectedLabel}
            </span>
            <ChevronDownIcon className={`h-5 w-5 text-gray-400 ml-2 transition-transform duration-200 ${isOpen ? 'transform rotate-180' : ''}`} />
          </div>
        </button>
        {error && <p className="text-red-500 text-xs mt-1 pl-1">{error}</p>}
      </div>
      
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-full bg-white rounded-lg shadow-xl border border-gray-200 z-20 animate-fade-in-down max-h-48 overflow-y-auto dark:bg-gray-800 dark:border-gray-600" role="listbox">
            <ul>
                {options.map((option) => (
                    <li
                        key={option.value}
                        onClick={() => handleSelect(option.value)}
                        className={`px-3 py-2 cursor-pointer hover:bg-gray-100 text-[#652D8E] text-sm font-medium dark:text-purple-300 dark:hover:bg-gray-700 ${value === option.value ? 'bg-gray-100 dark:bg-gray-700 font-bold' : ''}`}
                        role="option"
                        aria-selected={value === option.value}
                    >
                        {option.label}
                    </li>
                ))}
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
            <span className={`w-full ml-2 text-base truncate ${value ? 'text-black dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>
              {value ? formattedDate : placeholder}
            </span>
            <ChevronDownIcon className={`h-5 w-5 text-gray-400 ml-2 transition-transform duration-200 ${isOpen ? 'transform rotate-180' : ''}`} />
          </div>
        </button>
        {error && <p className="text-red-500 text-xs mt-1 pl-1">{error}</p>}
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
            nationality: 'US', 
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
            nationality: 'US', 
            emergencyContactName: 'Jane Doe', 
            emergencyContactNumber: '+15551234567' 
        }))
    ];

    const [passengers, setPassengers] = useState<Passenger[]>(initialPassengers);
    const [contactInfo, setContactInfo] = useState<ContactInfo>({
        firstName: 'Test',
        lastName: 'Contact',
        email: 'contact@example.com',
        phone: '+15557654321',
        country: 'US',
        optInMarketing: true,
    });
    const [paymentMethod, setPaymentMethod] = useState('In-Store');
    const [errors, setErrors] = useState<any>({});
    
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
    };

    const handleContactChange = (field: keyof ContactInfo, value: string | boolean) => {
        setContactInfo(prev => ({ ...prev, [field]: value }));
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
            <div className="mb-6">
                <button onClick={onBack} className="flex items-center text-[#652D8E] dark:text-purple-300 hover:opacity-80 font-semibold text-sm transition-colors">
                    <ChevronLeftIcon className="h-5 w-5 mr-1" />
                    Back to trip details
                </button>
            </div>

            <form onSubmit={handleSubmit}>
                <div className="lg:grid lg:grid-cols-3 lg:gap-8">
                    {/* Main Details Column */}
                    <div className="lg:col-span-2 space-y-8">
                        {/* Passenger Details */}
                        <div className="bg-white dark:bg-gray-800 p-4 rounded-2xl shadow-md border border-gray-200 dark:border-gray-700">
                            <h2 className="text-xl font-bold text-[#652D8E] dark:text-purple-300 mb-3 border-b border-gray-200 dark:border-gray-700 pb-3">Passenger Details</h2>
                            <div className="space-y-6">
                                {passengers.map((passenger, index) => (
                                    <div key={index} className="border-t border-gray-200/80 dark:border-gray-700/80 pt-4 first:pt-0 first:border-t-0">
                                        <h3 className="font-semibold text-base text-[#652D8E] dark:text-purple-300 mb-2">Passenger {index + 1} <span className="text-sm capitalize text-gray-600 dark:text-gray-400 font-medium">({passenger.type})</span></h3>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                                            <div className="sm:col-span-2 border-t border-gray-200/80 dark:border-gray-700/80 pt-3 mt-1">
                                                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Emergency Contact</h4>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                        <div className="bg-white dark:bg-gray-800 p-4 rounded-2xl shadow-md border border-gray-200 dark:border-gray-700">
                             <h2 className="text-xl font-bold text-[#652D8E] dark:text-purple-300 mb-3 border-b border-gray-200 dark:border-gray-700 pb-3">Contact Information</h2>
                             <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                                    />
                                </div>
                             </div>
                             <div className="mt-4 pt-4 border-t border-gray-200/80 dark:border-gray-700/80">
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
                                    <span className="ml-3 text-sm text-gray-700 dark:text-gray-300">
                                        Receive marketing emails and special offers.
                                    </span>
                                </label>
                            </div>
                        </div>
                        
                         {/* Payment Method */}
                        <div className="bg-white dark:bg-gray-800 p-4 rounded-2xl shadow-md border border-gray-200 dark:border-gray-700">
                             <h2 className="text-xl font-bold text-[#652D8E] dark:text-purple-300 mb-3 border-b border-gray-200 dark:border-gray-700 pb-3">Payment Method</h2>
                             <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                {paymentOptions.map(option => (
                                    <div key={option.name} className="relative">
                                        <button 
                                            type="button" 
                                            onClick={() => !option.disabled && setPaymentMethod(option.name)}
                                            disabled={option.disabled}
                                            className={`w-full p-4 rounded-lg border-2 flex flex-col items-center justify-center gap-2 transition-all duration-200 ${
                                                paymentMethod === option.name 
                                                ? 'bg-[#652D8E] dark:bg-purple-600 border-[#652D8E] dark:border-purple-600 shadow-lg' 
                                                : option.disabled
                                                    ? 'border-gray-200 bg-gray-50 dark:bg-gray-800/50 dark:border-gray-700 cursor-not-allowed' 
                                                    : 'border-gray-300 bg-white hover:border-gray-400 dark:bg-gray-700/50 dark:border-gray-600 dark:hover:border-gray-500'
                                            } ${option.disabled ? 'opacity-70' : ''}`}
                                        >
                                            {paymentMethod === option.name && !option.disabled && (
                                                <div className="absolute top-2 right-2 bg-white rounded-full p-0.5">
                                                    <CheckIcon className="h-3 w-3 text-[#652D8E]" />
                                                </div>
                                            )}
                                            {option.icon}
                                            <span className={`font-semibold text-sm ${paymentMethod === option.name ? 'text-white' : option.disabled ? 'text-gray-400 dark:text-gray-500' : 'text-gray-800 dark:text-gray-200'}`}>
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
                    <div className="lg:col-span-1 mt-8 lg:mt-0">
                        <div className="sticky top-28">
                            <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-md border border-gray-200 dark:border-gray-700">
                                <h3 className="text-xl font-bold text-[#652D8E] dark:text-purple-300 mb-4 border-b border-gray-200 dark:border-gray-700 pb-4">Trip Summary</h3>
                                <TripSummary booking={booking} query={query} />
                                <button type="submit" className="mt-6 w-full flex items-center justify-center gap-2 bg-[#652D8E] dark:bg-purple-600 text-white font-bold py-3 px-4 rounded-lg hover:opacity-90 transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#652D8E] dark:focus:ring-offset-gray-800 transform hover:scale-105 shadow-lg">
                                    <span>Review & Confirm</span>
                                    <ArrowRightIcon className="h-5 w-5" />
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