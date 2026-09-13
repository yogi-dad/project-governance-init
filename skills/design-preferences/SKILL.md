---
name: design-preferences
description: Establish a visual direction before building or changing web and mobile interfaces. Use when UI work needs choices about surfaces, density, typography, color, motion, responsive behavior, or accessibility.
---

# Design preferences

Ask for the design direction before choosing components or writing styles. Record decisions in the project governance file or design notes.

## Intake

Ask the user to choose or describe:

- Visual language: glass/translucent, flat, editorial, tactile, dense, minimal, or another reference.
- Surface treatment: solid, translucent, bordered, elevated, or mixed. Use glass only when contrast, performance, and readability remain strong.
- Density and rhythm: compact, comfortable, or spacious.
- Type: existing brand fonts, system fonts, or a new pairing; include size and line-height expectations.
- Color: existing tokens, light/dark behavior, contrast requirements, and semantic states.
- Motion: none, subtle transitions, or expressive motion; respect reduced-motion settings.
- Responsive targets: smallest supported viewport, touch targets, keyboard use, and orientation changes.

If the user has no preference, propose one direction with a short rationale and wait for approval before committing to it.

## Build rules

- Reuse the repository's tokens and components before adding new ones.
- Prefer semantic HTML or platform controls and visible focus states.
- Check contrast, keyboard navigation, screen-reader names, loading, empty, error, and disabled states.
- Test the real browser or device at the smallest and largest supported sizes.
- Keep decorative effects from hiding content or increasing motion, memory, or load cost.
