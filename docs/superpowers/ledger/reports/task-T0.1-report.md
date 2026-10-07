# T0.1 report
Implemented CSS, dialog functions (showDialog/alert/prompt/confirm), toast opts, UI exports per brief verbatim.
RED: 4/4 dialogs tests failed (UI.showDialog not a function / no .toast.sticky).
GREEN: `npx playwright test` -> 7 passed (dialogs 4, harness 2, debug-modules 1).
Adaptation: in test 1, `getByRole('button',{name:'Save'})` matched the toolbar "Save" button too (strict mode); scoped to `#dialog-actions`.
Note: test-results/.last-run.json is tracked in git and gets modified by runs; I reverted it, not committed.
Self-review: Escape -> null for prompt; second showDialog resolves the first with button:null.
