import React from 'react';
import { ResetIcon, DollarCircleIcon, SunriseIcon, FastForwardIcon, SunIcon, MoonIcon, CheckIcon, WifiIcon, PowerIcon, RestroomIcon, ArmchairIcon } from './icons';

interface FilterSidebarProps {
  sort: string;
  onSortChange: (sort: string) => void;
  timeFilters: string[];
  onTimeFilterChange: (filters: string[]) => void;
  operatorFilters: string[];
  onOperatorFilterChange: (filters: string[]) => void;
  amenityFilters: string[];
  onAmenityFilterChange: (filters: string[]) => void;
  availableOperators: string[];
  availableAmenities: string[];
}

const iconProps = { className: "h-6 w-6" };

const sortOptions = [
    { value: 'earliest', label: 'Earliest Departure', icon: <SunriseIcon {...iconProps} /> },
    { value: 'cheapest', label: 'Cheapest Price', icon: <DollarCircleIcon {...iconProps} /> },
    { value: 'fastest', label: 'Fastest Trip', icon: <FastForwardIcon {...iconProps} /> },
];

const timeOptions = [
    { value: 'morning', label: 'Morning (before 12pm)', icon: <SunIcon {...iconProps} /> },
    { value: 'afternoon', label: 'Afternoon (12pm - 6pm)', icon: <SunIcon {...iconProps} style={{ transform: 'scale(1.1)'}} /> },
    { value: 'evening', label: 'Evening (after 6pm)', icon: <MoonIcon {...iconProps} /> },
];

const getAmenityIcon = (amenity: string) => {
    const amenityIconProps = { className: "h-6 w-6" };
    switch (amenity.toLowerCase()) {
        case 'wi-fi': return <WifiIcon {...amenityIconProps} />;
        case 'charging port': return <PowerIcon {...amenityIconProps} />;
        case 'toilet': return <RestroomIcon {...amenityIconProps} />;
        case 'reclining seat': return <ArmchairIcon {...amenityIconProps} />;
        default: return null;
    }
};

const FilterSection: React.FC<{ title: string, children: React.ReactNode }> = ({ title, children }) => (
    <div className="border-b border-gray-200 dark:border-gray-700 py-4 last:border-b-0">
        <h3 className="font-bold text-lg text-[#652D8E] dark:text-purple-300 mb-3">{title}</h3>
        {children}
    </div>
);

// FIX: Changed component to React.FC to correctly handle the 'key' prop in lists.
const FilterCard: React.FC<{ isSelected: boolean, onClick: () => void, children: React.ReactNode }> = ({ isSelected, onClick, children }) => {
    const baseClasses = "p-2 w-full rounded-lg border-2 cursor-pointer transition-all duration-200 flex items-center justify-center text-center relative focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-gray-800 focus:ring-[#652D8E]";
    const selectedClasses = "bg-[#652D8E] dark:bg-purple-600 text-white border-[#652D8E] dark:border-purple-600 shadow-lg shadow-[#652D8E]/20";
    const unselectedClasses = "bg-white dark:bg-gray-700/50 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-600 hover:border-[#652D8E]/60 dark:hover:border-purple-400/60 hover:bg-[#652D8E]/5 dark:hover:bg-purple-900/20";

    return (
        <button type="button" onClick={onClick} className={`${baseClasses} ${isSelected ? selectedClasses : unselectedClasses}`}>
            {children}
        </button>
    );
};


const FilterSidebar: React.FC<FilterSidebarProps> = ({
  sort,
  onSortChange,
  timeFilters,
  onTimeFilterChange,
  operatorFilters,
  onOperatorFilterChange,
  amenityFilters,
  onAmenityFilterChange,
  availableOperators,
  availableAmenities,
}) => {

    const handleMultiSelectChange = (
        currentFilters: string[],
        setter: (newFilters: string[]) => void,
        value: string
    ) => {
        const newFilters = currentFilters.includes(value)
            ? currentFilters.filter(item => item !== value)
            : [...currentFilters, value];
        setter(newFilters);
    };

    const resetFilters = () => {
        onSortChange('earliest');
        onTimeFilterChange([]);
        onOperatorFilterChange([]);
        onAmenityFilterChange([]);
    }

    const anyFiltersApplied = timeFilters.length > 0 || operatorFilters.length > 0 || amenityFilters.length > 0 || sort !== 'earliest';

    return (
        <aside className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-md border border-gray-200 dark:border-gray-700 sticky top-28">
            <div className="flex justify-between items-center mb-2">
                <h2 className="text-2xl font-bold text-[#652D8E] dark:text-purple-300">Filters</h2>
                 {anyFiltersApplied && (
                    <button onClick={resetFilters} className="flex items-center gap-1 text-sm font-semibold text-[#652D8E] dark:text-purple-300 hover:opacity-75 transition-opacity">
                        <ResetIcon className="h-4 w-4"/>
                        Reset
                    </button>
                 )}
            </div>
            
            <FilterSection title="Sort By">
                <div className="space-y-2">
                    {sortOptions.map(option => (
                        <FilterCard
                            key={option.value}
                            isSelected={sort === option.value}
                            onClick={() => onSortChange(option.value)}
                        >
                            <div className="flex items-center gap-3 w-full px-2">
                                {option.icon}
                                <span className="font-semibold text-sm">{option.label}</span>
                            </div>
                        </FilterCard>
                    ))}
                </div>
            </FilterSection>

            <FilterSection title="Departure Time">
                <div className="space-y-2">
                    {timeOptions.map(option => (
                        <FilterCard
                            key={option.value}
                            isSelected={timeFilters.includes(option.value)}
                            onClick={() => handleMultiSelectChange(timeFilters, onTimeFilterChange, option.value)}
                        >
                            <div className="flex items-center gap-3 w-full px-2">
                                {option.icon}
                                <div className="text-left">
                                    <span className="font-semibold text-sm">{option.label.split(' (')[0]}</span>
                                    <span className="text-xs opacity-80 block">{`(${option.label.split(' (')[1]}`}</span>
                                </div>
                            </div>
                             {timeFilters.includes(option.value) && <CheckIcon className="h-4 w-4 absolute top-2 right-2"/>}
                        </FilterCard>
                    ))}
                </div>
            </FilterSection>

            {availableOperators.length > 0 && (
                <FilterSection title="Bus Companies">
                    <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
                        {availableOperators.map(operator => (
                            <FilterCard
                                key={operator}
                                isSelected={operatorFilters.includes(operator)}
                                onClick={() => handleMultiSelectChange(operatorFilters, onOperatorFilterChange, operator)}
                            >
                                <div className="flex items-center justify-between w-full px-2">
                                    <span className="font-semibold text-sm">{operator}</span>
                                    {operatorFilters.includes(operator) && <CheckIcon className="h-4 w-4" />}
                                </div>
                            </FilterCard>
                        ))}
                    </div>
                </FilterSection>
            )}

            {availableAmenities.length > 0 && (
                <FilterSection title="Amenities">
                    <div className="grid grid-cols-3 gap-2">
                        {availableAmenities.map(amenity => (
                             <FilterCard
                                key={amenity}
                                isSelected={amenityFilters.includes(amenity)}
                                onClick={() => handleMultiSelectChange(amenityFilters, onAmenityFilterChange, amenity)}
                            >
                                <div className="flex flex-col items-center gap-1 py-1">
                                    {getAmenityIcon(amenity)}
                                    <span className="font-semibold text-xs capitalize">{amenity}</span>
                                </div>
                                {amenityFilters.includes(amenity) && <CheckIcon className="h-3 w-3 absolute top-1.5 right-1.5"/>}
                            </FilterCard>
                        ))}
                    </div>
                </FilterSection>
            )}
        </aside>
    );
};

export default FilterSidebar;
