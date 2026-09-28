import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown, X, Search } from 'lucide-react';
import { getNextTreatmentOptionIndex } from '../utils/treatmentSelectorKeyboard';

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  emptyMessage?: string;
  className?: string;
}

export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  value,
  onChange,
  options,
  placeholder = 'Select an option',
  emptyMessage = 'No options found',
  className = ''
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeOptionIndex, setActiveOptionIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const listboxId = React.useId();

  const selectedOption = options.find(opt => opt.value === value);

  const filteredOptions = options.filter(option =>
    option.label.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSelect = useCallback((optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
    setSearchTerm('');
    setActiveOptionIndex(-1);
  }, [onChange]);

  const handleClear = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    setSearchTerm('');
  }, [onChange]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchTerm('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    setActiveOptionIndex(-1);
    optionRefs.current = [];
  }, [searchTerm]);

  useEffect(() => {
    if (activeOptionIndex < 0) return;
    optionRefs.current[activeOptionIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeOptionIndex]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    event.stopPropagation();

    if (event.key === 'Escape') {
      setIsOpen(false);
      setSearchTerm('');
      setActiveOptionIndex(-1);
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setIsOpen(true);
      setActiveOptionIndex((currentIndex) => getNextTreatmentOptionIndex(
        currentIndex,
        filteredOptions.length,
        event.key === 'ArrowDown' ? 'down' : 'up'
      ));
      return;
    }

    if (event.key === 'Enter' && isOpen && activeOptionIndex >= 0) {
      event.preventDefault();
      handleSelect(filteredOptions[activeOptionIndex].value);
    }
  };

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <div
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="combobox"
        aria-controls={listboxId}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-activedescendant={activeOptionIndex >= 0 ? `${listboxId}-option-${activeOptionIndex}` : undefined}
        className="w-full border border-indigo-200 bg-white rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 cursor-pointer flex items-center justify-between gap-2 hover:border-indigo-300 transition-colors"
      >
        <div className="flex-1 min-w-0">
          {selectedOption ? (
            <span className="text-gray-900 truncate block">{selectedOption.label}</span>
          ) : (
            <span className="text-gray-400">{placeholder}</span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {value && (
            <button
              type="button"
              onClick={handleClear}
              className="p-0.5 hover:bg-gray-100 rounded transition-colors"
              title="Clear selection"
            >
              <X size={14} className="text-gray-400" />
            </button>
          )}
          <ChevronDown
            size={16}
            className={`text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          />
        </div>
      </div>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white rounded-xl shadow-lg border border-gray-200 max-h-60 overflow-hidden animate-fade-in">
          <div className="p-2 border-b border-gray-100 sticky top-0 bg-white">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 transform -translate-y-1/2 text-gray-400" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search..."
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={handleKeyDown}
                role="searchbox"
              />
            </div>
          </div>
          
          <div id={listboxId} role="listbox" className="max-h-48 overflow-y-auto">
            {filteredOptions.length === 0 ? (
              <div className="px-4 py-6 text-center text-gray-400 text-sm">
                {emptyMessage}
              </div>
            ) : (
              filteredOptions.map((option, index) => (
                <div
                  key={option.value}
                  id={`${listboxId}-option-${index}`}
                  ref={(element) => { optionRefs.current[index] = element; }}
                  role="option"
                  aria-selected={option.value === value}
                  onClick={() => handleSelect(option.value)}
                  onMouseEnter={() => setActiveOptionIndex(index)}
                  className={`px-4 py-2.5 text-sm cursor-pointer transition-colors hover:bg-indigo-50 ${
                    option.value === value || index === activeOptionIndex ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-gray-700'
                  }`}
                >
                  {option.label}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
