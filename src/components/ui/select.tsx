'use client'

import { SelectHTMLAttributes, forwardRef } from 'react'
import { cn } from '@/lib/utils'

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label?: string
  error?: string
  helper?: string
  variant?: 'default' | 'filled' | 'underlined'
  size?: 'sm' | 'md' | 'lg'
  success?: boolean
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({
    className,
    label,
    error,
    helper,
    id,
    variant = 'default',
    size = 'md',
    success = false,
    disabled,
    children,
    ...props
  }, ref) => {
    const selectId = id || `select-${Math.random().toString(36).substring(2)}`

    const baseClasses = cn(
      'w-full font-medium transition-base text-text-primary',
      'focus:outline-none focus:ring-2 focus:ring-offset-1',
      'disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-surface-tertiary',
      'appearance-none bg-no-repeat bg-right pr-10',
      'cursor-pointer'
    )

    const variants = {
      default: cn(
        'bg-surface-primary border border-border-primary',
        'hover:border-border-secondary focus:border-border-focus focus:ring-primary-500/20',
        'dark:bg-surface-primary dark:border-border-primary dark:hover:border-border-secondary'
      ),
      filled: cn(
        'bg-surface-secondary border border-transparent',
        'hover:bg-surface-tertiary focus:bg-surface-primary focus:border-border-focus focus:ring-primary-500/20',
        'dark:bg-surface-secondary dark:hover:bg-surface-tertiary dark:focus:bg-surface-primary'
      ),
      underlined: cn(
        'bg-transparent border-0 border-b-2 border-border-primary rounded-none',
        'hover:border-border-secondary focus:border-border-focus focus:ring-0',
        'dark:border-border-primary dark:hover:border-border-secondary'
      )
    }

    const sizes = {
      sm: 'h-8 px-3 text-sm rounded-md',
      md: 'h-10 px-4 text-sm rounded-lg',
      lg: 'h-12 px-5 text-base rounded-lg'
    }

    const stateClasses = cn(
      error && 'border-error-500 focus:border-error-500 focus:ring-error-500/20',
      success && 'border-success-500 focus:border-success-500 focus:ring-success-500/20'
    )

    return (
      <div className="space-y-2">
        {label && (
          <label
            htmlFor={selectId}
            className="text-sm font-medium text-text-primary"
          >
            {label}
          </label>
        )}
        <div className="relative">
          <select
            id={selectId}
            className={cn(
              baseClasses,
              variants[variant],
              sizes[size],
              stateClasses,
              className
            )}
            ref={ref}
            disabled={disabled}
            {...props}
          >
            {children}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
            <svg
              className="h-4 w-4 text-gray-400"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                clipRule="evenodd"
              />
            </svg>
          </div>
        </div>
        {error && (
          <p className="text-sm text-error-500 flex items-center gap-1">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            {error}
          </p>
        )}
        {success && !error && (
          <p className="text-sm text-success-500 flex items-center gap-1">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            Selection is valid
          </p>
        )}
        {helper && !error && !success && (
          <p className="text-sm text-text-secondary">{helper}</p>
        )}
      </div>
    )
  }
)

Select.displayName = 'Select'

export default Select
