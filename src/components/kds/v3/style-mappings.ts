/**
 * MOK-158 / KDS v3 phase 6 — shared style mappings for per-layout components.
 *
 * Plan: .planning/kds-v3/PHASE-6-PLAN.md (T6-T9 prerequisite)
 *
 * Maps the operator-facing enums (density / title_size / title_align) to
 * Tailwind utility classes. Single source of truth so the four layout
 * renderers agree on what 'compact' / 'normal' / 'loose' actually look like.
 *
 * Color values come from `kds-themes.css` CSS variables (--kds-text, etc.)
 * — kept in CSS rather than here so the theme-warm / theme-dark / theme-wps
 * classes on a parent can re-tint without component-level branching.
 */
import type { Density, TitleSize, TitleAlign } from '@/lib/kds/v3-render'

/** Vertical padding between item rows. Drives perceived density. */
export const DENSITY_TO_ROW_PADDING: Record<Density, string> = {
  compact: 'py-0.5',
  normal: 'py-1.5',
  loose: 'py-3',
}

/** Title font-size class. Sized for TV viewing at ~3m. */
export const TITLE_SIZE_CLASS: Record<TitleSize, string> = {
  small: 'text-xl',
  medium: 'text-2xl',
  large: 'text-4xl',
}

/** Body font-size class. Co-scales loosely with title to keep proportions. */
export const BODY_SIZE_FOR_TITLE: Record<TitleSize, string> = {
  small: 'text-base',
  medium: 'text-xl',
  large: 'text-2xl',
}

export const TITLE_ALIGN_CLASS: Record<TitleAlign, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
}
