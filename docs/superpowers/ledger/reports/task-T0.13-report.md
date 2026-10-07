# T0.13 report
Implemented all 7 sites (publishMap -> await UI.prompt; setAutosaveFolder, _loadFromJSON catch, initFileInput catch -> UI.alert; LocalizationKeys.add -> UI.toast; HexDB/BldDB.promptReskin -> async, select of postapoc ids, with empty-options toast guard).
Deviation: the reskin functions were already `window.prompt` sites with different line numbers; replaced per brief.
Tests: tests/no-native-dialogs.spec.ts (lint + 9 behavioural tests incl. cancel paths for reskin and publish, building reskin, autosave-folder). Focused: 14 passed with dialogs.spec. Full suite: 120 passed.
RED: with the original HTML, 10 of 10 new tests failed; GREEN after change.
Control flow: all converted alert calls are fire-and-forget at ends of functions (no return value used); publishMap was already async, prompt precedes the button latch, a second invocation supersedes the open dialog (resolves null -> return); reskin handlers are onclick, addReskin re-checks active package after the await. Cancel (null) aborts with no side effects.
Files: MapEditorPro.html, tests/no-native-dialogs.spec.ts. Native confirm() untouched (out of scope).
