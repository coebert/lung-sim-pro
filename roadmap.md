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
