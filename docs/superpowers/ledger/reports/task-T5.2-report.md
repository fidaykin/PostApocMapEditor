# T5.2 report: active-package selector in HEX DB and BUILDINGS toolbars
Commit ccad574. Changed: MapEditorPro.html (#hexdb-tools, #bld-tools, #pkg-active-select, CSS, Packages.init/_fetchRegistry/setActive/renderActiveDropdowns), new tests/packages-toolbar.spec.ts (7 tests).
- Native `<select class="pkg-active-select" aria-label="Active package">` first child of both mode toolbars (mode toolbars replace #map-tools and are hidden in map mode: canvas stays 1491x808 at 1400x900, asserted). `renderActiveDropdowns` rebuilds every selector with DOM APIs. Sync both ways through setActive (PACKAGES marker, toolbars, badge). New entries already use Packages.getActive() (prefix + package): tested.
- Robustness: localStorage in try/catch; unknown id in setActive toasts and keeps current; remembered package missing from cached/live registry falls back to postapoc + toast + persisted; cached registry validated.
- Keyboard: native labelled focusable select asserted (ArrowDown on a closed select is OS dependent, not asserted).
RED 7/7 failed; GREEN 7/7. Mutation: _ensureActiveExists no-op fails the fallback test; restored with cmp. Focused run 117 passed.
Not done: if the live registry fetch fails and the remembered id is not in the built-in list, the id stays until a registry arrives.
