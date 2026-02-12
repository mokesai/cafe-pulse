# Kitchen Display System (KDS) Implementation Plan

## Overview

A menu display system for two side-by-side 50" TV screens at Little Cafe (Kaiser Permanente, Denver). Menu data flows from Square API → Google Sheets (for editing) → KDS display pages.

### Goals
- Display menu items with prices on two TV screens
- Screen 1: Drinks (hot, cold, espressos, blended)
- Screen 2: Food (breakfast, pastries, sandwiches, snacks)
- Static menu content with rotating footer images
- Easy price/item updates via Google Sheets
- Branded with Little Cafe logo, Kaiser Permanente, hours

## System Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌─────────────┐
│  Square     │────▶│ Google       │────▶│  Supabase   │────▶│  TV Display │
│  Catalog    │     │ Sheets       │     │  Database   │     │  Pages      │
└─────────────┘     └──────────────┘     └─────────────┘     └─────────────┘
   Export            User edits          Import &            /kds/drinks
   Script            prices,             cache               /kds/food
                     categories
```

## Workflow

### 1. Square → Google Sheets Export
- Run `npm run export-kds-menu` to fetch catalog from Square
- Outputs CSV or pushes directly to Google Sheets
- Includes all menu items with Square IDs, prices, categories

### 2. Google Sheets Editing
- User adjusts prices, display names, categories
- Sets sort order and visibility flags
- Changes saved automatically in Sheets

### 3. Sheets → KDS Import
- Run `npm run import-kds-menu` to pull data from Sheets
- Stores in Supabase `kds_*` tables
- Or: KDS pages fetch directly from published Sheets URL

### 4. TV Display
- Navigate to `/kds/drinks` on Screen 1
- Navigate to `/kds/food` on Screen 2
- Pages auto-refresh every 5 minutes for updates
- Footer images rotate every 6 seconds

## Database Schema

### Table: `kds_categories`
```sql
CREATE TABLE kds_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,                    -- "Hot Drinks"
  slug TEXT UNIQUE NOT NULL,             -- "hot-drinks"
  screen TEXT NOT NULL,                  -- "drinks" or "food"
  position TEXT NOT NULL,                -- "top-left", "top-right", "bottom-left", "bottom-right"
  sort_order INTEGER NOT NULL DEFAULT 0,
  color TEXT,                            -- optional accent color
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Table: `kds_menu_items`
```sql
CREATE TABLE kds_menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  square_item_id TEXT,                   -- link to Square catalog
  square_variation_id TEXT,
  name TEXT NOT NULL,                    -- "Caramel Macchiato"
  display_name TEXT,                     -- optional shorter name for display
  price_cents INTEGER NOT NULL,          -- 595 = $5.95
  display_price TEXT,                    -- "$5.95" or "5.95" formatted
  category_id UUID REFERENCES kds_categories(id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_visible BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Table: `kds_settings`
```sql
CREATE TABLE kds_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Example settings:
-- { key: "image_rotation_interval", value: 6000 }
-- { key: "refresh_interval", value: 300000 }
-- { key: "header_tagline", value: "Freshly Brewed Every Day" }
```

### Table: `kds_images`
```sql
CREATE TABLE kds_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  screen TEXT NOT NULL,                  -- "drinks" or "food"
  filename TEXT NOT NULL,                -- "espresso-pour.jpg"
  alt_text TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Google Sheets Structure

### Sheet 1: Menu Items
| Column | Description |
|--------|-------------|
| square_item_id | Square catalog item ID |
| square_variation_id | Square variation ID |
| name | Original name from Square |
| display_name | Override name for KDS (optional) |
| price | Price in dollars (e.g., 5.95) |
| display_price | Formatted price (e.g., "$5.95") |
| category | Display category slug |
| sort_order | Order within category |
| is_visible | TRUE/FALSE |

### Sheet 2: Categories
| Column | Description |
|--------|-------------|
| slug | Unique identifier |
| name | Display name |
| screen | "drinks" or "food" |
| position | "top-left", "top-right", "bottom-left", "bottom-right" |
| sort_order | Order if rotating |
| color | Accent color (optional) |

### Sheet 3: Settings
| Key | Value |
|-----|-------|
| image_rotation_interval | 6000 |
| refresh_interval | 300000 |
| drinks_tagline | Freshly Brewed Every Day |
| food_tagline | Baked Fresh Daily |

### Sheet 4: Footer Images
| Column | Description |
|--------|-------------|
| screen | "drinks" or "food" |
| filename | Image filename |
| alt_text | Accessibility text |
| sort_order | Rotation order |
| is_active | TRUE/FALSE |

## File Structure

```
src/app/kds/
├── layout.tsx                 # Full-screen layout, no nav
├── page.tsx                   # Redirect or display selector
├── drinks/
│   └── page.tsx               # Screen 1: Drinks display
├── food/
│   └── page.tsx               # Screen 2: Food display
└── components/
    ├── KDSHeader.tsx          # Logo, hours, location
    ├── KDSCategoryGrid.tsx    # 4-quadrant category layout
    ├── KDSCategorySection.tsx # Single category with items
    ├── KDSMenuItem.tsx        # Item name + price row
    ├── KDSFooter.tsx          # Rotating image + tagline
    └── KDSImageRotator.tsx    # Image rotation logic

src/lib/kds/
├── sheets.ts                  # Google Sheets fetch utilities
├── types.ts                   # KDS type definitions
└── queries.ts                 # Supabase queries for KDS data

scripts/
├── export-kds-menu-to-sheets.js    # Square → Sheets export
└── import-kds-menu-from-sheets.js  # Sheets → Supabase import

public/images/kds/
├── drinks/
│   ├── espresso-pour.jpg
│   ├── iced-coffee.jpg
│   ├── frappuccino.jpg
│   └── latte-art.jpg
└── food/
    ├── breakfast-burrito.jpg
    ├── croissant.jpg
    ├── danish.jpg
    └── sandwich.jpg
```

## Display Specifications

### Screen Dimensions
- Resolution: 1920x1080 (Full HD) or 3840x2160 (4K)
- Aspect ratio: 16:9
- Safe area: 90% of screen (account for TV overscan)

### Typography
| Element | Size (1080p) | Size (4K) | Weight |
|---------|--------------|-----------|--------|
| Header logo | 48px | 96px | Bold |
| Header text | 24px | 48px | Medium |
| Category title | 36px | 72px | Bold |
| Item name | 28px | 56px | Regular |
| Item price | 28px | 56px | Medium |
| Footer tagline | 24px | 48px | Medium |

### Colors
```css
:root {
  --kds-bg: #1a1a1a;           /* Dark background */
  --kds-text: #ffffff;          /* White text */
  --kds-text-muted: #a0a0a0;    /* Muted text */
  --kds-accent: #c4a574;        /* Warm gold accent */
  --kds-divider: #333333;       /* Section dividers */
  --kds-header-bg: #0d0d0d;     /* Header background */
}
```

### Layout Grid (per screen)
```
┌────────────────────────────────────────────────────┐
│  HEADER (80px)                                     │
│  Logo        Little Cafe        8AM-6PM Mon-Fri   │
│              Kaiser Permanente · Denver            │
├───────────────────────┬────────────────────────────┤
│                       │                            │
│  TOP-LEFT             │  TOP-RIGHT                 │
│  Category             │  Category                  │
│  (380px height)       │  (380px height)            │
│                       │                            │
├───────────────────────┼────────────────────────────┤
│                       │                            │
│  BOTTOM-LEFT          │  BOTTOM-RIGHT              │
│  Category             │  Category                  │
│  (380px height)       │  (380px height)            │
│                       │                            │
├───────────────────────┴────────────────────────────┤
│  FOOTER (160px)                                    │
│  [Rotating Image]  |  Tagline text                 │
└────────────────────────────────────────────────────┘
```

## Screen Content Mapping

### Screen 1: Drinks (`/kds/drinks`)
| Position | Category | Example Items |
|----------|----------|---------------|
| top-left | Hot Drinks | Drip Coffee, Hot Tea, Hot Chocolate |
| top-right | Espressos | Latte, Cappuccino, Americano, Macchiato |
| bottom-left | Cold Drinks | Iced Coffee, Iced Tea, Lemonade |
| bottom-right | Blended | Frappuccinos, Smoothies, Refreshers |
| footer | Rotating images | espresso-pour, latte-art, iced-coffee, frappuccino |

### Screen 2: Food (`/kds/food`)
| Position | Category | Example Items |
|----------|----------|---------------|
| top-left | Breakfast | Breakfast Burrito, Egg Sandwich, Oatmeal |
| top-right | Pastries | Croissant, Danish, Muffin, Scone |
| bottom-left | Sandwiches | Turkey Club, Ham & Swiss, Veggie Wrap |
| bottom-right | Snacks | Chips, Fruit Cup, Yogurt, Granola Bar |
| footer | Rotating images | burrito, croissant, danish, sandwich |

## Implementation Phases

### Phase 1: Database & Types ✅
**Tasks:**
- [x] Create Supabase migration for `kds_categories` table
- [x] Create Supabase migration for `kds_menu_items` table
- [x] Create Supabase migration for `kds_settings` table
- [x] Create Supabase migration for `kds_images` table
- [x] Define TypeScript types in `src/lib/kds/types.ts`
- [x] Create Supabase queries in `src/lib/kds/queries.ts`

**Files:**
- `supabase/migrations/XXXXXX_create_kds_tables.sql`
- `src/lib/kds/types.ts`
- `src/lib/kds/queries.ts`

### Phase 2: Square → Sheets Export ✅
**Tasks:**
- [x] Create export script `scripts/export-kds-menu-to-sheets.js`
- [x] Fetch all catalog items from Square API
- [x] Transform to flat spreadsheet format
- [x] Output as CSV file
- [x] Add npm script: `"export-kds-menu": "node scripts/export-kds-menu-to-sheets.js"`

**Files:**
- `scripts/export-kds-menu-to-sheets.js`
- `package.json` (add script)

### Phase 3: Google Sheets Setup (Manual)
**Tasks:**
- [ ] Create Google Sheet with 4 tabs (Items, Categories, Settings, Images)
- [ ] Import CSV from Phase 2
- [ ] Add display columns (display_name, category, sort_order, is_visible)
- [ ] Populate categories with screen and position mappings
- [ ] Configure settings values
- [ ] Publish sheet as CSV (File → Share → Publish to web)

**Deliverable:**
- Google Sheet URL for menu management
- Published CSV URLs for each tab

### Phase 4: Sheets → Database Import ✅
**Tasks:**
- [x] Create import script `scripts/import-kds-menu-from-sheets.js`
- [x] Fetch published CSV from Google Sheets
- [x] Parse and validate data
- [x] Upsert to Supabase tables
- [x] Add npm script: `"import-kds-menu": "node scripts/import-kds-menu-from-sheets.js"`

**Files:**
- `scripts/import-kds-menu-from-sheets.js`
- `package.json` (add script)

### Phase 5: KDS Layout & Components ✅
**Tasks:**
- [x] Create KDS layout (`src/app/kds/layout.tsx`)
  - Full-screen, no scroll, dark background
  - Load Inter font at appropriate sizes
  - Meta tags to prevent zoom/scroll on TV browsers
- [x] Create `KDSHeader` component
  - Little Cafe logo (left)
  - "Kaiser Permanente · Denver" (center)
  - "8AM-6PM Mon-Fri" (right)
- [x] Create `KDSCategorySection` component
  - Category title with underline
  - List of menu items
- [x] Create `KDSMenuItem` component
  - Item name (left-aligned)
  - Price (right-aligned)
  - Dots or space between
- [x] Create `KDSCategoryGrid` component
  - 2x2 grid layout
  - Accepts 4 categories with positions
- [x] Create `KDSFooter` component
  - Image area (left)
  - Tagline text (right)
- [x] Create `KDSImageRotator` component
  - Fade transition between images
  - Configurable interval (default 6s)

**Files:**
- `src/app/kds/layout.tsx`
- `src/app/kds/components/KDSHeader.tsx`
- `src/app/kds/components/KDSCategorySection.tsx`
- `src/app/kds/components/KDSMenuItem.tsx`
- `src/app/kds/components/KDSCategoryGrid.tsx`
- `src/app/kds/components/KDSFooter.tsx`
- `src/app/kds/components/KDSImageRotator.tsx`

### Phase 6: KDS Display Pages ✅
**Tasks:**
- [x] Create drinks page (`src/app/kds/drinks/page.tsx`)
  - Fetch categories where screen = "drinks"
  - Fetch menu items for those categories
  - Fetch footer images for drinks
  - Render KDSHeader + KDSCategoryGrid + KDSFooter
- [x] Create food page (`src/app/kds/food/page.tsx`)
  - Same structure, screen = "food"
- [x] Create root page (`src/app/kds/page.tsx`)
  - Display selector or redirect

**Files:**
- `src/app/kds/page.tsx`
- `src/app/kds/drinks/page.tsx`
- `src/app/kds/food/page.tsx`

### Phase 7: Auto-Refresh & Polling ✅
**Tasks:**
- [x] Add client-side polling for data refresh
- [x] Use React Query with refetchInterval (5 minutes)
- [x] Or: Use Next.js revalidation with ISR
- [x] Add visual indicator during refresh (subtle)
- [x] Handle offline/error states gracefully

**Implementation options:**
```typescript
// Option A: React Query polling
const { data } = useQuery({
  queryKey: ['kds-menu', screen],
  queryFn: fetchKDSMenu,
  refetchInterval: 5 * 60 * 1000, // 5 minutes
});

// Option B: Page-level refresh
useEffect(() => {
  const interval = setInterval(() => {
    router.refresh();
  }, 5 * 60 * 1000);
  return () => clearInterval(interval);
}, []);
```

### Phase 8: Images & Assets ✅
**Tasks:**
- [x] Collect/create footer images
  - Drinks: espresso pour, latte art, iced coffee, frappuccino
  - Food: breakfast burrito, croissant, danish, sandwich
- [x] Optimize images for TV display (1920px width, WebP format)
- [x] Add images to `public/images/kds/drinks/` and `public/images/kds/food/`
- [x] Add Little Cafe logo optimized for dark background
- [x] Seed `kds_images` table with image references

**Files:**
- `public/images/kds/drinks/*.webp`
- `public/images/kds/food/*.webp`
- `public/images/kds/logo-light.svg`

### Phase 9: Styling & Polish ✅
**Tasks:**
- [x] Create KDS-specific CSS with variables (`kds.css`)
- [x] Test on 1080p and 4K resolutions (responsive breakpoints)
- [x] Adjust font sizes for readability at distance
- [x] Fine-tune spacing and alignment
- [x] Add subtle animations (fade transitions, staggered item animations)
- [x] Test image rotation timing
- [x] Verify contrast ratios for accessibility

### Phase 11: TV Deployment (After Phase 10)
**Tasks:**
- [ ] Configure TV browser (Chromium kiosk mode, Fire TV, etc.)
- [ ] Set up auto-start on TV power-on
- [ ] Configure screen 1 to load `/kds/drinks`
- [ ] Configure screen 2 to load `/kds/food`
- [ ] Test auto-refresh over extended period
- [ ] Finalize TV setup documentation

**Documentation:** See `doc/kds-tv-deployment.md` for setup guide (draft).

## API Endpoints (Optional)

If direct Sheets fetch is unreliable, create API endpoints:

```
GET /api/kds/menu?screen=drinks
GET /api/kds/menu?screen=food
GET /api/kds/settings
GET /api/kds/images?screen=drinks
POST /api/kds/refresh  (trigger re-import from Sheets)
```

## Environment Variables

```bash
# Google Sheets (if using Sheets API)
GOOGLE_SHEETS_API_KEY=your_api_key
KDS_SHEET_ID=your_sheet_id

# Or: Published CSV URLs
KDS_ITEMS_CSV_URL=https://docs.google.com/spreadsheets/d/.../pub?gid=0&output=csv
KDS_CATEGORIES_CSV_URL=https://docs.google.com/spreadsheets/d/.../pub?gid=123&output=csv
KDS_SETTINGS_CSV_URL=https://docs.google.com/spreadsheets/d/.../pub?gid=456&output=csv
KDS_IMAGES_CSV_URL=https://docs.google.com/spreadsheets/d/.../pub?gid=789&output=csv
```

## npm Scripts

Add to `package.json`:
```json
{
  "scripts": {
    "export-kds-menu": "node scripts/export-kds-menu-to-sheets.js",
    "import-kds-menu": "node scripts/import-kds-menu-from-sheets.js"
  }
}
```

## Testing Checklist

- [ ] Export script fetches all Square catalog items
- [ ] Google Sheets displays all menu data correctly
- [ ] Import script populates database tables
- [ ] `/kds/drinks` displays all drink categories
- [ ] `/kds/food` displays all food categories
- [ ] Footer images rotate at correct interval
- [ ] Auto-refresh updates content from Sheets
- [ ] Display readable on 50" TV from 10+ feet
- [ ] No scroll bars or overflow on TV display
- [ ] Graceful handling of missing images
- [ ] Works offline with cached data

---

## Phase 10: Warm Theme Redesign

Based on the reference design (`cafe-menu-example.png`), redesign the KDS to match the warm, inviting cafe aesthetic.

### Reference Design Analysis

The example shows two side-by-side menu screens with:
- Warm wood/paper textured background
- Script "Little Café" logo with "We proudly serve Starbucks coffee" tagline
- Multiple flexible category sections (not fixed 2x2 grid)
- Category headers with decorative icons
- Two-column item layout within categories
- Large promotional food/drink images at the bottom
- Warm brown/cream/gold color palette

### Current vs Target Comparison

| Element | Current KDS | Target Design |
|---------|-------------|---------------|
| Background | Solid dark (#121212) | Warm wood/paper texture |
| Color scheme | Dark with gold accents | Browns, cream, gold on light |
| Logo style | Coffee icon + sans-serif | Script/cursive "Little Café" |
| Layout | Fixed 2x2 quadrant grid | Flexible multi-section flow |
| Category headers | Simple text + underline | Icons + decorative styling |
| Items per category | Up to 8 items, single column | Variable, two-column layout |
| Footer | Small rotating image (180x120) | Large promotional images (~400px tall) |
| Typography | Inter (sans-serif only) | Script logo + sans-serif body |

### Screen Content Layout

**Screen 1: Coffee & Drinks**
```
┌────────────────────────────────────────────────────────┐
│  [Logo] Little Café                                    │
│         We proudly serve Starbucks coffee              │
├──────────────────────┬─────────────────────────────────┤
│ ☕ COFFEE            │ 🧊 FRAPPUCCINOS                 │
│ Fresh Brewed   $2.85 │ Caramel         $5.45          │
│ Iced Coffee    $3.45 │ Mocha           $5.45          │
│ Cold Brew      $4.95 │ Java Chip       $5.45          │
│ ...                  │ ...                             │
├──────────────────────┼─────────────────────────────────┤
│ 🥛 FRAPPUCCINOS      │ 🍵 TEA & REFRESHERS            │
│    (Crème/Coffee)    │ Hot Tea         $2.45          │
│ Vanilla        $5.45 │ Chai Tea Latte  $5.45          │
│ Caramel        $5.45 │ Refreshers      $4.95          │
│ ...                  │ ...                             │
├──────────────────────┴─────────────────────────────────┤
│ ⚙️ CUSTOMIZE: Add Dairy Milk, Oat Milk, etc.          │
├────────────────────────────────────────────────────────┤
│                                                        │
│  [=== Large Promotional Image (croissant/pastry) ===]  │
│                                                        │
└────────────────────────────────────────────────────────┘
```

**Screen 2: Food & Specialty Drinks**
```
┌────────────────────────────────────────────────────────┐
│  [Logo] Little Café                                    │
│         FOOD & SPECIALTY DRINKS                        │
├──────────────────────┬─────────────────────────────────┤
│ 🥐 CROISSANTS $4.95  │ 🍵 TEA $4.95                   │
│ Butter               │ Hot Tea                         │
│ Raspberry            │ Chai Tea                        │
│ Chocolate            │ Matcha                          │
├──────────────────────┼─────────────────────────────────┤
│ 🍪 COOKIES $4.95     │ 🥯 DANISH                       │
│ Vanilla Biscotti     │ Cheese         $4.65           │
│ Strawberry Crème     │ Assorted       $4.65           │
│ Matcha Crème         │                                 │
├──────────────────────┼─────────────────────────────────┤
│ 🍦 ICE CREAM $4.95   │ 🍫 CHOCOLATE & MORE            │
│ Assorted             │ Hot Chocolate  $4.95 w/ whip   │
│                      │                                 │
├──────────────────────┴─────────────────────────────────┤
│ ⚙️ CUSTOMIZE: Syrup, Extra Shot, etc.                 │
├────────────────────────────────────────────────────────┤
│                                                        │
│  [=== Large Promotional Images (drinks/muffin) ===]    │
│                                                        │
└────────────────────────────────────────────────────────┘
```

### Implementation Tasks

#### Phase 10.1: Asset Preparation ✅
- [x] Source or create wood/paper texture background image
- [x] Choose script font for logo (Google Fonts: "Great Vibes" selected)
- [x] Create category icon set (coffee cup, blender, leaf, cookie, etc.)
- [x] Gather large promotional images for footer (~1200x400px)
- [x] Create "Little Café" script logo SVG (using Google Font instead)

**Assets created:**
```
public/images/kds/
├── bg-wood-texture.svg       # SVG wood grain background pattern
├── icons/
│   ├── breakfast.svg         # Breakfast/egg icon
│   ├── chocolate.svg         # Hot chocolate icon
│   ├── coffee.svg            # Coffee cup with steam
│   ├── cookie.svg            # Cookie with chips
│   ├── croissant.svg         # Croissant pastry
│   ├── customize.svg         # Settings/gear icon
│   ├── danish.svg            # Danish pastry
│   ├── frappuccino.svg       # Blended drink cup
│   ├── ice-cream.svg         # Ice cream cone
│   ├── iced-drink.svg        # Cold drink with ice
│   ├── lotus.svg             # Lotus flower (for Lotus Energy)
│   ├── sandwich.svg          # Sandwich icon
│   └── tea.svg               # Tea cup with steam
├── promo/
│   ├── drinks-banner.png     # Large footer image for drinks screen
│   └── food-banner.png       # Large footer image for food screen
```

#### Phase 10.2: Database Schema Updates ✅
- [x] Add `icon` field to `kds_categories` table for category icons
- [x] Add `subtitle` field to `kds_settings` for screen subtitles
- [x] Update category `position` to support flexible ordering (now nullable)

**Migration:** `20260126100000_kds_warm_theme_schema.sql`
- Added `icon` column to `kds_categories`
- Made `position` column nullable (using `sort_order` for ordering instead)
- Added new settings: `drinks_subtitle`, `food_subtitle`, `theme`, `cafe_name`

**Updated files:**
- `src/lib/kds/types.ts` - Added `KDSCategoryIcon` type, made `position` optional
- `src/lib/kds/queries.ts` - Updated mappers and upsert to include `icon`
- `scripts/import-kds-menu-from-sheets.js` - Added `icon` to category transform
- `data/kds-categories-export.csv` - Added `icon` column with values

#### Phase 10.3: New CSS Theme ✅
- [x] Create `kds-warm.css` with warm color palette
- [x] Add textured background with overlay
- [x] Import and configure script font for logo (Great Vibes)
- [x] Style category headers with icons
- [x] Create two-column item layout within categories
- [x] Style larger footer/promotional area
- [x] Theme switching via CSS import (keep dark theme as `kds.css`)

**Created:** `src/app/kds/kds-warm.css`

**Key features:**
- Google Fonts import for "Great Vibes" script font
- Wood texture SVG background with warm overlay
- Script logo styling (`.kds-header-logo` uses `font-family: var(--kds-font-script)`)
- Category icon styling (`.kds-category-icon`)
- Two-column item grid (`.kds-items-grid`)
- Large promo footer (`.kds-promo-footer`)
- Customize bar styling (`.kds-customize-bar`)
- Responsive breakpoints for 4K and smaller screens

**To switch themes:** Edit `layout.tsx` import:
- Warm theme: `import './kds-warm.css'`
- Dark theme: `import './kds.css'`

#### Phase 10.4: Layout Component Updates ✅
- [x] Update `KDSHeader` with script logo and tagline (added `subtitle` prop)
- [x] Create `KDSFlexGrid` component for flexible category layout
- [x] Update `KDSCategorySection` with icon support and two-column items
- [x] Update `KDSMenuItem` for two-column layout (added `compact` prop)
- [x] Create `KDSPromoFooter` for large promotional images with rotation
- [x] Add optional "CUSTOMIZE" section component (`KDSCustomizeBar`)
- [x] Create `KDSCategoryIcon` component for rendering category icons
- [x] Update `KDSCategoryGrid` to pass `icon` prop to category sections
- [x] Export all new components from `components/index.ts`

**Component structure:**
```
src/app/kds/components/
├── KDSHeader.tsx           # Updated: subtitle prop for taglines
├── KDSFlexGrid.tsx         # NEW: flexible multi-row category layout
├── KDSCategorySection.tsx  # Updated: icon, categoryPrice, twoColumn, maxItems props
├── KDSCategoryIcon.tsx     # NEW: renders category icons from SVG files
├── KDSMenuItem.tsx         # Updated: compact mode (no dot leaders)
├── KDSCategoryGrid.tsx     # Updated: passes icon to sections
├── KDSCustomizeBar.tsx     # NEW: "CUSTOMIZE" options section
├── KDSPromoFooter.tsx      # NEW: large promotional image footer with rotation
├── KDSFooter.tsx           # Keep for backward compatibility
└── KDSImageRotator.tsx     # Keep as-is
```

#### Phase 10.5: Page Updates ✅
- [x] Update `KDSScreen` to support warm theme features:
  - Added `usePromoFooter` and `promoImages` props
  - Gets screen-specific subtitle from settings (`drinks_subtitle`, `food_subtitle`)
  - Uses `cafe_name` setting for header
  - Passes subtitle to KDSHeader
- [x] Update `/kds/drinks` to use promotional footer with `drinks-banner.png`
- [x] Update `/kds/food` to use promotional footer with `food-banner.png`
- [x] Screen-specific subtitles loaded from database settings

#### Phase 10.6: Google Sheets Updates ✅
- [x] `icon` column already added to categories export (`data/kds-categories-export.csv`)
- [x] Updated settings template with new warm theme settings:
  - `drinks_subtitle` - "We proudly serve Starbucks coffee"
  - `food_subtitle` - "FOOD & SPECIALTY DRINKS"
  - `cafe_name` - "Little Café"
  - `theme` - "warm"
- [x] Import script already handles `icon` field (updated in Phase 10.2)
- [x] Categories export includes icon mappings for all categories

**Files updated:**
- `data/kds-settings-template.csv` - Added subtitle, cafe_name, and theme settings
- `data/kds-categories-export.csv` - Already has icon column with values

#### Phase 10.7: Testing & Polish
- [ ] Test on 1080p display
- [ ] Test on 4K display
- [ ] Verify text readability at 10+ feet
- [ ] Check image quality on large screens
- [ ] Fine-tune spacing and typography
- [ ] Test auto-refresh with new layout
- [ ] Verify all category icons render correctly

### Files to Create/Modify

**New files:**
- `public/images/kds/bg-wood-texture.jpg`
- `public/images/kds/icons/*.svg` (category icons)
- `public/images/kds/promo/*.jpg` (large footer images)
- `src/app/kds/kds-warm.css`
- `src/app/kds/components/KDSFlexGrid.tsx`
- `src/app/kds/components/KDSCategoryIcon.tsx`
- `src/app/kds/components/KDSCustomizeBar.tsx`
- `src/app/kds/components/KDSPromoFooter.tsx`
- `supabase/migrations/XXXXXX_add_kds_category_icon.sql`

**Modified files:**
- `src/app/kds/kds.css` (or replace with kds-warm.css)
- `src/app/kds/layout.tsx` (load script font)
- `src/app/kds/components/KDSHeader.tsx`
- `src/app/kds/components/KDSCategorySection.tsx`
- `src/app/kds/components/KDSMenuItem.tsx`
- `src/app/kds/drinks/page.tsx`
- `src/app/kds/food/page.tsx`
- `src/lib/kds/types.ts` (add icon field)
- `src/lib/kds/queries.ts` (include icon in queries)
- `scripts/import-kds-menu-from-sheets.js` (handle icon field)
- `data/kds-categories-template.csv` (add icon column)

### Dependencies

- Google Font: "Great Vibes" (or similar script font)
- Wood texture image (royalty-free or custom)
- Category icon SVGs (Lucide, Heroicons, or custom)
- Promotional photos (existing slideshow images can be cropped/resized)

### Estimated Effort

| Sub-phase | Tasks | Complexity |
|-----------|-------|------------|
| 10.1 Asset Preparation | Gather images, fonts, icons | Low |
| 10.2 Database Updates | Add icon column, migration | Low |
| 10.3 CSS Theme | New warm color scheme, typography | Medium |
| 10.4 Layout Components | New/updated components | Medium-High |
| 10.5 Page Updates | Wire up new components | Low |
| 10.6 Sheets Updates | Add columns, update import | Low |
| 10.7 Testing | Display testing, polish | Medium |

---

## Future Enhancements

- **Admin UI**: Manage KDS content from admin dashboard instead of Sheets
- **Real-time updates**: WebSocket push when Sheets changes
- **Multiple layouts**: Support different screen arrangements
- **Specials board**: Third screen for daily specials
- **QR code**: Display QR code linking to online ordering
- **Analytics**: Track which items are displayed most
- **Theme switcher**: Toggle between dark and warm themes from admin
