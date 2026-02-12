'use client'

import { useSearchParams } from 'next/navigation'
import { useEffect } from 'react'
import type { KDSTheme } from '@/lib/kds/types'
import { KDS_THEMES } from '@/lib/kds/types'

const THEME_BACKGROUNDS: Record<KDSTheme, string> = {
  warm: '#8b6847',
  dark: '#121212',
  wps: '#F8F9FA',
}

interface KDSThemeWrapperProps {
  dbTheme?: KDSTheme
  children: React.ReactNode
}

export default function KDSThemeWrapper({ dbTheme = 'warm', children }: KDSThemeWrapperProps) {
  const searchParams = useSearchParams()

  // URL query param overrides database setting (for kiosk mode)
  const paramTheme = searchParams.get('theme') as KDSTheme | null
  const theme: KDSTheme = paramTheme && KDS_THEMES.includes(paramTheme) ? paramTheme : dbTheme

  // Set html/body background color to match theme (prevents white flash)
  useEffect(() => {
    const bg = THEME_BACKGROUNDS[theme]
    document.documentElement.style.backgroundColor = bg
    document.body.style.backgroundColor = bg

    return () => {
      document.documentElement.style.backgroundColor = ''
      document.body.style.backgroundColor = ''
    }
  }, [theme])

  return (
    <div className={`kds-root theme-${theme}`}>
      {children}
    </div>
  )
}
