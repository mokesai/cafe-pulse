#!/usr/bin/env node

/**
 * Import KDS menu data from Google Sheets (published CSV) or local CSV files.
 *
 * This script imports menu items, categories, images, and settings into the
 * Supabase KDS tables for the Kitchen Display System.
 *
 * Usage:
 *   # Import from environment variable URLs
 *   npm run import-kds-menu
 *
 *   # Import from local CSV files
 *   npm run import-kds-menu -- --local
 *
 *   # Import specific tables only
 *   npm run import-kds-menu -- --categories --menu
 *
 * Environment Variables (for Google Sheets):
 *   KDS_MENU_CSV_URL       - Published CSV URL for menu items
 *   KDS_CATEGORIES_CSV_URL - Published CSV URL for categories
 *   KDS_IMAGES_CSV_URL     - Published CSV URL for images
 *   KDS_SETTINGS_CSV_URL   - Published CSV URL for settings
 *
 * Local Files (with --local flag):
 *   data/kds-menu-export.csv
 *   data/kds-categories-export.csv
 *   data/kds-images-template.csv
 *   data/kds-settings-template.csv
 */

require('dotenv').config({ path: '.env.local' })

const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')

// Local file paths
const LOCAL_MENU_FILE = path.join('data', 'kds-menu-export.csv')
const LOCAL_CATEGORIES_FILE = path.join('data', 'kds-categories-export.csv')
const LOCAL_IMAGES_FILE = path.join('data', 'kds-images-template.csv')
const LOCAL_SETTINGS_FILE = path.join('data', 'kds-settings-template.csv')

function parseArgs() {
  const args = process.argv.slice(2)
  const options = {
    useLocal: false,
    importMenu: false,
    importCategories: false,
    importImages: false,
    importSettings: false,
    clearFirst: false,
  }

  let anySpecific = false

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--local' || arg === '-l') {
      options.useLocal = true
    } else if (arg === '--menu' || arg === '-m') {
      options.importMenu = true
      anySpecific = true
    } else if (arg === '--categories' || arg === '-c') {
      options.importCategories = true
      anySpecific = true
    } else if (arg === '--images' || arg === '-i') {
      options.importImages = true
      anySpecific = true
    } else if (arg === '--settings' || arg === '-s') {
      options.importSettings = true
      anySpecific = true
    } else if (arg === '--clear') {
      options.clearFirst = true
    } else if (arg === '--help' || arg === '-h') {
      console.log(`KDS Menu Import from Google Sheets

Usage:
  npm run import-kds-menu [OPTIONS]

Options:
  --local, -l       Import from local CSV files instead of URLs
  --menu, -m        Import menu items only
  --categories, -c  Import categories only
  --images, -i      Import images only
  --settings, -s    Import settings only
  --clear           Clear existing data before import
  --help            Show this help message

If no specific table flags are provided, all tables are imported.

Environment Variables (for remote import):
  KDS_MENU_CSV_URL       Published CSV URL for menu items
  KDS_CATEGORIES_CSV_URL Published CSV URL for categories
  KDS_IMAGES_CSV_URL     Published CSV URL for images
  KDS_SETTINGS_CSV_URL   Published CSV URL for settings

Local Files (with --local):
  ${LOCAL_MENU_FILE}
  ${LOCAL_CATEGORIES_FILE}
  ${LOCAL_IMAGES_FILE}
  ${LOCAL_SETTINGS_FILE}
`)
      process.exit(0)
    }
  }

  // If no specific tables requested, import all
  if (!anySpecific) {
    options.importMenu = true
    options.importCategories = true
    options.importImages = true
    options.importSettings = true
  }

  return options
}

function parseCSV(csvText) {
  const lines = csvText.trim().split('\n')
  if (lines.length < 2) return []

  const headers = parseCSVLine(lines[0])
  const rows = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()

    // Skip empty lines and comment lines (starting with #)
    if (!line || line.startsWith('#')) {
      continue
    }

    const values = parseCSVLine(line)
    if (values.length !== headers.length) {
      console.warn(`⚠️  Row ${i + 1} has ${values.length} columns, expected ${headers.length}`)
      continue
    }

    const row = {}
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j]
    }
    rows.push(row)
  }

  return rows
}

function parseCSVLine(line) {
  const values = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    const nextChar = line[i + 1]

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        current += '"'
        i++ // Skip next quote
      } else if (char === '"') {
        inQuotes = false
      } else {
        current += char
      }
    } else {
      if (char === '"') {
        inQuotes = true
      } else if (char === ',') {
        values.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
  }
  values.push(current.trim())

  return values
}

async function fetchCSV(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`)
  }
  return response.text()
}

function readLocalCSV(filepath) {
  if (!fs.existsSync(filepath)) {
    throw new Error(`File not found: ${filepath}`)
  }
  return fs.readFileSync(filepath, 'utf8')
}

async function getCSVData(envVar, localPath, useLocal) {
  if (useLocal) {
    console.log(`📂 Reading from ${localPath}`)
    return readLocalCSV(localPath)
  }

  const url = process.env[envVar]
  if (!url) {
    throw new Error(`Missing environment variable: ${envVar}`)
  }

  console.log(`🌐 Fetching from ${envVar}`)
  return fetchCSV(url)
}

// Data transformation functions

function transformCategory(row) {
  // Parse boolean for show_size_header (default to true if not specified)
  let showSizeHeader = true
  if (row.show_size_header !== undefined && row.show_size_header !== '') {
    showSizeHeader = row.show_size_header === 'true' || row.show_size_header === 'TRUE' || row.show_size_header === '1' || row.show_size_header === true
  }

  return {
    slug: row.slug,
    name: row.name,
    screen: row.screen,
    position: row.position || null,
    sort_order: parseInt(row.sort_order, 10) || 0,
    color: row.color || null,
    icon: row.icon || null,
    display_type: row.display_type || null,
    show_size_header: showSizeHeader,
    header_text: row.header_text || null,
    size_labels: row.size_labels || null,
  }
}

function transformMenuItem(row, categoryMap) {
  const categorySlug = row.kds_category || 'uncategorized'
  const categoryId = categoryMap.get(categorySlug)

  if (!categoryId && categorySlug !== 'uncategorized') {
    console.warn(`⚠️  Unknown category "${categorySlug}" for item "${row.name}"`)
  }

  // Parse price - handle both "5.95" and "595" formats
  let priceCents = 0
  if (row.price_cents) {
    priceCents = parseInt(row.price_cents, 10)
  } else if (row.price) {
    const priceFloat = parseFloat(row.price)
    priceCents = Math.round(priceFloat * 100)
  }

  // Parse booleans
  const isVisible = row.is_visible === 'true' || row.is_visible === 'TRUE' || row.is_visible === '1' || row.is_visible === true
  const featured = row.featured === 'true' || row.featured === 'TRUE' || row.featured === '1' || row.featured === true

  return {
    square_item_id: row.square_item_id || null,
    square_variation_id: row.square_variation_id || null,
    name: row.name,
    display_name: row.display_name || null,
    variation_name: row.variation_name || null,
    price_cents: priceCents,
    display_price: row.display_price || `$${(priceCents / 100).toFixed(2)}`,
    category_id: categoryId || null,
    sort_order: parseInt(row.sort_order, 10) || 0,
    is_visible: isVisible,
    display_type: row.display_type || null,
    featured: featured,
    bullet_color: row.bullet_color || null,
    parent_item: row.parent_item || null,
  }
}

function transformImage(row) {
  const isActive = row.is_active === 'true' || row.is_active === 'TRUE' || row.is_active === '1' || row.is_active === true

  return {
    screen: row.screen,
    filename: row.filename,
    alt_text: row.alt_text || null,
    sort_order: parseInt(row.sort_order, 10) || 0,
    is_active: isActive,
  }
}

function transformSetting(row) {
  // Try to parse value as JSON, fallback to string
  let value = row.value
  try {
    // Check if it's a number
    if (!isNaN(value) && value.trim() !== '') {
      value = parseInt(value, 10)
    }
  } catch {
    // Keep as string
  }

  return {
    key: row.key,
    value: value,
  }
}

// Database operations

async function clearTable(supabase, tableName) {
  console.log(`🗑️  Clearing ${tableName}...`)
  const { error } = await supabase
    .from(tableName)
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000')

  if (error) {
    console.error(`Failed to clear ${tableName}:`, error)
    return false
  }
  return true
}

async function importCategories(supabase, rows, clearFirst) {
  console.log(`\n📁 Importing ${rows.length} categories...`)

  if (clearFirst) {
    await clearTable(supabase, 'kds_menu_items') // Clear items first (FK constraint)
    await clearTable(supabase, 'kds_categories')
  }

  const categories = rows.map(transformCategory)
  let successCount = 0

  for (const category of categories) {
    const { error } = await supabase
      .from('kds_categories')
      .upsert(category, { onConflict: 'slug' })

    if (error) {
      console.error(`❌ Failed to upsert category "${category.slug}":`, error.message)
    } else {
      successCount++
    }
  }

  console.log(`✅ Imported ${successCount}/${categories.length} categories`)
  return successCount
}

async function importMenuItems(supabase, rows, clearFirst) {
  console.log(`\n🍽️  Importing ${rows.length} menu items...`)

  // Build category slug -> id map
  const { data: categories, error: catError } = await supabase
    .from('kds_categories')
    .select('id, slug')

  if (catError) {
    console.error('❌ Failed to fetch categories:', catError.message)
    return 0
  }

  const categoryMap = new Map()
  for (const cat of categories || []) {
    categoryMap.set(cat.slug, cat.id)
  }

  if (clearFirst) {
    await clearTable(supabase, 'kds_menu_items')
  }

  // Filter out uncategorized items (they won't display anyway)
  const validRows = rows.filter(row => {
    const slug = row.kds_category || 'uncategorized'
    if (slug === 'uncategorized' || !categoryMap.has(slug)) {
      return false
    }
    return true
  })

  if (validRows.length < rows.length) {
    console.log(`⚠️  Skipping ${rows.length - validRows.length} items with unknown/uncategorized categories`)
  }

  const menuItems = validRows.map(row => transformMenuItem(row, categoryMap))
  let successCount = 0

  if (clearFirst) {
    // Simple batch insert when clearing first (no conflicts possible)
    const batchSize = 50
    for (let i = 0; i < menuItems.length; i += batchSize) {
      const batch = menuItems.slice(i, i + batchSize)

      const { error } = await supabase
        .from('kds_menu_items')
        .insert(batch)

      if (error) {
        console.error(`❌ Batch insert failed:`, error.message)
        // Try individual inserts for this batch
        for (const item of batch) {
          const { error: itemError } = await supabase
            .from('kds_menu_items')
            .insert(item)

          if (!itemError) {
            successCount++
          } else {
            console.error(`❌ Failed to insert "${item.name}":`, itemError.message)
          }
        }
      } else {
        successCount += batch.length
      }
    }
  } else {
    // Manual upsert: check if exists by square_variation_id, then insert or update
    for (const item of menuItems) {
      if (item.square_variation_id) {
        // Check if exists
        const { data: existing } = await supabase
          .from('kds_menu_items')
          .select('id')
          .eq('square_variation_id', item.square_variation_id)
          .maybeSingle()

        if (existing) {
          // Update existing
          const { error } = await supabase
            .from('kds_menu_items')
            .update(item)
            .eq('id', existing.id)

          if (!error) {
            successCount++
          } else {
            console.error(`❌ Failed to update "${item.name}":`, error.message)
          }
        } else {
          // Insert new
          const { error } = await supabase
            .from('kds_menu_items')
            .insert(item)

          if (!error) {
            successCount++
          } else {
            console.error(`❌ Failed to insert "${item.name}":`, error.message)
          }
        }
      } else {
        // No square_variation_id, just insert
        const { error } = await supabase
          .from('kds_menu_items')
          .insert(item)

        if (!error) {
          successCount++
        } else {
          console.error(`❌ Failed to insert "${item.name}":`, error.message)
        }
      }
    }
  }

  console.log(`✅ Imported ${successCount}/${menuItems.length} menu items`)
  return successCount
}

async function importImages(supabase, rows, clearFirst) {
  console.log(`\n🖼️  Importing ${rows.length} images...`)

  if (clearFirst) {
    await clearTable(supabase, 'kds_images')
  }

  const images = rows.map(transformImage)
  let successCount = 0

  for (const image of images) {
    const { error } = await supabase
      .from('kds_images')
      .upsert(image, { onConflict: 'filename' })

    if (error) {
      console.error(`❌ Failed to upsert image "${image.filename}":`, error.message)
    } else {
      successCount++
    }
  }

  console.log(`✅ Imported ${successCount}/${images.length} images`)
  return successCount
}

async function importSettings(supabase, rows, clearFirst) {
  console.log(`\n⚙️  Importing ${rows.length} settings...`)

  // Don't clear settings, just upsert

  const settings = rows.map(transformSetting)
  let successCount = 0

  for (const setting of settings) {
    const { error } = await supabase
      .from('kds_settings')
      .upsert(setting, { onConflict: 'key' })

    if (error) {
      console.error(`❌ Failed to upsert setting "${setting.key}":`, error.message)
    } else {
      successCount++
    }
  }

  console.log(`✅ Imported ${successCount}/${settings.length} settings`)
  return successCount
}

async function main() {
  const options = parseArgs()

  // Validate environment
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SECRET_KEY

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing Supabase credentials (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY)')
    process.exit(1)
  }

  const supabase = createClient(supabaseUrl, supabaseKey)

  console.log('🚀 KDS Menu Import')
  console.log(`   Mode: ${options.useLocal ? 'Local files' : 'Google Sheets URLs'}`)
  console.log(`   Clear first: ${options.clearFirst}`)
  console.log('')

  const results = {
    categories: 0,
    menuItems: 0,
    images: 0,
    settings: 0,
  }

  try {
    // Import categories first (other tables depend on it)
    if (options.importCategories) {
      const csvText = await getCSVData('KDS_CATEGORIES_CSV_URL', LOCAL_CATEGORIES_FILE, options.useLocal)
      const rows = parseCSV(csvText)
      results.categories = await importCategories(supabase, rows, options.clearFirst)
    }

    // Import menu items
    if (options.importMenu) {
      const csvText = await getCSVData('KDS_MENU_CSV_URL', LOCAL_MENU_FILE, options.useLocal)
      const rows = parseCSV(csvText)
      results.menuItems = await importMenuItems(supabase, rows, options.clearFirst)
    }

    // Import images
    if (options.importImages) {
      const csvText = await getCSVData('KDS_IMAGES_CSV_URL', LOCAL_IMAGES_FILE, options.useLocal)
      const rows = parseCSV(csvText)
      results.images = await importImages(supabase, rows, options.clearFirst)
    }

    // Import settings
    if (options.importSettings) {
      const csvText = await getCSVData('KDS_SETTINGS_CSV_URL', LOCAL_SETTINGS_FILE, options.useLocal)
      const rows = parseCSV(csvText)
      results.settings = await importSettings(supabase, rows, options.clearFirst)
    }

    // Summary
    console.log('\n📊 Import Summary:')
    if (options.importCategories) console.log(`   Categories: ${results.categories}`)
    if (options.importMenu) console.log(`   Menu Items: ${results.menuItems}`)
    if (options.importImages) console.log(`   Images: ${results.images}`)
    if (options.importSettings) console.log(`   Settings: ${results.settings}`)

    console.log('\n✨ Import complete!')

  } catch (error) {
    console.error('\n❌ Import failed:', error.message)
    process.exit(1)
  }
}

main()
