# Poster roadmap

- [x] Add author credit to poster
- [x] Remove "Free to use forever" claim from stat strip
- [x] Remove "zero cost" wording from conclusions
- [x] Emphasize AI-assisted "vibe-coding" / clinician-without-programming-background narrative on poster
- [x] Update poster title to "From clinician to creator: AI-assisted development of a ventilator simulation app"


- [x] Rebuild poster from a clean A1 master using the approved graphic-design optimization plan
- [x] Remove the top-right "Academic poster" label and footer references
- [x] Verify both QR codes from the final rendered PDF
- [x] Rewrite Results section: successful build, team reception, Salisbury course adoption (poster v11)

# Opus bug check #2 (Oct 2026)
- [x] Quick fixes: Space/keys on focused buttons, alarm re-sounds on new alarm + 2-min silence cap, apnoea alarm, audio unlock, Ti capped to breath cycle, APRV NaN guards, APRV tutorial selectable, tutorial targets match text
- [x] Clinical: PSV apnoea in paralysed patients, healthy-lung oxygenation, mL/kg on predicted body weight, PCV/PRVC pressure (auto-PEEP lowers VT not raises PIP), FiO₂ advice only when desaturated, 10 s measurement window
- [x] Model-derived plateau pressure + auto-PEEP, airway pressure = PEEP in expiration, auto-PEEP lowers BP, SIMV full mandatory rate
- [x] Shared cardiac phase (ECG/ABP/pleth sync)

# Standalone ventilator view
- [x] Add a full three-trace ventilator page matching the bedside screen, with shared settings and navigation
- [x] Verify live traces, freeze/resume, mode changes and return navigation

# Bedside capnogram
- [x] Add a live CO₂ trace matching the simulator and EtCO₂ reading
- [x] Verify live changes, freeze/resume and phone layout

# Bedside live respiratory traces
- [x] Show pressure, flow and volume together using shared live simulation data
- [x] Verify motion, settings changes, freeze/resume and phone layout

# Breath-synchronized capnography
- [x] Model dead-space washout, expiratory upstroke, alveolar plateau and inspiratory downstroke
- [x] Test mode timing, obstructive shape and absent ventilation; verify the live phone display

# Apple App Store release (paid download, iPhone + iPad)
- [x] Add Capacitor native wrapper config
- [x] Offline fonts, onboarding touch tips, "education only" notice
- [x] iPad layout check (upright iPad uses stacked touch layout)
- [x] Physiology review of all six patients
- [x] More patient cases (COPD, asthma, sepsis, paediatric; obesity existed)
- [x] Guided scenarios with scoring and debrief (tutorials for every patient except healthy self-ventilating)
- [x] Learning content for each mode, waveform and alarm (/learn)
- [x] Release packaging: offline bundled config, ios:prepare workflow, iOS project generated, safe-area insets, docs/IOS_RELEASE.md
- [x] Brand name fix, split preflight/strict iOS checks with regression tests
- [x] App icon in iOS asset catalog (master: resources/app-icon-1024.png); signing team set
- [x] Mobile tutorial keeps progress across panel switches
- [x] Support and privacy pages (/support, /privacy) linked from About
- [ ] Owner review of support/privacy text, then publish for public URLs
- [ ] Store assets: screenshots, description (blocked: needs Rob's input/approval)
- [ ] Build & submit via Xcode (blocked: done by Rob on his Mac)

# Physiology & tutorial audit (18 Nov 2026)
- [x] 1 Closed-form periodic RC pressure breaths + PRVC targeting
- [x] 2 APRV gas exchange from delivered release ventilation; apnoea handling
- [x] 3 Paediatric weight-based defaults, TV range, PBW-based alarm limit, tutorial reorder
- [x] 4 Tutorial mode binding, fresh-breath checks, O₂ upper bounds, invalidated-step notice
- [x] 5 PCV rise forwarded; stored timing basis; applied Ti/Te readouts with limit warning; asthma text
- [x] 6 Breath-based MV/RR, per-breath mandatory/supported VT, residual volume carried in SIMV; event-timed scheduler (2ce0284); SIMV mandatory slots due at k·60/RR from t=0 with a 25%/≤5 s sync window — RR4 no longer skips the first slot (tested RR4–14, live no-apnoea)
- [x] 7 Patient effort in PSV/SIMV support; APRV spontaneous effort in the shared lung model (2ce0284); P Low can no longer exceed P High (legacy inverted settings = CPAP at P High on every path, tested 5–10 × P Low ≥ P High, both patient types)
- [x] 8 Apnoea from time since last breath (20 s); last complete breath retained
- [x] 9 APRV single trajectory + end-release flow readout
- [x] 10 PRVC Pmax/PEEP conflict and target-not-reached alarms
- [x] 11 Alveolar-ventilation CO₂, sampled EtCO₂ with plateau status, plateau-based SpO₂ penalty
- [x] 12 Wording (ARDSNet pH, APRV), PBW, model-derived Pplat, warm-up/apnoea feedback, scoring, spontaneous tutorial; ARDSNet plateau ≤30 stated as simulation objective with severe-acidaemia caveat; stale 'not simulated' lesson text removed; missed-trigger feedback separates effort / ventilator / total rates
- [x] 11 follow-up: dead space split into anatomical 2.2 mL/kg PBW + apparatus 0 mL; VCO₂ implied by normocapnia at reference VA; one assumption shared by gas model and capnogram
- [ ] Clinician review of physiology targets and tutorial wording (paediatric case especially) — needs a clinician
- [ ] Physical iPhone walkthrough of the next bundled build — needs a device + Xcode
- [x] Install Meshy lungs/heart/airways GLBs as bundled 3D Lung View (3D default, SVG fallback)
- [x] Final audit residuals: ARDSNet acidaemia wording, APRV modelled-score labelling, npm lock verified
