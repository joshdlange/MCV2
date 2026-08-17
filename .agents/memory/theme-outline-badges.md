---
name: Dark-root theme vs white cards
description: Why text-foreground is invisible on cards; badge outline fix
---
- The app theme is dark at `:root` (`--foreground` ≈ white) but `--card` is white with dark `--card-foreground`. Any component styled with `text-foreground` that renders on a card is white-on-white (invisible).
- Fixed globally in `badge.tsx`: outline variant uses `text-card-foreground border-gray-300`.
- **How to apply:** on light cards, never rely on `text-foreground`/theme defaults for text color — use explicit grays or `text-card-foreground`. Check new shadcn components for the same trap.
