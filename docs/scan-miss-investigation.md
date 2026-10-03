# DEV scan misses — investigation, 2026-10-03

No model, embeddings, frozen index or catalog images were changed.

## Magneto #62, 1995 Fleer Marvel Masterpieces (19222)

- The reference exists, downloads, and is present in the frozen index. Missing
  image/index coverage is **ruled out**.
- It shows a single Magneto card, not an obvious wrong character or montage.
  However, it is only **240×160**, with the portrait card occupying roughly half
  the landscape frame and substantial background. This is a weak reference.
- The phone scan's saved rank was 39. Its top five included Magneto #164
  (2023 Platinum, two parallels), Magneto CM-MU-07 (2025 Cosmos), Magneto #36
  (2015 Retro), and Grim Reaper #25 (2016 Annual).
- This shows competing visual matches, **not proof that they share the exact
  artwork**. Reference framing/resolution is a plausible contributor, not a
  demonstrated causal explanation.
- The original phone photo and query vector were not retained under the
  photo-consent rules. Glare, blur, framing, and photo condition therefore cannot
  be examined or ruled out. A definitive cause needs the original query and a
  controlled same-model comparison with an approved better reference.
- Not suppressed: the reference is weak, but not established as incorrect.

## Colossus #11, 2008 Upper Deck Masterpieces Set 2 (22723)

Downloaded and visually confirmed the current **240×108 three-card montage**.
This is not a clean single-card reference. Added its exact image URL to the
bad-image list and suppressed its DEV recognition result until replaced with
a different approved URL and fresh vector. It remains manually searchable.
No replacement, crop, re-embedding, or ranking improvement is claimed.

## Darkhawk's mislabeled competitors

Visually confirmed Darkhawk images on Medusa 198004 and 198094, plus Jean Grey
198184 and 198201—the other misleading entries in that scan's saved top five.
All four are flagged and suppressed from DEV rankings and expanded options.
They remain available in manual search; no catalog identities were rewritten.

The suppression source is `docs/scan-bad-images.md`, read at DEV startup.
Changing a URL alone cannot revive stale frozen vectors. An approved replacement
with a different URL and valid override embedding can restore the card.