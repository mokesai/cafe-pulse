/**
 * KDS Photo Utilities
 * Scans photo directories and returns available photos for the menu display.
 */

import fs from 'fs'
import path from 'path'

const PHOTOS_BASE_DIR = path.join(process.cwd(), 'public/images/kds/photos')

// Photo categories
const DRINK_CATEGORIES = ['espressos', 'frappuccinos', 'refreshers']
const FOOD_CATEGORIES = ['pastries', 'croissants', 'muffins', 'sandwiches', 'burritos']
const ALL_CATEGORIES = [...DRINK_CATEGORIES, ...FOOD_CATEGORIES]

// Supported image extensions
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp']

/**
 * Scan a category directory for photos
 */
function scanCategory(category: string): string[] {
  const categoryDir = path.join(PHOTOS_BASE_DIR, category)

  if (!fs.existsSync(categoryDir)) {
    return []
  }

  try {
    const files = fs.readdirSync(categoryDir)
    return files
      .filter(file => {
        const ext = path.extname(file).toLowerCase()
        return IMAGE_EXTENSIONS.includes(ext)
      })
      .map(file => `${category}/${file}`)
  } catch {
    return []
  }
}

/**
 * Scan root directory for photos (not in subdirectories)
 */
function scanRootPhotos(): string[] {
  if (!fs.existsSync(PHOTOS_BASE_DIR)) {
    return []
  }

  try {
    const files = fs.readdirSync(PHOTOS_BASE_DIR)
    return files
      .filter(file => {
        const ext = path.extname(file).toLowerCase()
        const fullPath = path.join(PHOTOS_BASE_DIR, file)
        // Only include files (not directories) with valid image extensions
        return IMAGE_EXTENSIONS.includes(ext) && fs.statSync(fullPath).isFile()
      })
  } catch {
    return []
  }
}

/**
 * Get all available photos from all categories plus root directory
 */
export function getAllPhotos(): string[] {
  const photos: string[] = []

  // Include root-level photos
  photos.push(...scanRootPhotos())

  // Include category photos
  for (const category of ALL_CATEGORIES) {
    photos.push(...scanCategory(category))
  }

  // Shuffle for variety
  return shuffleArray(photos)
}

/**
 * Get photos from drink categories only
 */
export function getDrinkPhotos(): string[] {
  const photos: string[] = []

  for (const category of DRINK_CATEGORIES) {
    photos.push(...scanCategory(category))
  }

  return shuffleArray(photos)
}

/**
 * Get photos from food categories only
 */
export function getFoodPhotos(): string[] {
  const photos: string[] = []

  for (const category of FOOD_CATEGORIES) {
    photos.push(...scanCategory(category))
  }

  return shuffleArray(photos)
}

/**
 * Get photos from specific categories
 */
export function getPhotosByCategories(categories: string[]): string[] {
  const photos: string[] = []

  for (const category of categories) {
    photos.push(...scanCategory(category))
  }

  return shuffleArray(photos)
}

/**
 * Shuffle array using Fisher-Yates algorithm
 */
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

/**
 * Get available categories that have at least one photo
 */
export function getAvailableCategories(): string[] {
  return ALL_CATEGORIES.filter(category => scanCategory(category).length > 0)
}
