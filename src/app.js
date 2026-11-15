// Application controller: view state, input handling and render orchestration.
import { generateCity } from './generate.js';
import { createLabels, layoutLabels, labelAtPoint, togglePin } from './labels.js';
import { zoomAt, screenToWorld } from './geometry.js';
import { renderMap } from './maprender.js';
import { renderOverlay } from './overlay.js';
import { buildGeoJson, downloadJson, downloadCanvas } from './geoexport.js';

export function createApp(canvas, options = {}) {
  const ctx = canvas.getContext('2d');
  const city = options.city || generateCity(options.seed);
  const labels = createLabels(city.pois);
  const state = {
    canvas,
    ctx,
    city,
    labels,
    view: { center: { x: 0, y: 0 }, scale: 0.16, width: 800, height: 600 },
    dragging: false,
    dragStart: null,
    moved: false,
  };

  function resize() {
    const rect = canvas.getBoundingClientRect();
    state.view.width = rect.width;
    state.view.height = rect.height;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render();
  }

  function render() {
    layoutLabels(labels, state.view);
    renderMap(ctx, city, state.view);
    renderOverlay(ctx, labels, state.view);
  }

  function zoom(factor, anchorX = state.view.width / 2, anchorY = state.view.height / 2) {
    state.view = zoomAt(state.view, factor, anchorX, anchorY);
    render();
  }

  function resetView() {
    state.view.center = { x: 0, y: 0 };
    state.view.scale = 0.16;
    render();
  }

  function onWheel(event) {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
    zoom(factor, event.clientX - rect.left, event.clientY - rect.top);
  }

  function onPointerDown(event) {
    const rect = canvas.getBoundingClientRect();
    state.dragging = true;
    state.moved = false;
    state.dragStart = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      world: screenToWorld(event.clientX - rect.left, event.clientY - rect.top, state.view),
    };
    canvas.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    if (!state.dragging) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (Math.hypot(x - state.dragStart.x, y - state.dragStart.y) > 4) state.moved = true;
    const worldNow = screenToWorld(x, y, state.view);
    state.view.center = {
      x: state.view.center.x + (state.dragStart.world.x - worldNow.x),
      y: state.view.center.y + (state.dragStart.world.y - worldNow.y),
    };
    render();
  }

  function onPointerUp(event) {
    if (!state.dragging) return;
    state.dragging = false;
    if (state.moved) return;
    const rect = canvas.getBoundingClientRect();
    const hit = labelAtPoint(labels, state.view, event.clientX - rect.left, event.clientY - rect.top);
    if (hit) {
      togglePin(hit);
      render();
    }
  }

  function exportPng() {
    render();
    downloadCanvas(canvas, 'procedural-city.png', 3);
  }

  function exportGeoJson() {
    downloadJson(buildGeoJson(city, labels), 'procedural-city.geojson');
  }

  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  window.addEventListener('resize', resize);

  const toolbar = bindToolbar(options.toolbar, { zoom, resetView, exportPng, exportGeoJson });
  resize();

  return { state, resize, render, zoom, resetView, exportPng, exportGeoJson, toolbar };
}

function bindToolbar(toolbar, actions) {
  if (!toolbar) return null;
  toolbar.querySelector('[data-action="zoom-in"]').addEventListener('click', () => actions.zoom(1.3));
  toolbar.querySelector('[data-action="zoom-out"]').addEventListener('click', () => actions.zoom(1 / 1.3));
  toolbar.querySelector('[data-action="reset"]').addEventListener('click', actions.resetView);
  toolbar.querySelector('[data-action="export-png"]').addEventListener('click', actions.exportPng);
  toolbar.querySelector('[data-action="export-json"]').addEventListener('click', actions.exportGeoJson);
  return actions;
}
