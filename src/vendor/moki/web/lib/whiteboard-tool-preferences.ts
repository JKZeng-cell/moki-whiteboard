import {useSyncExternalStore} from 'react';

export const AUTO_TOOL_SWITCH_KEY = 'moki-whiteboard-auto-tool-switch';
const CHANGE_EVENT = 'moki-whiteboard-tool-preferences-changed';
let fallback: boolean | undefined;

export function readAutoToolSwitch(): boolean {
  if (fallback !== undefined) return fallback;
  try { return localStorage.getItem(AUTO_TOOL_SWITCH_KEY) !== 'false'; }
  catch { return true; }
}

export function setAutoToolSwitch(enabled: boolean): void {
  try { localStorage.setItem(AUTO_TOOL_SWITCH_KEY, String(enabled)); fallback = undefined; }
  catch { fallback = enabled; }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(change: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === AUTO_TOOL_SWITCH_KEY || event.key === null) { fallback = undefined; change(); }
  };
  window.addEventListener(CHANGE_EVENT, change);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, change);
    window.removeEventListener('storage', onStorage);
  };
}

export function useAutoToolSwitch(): readonly [boolean, typeof setAutoToolSwitch] {
  return [useSyncExternalStore(subscribe, readAutoToolSwitch, () => true), setAutoToolSwitch];
}
