# Weather Sandbox Rework Plan (v4)

This plan converts the broad rework request into a staged, shippable roadmap with explicit scope, dependencies, and acceptance criteria.

## Update Log

- **2026-02-21:** Reworked all tools under the unified toolset direction (Section 6) and reworked lightning generation visual effects as part of the next-gen lightning system (Section 1, Optical + Thermal Response).

## 0) Delivery Strategy

- **Approach:** Ship in phases behind feature flags (`experimental.*`) so stability regressions are isolated.
- **Cadence:** 1 major milestone per PR group (3–7 PRs each), with nightly perf checks.
- **Risk controls:** Keep old systems as fallback until parity checks pass.

---

## 1) Brand-New Lightning Generation System

### Goals
- **Fully replace** the current basic/flash-biased lightning path with a next-gen channel solver (desktop + mobile parity).
- Improve cloud-to-ground (CG), intra-cloud (IC), branching coherence, stepped leader behavior, and multi-stroke realism.
- Ensure lightning is rendered as full channel structure on mobile and not downgraded to flash-only behavior.

### Work Items
1. **Legacy Lightning Retirement**
   - Remove/replace old flash-centric fallback path and route all lightning through one unified solver.
   - Keep temporary feature-flag fallback only until parity tests pass.
2. **Charge Field Layer**
   - Add explicit charge-separation buffers (positive/negative charge density).
   - Couple charge dynamics to graupel/ice/water collisions and vertical wind shear.
3. **Strike Initiation Model**
   - Compute breakdown potential using electric field gradient + humidity + aerosol suppression.
   - Add probabilistic leader inception and stepped-growth progression.
4. **Channel Propagation**
   - Replace one-pass target jump with iterative leader stepping and branch pruning.
   - Add attachment to rods/airplane/terrain through weighted attractors.
5. **Optical + Thermal Response**
   - Multi-stroke timing curves, channel persistence, and thermal bloom decay.
   - Better IC/CG color temperature ramps and camera shake coupling.
6. **Mobile/Low-End Parity**
   - Add adaptive complexity scaling that preserves full bolt structure before reducing optional post-effects.
   - Validate “full bolt first” rendering policy across coarse-pointer/mobile devices.

### Acceptance Criteria
- Visible increase in branching coherence and stroke diversity.
- CG/IC ratio tunable and stable across presets.
- Mobile devices render full bolt channels (not flash-only substitutions).
- No frame-time spikes above target budget at default settings.

---

## 2) Reworked Simulation UI Controls

### Goals
- Modernize startup and in-sim controls for discoverability, hierarchy, and touch parity.

### Work Items
1. Redesign intro/startup screen into a two-stage flow: Quick Start + Advanced Setup.
2. Rework loading screen with staged progress (assets, shaders, textures, audio, worker init) and clear failure states.
3. Add inline descriptions, reset-to-default, profile save/load, and dependency-aware control disabling.
4. Build responsive control layout for desktop/tablet/mobile and add command palette for quick tool/control search.

### Acceptance Criteria
- Core tasks completed in fewer clicks (baseline UX script).
- Touch and mouse workflows both usable without hidden controls.

---

## 3) Fullscreen Mode (Native + UX)

### Goals
- Add robust fullscreen experience with escape hints and safe overlays.

### Work Items
1. Add Fullscreen API toggle button + keyboard shortcut.
2. Ensure overlays/charts/tooltips reposition correctly in fullscreen.
3. Persist preferred fullscreen behavior in local settings.

### Acceptance Criteria
- Enter/exit fullscreen without UI breakage in Chromium/Firefox/Safari.

---

## 4) Graphics Settings Rework

### Goals
- Replace static presets with adaptive quality tiers and explicit render-budget controls.

### Work Items
1. Add **Device Info** panel (GPU renderer, WebGL version, VRAM estimate class, CPU cores, memory hint, current DPR).
2. Add **Pixel Ratio slider** (renderScale clamp with safe min/max) and live estimated cost readout.
3. Split settings into Simulation Cost vs Visual Cost, with dynamic resolution scaling and GPU budget estimator.
4. Add "Auto" mode that adjusts quality from rolling frame time and exposes advanced toggles: volumetrics, bloom, postFX, AA, precipitation density.

### Acceptance Criteria
- Stable frame pacing under target threshold in Auto mode.
- Preset behavior clearly communicated and reproducible.

---

## 5) Real-Time Radar Overlay

### Goals
- Add in-sim radar product rendering from model state (not external feed).

### Work Items
1. Create derived radar reflectivity layer (dBZ proxy) from hydrometeor mass/phase.
2. Add velocity product from wind field (radial velocity proxy).
3. Implement overlay widget (opacity, range rings, sweep angle style options).
4. Add legend/color scales and mode switching (REF/VEL/COMPOSITE).

### Acceptance Criteria
- Radar reflects storm structure changes in real time.
- Overlay toggle and legend are responsive and readable.

---

## 6) Toolset Rework

### Goals
- Standardize all tools around shared interaction model and brush physics.

### Work Items
1. Define unified tool API: `begin/stroke/end`, pressure, falloff, invert behavior.
2. Rework brush engine (shape kernels, hardness curve, jitter/noise options, accumulation mode, symmetry options).
3. Rebuild legacy tools on top of unified API and add tool presets + parameter locking.
4. Improve touch gestures and stylus support.

### Acceptance Criteria
- All tools share consistent behavior and controls.
- Reduced tool-specific bugs from duplicated logic.

---

## 7) Realistic Water Waves

### Goals
- Replace basic surface motion with wind-driven, precipitation-coupled wave model.

### Work Items
1. Add wave spectral approximation (small-cap + swell blend).
2. Couple wave amplitude to wind stress and precipitation rate.
3. Add shoreline damping and terrain interaction.
4. Improve foam/specular highlights in display shader.

### Acceptance Criteria
- Visually plausible waves across calm/storm scenarios.
- Minimal additional GPU cost in Medium preset.

---

## 8) Display Mode Rework

### Goals
- Normalize all display modes (temperature, pressure, winds, AQ, radar, realistic) around one compositing pipeline.

### Work Items
1. Build mode registry with shared uniforms and color scale descriptors.
2. Add per-mode legends and value probing at cursor.
3. Improve transitions between modes and reduce shader duplication.
4. Add runtime shader feature toggles and compile diagnostics for rapid tuning.

### Acceptance Criteria
- No mode-switch flicker or stale-uniform artifacts.
- Easier addition of new modes (radar included).

---

## 9) Precipitation Particle System Rework

### Goals
- Upgrade particle lifecycle realism while preserving performance.

### Work Items
1. Introduce explicit hydrometeor classes (drizzle/rain/graupel/hail/snow proxy buckets).
2. Improve spawn/death logic with cloud microphysics constraints.
3. Revisit deposition and splashback with terrain/wind coupling.
4. Validate "no floating precipitation" under strong updraft scenarios.

### Acceptance Criteria
- Persistent suspended artifacts eliminated in stress tests.
- Better phase-transition realism and deposition consistency.

---

## 10) Old Feature Enhancement Pass (No Tweaks)

### Goals
- Identify legacy core systems and enhance their fidelity/capability directly.
- Do **not** spend this pass on small UX polish or minor toggle adjustments.

### Old Core Features to Enhance
1. **Lightning Engine (legacy path):** improve branching quality, channel persistence, and multi-stroke sequencing.
2. **Precipitation System (legacy particles):** improve phase behavior, fall consistency, and terrain interaction.
3. **Water/Wave Model (legacy surface motion):** improve wind coupling, shoreline damping, and storm-state response.
4. **Display/Shader Stack (legacy mode-specific paths):** improve compositing consistency and remove outdated render branches.

### Work Items
1. Build a short inventory of old feature modules still running in default scenarios.
2. Replace or upgrade each listed legacy module with a stronger implementation (no micro-tweak-only tasks).
3. Validate each enhancement in storm scenarios (calm, supercell, coastal, mountain).
4. Remove deprecated fallback paths only after parity checks pass.

### Acceptance Criteria
- Each old core feature above has a shipped enhancement, not just a minor parameter tweak.
- Lightning and precipitation visibly improve in structure/behavior versus baseline captures.
- Water and display paths show measurable quality gains without regressions in default presets.
- Legacy fallback code for replaced paths is either removed or fully gated behind explicit debug flags.

---


## 11) Loading + Intro UX Redesign Package

### Goals
- Fully redesign first-run/user-entry experience and startup clarity.

### Work Items
1. New loading screen visual language (status steps, cancel/retry affordances, fallback diagnostics).
2. Intro redesign with device-aware recommendations (quality preset suggestion based on detected capability).
3. Add “What changed” card for new systems (radar, brush, precipitation, lightning).
4. Add startup benchmark quick test (optional) to seed default graphics values.

### Acceptance Criteria
- Users can understand startup state at a glance.
- Fewer startup confusion reports and better default preset fit per device class.

---

## 12) New Feature Expansion + Shader Enhancement Pack

### Goals
- Add high-impact new features while modernizing core shaders for quality and maintainability.

### Work Items
1. Add storm-core diagnostics overlays (updraft helicity proxy, convergence bands, hail potential index).
2. Add cinematic but controllable atmosphere passes (volumetric shafts, improved cloud self-shadowing, temporal denoise hooks).
3. Rework precipitation/lightning/water shaders for shared utility functions and fewer duplicated code paths.
4. Add shader quality ladder (Ultra/High/Medium/Mobile) with deterministic feature masks.
5. Add GPU timing instrumentation per major pass to guide optimization.

### Acceptance Criteria
- At least 3 new user-visible features shipped behind toggles.
- Shader maintenance improved (lower duplication and clearer feature flags).
- Quality ladder behaves predictably across device tiers.

---

## Milestones and Sequencing

1. **M0 Startup/Onboarding UX pass** (Sections 2 + 11)
2. **M1 Lightning Replacement + Precip foundation** (Sections 1 + 9)
3. **M2 Rendering/Shader modernization** (Sections 4 + 8 + 7 + 12)
4. **M3 UI/Tools/Fullscreen** (Sections 3 + 6)
5. **M4 Radar + Old-feature enhancement pass** (Sections 5 + 10)

---

## Validation Matrix (per milestone)

- **Correctness:** Scenario-based regression runs (calm, supercell, mountain, marine).
- **Performance:** Frame-time budget checks at Low/Medium/High.
- **UX:** Keyboard/mouse/touch task scripts.
- **Visual QA:** Screenshot diffs and shader artifact checks.

---

## Definition of Done

- Feature complete for milestone scope.
- No P1 regressions in default preset.
- Docs updated (controls/help/changelog).
- Baseline performance targets met on representative desktop + mobile profile.
