'use client'

import { useState, useEffect, useRef } from 'react'
import { Input } from '@/components/ui/input'

interface MedicationAutocompleteProps {
  id?: string
  value: string
  onChange: (val: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function MedicationAutocomplete({
  id = 'name',
  value,
  onChange,
  placeholder = 'e.g. Ibuprofen, Paracetamol, Amoxicillin',
  disabled = false,
  className,
}: MedicationAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!value || value.trim().length < 2) {
      setSuggestions([])
      setIsOpen(false)
      return
    }

    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/medications/suggest?q=${encodeURIComponent(value.trim())}`)
        if (res.ok) {
          const data = await res.json()
          setSuggestions(data.suggestions || [])
          setIsOpen((data.suggestions || []).length > 0)
        }
      } catch (err) {
        console.error('Failed to load medication suggestions:', err)
      } finally {
        setLoading(false)
      }
    }, 250)

    return () => clearTimeout(timer)
  }, [value])

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function handleSelect(suggestion: string) {
    onChange(suggestion)
    setIsOpen(false)
    setSuggestions([])
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <Input
          id={id}
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            setIsOpen(true)
          }}
          onFocus={() => {
            if (suggestions.length > 0) setIsOpen(true)
          }}
          placeholder={placeholder}
          disabled={disabled}
          className={className}
          autoComplete="off"
        />
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {isOpen && suggestions.length > 0 && (
        <ul className="absolute z-50 left-0 right-0 mt-1 max-h-56 overflow-auto rounded-md border border-gray-200 bg-white py-1 text-sm shadow-lg ring-1 ring-black/5 focus:outline-none">
          <li className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-gray-400">
            Suggested medications
          </li>
          {suggestions.map((suggestion, index) => (
            <li
              key={index}
              onClick={() => handleSelect(suggestion)}
              className="cursor-pointer px-3 py-2 text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors flex items-center justify-between"
            >
              <span className="font-medium">{suggestion}</span>
              <span className="text-xs text-gray-400">Select</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
