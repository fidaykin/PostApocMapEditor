// brush.js - the Brush module (paint footprint: size 0..12, hex-disc expansion), extracted from MapEditorPro.html (T6.4).
// CLASSIC script, not a module: `const Brush` below is a global lexical binding, exactly as when it lived in the inline
// script (visible to inline onclick handlers and every other script, NOT a window property).
// LOAD ORDER: loaded from <head> after hex-utils.js and before the inline editor script. Top level only declares the
// module; MAP_WIDTH / MAP_HEIGHT (inline-script lets), HexUtils and document are read at CALL time, never at load time.
// Deployment: published into dev/ by .github/workflows/deploy-dev.yml; bump the ?v= on the tag in MapEditorPro.html with every change.
// ════════════════════════════════════════════════════════════
// BRUSH MODULE — size/shape, hex neighbor expansion
// ════════════════════════════════════════════════════════════
const Brush = (() => {
  const MAX_SIZE = 12;
  let _size = 0;   // hex radius: 0 = single tile, n = disc of radius n (3n(n+1)+1 tiles)

  // Offset pattern cache. A disc is a fixed set of (dcol, drow) offsets that depends only on the radius and on the
  // parity of the centre's cube q (= (H-1-row) - floor(H/2), so it folds in both the row parity and the map height
  // parity: K3). The pattern is built once from HexUtils on a virtual unbounded map (W=0, H=1, centre q=parity) and a
  // mouse move only translates and clips it.
  const _patterns = new Map();
  let _builds = 0;
  function _pattern(radius, qPar) {
    const key = radius * 2 + qPar;
    let p = _patterns.get(key);
    if (!p) {
      _builds++;
      const centre = HexUtils.fromCube({ q: qPar, r: 0, s: -qPar }, 0, 1);
      const cubes = HexUtils.cubeDisc({ q: qPar, r: 0, s: -qPar }, radius);
      p = new Int32Array(cubes.length * 2);
      cubes.forEach((c, i) => {
        const cell = HexUtils.fromCube(c, 0, 1);
        p[i * 2] = cell.col - centre.col;
        p[i * 2 + 1] = cell.row - centre.row;
      });
      _patterns.set(key, p);
    }
    return p;
  }

  function getAffectedTiles(col, row) {
    if (_size === 0) return [{ col, row }];
    if (col < 0 || col >= MAP_WIDTH || row < 0 || row >= MAP_HEIGHT) return [];
    const q = (MAP_HEIGHT - 1 - row) - Math.floor(MAP_HEIGHT / 2);
    const p = _pattern(_size, ((q % 2) + 2) % 2);
    const out = [];
    for (let i = 0; i < p.length; i += 2) {
      const c = col + p[i], r = row + p[i + 1];
      if (c >= 0 && c < MAP_WIDTH && r >= 0 && r < MAP_HEIGHT) out.push({ col: c, row: r });
    }
    return out;
  }

  function setSize(s) {
    _size = Math.max(0, Math.min(MAX_SIZE, parseInt(s) || 0));
    document.querySelectorAll('.brush-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.brush) === _size);
    });
    const range = document.getElementById('brush-size-range');
    if (range) range.value = String(_size);
    const label = document.getElementById('brush-size-label');
    if (label) { const n = 3 * _size * (_size + 1) + 1; label.textContent = `Radius ${_size} (${n} ${n === 1 ? 'tile' : 'tiles'})`; }
  }

  function getSize() { return _size; }
  function grow()   { setSize(_size + 1); }
  function shrink() { setSize(_size - 1); }
  function patternBuilds() { return _builds; }

  return { getAffectedTiles, setSize, getSize, grow, shrink, MAX_SIZE, patternBuilds };
})();
