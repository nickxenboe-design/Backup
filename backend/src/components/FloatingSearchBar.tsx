import React, { useEffect, useRef } from 'react';
import BusSearchBar from './BusSearchBar';
import { XIcon } from './icons';
import { SearchQuery } from '@/utils/api';

interface FloatingSearchBarProps {
    isOpen: boolean;
    onClose: () => void;
    onSearch: (query: SearchQuery) => void;
    loading: boolean;
    initialQuery: SearchQuery | null;
}

const FloatingSearchBar: React.FC<FloatingSearchBarProps> = ({ isOpen, onClose, onSearch, loading, initialQuery }) => {
    const modalRef = useRef<HTMLDivElement>(null);

    // Close on Escape key press
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };
        if (isOpen) {
            document.addEventListener('keydown', handleKeyDown);
        }
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen, onClose]);
    
    // Close on outside click
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
                onClose();
            }
        };
        if (isOpen) {
            // Use timeout to prevent modal from closing instantly on button click
            setTimeout(() => document.addEventListener('mousedown', handleClickOutside), 0);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div 
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-start justify-center pt-12 md:pt-20"
            role="dialog"
            aria-modal="true"
        >
            <div 
                ref={modalRef}
                className="relative container mx-auto px-4 md:px-6 animate-fade-in-down max-w-4xl"
            >
                <div className="relative">
                    <BusSearchBar onSearch={onSearch} loading={loading} initialQuery={initialQuery} />
                    <button 
                        onClick={onClose}
                        className="absolute -top-3 -right-3 bg-white text-gray-600 rounded-full p-2 shadow-lg hover:bg-gray-200 transition-colors focus:outline-none focus:ring-2 focus:ring-[#652D8E] dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                        aria-label="Close search editor"
                    >
                        <XIcon className="h-5 w-5" />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default FloatingSearchBar;