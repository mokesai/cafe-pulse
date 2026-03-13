# KDS Menu Wireframe Design Specification

Based on reference image: `data/cafe-menu-improved-example.jpeg`

---

## SCREEN 1: DRINKS (Left TV Panel)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ┌─────────┐                                                    ┌─────────┐ │
│ │ PRODUCT │      𝓛𝓲𝓽𝓽𝓵𝓮 𝓒𝓪𝓯𝓮́                                   │ PRODUCT │ │
│ │  IMAGE  │   ☕ Proudly Serving Starbucks®                     │  IMAGE  │ │
│ └─────────┘                                                    └─────────┘ │
│  (coffee)        Kaiser Permanente · Denver                      (coffee)  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────┐    ┌─────────────────────────────────┐│
│  │ ★ MOST POPULAR                  │    │                                 ││
│  │                                 │    │                                 ││
│  │  ● Latte (Hot or Iced)    [grn] │    │                                 ││
│  │  ● Vanilla Latte          [yel] │    │                                 ││
│  │  ● Caramel Macchiato      [org] │    │        ┌───────────────┐        ││
│  │  ● Cold Brew - Vanilla    [brn] │    │        │               │        ││
│  │      Sweet Cream                │    │        │   PRODUCT     │        ││
│  │  ● Pink Drink             [pnk] │    │        │   IMAGES      │        ││
│  │                                 │    │        │               │        ││
│  │  (NO PRICES IN THIS SECTION)    │    │        │  (Starbucks   │        ││
│  └─────────────────────────────────┘    │        │   drinks -    │        ││
│                                         │        │   iced coffee,│        ││
│  ┌─────────────────────────────────┐    │        │   frappuccino)│        ││
│  │ ☕ STARBUCKS ESPRESSO & COFFEE  │    │        │               │        ││
│  │                                 │    │        └───────────────┘        ││
│  │           Tall   GRANDE   Venti │    │                                 ││
│  │ ─────────────────────────────── │    │                                 ││
│  │ Caramel   $4.45   $4.95   $5.45 │    │                                 ││
│  │ Mocha     $4.95   $5.45   $5.45 │    └─────────────────────────────────┘│
│  │ Java Chip $4.95   $5.95   $5.95 │                                       │
│  │ White Chocolate                 │         Tall   GRANDE   Venti        │
│  │   Mocha   $5.25   $5.75   $6.25 │         $5.45                        │
│  │                                 │         $5.45                        │
│  └─────────────────────────────────┘         $5.95                        │
│                                              $6.25                        │
│  ┌─────────────────────────────────┐                                       │
│  │ 🥤 FRAPPUCCINOS                 │         Tall   GRANDE   Venti        │
│  │                                 │         $6.35                        │
│  │           Tall   GRANDE   Venti │         $6.45                        │
│  │ ─────────────────────────────── │         $6.25                        │
│  │ Caramel   $5.35   $5.85   $6.35 │                                       │
│  │ Java Chip $5.45   $5.75   $6.35 │                                       │
│  │ White Chocolate                 │                                       │
│  │   Mocha   $3.45   $5.75   $4.45 │                                       │
│  │                                 │                                       │
│  └─────────────────────────────────┘                                       │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐  ⏱ Next update:   │
│ │  PHOTO 1  │ │  PHOTO 2  │ │  PHOTO 3  │ │  PHOTO 4  │     4:59          │
│ │ (pastry)  │ │ (coffee)  │ │(croissant)│ │ (starbux) │                   │
│ └───────────┘ └───────────┘ └───────────┘ └───────────┘                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Screen 1 Layout Specifications:

| Section | Position | Display Type | Notes |
|---------|----------|--------------|-------|
| Header | Top | Custom | Script font "Little Café", Starbucks Siren + "Proudly Serving Starbucks®", product images L/R |
| MOST POPULAR | Top-Left | Featured list | Star icon, colored bullets, NO PRICES |
| ESPRESSO & COFFEE | Middle-Left | Price grid | 3 columns: Tall, GRANDE (bold), Venti |
| FRAPPUCCINOS | Bottom-Left | Price grid | 3 columns: Tall, GRANDE (bold), Venti |
| Product Images | Right side | Image panel | 2-3 Starbucks drink photos stacked |
| Photo Strip | Bottom | Rotating images | 4 product photos |

### Colored Bullets for MOST POPULAR:
- 🟢 Green: Latte
- 🟡 Yellow: Vanilla Latte
- 🟠 Orange: Caramel Macchiato
- 🟤 Brown: Cold Brew
- 🩷 Pink: Pink Drink

---

## SCREEN 2: FOOD & SPECIALTY DRINKS (Right TV Panel)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│                      LOTUS ENERGY DRINKS                                    │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────┐    ┌─────────────────────────────────┐│
│  │ Regular (Most Popular) – $6.45  │    │ 🍴 PERFECT WITH YOUR            ││
│  │                                 │    │    GRANDE COFFEE                ││
│  │ Most Popular Flavors:           │    │                                 ││
│  │  ● Blue Raspberry  ● Strawberry │    │  Breakfast Burrito      $6.95   ││
│  │       [blue]           [red]    │    │  Ham & Cheese Croissant $5.45   ││
│  │  ● Peach           ● Mango      │    │  Butter Croissant       $3.95   ││
│  │       [orange]         [yellow] │    │  Breakfast Sandwich            ││
│  │  ● Ocean                        │    │    (Egg & Cheese)       $5.45   ││
│  │       [teal]                    │    │  Blueberry Muffin       $3.95   ││
│  │                                 │    │  Chocolate Chip Cookie  $2.95   ││
│  └─────────────────────────────────┘    │  Empanada                       ││
│                                         │    (Beef or Chicken)    $4.95   ││
│  ┌─────────────────────────────────┐    │  Ice Cream Cup or Bar   $3.45   ││
│  │ 🥤 SMOOTHIES                    │    │                                 ││
│  │                                 │    └─────────────────────────────────┘│
│  │               Tall      Venti   │                                       │
│  │ ─────────────────────────────── │    ┌─────────────────────────────────┐│
│  │ Mango        $5.35      $3.95   │    │                                 ││
│  │ Strawberry   $5.95      $6.45   │    │        ┌───────────────┐        ││
│  │                                 │    │        │               │        ││
│  └─────────────────────────────────┘    │        │   PRODUCT     │        ││
│                                         │        │   IMAGES      │        ││
│  ┌─────────────────────────────────┐    │        │               │        ││
│  │ ❤️ OTHER FAVORITES              │    │        │ (Energy drinks│        ││
│  │                                 │    │        │  in colorful  │        ││
│  │              Serene     Venti   │    │        │  cups, food)  │        ││
│  │ ─────────────────────────────── │    │        │               │        ││
│  │ Hot Chocolate  $3.35    $3.75   │    │        └───────────────┘        ││
│  │ White Hot                       │    │                                 ││
│  │   Chocolate    $3.45    $3.95   │    │                                 ││
│  │ Steamed Milk   $2.95    $3.95   │    │                                 ││
│  │                                 │    │                                 ││
│  └─────────────────────────────────┘    └─────────────────────────────────┘│
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐  ⏱ Next update:   │
│ │  PHOTO 1  │ │  PHOTO 2  │ │  PHOTO 3  │ │  PHOTO 4  │     4:59          │
│ │ (muffin)  │ │ (drinks)  │ │(croissant)│ │ (cookies) │                   │
│ └───────────┘ └───────────┘ └───────────┘ └───────────┘                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Screen 2 Layout Specifications:

| Section | Position | Display Type | Notes |
|---------|----------|--------------|-------|
| Header Banner | Top | Bold text | "LOTUS ENERGY DRINKS" (large, centered) |
| Lotus Energy | Top-Left | Single price + flavors | Price in header, colored bullet flavors below |
| SMOOTHIES | Middle-Left | Price grid | 2 columns: Tall, Venti |
| OTHER FAVORITES | Bottom-Left | Price grid | 2 columns: Serene, Venti |
| PERFECT WITH YOUR GRANDE COFFEE | Right column | Simple list | Item name + single price |
| Product Images | Bottom-Right | Image panel | Energy drinks, pastries |
| Photo Strip | Bottom | Rotating images | 4 product photos |

### Colored Bullets for Lotus Flavors:
- 🔵 Blue: Blue Raspberry
- 🔴 Red: Strawberry
- 🟠 Orange: Peach
- 🟡 Yellow: Mango
- 🩵 Teal: Ocean

---

## Display Type Summary

| Type | Description | Price Display | Used In |
|------|-------------|---------------|---------|
| `featured` | Highlighted items with colored bullets | NO prices | Most Popular |
| `price-grid` | Table with size columns | Tall/Grande/Venti columns | Espresso, Frappuccinos, Smoothies |
| `single-price` | One price in header | Price in category header | Lotus Energy |
| `flavor-options` | Colored bullet grid | NO prices (inherit from parent) | Lotus Flavors |
| `simple-list` | Item + price per line | Single price per item | Food Pairings |

---

## Key Design Requirements

### Screen 1 (Drinks):
1. Header must include Starbucks Siren logo with "Proudly Serving Starbucks®" (WPS requirement)
2. "MOST POPULAR" section has NO prices - just names with colored bullets
3. GRANDE column should be visually emphasized (bold or larger)
4. Product images on right side, not dominating the layout

### Screen 2 (Food & Specialty):
1. Banner is "LOTUS ENERGY DRINKS" (not "Little Café")
2. Lotus price shown ONCE in section header ("Regular (Most Popular) – $6.45")
3. Flavors listed with colored bullets, no individual prices
4. Food section uses simple list format (name + price)
5. "Serene" size label used instead of "Tall" for hot drinks

### Both Screens:
1. Warm tan/brown color scheme
2. Photo strip at bottom (4 rotating images)
3. Refresh indicator in corner
4. Compact layout - maximize menu items, minimize wasted space
