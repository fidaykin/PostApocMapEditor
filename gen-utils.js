// gen-utils.js - pure helpers for map generation. No DOM, no editor globals.
const GenUtils = (() => {
  // ── Heightmap import ─────────────────────────────────────────
  function luminanceGrid(rgba, w, h) {
    const out = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++)
      out[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    return out;
  }

  // Resample an image (row-major, w*h) onto the map grid, indexed [row*W+col], with the SCREEN orientation of the grid
  // (Unity axis flip, see Canvas.hexCenterWorld): the horizontal screen axis is the ROW axis (xi = H-1-row grows east)
  // and the vertical screen axis is the COL axis (col grows north), so a north-up, west-left image lands the same way
  // round on screen. The image is stretched over the bounding box of the hex grid (cell centres +/- half a hex):
  //   x: centre 1.5*xi (units of the hex circumradius), extent +/-1  -> fx = (1.5*xi + 1) / (1.5*(H-1) + 2)
  //   y: centre yu in row pitches, extent +/-0.5, odd worldX (xi - floor(H/2)) columns sit half a pitch UP
  //      -> fy = (yu + 0.5) / (W + 0.5), yu = (W-1-col) + 0.5 - (odd ? 0.5 : 0)
  // Nearest neighbour (as the design spec says), deterministic, exactly W*H source reads whatever the image size.
  function resampleToMap(src, sw, sh, W, H) {
    const out = new Float32Array(W * H);
    const halfH = Math.floor(H / 2), xDen = 1.5 * (H - 1) + 2, yDen = W + 0.5;
    const sxOf = new Int32Array(H);
    for (let row = 0; row < H; row++)
      sxOf[row] = Math.max(0, Math.min(sw - 1, Math.floor(((1.5 * (H - 1 - row) + 1) / xDen) * sw)));
    for (let row = 0; row < H; row++) {
      const xi = H - 1 - row, odd = ((xi - halfH) % 2) !== 0;
      const sx = sxOf[row];
      for (let col = 0; col < W; col++) {
        const yu = (W - 1 - col) + (odd ? 0 : 0.5);
        const sy = Math.max(0, Math.min(sh - 1, Math.floor(((yu + 0.5) / yDen) * sh)));
        out[row * W + col] = src[sy * sw + sx];
      }
    }
    return out;
  }

  function normalize(grid) {
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < grid.length; i++) { const v = grid[i]; if (v < min) min = v; if (v > max) max = v; }
    const out = new Float32Array(grid.length);
    if (!(max > min)) { out.fill(0.5); return { grid: out, flat: true }; }
    const span = max - min;
    for (let i = 0; i < grid.length; i++) out[i] = (grid[i] - min) / span;
    return { grid: out, flat: false };
  }

  function applySeaLevel(grid, offset) {
    const out = new Float32Array(grid.length);
    for (let i = 0; i < grid.length; i++) out[i] = Math.max(0, Math.min(1, grid[i] - offset));
    return out;
  }

  return { luminanceGrid, resampleToMap, normalize, applySeaLevel };
})();
