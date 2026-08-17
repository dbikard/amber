/* render_select.js — the renderer, and the one hard requirement for running at all.
 *
 * There used to be a second, Canvas-flavoured renderer here, kept as a fallback for devices
 * without WebGL. It was never a fallback: it ran on PixiJS, which has been WebGL-only since
 * v7, so a device that could not run the 3D renderer could not run that one either — it
 * simply died a little later, on a black screen, with "CanvasRenderer is not yet
 * implemented". Better to say plainly what the game needs. */
(function (global) {
  'use strict';
  let ok = !!global.THREE && !!global.Render3D;
  if (ok) {
    try {
      const c = document.createElement('canvas');
      ok = !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch (e) { ok = false; }
  }
  global.Render = ok ? global.Render3D : null;
})(typeof window !== 'undefined' ? window : globalThis);
