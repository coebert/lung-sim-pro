
# ICU Vent Sim — Design & UX Review

Below is an honest appraisal from an app-development + clinical-UX perspective, followed by a phased plan. I captured screenshots at desktop (1440×900), phone portrait (390×844) and phone landscape (844×390) to ground the critique.

---

## 1. What already works well

- **Domain-appropriate aesthetic.** Dark monitor-style background, tabular monospace numerals, saturated waveform colours — this reads like a real ICU bedside device, which is exactly right for training.
- **Semantic token system.** `index.css` + `tailwind.config.ts` + `src/lib/theme.ts` are well factored; canvas/SVG mirror the CSS HSL tokens in one place.
- **Responsive scaffolding.** Three distinct layouts (desktop / mobile-portrait / mobile-landscape) via `useLayoutMode`, plus a bottom-nav + overlay pattern on phones. This is the right architecture.
- **Solid engineering hygiene** underneath: strictNullChecks on, golden-file tests, discriminated-union mode tests, CI.

## 2. Problems, grouped by severity

### Critical — hurts usability or clinical realism

1. **Waveforms look flat / clipped on first load.** In the desktop shot, PIP is 10 but the Paw trace is a barely-visible baseline; the axis reads 40 at top, so a 10-cmH₂O peak occupies only 25 % of the pane. Volume is pinned at the bottom (600 mL scale for a 500 mL breath is fine, but the trace touches the bottom edge). **Auto-ranging or better default y-scales per waveform** is needed — real ventilators use fixed clinical scales (Paw 0–40, Flow ±60, Volume 0–800) but *center* zero for flow, and the scale labels shouldn't overlap the trace.
2. **Numeric readouts overlap the waveform.** Right-edge labels ("HR 72", "ABP 120/75", "SpO₂ 99", "EtCO₂ 5.1") sit *on top of* the trace and axis numbers ("2", "0", "20"). This is the single biggest visual defect. Real monitors put big numerics in a separate right-hand column with its own background.
3. **Alarm banner is generic and static.** "ALARM Low VTe (<200)" is amber, non-dismissible, doesn't flash, doesn't say the actual value, has no priority tier (ISO 60601-1-8 uses high=red/flashing, medium=amber/slow-flash, low=cyan/steady), no acknowledge action, and the speaker icon is decorative. For a teaching tool this is a missed learning moment.
4. **Mobile landscape hides the header entirely** (including Freeze / Prone / Tutorial / vitals bar). On a phone in landscape you can see waveforms but can't pause, can't see HR/BP/SpO₂ numerically, and can't reach the header controls at all. Vitals should always be visible; controls belong in the bottom nav.
5. **Mobile portrait ventilator pane is unreadable.** Only 4 numerics fit (PIP/PEEP/PMEAN/VTE) and the traces are ~120 px tall with axis labels overlapping. MV, Cdyn, and mode indicator disappear. Users can't tell which mode is active on a phone without opening the Settings overlay.
6. **Patient selector eats a full row on desktop** for six static cards that are rarely changed after setup. It dominates the bottom of the screen but is essentially a one-time picker.

### Warning — degrades experience

7. **Header density and hierarchy.** Icon-only Play/Pause, GraduationCap, RotateCcw sit next to a pulsing green dot and an H1 that also carries FROZEN/TUTORIAL badges. Nothing is grouped; the title, mode, patient summary and vital-value bar all fight for the same strip. No visual separation between "app chrome" and "clinical status".
8. **Font stack is monospace *everywhere*.** JetBrains Mono is right for numerics and waveform labels, but body copy, buttons, tutorial prose and clinical feedback text all in mono makes reading tiring and gives the whole app a "terminal" feel rather than a device+dashboard feel. Real monitors pair a sans (Frutiger/Roboto Condensed) for labels with mono/tabular for values.
9. **Colour semantics are inconsistent.** Primary blue (`210 100% 50%`) is used both for "active tab" and for "danger toggle" (Prone button turns primary-blue when active — which reads as "informational" not "physiologic intervention"). Alarm banner amber is unrelated to any token. There is no `--warning` / `--success` / `--info` triad.
10. **Ventilator controls are numeric steppers only.** Real ventilators use a rotary encoder metaphor; here we have `- 5 +` boxes. No long-press acceleration, no keyboard shortcuts (arrow keys/PgUp), no undo, no "confirm change" — a trainee can silently drop PEEP to 0.
11. **Tap targets.** On mobile the bottom-nav buttons are ~44 px tall in portrait but only ~24 px in landscape (`py-0.5`). Below the 44×44 WCAG minimum. Stepper `-/+` buttons on the controls are also small.
12. **No focus-visible styles** beyond shadcn defaults on custom `<button>`s in `Index.tsx`, `MobileShell.tsx`. Keyboard nav is possible but invisible.
13. **`h-screen` is used** on the root container. On iOS Safari with the URL bar, this overflows. Should be `h-dvh`.
14. **Clinical feedback panel** (`ClinicalFeedback.tsx`, 276 LOC) mixes green/amber/red pills but every entry appears equally weighted — no ordering by severity, no expand/collapse of resolved items, no link back to *which control* to adjust.
15. **Lung animation panel** is 946 LOC and heavy; on desktop it competes with the vitals column, and on mobile portrait it's rendered at 120 px wide, where the anatomical detail is illegible.
16. **Tutorial mode** is not discoverable — a graduation-cap icon in the top-left. New users won't find it. Also, entering tutorial replaces the right-hand column entirely, so trainees lose the lung animation and clinical feedback while learning — the opposite of what they need.

### Info — polish / craft

17. Author credit uses `text-[8px]` — below legibility threshold; should be `text-[10px] opacity-60` or moved into an About dialog.
18. Waveform grid lines (`--monitor-grid`) are barely visible; real monitors show ~1 s / 5 mm grid to help time measurement.
19. No unit toggle (mmHg ↔ kPa is fixed per channel: ABP in mmHg, CO₂ in kPa — inconsistent).
20. Six patient cards use inconsistent naming ("ARDS Patient" vs "Spontaneously Breathing (Inadequate)"); no icon, no severity colour.
21. No dark/light toggle — fine for an ICU sim, but the semantic tokens are already there so it's ~1 hour of work if wanted.
22. No empty-state / onboarding — first-time user lands on Healthy Adult + VCV with no hint of what to try.
23. `App.css` still has the Vite template `#root { max-width: 1280px; margin: 0 auto; padding: 2rem; }` — this contradicts the full-bleed layout and only doesn't break because `Index.tsx` uses `h-screen` on its own root inside. Dead CSS that will bite later.
24. `index.html` `<title>` / `<meta description>` should be checked against the "not Lovable App" rule.

---

## 3. Improvement plan (phased)

Ordered so each phase is independently shippable and each builds on the last.

### Phase 1 — Fix what's broken (half-day)

- Move monitor numerics into a **dedicated right-hand column** per waveform lane (label above, big value below, alarm limits under). No more overlay on the trace.
- Replace `h-screen` → `h-dvh` in `Index.tsx` root.
- Delete Vite boilerplate from `App.css`.
- Set proper waveform y-scales: Paw 0–40 with 10-cmH₂O gridlines, Flow ±60 centered, Volume 0–800; draw the grid at 1 s spacing with visible-but-subtle `--monitor-grid` (bump lightness ~4 %).
- Show vitals bar in mobile-landscape header (collapse title to just the pulse dot).
- Make bottom-nav buttons min 44 px tall in both orientations.
- Add visible `focus-visible:ring-2 ring-ring` to all custom `<button>`s in `Index.tsx` and `MobileShell.tsx`.

### Phase 2 — Alarm system worthy of the domain (1 day)

- Introduce a `Priority = 'high' | 'medium' | 'low' | 'info'` type in `alarms.ts`.
- Tokens: `--alarm-high` (red 0 84 55, flashing 2 Hz), `--alarm-medium` (amber 40 100 55, flashing 0.5 Hz), `--alarm-low` (cyan 190 80 55, steady), following IEC 60601-1-8.
- `AlarmBanner` becomes a stack; each row shows priority chip, parameter, actual value vs limit, timestamp, and an Acknowledge / Silence 2 min button. Speaker icon actually toggles audio (Web Audio short beep patterns per priority).
- Alarm limits become editable per-parameter via a long-press on the numeric readout.

### Phase 3 — Typography + colour discipline (half-day)

- Add a sans (Inter or IBM Plex Sans, condensed weight for labels) for body/UI; keep JetBrains Mono only for numerics and axis labels. Wire via `body { font-family: sans }` + `.monitor-text { font-family: mono }`.
- Define semantic tokens: `--success`, `--warning`, `--danger`, `--info` and stop overloading `--primary` for the Prone toggle (use `--warning` — prone is a significant physiologic change).
- Add `--grid-strong` / `--grid-weak` and use them in `WaveformCanvas`.

### Phase 4 — Ergonomics of controls (1 day)

- Steppers gain: long-press auto-repeat with acceleration, keyboard `ArrowUp/Down` (±1) and `PgUp/PgDn` (±5), and a subtle "changed" pulse.
- Global keyboard shortcuts: `Space` = freeze, `P` = prone, `T` = tutorial, `1–6` = patient. Show a `?` overlay listing them.
- Add an **undo toast** ("PEEP 5 → 3 · Undo") for any control change, 6 s.
- Collapse Patient selector into a header dropdown ("Patient: Healthy Adult ▾") and reclaim the bottom row for a compact **trend strip** (last 5 min of SpO₂, MAP, EtCO₂).

### Phase 5 — Mobile that actually teaches (1 day)

- Portrait: show mode + PIP/PEEP/VTE/MV/Cdyn in a 2×3 mini-grid using auto-fit; drop the tiny lung animation on portrait (move it behind a "Lung" chip in the vitals bar).
- Landscape: dedicate one lane per waveform (Paw, Flow, Volume, ECG, Pleth, CO₂) at reduced height with the right-column numerics from Phase 1.
- Tutorial in a bottom sheet, not a full column replacement — trainee keeps seeing the waveforms they're learning about.
- Set `preview_ui--set_preview_device_viewport` to mobile when the user asks for mobile review; verify with Playwright at 390×844 and 844×390 after each phase.

### Phase 6 — Onboarding + polish (half-day)

- First-visit modal: "Pick a patient → try changing PEEP → open Tutorial". Persist dismissal in `localStorage`.
- Patient cards: add a severity colour bar (green→red) and an icon per pathology.
- Author credit → "About" dialog (accessible via a small `i` icon in the header) at legible 12 px.
- Set proper `<title>` / `<meta description>` / og tags in `index.html` if not already ICU-Sim-specific.
- Add `prefers-reduced-motion` guard around waveform pulse dot and any future alarm flashing.

---

## 4. Technical notes (for the developer, not the trainee)

- `WaveformCanvas.tsx` is the right place to introduce per-lane `yMin/yMax/gridStep` props; today the scales look implicit.
- `LungAnimation.tsx` at 946 LOC should be split (chest wall, lungs, secretions, labels) — currently one of the largest files.
- `ClinicalFeedback.tsx` and `TutorialPanel.tsx` both re-derive advice from `settings/patient/vitals`; extract a `useClinicalAdvice(settings, patient, vitals)` hook so tutorial and feedback stay in sync.
- Add `WaveformCanvas` snapshot tests (already have engine golden files; render layer has none) via a small canvas mock.
- Consider a Zustand slice for `layout` (frozen, prone, tutorialActive, mobileOverlay, lungCollapsed) — currently spread across `Index.tsx` local state and `simulationStore`.

---

## 5. Suggested execution order

If you want to ship visible wins fastest: **Phase 1 → Phase 3 → Phase 2 → Phase 5 → Phase 4 → Phase 6**. Phase 1 alone will make the app look substantially more professional.

Tell me which phase(s) to start on, or say "do Phase 1" and I'll implement it directly.
