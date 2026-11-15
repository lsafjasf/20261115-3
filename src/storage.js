import { exportJson, importProject } from './serialize.js';

export const STORAGE_KEY = 'visual-editor-project-v1';

export async function saveNow(store) {
  const json = await exportJson(store, Date.now());
  localStorage.setItem(STORAGE_KEY, json);
  return json;
}

export function hasSavedProject() {
  return localStorage.getItem(STORAGE_KEY) !== null;
}

export function loadSaved() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  return importProject(raw);
}

export function clearSaved() {
  localStorage.removeItem(STORAGE_KEY);
}
