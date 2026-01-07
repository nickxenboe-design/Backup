import React, { useState, useRef, useEffect } from 'react';

interface LocationInputProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  icon: React.ReactNode;
}

const allLocations = [
    'v73xj7',
    'v58fnj',
    'v1abc2',
    'v3def4',
    'v5ghi6',
    'v7jkl8',
    'v9mno0',
    'v1pqr2',
    'v3stu4',
    'v5vwx6',
    'v7yza8',
    'v9bcd0'
];

const LocationInput: React.FC<LocationInputProps> = ({ id, label, value, onChange, icon }) => {
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setShowSuggestions(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const inputValue = e.target.value;
        onChange(inputValue);

        if (inputValue) {
            const filteredSuggestions = allLocations.filter(location =>
                location.toLowerCase().includes(inputValue.toLowerCase())
            );
            setSuggestions(filteredSuggestions);
            setShowSuggestions(filteredSuggestions.length > 0);
        } else {
            setShowSuggestions(false);
        }
    };

    const handleSuggestionClick = (suggestion: string) => {
        onChange(suggestion);
        setShowSuggestions(false);
    };

    return (
        <div ref={containerRef} className="relative flex-1 p-4 group rounded-lg lg:rounded-none transition-colors duration-200 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700/50 dark:hover:bg-gray-700">
            <label htmlFor={id} className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">
                {label}
            </label>
            <div className="flex items-center">
                {icon}
                <input
                    id={id}
                    type="text"
                    value={value}
                    onChange={handleInputChange}
                    onFocus={() => value && setShowSuggestions(suggestions.length > 0)}
                    placeholder={`Enter a ${label.toLowerCase()}`}
                    className="w-full ml-3 text-lg bg-transparent focus:outline-none text-black dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
                    autoComplete="off"
                />
            </div>
            {showSuggestions && (
                <ul className="absolute left-0 mt-4 w-full bg-white border border-gray-300 rounded-lg shadow-lg z-20 max-h-60 overflow-y-auto dark:bg-gray-800 dark:border-gray-600">
                    {suggestions.map((suggestion, index) => (
                        <li
                            key={index}
                            onClick={() => handleSuggestionClick(suggestion)}
                            className="px-4 py-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 text-[#652D8E] dark:text-purple-300"
                        >
                            {suggestion}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export default LocationInput;
