# T0.14 report
Implemented: 4 sites in zone-painter.js (lines 500, 569, 805, 814) -> UI.toast x3, UI.prompt (await) in now-async _uiSavePreset. Cancel (null) still returns via unchanged `!name` guard. Only caller is inline onclick (ignores return). UI is a global defined in MapEditorPro.html, resolved at call time (tests confirm).
Lint: tightened NATIVE regex (alert (, window/globalThis/self.alert/prompt), strips comments and string/template literals (line numbers preserved) before matching; covers MapEditorPro.html and zone-painter.js. Limitation: inline onclick="alert()" inside strings is not caught.
Tests: added Save preset dialog+toast, cancel-saves-nothing, Fill Zones toast. RED: lint listed the 4 offenders (:500,:569,:805,:814) and tests failed on old code. GREEN: full suite 124 passed.
Not directly tested: _randomizeFillUI "No map loaded" toast (trivial one-line swap).
