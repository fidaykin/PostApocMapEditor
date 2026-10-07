# Phase 2 FIX WAVE 2 report
W2-1 zone rename: persistent Esc/Enter handler removed on blur; test with real typing (RED then GREEN); zone-painter.js ?v=17.
W2-2 Layers aria-label constant ('Roads visible' / 'Roads locked'), aria-pressed carries state; layers test extended.
W2-3 Bridge tool ignores e.detail>=2; RED/GREEN test (dblclick places once).
W2-4 Line/Circle/Polygon previews with symmetry capped at RECT_SYM_PREVIEW_CAP (outline only above it, canvas tooltip says so); work-counter test (filled circle rot6 radius 150: <=4000 cells, mutation without cap gave 73477).
W2-5 stale comment, tests/README (~6 min, focused advice, quiesceAfterDialog scope), helpers.ts doc, implementer-rules (gitignored dir, edited in place, not committed).
W2-6 CHANGELOG: Undo/zone-definitions, satellites captured, shortcut bullet (Turkish-F, Dvorak ' = Erase Road and , = Road verified against code via physical KeyQ/KeyW fallback for non-Latin typed keys; AZERTY , = Select Region; paste keys physical), fix wave 1 and wave 2 bullets, deploy note; stale dev note removed.
W2-7 deploy-dev.yml publishes zone-painter.js (trigger path, rewrite, ?v=[0-9]+ grep, cp, git add); lint allowlist removed, asserts publish + ?v= tie. Note: workflow grep checks only that the tag has a numeric ?v= (not a fixed number, since it is bumped per change).
W2-8 T4.11 rewritten. TRUE perf statement: all perf specs use 1400x900 (tests/perf-scene.ts VIEWPORT), which is BELOW 1920, so the new auto-collapse would change the canvas there and break pixel hashes; plan adds a 'classic' storage value seeded by perf-scene/openEditor to keep today's layout. Threshold set to 1920 (not 1931) so 1920x1080 equals today's layout; flag for controller.
Focused specs: layers, shortcut-layouts, stamps, fixwave1 (-g subset) + perf-workers deploy lint: 296 passed, 0 failed. Not run: full suite (per directive). Not done: nothing.
