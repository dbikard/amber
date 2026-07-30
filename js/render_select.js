/* render_select.js — picks the renderer before game.js loads.
 * 3D (Three.js, AoE2-pitch camera) by default; ?r=2d forces the Pixi painted-map
 * renderer; devices without working WebGL fall back to 2D automatically. */
(function (global) {
  'use strict';
  const q = new URLSearchParams(location.search).get('r');
  let use3d = q !== '2d' && !!global.THREE && !!global.Render3D;
  if (use3d) {
    try {
      const c = document.createElement('canvas');
      use3d = !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch (e) { use3d = false; }
  }
  global.Render = use3d ? global.Render3D : global.Render2D;
  global.RENDER_MODE = use3d ? '3d' : '2d';
})(typeof window !== 'undefined' ? window : globalThis);
