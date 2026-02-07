#!/usr/bin/env node

/**
 * Export Square catalog to CSV for KDS (Kitchen Display System) Google Sheets.
 *
 * This script fetches all menu items from Square and outputs them in a format
 * ready for import into Google Sheets for KDS configuration.
 *
 * Usage:
 *   node scripts/export-kds-menu-to-sheets.js
 *   node scripts/export-kds-menu-to-sheets.js --out data/kds-menu-export.csv
 *
 * Options:
 *   --out <file>     Output path (default: data/kds-menu-export.csv)
 *   --categories     Also export categories CSV (data/kds-categories-export.csv)
 *   --images         Also export images template CSV (data/kds-images-template.csv)
 *   --all            Export all CSVs (menu, categories, images, settings)
 */

require('dotenv').config({ path: '.env.local' })

const fs = require('fs')
const path = require('path')
const { Client } = require('square/legacy')

const DEFAULT_MENU_OUTPUT = path.join('data', 'kds-menu-export.csv')
const DEFAULT_CATEGORIES_OUTPUT = path.join('data', 'kds-categories-export.csv')
const DEFAULT_IMAGES_OUTPUT = path.join('data', 'kds-images-template.csv')
const DEFAULT_SETTINGS_OUTPUT = path.join('data', 'kds-settings-template.csv')

function parseArgs() {
  const args = process.argv.slice(2)
  const options = {
    out: DEFAULT_MENU_OUTPUT,
    exportCategories: false,
    exportImages: false,
    exportSettings: false,
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--out' && args[i + 1]) {
      options.out = args[i + 1]
      i += 1
    } else if (arg === '--categories') {
      options.exportCategories = true
    } else if (arg === '--images') {
      options.exportImages = true
    } else if (arg === '--settings') {
      options.exportSettings = true
    } else if (arg === '--all') {
      options.exportCategories = true
      options.exportImages = true
      options.exportSettings = true
    } else if (arg === '--help' || arg === '-h') {
      console.log(`KDS Menu Export for Google Sheets

Usage:
  node scripts/export-kds-menu-to-sheets.js [OPTIONS]

Options:
  --out FILE        Output CSV file for menu items (default: ${DEFAULT_MENU_OUTPUT})
  --categories      Also export categories template CSV
  --images          Also export images template CSV
  --settings        Also export settings template CSV
  --all             Export all templates (menu, categories, images, settings)
  --help            Show this help message

Output Files:
  Menu items:    ${DEFAULT_MENU_OUTPUT}
  Categories:    ${DEFAULT_CATEGORIES_OUTPUT}
  Images:        ${DEFAULT_IMAGES_OUTPUT}
  Settings:      ${DEFAULT_SETTINGS_OUTPUT}

After export:
  1. Import CSVs into Google Sheets
  2. Edit display_name, kds_category, sort_order, is_visible columns
  3. Run 'npm run import-kds-menu' to import into database
`)
      process.exit(0)
    }
  }

  return options
}

function ensureOutputDir(filepath) {
  const dir = path.dirname(filepath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function escapeCSV(value) {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function toCSVRow(values) {
  return values.map(escapeCSV).join(',')
}

async function fetchCatalog() {
  const client = new Client({
    bearerAuthCredentials: {
      accessToken: process.env.SQUARE_ACCESS_TOKEN
    },
    environment: (process.env.SQUARE_ENVIRONMENT || 'sandbox').toLowerCase()
  })

  const items = []
  let cursor
  do {
    const response = await client.catalogApi.listCatalog(cursor, 'ITEM,CATEGORY')

    if (response?.result?.objects) {
      items.push(...response.result.objects)
    }

    cursor = response?.result?.cursor
  } while (cursor)

  // Filter out deleted items
  return items.filter(item => !item.isDeleted)
}

function extractMenuData(catalogObjects) {
  // Build category map
  const categories = new Map()
  for (const obj of catalogObjects) {
    if (obj.type === 'CATEGORY' && obj.categoryData) {
      categories.set(obj.id, {
        id: obj.id,
        name: obj.categoryData.name || 'Uncategorized',
        ordinal: obj.categoryData.ordinal || 0
      })
    }
  }

  // Extract menu items with variations
  const menuItems = []
  for (const obj of catalogObjects) {
    if (obj.type !== 'ITEM' || !obj.itemData) continue

    const itemData = obj.itemData

    // Skip archived items
    if (itemData.isArchived) continue
    const categoryId = itemData.categoryId
    const category = categories.get(categoryId)
    const categoryName = category?.name || 'Uncategorized'

    // Each variation becomes a row
    for (const variation of itemData.variations || []) {
      if (!variation.itemVariationData) continue

      const variationData = variation.itemVariationData
      const priceCents = variationData.priceMoney?.amount
        ? Number(variationData.priceMoney.amount)
        : 0
      const priceFormatted = (priceCents / 100).toFixed(2)

      // Determine display name - use variation name if different from "Regular"
      const variationName = variationData.name || ''
      const isDefaultVariation = variationName.toLowerCase() === 'regular' || variationName === ''
      const displayName = isDefaultVariation ? itemData.name : `${itemData.name} (${variationName})`

      menuItems.push({
        square_item_id: obj.id,
        square_variation_id: variation.id,
        name: itemData.name,
        variation_name: variationName,
        display_name: displayName,
        description: itemData.description || '',
        price: priceFormatted,
        price_cents: priceCents,
        display_price: `$${priceFormatted}`,
        square_category: categoryName,
        square_category_id: categoryId || '',
        // KDS fields for user to fill in
        kds_category: suggestKDSCategory(categoryName),
        sort_order: 0,
        is_visible: true,
      })
    }
  }

  // Sort by category, then by name
  menuItems.sort((a, b) => {
    if (a.square_category !== b.square_category) {
      return a.square_category.localeCompare(b.square_category)
    }
    return a.name.localeCompare(b.name)
  })

  return { menuItems, categories: Array.from(categories.values()) }
}

/**
 * Suggest a KDS category slug based on Square category name
 */
function suggestKDSCategory(categoryName) {
  const name = categoryName.toLowerCase()

  // Drinks screen categories
  if (name.includes('hot') && (name.includes('drink') || name.includes('beverage'))) {
    return 'hot-drinks'
  }
  if (name.includes('espresso') || name.includes('latte') || name.includes('cappuccino')) {
    return 'espressos'
  }
  if (name.includes('cold') || name.includes('iced')) {
    return 'cold-drinks'
  }
  if (name.includes('frappuccino') || name.includes('frappe') || name.includes('blended')) {
    return 'blended'
  }
  if (name.includes('smoothie')) {
    return 'blended'
  }
  if (name.includes('refresher')) {
    return 'blended'
  }
  if (name.includes('coffee') || name.includes('tea')) {
    return 'hot-drinks'
  }

  // Food screen categories
  if (name.includes('breakfast') || name.includes('burrito') || name.includes('egg')) {
    return 'breakfast'
  }
  if (name.includes('pastry') || name.includes('pastries') || name.includes('croissant') || name.includes('danish') || name.includes('muffin')) {
    return 'pastries'
  }
  if (name.includes('sandwich') || name.includes('lunch') || name.includes('wrap')) {
    return 'sandwiches'
  }
  if (name.includes('snack') || name.includes('chip') || name.includes('fruit')) {
    return 'snacks'
  }
  if (name.includes('bakery') || name.includes('baked')) {
    return 'pastries'
  }
  if (name.includes('food')) {
    return 'snacks'
  }

  // Default based on common patterns
  return 'uncategorized'
}

function generateMenuCSV(menuItems) {
  const headers = [
    'square_item_id',
    'square_variation_id',
    'name',
    'variation_name',
    'display_name',
    'description',
    'price',
    'price_cents',
    'display_price',
    'square_category',
    'kds_category',
    'sort_order',
    'is_visible'
  ]

  const rows = [toCSVRow(headers)]
  for (const item of menuItems) {
    rows.push(toCSVRow([
      item.square_item_id,
      item.square_variation_id,
      item.name,
      item.variation_name,
      item.display_name,
      item.description,
      item.price,
      item.price_cents,
      item.display_price,
      item.square_category,
      item.kds_category,
      item.sort_order,
      item.is_visible
    ]))
  }

  return rows.join('\n')
}

function generateCategoriesCSV() {
  const headers = ['slug', 'name', 'screen', 'position', 'sort_order', 'color']

  // Default KDS categories template
  const categories = [
    // Drinks screen
    { slug: 'hot-drinks', name: 'Hot Drinks', screen: 'drinks', position: 'top-left', sort_order: 1, color: '' },
    { slug: 'espressos', name: 'Espressos', screen: 'drinks', position: 'top-right', sort_order: 2, color: '' },
    { slug: 'cold-drinks', name: 'Cold Drinks', screen: 'drinks', position: 'bottom-left', sort_order: 3, color: '' },
    { slug: 'blended', name: 'Blended', screen: 'drinks', position: 'bottom-right', sort_order: 4, color: '' },
    // Food screen
    { slug: 'breakfast', name: 'Breakfast', screen: 'food', position: 'top-left', sort_order: 1, color: '' },
    { slug: 'pastries', name: 'Pastries', screen: 'food', position: 'top-right', sort_order: 2, color: '' },
    { slug: 'sandwiches', name: 'Sandwiches', screen: 'food', position: 'bottom-left', sort_order: 3, color: '' },
    { slug: 'snacks', name: 'Snacks', screen: 'food', position: 'bottom-right', sort_order: 4, color: '' },
  ]

  const rows = [toCSVRow(headers)]
  for (const cat of categories) {
    rows.push(toCSVRow([cat.slug, cat.name, cat.screen, cat.position, cat.sort_order, cat.color]))
  }

  return rows.join('\n')
}

function generateImagesCSV() {
  const headers = ['screen', 'filename', 'alt_text', 'sort_order', 'is_active']

  // Template with placeholder images
  const images = [
    // Drinks screen images
    { screen: 'drinks', filename: 'espresso-pour.jpg', alt_text: 'Fresh espresso being poured', sort_order: 1, is_active: true },
    { screen: 'drinks', filename: 'latte-art.jpg', alt_text: 'Latte with beautiful art', sort_order: 2, is_active: true },
    { screen: 'drinks', filename: 'iced-coffee.jpg', alt_text: 'Refreshing iced coffee', sort_order: 3, is_active: true },
    { screen: 'drinks', filename: 'frappuccino.jpg', alt_text: 'Blended frappuccino', sort_order: 4, is_active: true },
    // Food screen images
    { screen: 'food', filename: 'breakfast-burrito.jpg', alt_text: 'Hearty breakfast burrito', sort_order: 1, is_active: true },
    { screen: 'food', filename: 'croissant.jpg', alt_text: 'Flaky butter croissant', sort_order: 2, is_active: true },
    { screen: 'food', filename: 'danish.jpg', alt_text: 'Fresh baked danish', sort_order: 3, is_active: true },
    { screen: 'food', filename: 'sandwich.jpg', alt_text: 'Delicious sandwich', sort_order: 4, is_active: true },
  ]

  const rows = [toCSVRow(headers)]
  for (const img of images) {
    rows.push(toCSVRow([img.screen, img.filename, img.alt_text, img.sort_order, img.is_active]))
  }

  return rows.join('\n')
}

function generateSettingsCSV() {
  const headers = ['key', 'value']

  const settings = [
    { key: 'image_rotation_interval', value: '6000' },
    { key: 'refresh_interval', value: '300000' },
    { key: 'drinks_tagline', value: 'Freshly Brewed Every Day' },
    { key: 'food_tagline', value: 'Baked Fresh Daily' },
    { key: 'header_hours', value: '8AM-6PM Mon-Fri' },
    { key: 'header_location', value: 'Kaiser Permanente · Denver' },
  ]

  const rows = [toCSVRow(headers)]
  for (const setting of settings) {
    rows.push(toCSVRow([setting.key, setting.value]))
  }

  return rows.join('\n')
}

async function main() {
  const options = parseArgs()

  if (!process.env.SQUARE_ACCESS_TOKEN) {
    console.error('❌ Missing SQUARE_ACCESS_TOKEN in environment')
    process.exit(1)
  }

  console.log('📦 Fetching Square catalog...')
  const catalogObjects = await fetchCatalog()
  console.log(`✅ Retrieved ${catalogObjects.length} catalog objects`)

  const { menuItems, categories } = extractMenuData(catalogObjects)
  console.log(`📋 Found ${categories.length} categories and ${menuItems.length} menu item variations`)

  // Export menu items CSV
  ensureOutputDir(options.out)
  const menuCSV = generateMenuCSV(menuItems)
  fs.writeFileSync(options.out, menuCSV, 'utf8')
  console.log(`💾 Menu items exported to ${options.out}`)

  // Export categories template if requested
  if (options.exportCategories) {
    ensureOutputDir(DEFAULT_CATEGORIES_OUTPUT)
    const categoriesCSV = generateCategoriesCSV()
    fs.writeFileSync(DEFAULT_CATEGORIES_OUTPUT, categoriesCSV, 'utf8')
    console.log(`💾 Categories template exported to ${DEFAULT_CATEGORIES_OUTPUT}`)
  }

  // Export images template if requested
  if (options.exportImages) {
    ensureOutputDir(DEFAULT_IMAGES_OUTPUT)
    const imagesCSV = generateImagesCSV()
    fs.writeFileSync(DEFAULT_IMAGES_OUTPUT, imagesCSV, 'utf8')
    console.log(`💾 Images template exported to ${DEFAULT_IMAGES_OUTPUT}`)
  }

  // Export settings template if requested
  if (options.exportSettings) {
    ensureOutputDir(DEFAULT_SETTINGS_OUTPUT)
    const settingsCSV = generateSettingsCSV()
    fs.writeFileSync(DEFAULT_SETTINGS_OUTPUT, settingsCSV, 'utf8')
    console.log(`💾 Settings template exported to ${DEFAULT_SETTINGS_OUTPUT}`)
  }

  // Print summary
  console.log('\n📊 Summary by Square category:')
  const categoryCount = new Map()
  for (const item of menuItems) {
    const cat = item.square_category
    categoryCount.set(cat, (categoryCount.get(cat) || 0) + 1)
  }
  for (const [cat, count] of categoryCount.entries()) {
    console.log(`   ${cat}: ${count} items`)
  }

  console.log('\n✨ Next steps:')
  console.log('   1. Import CSV files into Google Sheets')
  console.log('   2. Review and edit kds_category, display_name, sort_order columns')
  console.log('   3. Set is_visible=false for items you don\'t want displayed')
  console.log('   4. Publish sheets as CSV (File → Share → Publish to web)')
  console.log('   5. Run: npm run import-kds-menu')
}

main().catch(error => {
  console.error('❌ Export failed:', error.message)
  if (error.errors) {
    console.error('   Details:', JSON.stringify(error.errors, null, 2))
  }
  process.exit(1)
})
