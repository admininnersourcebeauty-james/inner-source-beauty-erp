# Inner Source Beauty — Shopify Homepage Theme

Luxury skincare homepage rebuilt to match the INNER SOURCE BEAUTY reference design.

## Upload

1. Zip the `shopify-theme` folder contents (not the folder itself).
2. In Shopify Admin → **Online Store → Themes → Add theme → Upload zip**.
3. Publish when ready.

## Merge into existing theme

If you already have a live theme and only want the homepage:

1. Copy these into your existing theme:
   - `sections/isb-*.liquid`
   - `snippets/isb-*.liquid`
   - `assets/isb-base.css`, `assets/isb-home.css`, `assets/isb-home.js`
2. Replace `templates/index.json` with the one in this package (or add ISB sections via Theme Editor).
3. Update `sections/header-group.json` to use `isb-announcement-bar` and `isb-header`, or add those sections manually.
4. Add font links from `layout/theme.liquid` if not already present.

## Theme Editor — where to edit each section

| Section | Location in Theme Editor |
|---------|--------------------------|
| Announcement bar | **Header → ISB Announcement bar** — announcement text |
| Header / navigation | **Header → ISB Header** — logo override, main menu, sticky toggle |
| Logo (global) | **Theme settings → Brand** — logo, logo width, favicon |
| Hero | **Homepage → ISB Hero** — eyebrow, heading, body, button, hero image |
| Benefits | **Homepage → ISB Benefits** — 4 benefit blocks (icon, title, description) |
| Best Sellers | **Homepage → ISB Best Sellers** — heading, view-all link, collection; or add **Product** blocks to hand-pick 4 products |
| Our Story | **Homepage → ISB Our Story** — eyebrow, heading, body, button, image |
| Testimonials | **Homepage → ISB Testimonials** — heading; add/edit **Testimonial** blocks |
| Footer note | **Footer → ISB Footer** — footer note text |

## Product pages / cart

Product and cart templates use minimal functional sections (`main-product`, `main-cart`) — not styled with the homepage design. Cart uses native Shopify form POST to `/cart` and checkout.

## Menu setup

Create a navigation menu in **Online Store → Navigation** (e.g. `main-menu`) with:

- SHOP (with sub-links)
- BEST SELLERS
- ABOUT US
- JOURNAL
- CONTACT

Assign it in **ISB Header → Main menu**.
