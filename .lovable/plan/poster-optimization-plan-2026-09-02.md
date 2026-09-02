# Poster optimization plan

## Design diagnosis

The current version should not be patched further. It has been produced through successive raster overlays, so edits no longer share a common grid or typography scale.

- **Header hierarchy has collapsed:** the title is approximately 19 pt at A1, far too small for a conference poster, while most of the header is unused dark space.
- **Typography is inconsistent:** newly added Methods text is approximately 7 pt, whereas older section copy is much larger. Captions, chips, statistics and footer details vary without a coherent scale.
- **The layout is visibly broken:** Methods extends across and over the right column; its replacement rectangle obscures existing content; section numbering and text from older layers remain visible underneath.
- **Vertical rhythm is weak:** panel tops and baselines do not align, internal padding varies, and the statistics strip interrupts content instead of anchoring it.
- **The main visual is undersized:** genuine simulator screenshots are present, but they are too small to communicate the product at viewing distance.
- **Content cleanup is incomplete:** superseded phrases such as “zero-cost” and “to use, forever” remain visible in the flattened source and must be removed at source level.
- **Footer density is excessive:** references, QR labels, conference details and disclaimer compete in a shallow band.

## Recommended visual direction

Use a **clinical editorial / scientific-instrument** direction: dark navy field, cyan structural accents, white text, restrained blue panels, and generous whitespace. Preserve the app’s monitor aesthetic, but make the poster read like a rigorously designed academic communication rather than an enlarged interface.

## Phase 1 — Rebuild a true master layout

- Recreate the poster from a blank A1 landscape canvas at 300 dpi rather than editing `poster-v8.png`.
- Define one coordinate system with outer margins, a 12-column grid, consistent gutters and reusable section components.
- Keep every text block, image, chip, rule and QR code as a separately positioned source element until final export.
- Add automated bounds checks so no object can cross its assigned panel or page margin.

## Phase 2 — Restore hierarchy and spacing

Use four deliberate horizontal zones:

1. **Header, 17–19% of height:** conference identifier, title, product name, author/affiliation and a concise AI-assisted-development statement.
2. **Main narrative, 55–58%:** three aligned columns with the simulator as the dominant central visual.
3. **Evidence strip, 8–10%:** five evenly spaced statistics, with no duplicated or promotional claim.
4. **Take-home and access footer, 15–17%:** take-home message, QR codes, references and event/disclaimer line.

Recommended main grid:

- Left column, 27%: Background + Objectives.
- Centre column, 44%: large simulator screenshot, two supporting screenshots, concise feature/evidence labels.
- Right column, 29%: Methods + Results + Conclusions.
- Use equal gutters and consistent 8–12 mm panel padding. Align every section heading and panel edge to the grid.

## Phase 3 — Apply an A1 typography system

Target sizes measured at final A1 output:

- Title: **72–84 pt**, maximum three balanced lines.
- Product subtitle: **34–40 pt**.
- Author: **24–28 pt**; affiliation: **20–22 pt**.
- Section headings: **30–34 pt**.
- Body copy: **22–25 pt**, 1.2–1.3 line spacing.
- Figure captions and chips: **18–20 pt**.
- Statistics: **44–54 pt** values and **17–19 pt** labels.
- References/footer: **16–18 pt minimum**.

Use Inter for prose and JetBrains Mono only for numerical statistics or monitor-style labels. Avoid pills for long sentences; present the “vibe-coding” point as a short highlighted statement with normal line wrapping.

## Phase 4 — Edit and rebalance content

- Make the new title the clear first read: **“From clinician to creator: AI-assisted development of a ventilator simulation app.”**
- Reduce the header statement to one sentence: **“Built by an intensive care clinician with no prior programming background using AI-assisted ‘vibe-coding’.”**
- Tighten each main section to roughly 45–80 words; use bullets only where they improve scanning.
- Give the lowered barrier to clinician-led development explicit prominence in Methods and Conclusions without repeating the same wording.
- Keep claims precise: currently free to access, browser-based, no install; make no “free forever” or “zero-cost” claim.
- Retain 1–2 abbreviated references with DOI or short URLs and ensure claims about APRV, prone positioning and validation remain appropriately qualified.

## Phase 5 — Strengthen imagery and access elements

- Enlarge the main simulator screenshot enough for waveform and control structure to be recognizable from 1–1.5 m.
- Use two supporting screenshots at identical aspect ratio and size, with one-line captions.
- Crop screenshots deliberately around relevant UI; avoid tiny full-screen replicas.
- Keep each QR code at least 32–35 mm square with a white quiet zone, short human-readable URL and clear action label.
- Test both QR codes from the final PDF rendering, not only from the source PNG.

## Phase 6 — Accessibility and production QA

- Maintain at least WCAG AA contrast for all text, aiming for 7:1 for body copy and labels.
- Confirm minimum font sizes from PDF geometry rather than relying on pixel appearance.
- Export a print-ready A1 PDF and a separate screen preview; embed fonts and preserve 300 dpi imagery.
- Rasterize the final PDF and inspect the full page plus header, each column, statistics strip, QR area and footer at 100%.
- Run automated checks for overlap, clipping, margin violations and forbidden wording.
- Scan both QR codes from the rasterized PDF and verify their exact destinations.
- Review at three scales: thumbnail for hierarchy, projector-sized preview for contrast, and 100% crop for typography and image quality.

## Acceptance criteria

- All sections are visible, aligned and contained with no overwritten or residual text.
- The title is immediately legible and dominant at poster-thumbnail scale.
- Body text is comfortably readable at approximately 1–1.5 m on an A1 print.
- The simulator is the dominant visual, while the AI-assisted clinician-creator narrative is the dominant conceptual message.
- No “free forever,” “zero-cost,” or equivalent claim remains.
- Both QR codes decode from the final PDF and lead to the intended URLs.
- Final deliverables include a versioned A1 PDF, full-resolution PNG and review preview.
