# T4.0 report: UI.showModal

Implemented `UI.showModal` in MapEditorPro.html (API documented in the comment block above it and in CHANGELOG), next to the shared dialog; the shared `#dialog-modal` is untouched.
- Own overlay per call (`modal-overlay ui-modal open`, id ends `-modal`, z-index 600+n so later = on top); module-level stack; ONE document keydown (bubble phase, so field handlers run first): Escape closes the topmost only and returns if `defaultPrevented`; Tab/Shift+Tab trap.
- textContent for title/labels/string body; Node bodies inserted as is. Actions are `<button type="button">`; sync throw or async rejection: console.error + toast + the modal closes.
- onClose(reason) once: 'escape' | 'backdrop' | 'close'. Backdrop close needs mousedown AND click on the backdrop (a drag out of a field does not close); `modal:true` blocks it.
- `_isTypingOrModal` also matches `.ui-modal`; Canvas `_onMouseDown/_onMouseMove/_onWheel/_onTouchStart/_onKeyDown` return while a modal is open (mouseup is deliberately not gated so a drag always finishes).
- Bug found by the focus-trap test: the document-level Tab handler (cycle MAP/HEX DB/... modes) fired with a modal open (also with the shared dialog; only the modal case is fixed). Now skipped while a `.ui-modal` exists.

RED: all 13 tests in tests/modal.spec.ts failed ("UI.showModal is not a function") before the implementation. GREEN: 13/13; plus dialogs.spec.ts + no-native-dialogs.spec.ts: 31 passed in total (modal + both).
Sanity mutation (restored, cmp clean): removing the defaultPrevented check fails the Escape test; removing the mousedown/wheel gates fails the canvas test.
Notes: the "works while a fill runs" test only proves the modal has no fill gate (it does not run a real fill). Not done: Tab mode switch with the shared dialog open (pre-existing, owner may want it gated).
