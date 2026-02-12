# KDS Images Configuration

This directory contains cafe-specific images for the Kitchen Display System (KDS). These images are **not committed to the repository** and must be configured for each deployment.

## Required Directory Structure

```
public/images/kds/
├── README.md              # This file (committed)
├── bg-wood-texture.svg    # Background texture for warm theme
│
├── header/                # Header images (left/right of logo)
│   ├── espresso.jpeg      # Left header image (drinks screen)
│   ├── croissant.jpg      # Right header image (drinks screen)
│   ├── muffins-plate.jpg  # Left header image (food screen)
│   ├── pastries-plate.jpeg # Right header image (food screen)
│   └── starbucks-logo.png # Optional subtitle logo
│
├── icons/                 # Category icons (SVG format)
│   ├── breakfast.svg
│   ├── chocolate.svg
│   ├── coffee.svg
│   ├── cookie.svg
│   ├── croissant.svg
│   ├── customize.svg
│   ├── danish.svg
│   ├── frappuccino.svg
│   ├── ice-cream.svg
│   ├── iced-drink.svg
│   ├── lotus.svg
│   ├── sandwich.svg
│   └── tea.svg
│
├── photos/                # Promotional photos for photo strip
│   ├── burritos/          # Breakfast burrito photos
│   ├── coffee/            # Coffee drink photos
│   ├── croissants/        # Croissant/pastry photos
│   ├── frappuccinos/      # Blended drink photos
│   └── muffins/           # Muffin/bakery photos
│
├── drinks/                # Footer images for drinks screen (legacy)
│   ├── espresso-pour.png
│   ├── latte-art.png
│   ├── iced-coffee.png
│   └── frappuccino.png
│
├── food/                  # Footer images for food screen (legacy)
│   ├── breakfast-burrito.png
│   ├── croissant.png
│   ├── danish.png
│   └── sandwich.png
│
└── promo/                 # Large promotional banners
    ├── drinks-banner.png
    └── food-banner.png
```

## Image Specifications

### Header Images
- **Size**: 200x200px recommended
- **Format**: JPEG, PNG, or WebP
- **Usage**: Displayed in corners of the KDS header

### Category Icons
- **Size**: 24x24px viewBox (scalable SVG)
- **Format**: SVG only
- **Colors**: Should use `currentColor` for theming
- **Usage**: Displayed next to category headers

### Photo Strip Images
- **Size**: 400x300px minimum, landscape orientation
- **Format**: JPEG, PNG, or WebP
- **Usage**: Rotating promotional images at bottom of screen

### Background Texture
- **Format**: SVG (for scalability)
- **Usage**: Tiled background for warm theme

## Configuration

Images are referenced in:

1. **Page components** (`src/app/admin/(kds)/kds/*/page.tsx`):
   ```typescript
   const HEADER_IMAGES = {
     left: '/images/kds/header/espresso.jpeg',
     right: '/images/kds/header/croissant.jpg',
     subtitleLogo: '/images/kds/header/starbucks-logo.png',
   }
   ```

2. **Photos library** (`src/lib/kds/photos.ts`):
   - Configure photo categories and paths

3. **CSS theme** (`src/app/kds/kds-warm.css`):
   ```css
   --kds-bg-texture: url('/images/kds/bg-wood-texture.svg');
   ```

4. **Database** (`kds_images` table):
   - Footer image filenames stored in database

## Setup for New Deployment

1. Create the directory structure above
2. Add your cafe's images
3. Update page components with correct paths
4. Update `src/lib/kds/photos.ts` with your photo categories
5. Import images to database: `npm run import-kds-menu -- --local --images`
