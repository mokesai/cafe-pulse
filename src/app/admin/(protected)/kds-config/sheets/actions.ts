'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/server'
import { getTenantSquareConfig } from '@/lib/square/config'
import { getSheets, getDrive } from '@/lib/google/client'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client: SquareClient } = require('square/legacy') as { Client: new (opts: unknown) => { catalogApi: { listCatalog: (cursor?: string, types?: string) => Promise<{ result?: { objects?: unknown[]; cursor?: string } }> } } }

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GenerateSheetResult =
  | { success: true; sheetUrl: string; spreadsheetId: string; itemCount: number }
  | { success: false; error: string }

// ---------------------------------------------------------------------------
// Square catalog helpers (adapted from export-kds-menu-to-sheets.js)
// ---------------------------------------------------------------------------

interface SquareItem {
  square_item_id: string
  square_variation_id: string
  name: string
  variation_name: string
  display_name: string
  description: string
  price: string
  price_cents: number
  display_price: string
  square_category: string
  kds_category: string
  sort_order: number
  is_visible: boolean
}

async function fetchSquareCatalog(accessToken: string, environment: string) {
  const client = new SquareClient({
    bearerAuthCredentials: { accessToken },
    environment: environment.toLowerCase(),
  })

  const items: object[] = []
  let cursor: string | undefined
  do {
    const response = await client.catalogApi.listCatalog(cursor, 'ITEM,CATEGORY')
    if (response?.result?.objects) {
      items.push(...(response.result.objects as object[]))
    }
    cursor = response?.result?.cursor ?? undefined
  } while (cursor)

  return items.filter((item: object) => !(item as Record<string, unknown>).isDeleted)
}

function suggestKDSCategory(categoryName: string, parentName: string | null): string {
  const name = categoryName.toLowerCase()
  if (parentName) {
    const parent = parentName.toLowerCase()
    if (parent.includes('frappuccino') || parent.includes('blended')) {
      if (name.includes('creme') || name.includes('crème')) return 'frappuccinos-creme'
      if (name.includes('coffee')) return 'frappuccinos-coffee'
      return 'blended'
    }
  }
  if (name.includes('hot') && (name.includes('drink') || name.includes('beverage'))) return 'hot-drinks'
  if (name.includes('espresso') || name.includes('latte') || name.includes('cappuccino')) return 'espressos'
  if (name.includes('frappuccino') || name.includes('frappe') || name.includes('blended')) return 'blended'
  if (name.includes('creme') || name.includes('crème')) return 'blended'
  if (name.includes('refresher')) return 'refreshers'
  if (name.includes('smoothie')) return 'smoothies'
  if (name.includes('energy')) return 'energy-drinks'
  if (name.includes('cold') || name.includes('iced')) return 'cold-drinks'
  if (name.includes('coffee') || name.includes('tea')) return 'hot-drinks'
  if (name.includes('breakfast') || name.includes('burrito') || name.includes('egg')) return 'breakfast'
  if (name.includes('pastry') || name.includes('pastries') || name.includes('croissant') || name.includes('muffin')) return 'pastries'
  if (name.includes('sandwich') || name.includes('lunch') || name.includes('wrap')) return 'sandwiches'
  if (name.includes('snack') || name.includes('chip') || name.includes('fruit')) return 'snacks'
  if (name.includes('bakery') || name.includes('baked')) return 'pastries'
  return 'uncategorized'
}

function extractMenuData(catalogObjects: object[]): SquareItem[] {
  const categories = new Map<string, { id: string; name: string; parentId: string | null }>()
  for (const obj of catalogObjects as Record<string, unknown>[]) {
    if (obj.type === 'CATEGORY' && obj.categoryData) {
      const d = obj.categoryData as Record<string, unknown>
      const parent = d.parentCategory as Record<string, string> | null
      categories.set(obj.id as string, {
        id: obj.id as string,
        name: (d.name as string) || 'Uncategorized',
        parentId: parent?.id ?? null,
      })
    }
  }

  const menuItems: SquareItem[] = []
  for (const obj of catalogObjects as Record<string, unknown>[]) {
    if (obj.type !== 'ITEM' || !obj.itemData) continue
    const itemData = obj.itemData as Record<string, unknown>
    if (itemData.isArchived) continue

    const cats = itemData.categories as Array<Record<string, string>> | undefined
    const categoryId = cats?.[0]?.id ?? (itemData.categoryId as string | undefined)
    const category = categoryId ? categories.get(categoryId) : undefined
    const categoryName = category?.name ?? 'Uncategorized'
    const parentCategory = category?.parentId ? categories.get(category.parentId) : undefined
    const parentName = parentCategory?.name ?? null

    const variations = itemData.variations as Array<Record<string, unknown>> | undefined
    for (const variation of variations ?? []) {
      const vd = variation.itemVariationData as Record<string, unknown> | undefined
      if (!vd) continue
      const priceMoney = vd.priceMoney as Record<string, unknown> | undefined
      const priceCents = priceMoney?.amount ? Number(priceMoney.amount) : 0
      const priceFormatted = (priceCents / 100).toFixed(2)
      const variationName = (vd.name as string) || ''
      const isDefault = variationName.toLowerCase() === 'regular' || variationName === ''
      const displayName = isDefault
        ? (itemData.name as string)
        : `${itemData.name} (${variationName})`

      menuItems.push({
        square_item_id: obj.id as string,
        square_variation_id: variation.id as string,
        name: itemData.name as string,
        variation_name: variationName,
        display_name: displayName,
        description: (itemData.description as string) ?? '',
        price: priceFormatted,
        price_cents: priceCents,
        display_price: `$${priceFormatted}`,
        square_category: categoryName,
        kds_category: suggestKDSCategory(categoryName, parentName),
        sort_order: 0,
        is_visible: true,
      })
    }
  }

  menuItems.sort((a, b) =>
    a.square_category !== b.square_category
      ? a.square_category.localeCompare(b.square_category)
      : a.name.localeCompare(b.name)
  )
  return menuItems
}

// ---------------------------------------------------------------------------
// Data validation dropdowns
// ---------------------------------------------------------------------------

const MAX_DROPDOWN_ROWS = 100 // apply validation to this many data rows

function dropdownRule(sheetId: number, col: number, values: string[]) {
  return {
    setDataValidation: {
      range: {
        sheetId,
        startRowIndex: 1, // skip header
        endRowIndex: MAX_DROPDOWN_ROWS,
        startColumnIndex: col,
        endColumnIndex: col + 1,
      },
      rule: {
        condition: {
          type: 'ONE_OF_LIST',
          values: values.map(v => ({ userEnteredValue: v })),
        },
        showCustomUi: true,
        strict: false, // allow empty cells
      },
    },
  }
}

function buildDataValidationRequests() {
  // Categories tab (sheetId: 1)
  // Columns: slug(0), name(1), screen(2), display_type(3), icon(4), color(5),
  //          show_size_header(6), header_text(7), size_labels(8)
  const catScreen = dropdownRule(1, 2, ['drinks', 'food'])
  const catDisplayType = dropdownRule(1, 3, [
    'featured', 'price-grid', 'price-grid-compact', 'simple-list', 'single-price', 'flavor-options',
  ])
  const catIcon = dropdownRule(1, 4, [
    'coffee', 'frappuccino', 'tea', 'iced-drink', 'croissant', 'cookie',
    'danish', 'ice-cream', 'chocolate', 'customize', 'lotus', 'sandwich', 'breakfast',
    'heart', 'bolt', 'snowflake', 'star', 'utensils', 'deal',
  ])
  const catSizeHeader = dropdownRule(1, 6, ['yes', 'no'])

  // Menu Items tab (sheetId: 0)
  // Columns: ..., is_visible(12)
  const menuVisible = dropdownRule(0, 12, ['yes', 'no'])

  // Images tab (sheetId: 2)
  // Columns: screen(0), ..., is_active(4)
  const imgScreen = dropdownRule(2, 0, ['drinks', 'food'])
  const imgActive = dropdownRule(2, 4, ['yes', 'no'])

  return [catScreen, catDisplayType, catIcon, catSizeHeader, menuVisible, imgScreen, imgActive]
}

// ---------------------------------------------------------------------------
// Cell notes (hover help on header cells)
// ---------------------------------------------------------------------------

function cellNote(sheetId: number, col: number, note: string) {
  return {
    updateCells: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: col, endColumnIndex: col + 1 },
      rows: [{ values: [{ note }] }],
      fields: 'note',
    },
  }
}

function buildCellNoteRequests() {
  // Menu Items tab (sheetId: 0)
  const menuNotes = [
    cellNote(0, 0, 'Square catalog item ID. Auto-populated from Square — do not edit.'),
    cellNote(0, 1, 'Square variation ID. Auto-populated from Square — do not edit.'),
    cellNote(0, 2, 'Base item name (e.g., "Americano"). Used as the display name in price-grid mode.'),
    cellNote(0, 3, 'Size variation (e.g., "Tall", "Grande", "Venti"). Must match size_labels in the Categories tab for price-grid display.'),
    cellNote(0, 4, 'Optional override for the display name. If blank, name + variation is used.'),
    cellNote(0, 5, 'Item description. Not currently displayed on KDS screens.'),
    cellNote(0, 6, 'Price as decimal (e.g., "5.95"). Used if price_cents is empty.'),
    cellNote(0, 7, 'Price in cents (e.g., "595"). Takes priority over price column.'),
    cellNote(0, 8, 'Formatted price string (e.g., "$5.95"). Displayed on screen.'),
    cellNote(0, 9, 'Square catalog category. Auto-populated — used for reference only.'),
    cellNote(0, 10, 'KDS category slug this item belongs to. Must match a slug in the Categories tab.'),
    cellNote(0, 11, 'Sort order within the category. Lower numbers appear first.'),
    cellNote(0, 12, 'Whether this item is visible on the KDS screen. Set to "no" to hide without deleting.'),
    cellNote(0, 13, 'Category slug for sub-grouping within a flavor-options category. The slug must match a row in the Categories tab — the category name is used as the sub-heading.\n\nExample: For a "Frappuccino Blended Beverages" category (slug: frappuccinos), set sub_group to "frappuccinos-coffee" or "frappuccinos-creme". The renderer looks up the slug to display "Contains Coffee" or "Crème (Coffee-Free)" as sub-headings.\n\nLeave blank for categories that don\'t need sub-grouping.'),
  ]

  // Categories tab (sheetId: 1)
  const catNotes = [
    cellNote(1, 0, 'Unique identifier for this category (e.g., "espressos", "breakfast"). Used by the Layout Editor to place categories on screen. Must be unique per screen.'),
    cellNote(1, 1, 'Display name shown as the category title on the KDS screen (e.g., "Espresso & Coffee").'),
    cellNote(1, 2, 'Which KDS screen this category appears on: "drinks" or "food".'),
    cellNote(1, 3, 'Default display type for this category. Controls how items render on the KDS screen.\n\nIMPORTANT: The Layout Editor also has a Display type setting on each cell. The Layout Editor setting OVERRIDES this value. Set display_type here as the default, then use the Layout Editor to override per-cell if needed.\n\nOptions:\n• price-grid — Items grouped by name with size columns right-aligned at cell edge. Best for consistency when multiple categories share a column.\n• price-grid-compact — Same as price-grid but prices hug the longest item name. Best for wide columns where right-alignment wastes space.\n• featured — Names only, no prices. Best for "Most Popular" lists.\n• simple-list — Name + single price per row.\n• single-price — Items grouped by name with flavors listed below. Best for pastries/food with variations.\n• flavor-options — Items grouped by sub_group with sub-headings and price columns. Best for categories with sub-categories (e.g., Frappuccinos with Coffee/Crème groups).'),
    cellNote(1, 4, 'Icon shown next to the category title. Options: coffee, frappuccino, tea, iced-drink, croissant, cookie, danish, ice-cream, chocolate, customize, lotus, sandwich, breakfast. Leave blank for no icon.'),
    cellNote(1, 5, 'CSS color for the category title (e.g., "#ff6600", "gold", "rgb(232,176,75)"). Leave blank to use the theme default.'),
    cellNote(1, 6, 'Show size column headers (Tall/Grande/Venti) above the price columns. Only applies to price-grid and flavor-options display types.'),
    cellNote(1, 7, 'Custom header text for single-price categories (e.g., "All items $4.95").'),
    cellNote(1, 8, 'Custom size labels, pipe-separated (e.g., "Tall|Grande|Venti"). Defaults to Tall|Grande|Venti if blank. Labels must match variation_name values in Menu Items.'),
  ]

  // Images tab (sheetId: 2)
  const imgNotes = [
    cellNote(2, 0, 'Which KDS screen this image is for: "drinks" or "food".'),
    cellNote(2, 1, 'Image filename. Must match a file uploaded to KDS assets storage.'),
    cellNote(2, 2, 'Alt text for accessibility. Describes what the image shows.'),
    cellNote(2, 3, 'Display order for image rotation. Lower numbers appear first.'),
    cellNote(2, 4, 'Whether this image is active. Set to "no" to disable without deleting.'),
  ]

  // Settings tab (sheetId: 3)
  const settingsNotes = [
    cellNote(3, 0, 'Setting key. Valid keys:\n\n• image_rotation_interval — Milliseconds between image rotations (default: 6000)\n• refresh_interval — Milliseconds between data refreshes (default: 300000)\n• drinks_tagline — Subtitle text for drinks screen\n• food_tagline — Subtitle text for food screen\n• header_hours — Hours shown in header (e.g., "8AM-6PM Mon-Fri")\n• header_location — Location shown in header (e.g., "Kaiser Permanente · Denver")'),
    cellNote(3, 1, 'Setting value. Numbers are stored as integers; everything else as text.'),
  ]

  return [...menuNotes, ...catNotes, ...imgNotes, ...settingsNotes]
}

// ---------------------------------------------------------------------------
// Guide tab
// ---------------------------------------------------------------------------

function buildGuideTab(): string[][] {
  return [
    ['KDS Setup Guide'],
    [''],
    ['════════════════════════════════════════════════════════════════'],
    ['WORKFLOW'],
    ['════════════════════════════════════════════════════════════════'],
    ['1. Review and edit the Menu Items tab (items come from your Square catalog)'],
    ['2. Configure categories in the Categories tab (defines how items are grouped and displayed)'],
    ['3. Set up images in the Images tab (product photography for the display)'],
    ['4. Adjust settings in the Settings tab (hours, taglines, refresh intervals)'],
    ['5. Import this sheet from the admin panel: KDS Config → Manage Sheet → Import'],
    ['6. Open the Layout Editor to arrange categories and images on screen'],
    ['7. Preview your layout, then Publish when ready'],
    [''],
    ['This sheet defines WHAT content appears. The Layout Editor defines WHERE it appears.'],
    ['You will likely go back and forth between the sheet and Layout Editor several times.'],
    [''],
    ['════════════════════════════════════════════════════════════════'],
    ['MENU ITEMS TAB'],
    ['════════════════════════════════════════════════════════════════'],
    ['Contains all items from your Square catalog. Each row is one size variation of an item.'],
    ['For example, "Americano" has 3 rows: Tall, Grande, and Venti, each with its own price.'],
    [''],
    ['Key columns to edit:'],
    ['• kds_category — Assign each item to a category slug from the Categories tab'],
    ['• display_name — Override the display name shown on screen (optional)'],
    ['• is_visible — Set to "no" to hide an item without deleting it'],
    ['• sort_order — Controls the order items appear within their category'],
    ['• sub_group — For flavor-options categories only. References a category slug to create'],
    ['  sub-group headings. See "Flavor Options" section below.'],
    [''],
    ['Columns to leave alone (auto-populated from Square):'],
    ['• square_item_id, square_variation_id — Square catalog references'],
    ['• name — Base item name from Square (e.g., "Americano")'],
    ['• variation_name — Size or flavor (e.g., "Tall", "Chocolate Chip")'],
    ['• price, price_cents, display_price — Pricing from Square'],
    ['• square_category — Original Square category name'],
    [''],
    ['════════════════════════════════════════════════════════════════'],
    ['CATEGORIES TAB'],
    ['════════════════════════════════════════════════════════════════'],
    ['Defines the sections shown on the KDS screens. Each category groups related menu items.'],
    ['Categories can also serve as sub-group labels (see flavor-options below).'],
    [''],
    ['Required columns:'],
    ['• slug — Unique identifier (e.g., "espressos"). Referenced by the Layout Editor and Menu Items.'],
    ['• name — Display title shown on screen (e.g., "Espresso & Coffee")'],
    ['• screen — Which KDS screen: "drinks" or "food"'],
    [''],
    ['────────────────────────────────────────────────────────────────'],
    ['DISPLAY TYPES (display_type column)'],
    ['────────────────────────────────────────────────────────────────'],
    ['Controls how items in the category are rendered on the KDS screen.'],
    [''],
    ['PRICE-GRID'],
    ['  Items grouped by name with size columns (Tall/Grande/Venti).'],
    ['  Prices are right-aligned at the cell edge for consistent vertical alignment.'],
    ['  Best for: Multiple categories stacked in the same column (e.g., Espressos above Refreshers).'],
    ['  Requirements: variation_name on items must match size_labels on the category.'],
    ['  Example:'],
    ['                          TALL    GRANDE   VENTI'],
    ['    Americano             $3.65    $3.95   $4.45'],
    ['    Cafe Mocha            $5.45    $5.95   $6.45'],
    [''],
    ['PRICE-GRID-COMPACT'],
    ['  Same as price-grid but prices are positioned right after the longest item name.'],
    ['  Reduces whitespace in wide columns.'],
    ['  Best for: Wide columns where right-alignment leaves too much empty space.'],
    ['  Note: Categories in the same column may have prices at different horizontal positions'],
    ['  since each category sizes to its own longest name.'],
    ['  Example:'],
    ['                    TALL    GRANDE   VENTI'],
    ['    Americano       $3.65    $3.95   $4.45'],
    ['    Cafe Mocha      $5.45    $5.95   $6.45'],
    [''],
    ['FEATURED'],
    ['  Names only — no prices, no sizes. Deduplicates items by base name.'],
    ['  Supports header_text for descriptive text below the title.'],
    ['  Best for: "Most Popular" lists, spotlight sections, energy drink menus.'],
    ['  Example:'],
    ['    Queen-King ~ $5.95-$6.95       ← header_text'],
    ['    Berry Peachy'],
    ['    Orange Creamsicle'],
    ['    Pinky Promise'],
    [''],
    ['SIMPLE-LIST'],
    ['  Each item on its own line with name + single price.'],
    ['  Shows every variation as a separate row.'],
    ['  Best for: Simple food items without size variations.'],
    ['  Example:'],
    ['    Diz Burrito             $8.95'],
    ['    Sammies Sandwich        $7.95'],
    [''],
    ['SINGLE-PRICE'],
    ['  Items grouped by name with a single price. Variations are shown as a flavor line below.'],
    ['  The variation_name "Regular" is automatically hidden.'],
    ['  Best for: Pastries, baked goods, and food items with flavor variations at the same price.'],
    ['  Example:'],
    ['    Cookie                  $4.95'],
    ['      Chocolate Chip · Snickerdoodle · Peanut Butter · Oatmeal Raisin'],
    ['    Danish                  $4.95'],
    ['      Apple · Blueberry · Cream Cheese · Raspberry'],
    [''],
    ['FLAVOR-OPTIONS'],
    ['  Items grouped under sub-headings with a shared price grid.'],
    ['  Requires sub_group on Menu Items (see below).'],
    ['  Best for: Categories with sub-categories (e.g., Frappuccinos with Coffee/Crème groups).'],
    ['  Example:'],
    ['    Frappuccino® Blended Beverages          ← category name'],
    ['                          TALL    GRANDE   VENTI'],
    ['    CONTAINS COFFEE                         ← sub-group heading (from category name)'],
    ['    Caramel               $5.65    $6.35   $6.75'],
    ['    CRÈME (COFFEE-FREE)                     ← sub-group heading'],
    ['    Chai Creme            $5.45    $5.95   $6.45'],
    [''],
    ['────────────────────────────────────────────────────────────────'],
    ['SETTING UP FLAVOR-OPTIONS (sub_group)'],
    ['────────────────────────────────────────────────────────────────'],
    ['Flavor-options requires coordination between Categories and Menu Items:'],
    [''],
    ['1. Create a parent category (e.g., slug: "frappuccinos", name: "Frappuccino Blended Beverages")'],
    ['2. Create sub-group categories (e.g., slug: "frappuccinos-coffee", name: "Contains Coffee")'],
    ['   These provide the display names for sub-headings.'],
    ['3. On Menu Items, set kds_category to the parent slug ("frappuccinos")'],
    ['4. On Menu Items, set sub_group to the sub-group slug ("frappuccinos-coffee")'],
    ['   The renderer looks up the sub_group slug to get the display name for the heading.'],
    [''],
    ['────────────────────────────────────────────────────────────────'],
    ['OPTIONAL CATEGORY COLUMNS'],
    ['────────────────────────────────────────────────────────────────'],
    ['• icon — Icon shown before the category title. Available icons:'],
    ['  coffee, frappuccino, tea, iced-drink, croissant, cookie, danish, ice-cream,'],
    ['  chocolate, customize, lotus, sandwich, breakfast, heart, bolt, snowflake,'],
    ['  star, utensils, deal'],
    ['• color — CSS color for the category title (e.g., "#006241", "gold", "red")'],
    ['  For flavor-options, the sub-group category\'s color is used for sub-headings.'],
    ['• show_size_header — Show/hide the Tall/Grande/Venti header row (yes/no)'],
    ['• header_text — Descriptive text shown below the title (used by featured and single-price)'],
    ['• size_labels — Custom size labels, pipe-separated (e.g., "Small|Medium|Large")'],
    ['  Defaults to "Tall|Grande|Venti". Must match variation_name values in Menu Items.'],
    [''],
    ['════════════════════════════════════════════════════════════════'],
    ['IMAGES TAB'],
    ['════════════════════════════════════════════════════════════════'],
    ['Defines the image inventory for KDS screens. Images must be uploaded to KDS assets storage.'],
    ['The Layout Editor controls where images appear on screen — this tab just lists available images.'],
    [''],
    ['• Use landscape (wide) images for footer rows and horizontal cells'],
    ['• Use square images for division cells next to category lists'],
    ['• Transparent PNG images blend well on light or white backgrounds'],
    ['• Set image_fit to "contain" in the Layout Editor to show the full image without cropping'],
    [''],
    ['════════════════════════════════════════════════════════════════'],
    ['SETTINGS TAB'],
    ['════════════════════════════════════════════════════════════════'],
    ['Key-value pairs for screen configuration:'],
    ['• drinks_tagline / food_tagline — Subtitle text below the header title'],
    ['• header_hours — Business hours shown in header (e.g., "8AM-6PM Mon-Fri")'],
    ['• header_location — Location text shown in header (e.g., "Kaiser Permanente · Denver")'],
    ['• image_rotation_interval — Milliseconds between image rotations (default: 6000)'],
    ['• refresh_interval — Milliseconds between data refreshes (default: 300000)'],
    [''],
    ['════════════════════════════════════════════════════════════════'],
    ['LAYOUT EDITOR'],
    ['════════════════════════════════════════════════════════════════'],
    ['The Layout Editor (KDS Config → Layout Editor) controls the visual arrangement.'],
    [''],
    ['Key concepts:'],
    ['• Columns — Vertical sections of the screen. Adjust widths by percentage.'],
    ['• Rows — Horizontal sections within a column. Adjust heights by percentage.'],
    ['• Divisions — A row can be split into two side-by-side cells (e.g., category + image).'],
    ['• Gap — Pixel spacing between divisions in a split row.'],
    [''],
    ['Each cell can contain:'],
    ['• A category (select by slug, with display type override)'],
    ['• An image (select from uploaded assets, choose fit: cover/contain/fill)'],
    ['• Empty'],
    [''],
    ['Header options:'],
    ['• Title and subtitle text'],
    ['• Title/subtitle font — Choose from curated Google Fonts with live preview'],
    ['• Title/subtitle font size — In rem units'],
    ['• Title icon — Image shown to the left of the title'],
    ['• Logo — Image with position (left/center/right)'],
    ['• Show location / Show hours — Toggle display of info from Settings tab'],
    [''],
    ['════════════════════════════════════════════════════════════════'],
    ['TIPS'],
    ['════════════════════════════════════════════════════════════════'],
    ['• Hover over any column header in other tabs to see what it does'],
    ['• Columns with dropdowns show valid values — click the cell to see options'],
    ['• You can type values directly even if they are not in a dropdown'],
    ['• After editing this sheet, import from: KDS Config → Manage Sheet → Import'],
    ['• Use "Clean" import to replace all data, or "Merge" to update without deleting'],
    ['• Clear the browser cache (rm -rf .next) if preview shows stale content'],
    [''],
    ['════════════════════════════════════════════════════════════════'],
    ['COMMON PITFALLS'],
    ['════════════════════════════════════════════════════════════════'],
    [''],
    ['display_type set in TWO places'],
    ['  The Categories tab sets the DEFAULT display type for a category.'],
    ['  The Layout Editor can OVERRIDE it per-cell.'],
    ['  If a category renders incorrectly:'],
    ['  → Open the Layout Editor'],
    ['  → Select the cell containing the category'],
    ['  → Check the "Display type" dropdown in the properties panel'],
    ['  → Set to "Default" to fall back to the sheet value'],
    [''],
    ['variation_name must match size_labels'],
    ['  For price-grid, price-grid-compact, and flavor-options, the variation_name'],
    ['  on Menu Items (e.g., "Tall") must match the size_labels on the Category'],
    ['  (e.g., "Tall|Grande|Venti"). The match is case-insensitive.'],
    ['  If prices show "—" instead of values, check for mismatches.'],
    [''],
    ['sub_group references a category slug'],
    ['  For flavor-options, the sub_group value on Menu Items must match a slug'],
    ['  in the Categories tab. The category\'s name is used as the sub-heading.'],
    ['  If sub-headings don\'t appear, verify the slug exists in Categories.'],
    [''],
    ['kds_category must match a slug'],
    ['  The kds_category on Menu Items must match a slug in the Categories tab.'],
    ['  The import will warn about mismatches. Orphaned items won\'t display.'],
    [''],
    ['Images clipped or cropped'],
    ['  If an image is clipped, check the image_fit setting in the Layout Editor:'],
    ['  → cover — fills the cell, may crop edges'],
    ['  → contain — shows the full image, may have empty space'],
    ['  → fill — stretches to fill (may distort)'],
    ['  Also ensure image dimensions match the cell aspect ratio (use landscape for wide cells).'],
    [''],
    ['Items showing size in parentheses (e.g., "Cookie (Chocolate Chip)")'],
    ['  This means the category is using simple-list or the default renderer,'],
    ['  which shows display_name (includes variation). Switch display_type to'],
    ['  single-price to group items by name with flavors listed below.'],
    [''],
    ['Long item names bleeding into prices'],
    ['  Use price-grid (not price-grid-compact) for categories with long names.'],
    ['  price-grid right-aligns prices at the cell edge so names truncate with "..."'],
    ['  price-grid-compact positions prices after the longest name, which can overflow.'],
  ]
}

// ---------------------------------------------------------------------------
// Sheet tab builders
// ---------------------------------------------------------------------------

function buildMenuItemsTab(menuItems: SquareItem[]): string[][] {
  const headers = [
    'square_item_id', 'square_variation_id', 'name', 'variation_name',
    'display_name', 'description', 'price', 'price_cents', 'display_price',
    'square_category', 'kds_category', 'sort_order', 'is_visible', 'sub_group',
  ]
  const rows = [headers]
  for (const item of menuItems) {
    rows.push([
      item.square_item_id, item.square_variation_id, item.name, item.variation_name,
      item.display_name, item.description, item.price, String(item.price_cents),
      item.display_price, item.square_category, item.kds_category,
      String(item.sort_order), item.is_visible ? 'yes' : 'no', '',
    ])
  }
  return rows
}

function buildCategoriesTab(): string[][] {
  return [
    ['slug', 'name', 'screen', 'display_type', 'icon', 'color', 'show_size_header', 'header_text', 'size_labels'],
    ['hot-drinks', 'Hot Drinks', 'drinks', 'price-grid', 'coffee', '', 'yes', '', 'Tall|Grande|Venti'],
    ['espressos', 'Espressos', 'drinks', 'price-grid', 'coffee', '', 'yes', '', 'Tall|Grande|Venti'],
    ['cold-drinks', 'Cold Drinks', 'drinks', 'price-grid', 'iced-drink', '', 'yes', '', 'Tall|Grande|Venti'],
    ['blended', 'Blended', 'drinks', 'flavor-options', 'frappuccino', '', 'yes', '', 'Tall|Grande|Venti'],
    ['frappuccinos-coffee', 'Frappuccinos - Coffee', 'drinks', 'flavor-options', 'frappuccino', '', 'yes', '', 'Tall|Grande|Venti'],
    ['frappuccinos-creme', 'Frappuccinos - Crème (Coffee-Free)', 'drinks', 'flavor-options', 'frappuccino', '', 'yes', '', 'Tall|Grande|Venti'],
    ['refreshers', 'Refreshers', 'drinks', 'price-grid', 'tea', '', 'yes', '', 'Tall|Grande|Venti'],
    ['breakfast', 'Breakfast', 'food', 'simple-list', 'breakfast', '', '', '', ''],
    ['pastries', 'Pastries', 'food', 'simple-list', 'croissant', '', '', '', ''],
    ['sandwiches', 'Sandwiches', 'food', 'simple-list', 'sandwich', '', '', '', ''],
    ['snacks', 'Snacks', 'food', 'simple-list', 'cookie', '', '', '', ''],
  ]
}

function buildImagesTab(): string[][] {
  return [
    ['screen', 'filename', 'alt_text', 'sort_order', 'is_active'],
    ['drinks', 'espresso-pour.jpg', 'Fresh espresso being poured', '1', 'yes'],
    ['drinks', 'latte-art.jpg', 'Latte with beautiful art', '2', 'yes'],
    ['drinks', 'iced-coffee.jpg', 'Refreshing iced coffee', '3', 'yes'],
    ['drinks', 'frappuccino.jpg', 'Blended frappuccino', '4', 'yes'],
    ['food', 'breakfast-burrito.jpg', 'Hearty breakfast burrito', '1', 'yes'],
    ['food', 'croissant.jpg', 'Flaky butter croissant', '2', 'yes'],
    ['food', 'danish.jpg', 'Fresh baked danish', '3', 'yes'],
    ['food', 'sandwich.jpg', 'Delicious sandwich', '4', 'yes'],
  ]
}

function buildSettingsTab(): string[][] {
  return [
    ['key', 'value'],
    ['image_rotation_interval', '6000'],
    ['refresh_interval', '300000'],
    ['drinks_tagline', 'Freshly Brewed Every Day'],
    ['food_tagline', 'Baked Fresh Daily'],
    ['header_hours', '8AM-6PM Mon-Fri'],
    ['header_location', 'Kaiser Permanente · Denver'],
  ]
}

// ---------------------------------------------------------------------------
// Main server action
// ---------------------------------------------------------------------------

export async function generateKDSSetupSheet(
  tenantId: string,
  regenerate = false
): Promise<GenerateSheetResult> {
  try {
    const supabase = createServiceClient()

    // Check if sheet already exists
    const { data: existing } = await supabase
      .from('tenant_kds_sheets')
      .select('id, google_spreadsheet_id, google_sheet_url')
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (existing && !regenerate) {
      return { success: false, error: 'SHEET_EXISTS' }
    }

    // Get tenant name for sheet title
    const { data: tenant } = await supabase
      .from('tenants')
      .select('name, slug')
      .eq('id', tenantId)
      .single()

    if (!tenant) {
      return { success: false, error: 'Tenant not found' }
    }

    // Get Square credentials
    const squareConfig = await getTenantSquareConfig(tenantId)
    if (!squareConfig) {
      return { success: false, error: 'NO_SQUARE_CREDENTIALS' }
    }

    // Fetch Square catalog
    const catalogObjects = await fetchSquareCatalog(
      squareConfig.accessToken,
      squareConfig.environment
    )
    const menuItems = extractMenuData(catalogObjects)

    // Build sheet tabs
    const menuRows = buildMenuItemsTab(menuItems)
    const categoryRows = buildCategoriesTab()
    const imageRows = buildImagesTab()
    const settingsRows = buildSettingsTab()
    const guideRows = buildGuideTab()

    // Create Google Spreadsheet
    const sheets = getSheets()
    const drive = getDrive()

    const sheetTitle = `${tenant.name} — KDS Setup`
    const created = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title: sheetTitle },
        sheets: [
          { properties: { title: 'Menu Items', sheetId: 0 } },
          { properties: { title: 'Categories', sheetId: 1 } },
          { properties: { title: 'Images', sheetId: 2 } },
          { properties: { title: 'Settings', sheetId: 3 } },
          { properties: { title: 'Guide', sheetId: 4 } },
        ],
      },
    })

    const spreadsheetId = created.data.spreadsheetId!

    // Populate all 5 tabs
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: [
          { range: 'Menu Items!A1', values: menuRows },
          { range: 'Categories!A1', values: categoryRows },
          { range: 'Images!A1', values: imageRows },
          { range: 'Settings!A1', values: settingsRows },
          { range: 'Guide!A1', values: guideRows },
        ],
      },
    })

    // Apply dropdown data validations and cell notes
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [...buildDataValidationRequests(), ...buildCellNoteRequests()] },
    })

    // Set "anyone with the link can edit"
    await drive.permissions.create({
      fileId: spreadsheetId,
      requestBody: { role: 'writer', type: 'anyone' },
    })

    const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`

    // Upsert reference in DB
    if (existing) {
      await supabase
        .from('tenant_kds_sheets')
        .update({
          google_spreadsheet_id: spreadsheetId,
          google_sheet_url: sheetUrl,
          last_synced_at: null,
          last_imported_at: null,
        })
        .eq('tenant_id', tenantId)
    } else {
      await supabase
        .from('tenant_kds_sheets')
        .insert({
          tenant_id: tenantId,
          google_spreadsheet_id: spreadsheetId,
          google_sheet_url: sheetUrl,
        })
    }

    revalidatePath('/admin/kds-config')

    return {
      success: true,
      sheetUrl,
      spreadsheetId,
      itemCount: menuItems.length,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[generateKDSSetupSheet]', message)
    return { success: false, error: message }
  }
}
