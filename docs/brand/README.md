# Brand kit — "Rank Signal" (Live Model Test logo, v1)

Owner-supplied source artwork (SVG; text converted to shapes). Three ascending bars and a
live gold dot; the tallest bar and the dot form the "i" of LIVE.

| File | Used for |
| --- | --- |
| `lockup-horizontal.svg` | Website header/footer, Admin Panel sidebar/login (served copies in `web/public/brand/` and `admin/public/brand/` have the empty border trimmed from the viewBox) |
| `lockup-vertical.svg` | Mobile App login and language screens (`mobile/assets/images/logo-lockup.png`) |
| `icon-color.svg` | Favicons, collapsed sidebar, splash screen, `logo-mark.png` |
| `app-icon-1024.svg` | App icon, Apple touch icons, Android adaptive icon (background + foreground) |
| `icon-mono-*.svg`, `lockup-*-mono-*.svg`, `*-dark.svg` | One-colour and dark-background versions (not used yet) |

Palette: Royal Blue `#1250E4` · Electric Cyan `#25CCF6` · Deep Navy `#0A2A8F` ·
Ink `#0A1235` · Signal Gold `#F4B829`.

PNG files in the apps are rendered from these SVGs; to change the logo, replace the SVGs
and re-render the PNGs at the same sizes.
