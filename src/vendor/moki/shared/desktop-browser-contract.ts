import { z } from 'zod';
import { BrowserSessionIdSchema } from './browser-contract.js';

export const NativeBrowserPresentationSchema = z.object({
  mountId: z.string().min(1).max(100),
  sessionId: BrowserSessionIdSchema,
  targetId: z.string().min(1).max(100),
  visible: z.boolean(),
  bounds: z.object({
    x: z.number().finite(), y: z.number().finite(),
    width: z.number().min(0).max(10000), height: z.number().min(0).max(10000),
  }).strict(),
}).strict();
export type NativeBrowserPresentation = z.infer<typeof NativeBrowserPresentationSchema>;
export const NativeBrowserCaptureSchema = z.object({
  sessionId: BrowserSessionIdSchema,
  targetId: z.string().min(1).max(100),
}).strict();
export type NativeBrowserCapture = z.infer<typeof NativeBrowserCaptureSchema>;
export const NativeBrowserSiteDataSchema = z.object({
  sessionId: BrowserSessionIdSchema,
  targetId: z.string().min(1).max(100),
}).strict();
export type NativeBrowserSiteData = z.infer<typeof NativeBrowserSiteDataSchema>;
export type BrowserSiteDataSummary = {
  origin: string;
  hostname: string;
  cookieCount: number;
};
export type BrowserUserDataSummary = {
  cookieCount: number;
};
export type DesktopBrowserBridge = {
  present(input: NativeBrowserPresentation): Promise<boolean>;
  hide(mountId: string): Promise<void>;
  capture?(input: NativeBrowserCapture): Promise<string>;
  getCacheSize?(): Promise<number>;
  clearCache?(): Promise<number>;
  getUserDataSummary?(): Promise<BrowserUserDataSummary>;
  clearUserData?(): Promise<BrowserUserDataSummary>;
  clearSiteData?(input: NativeBrowserSiteData): Promise<BrowserSiteDataSummary>;
  onHostVisible?(listener: () => void): () => void;
};

export function isAllowedNativeBrowserNavigation(value: string, allowBlob = false): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') return true;
    if (allowBlob && url.protocol === 'blob:') return true;
    return url.protocol === 'about:' && url.pathname === 'blank';
  } catch {
    return false;
  }
}

export function nativeBrowserUserAgent(value: string): string {
  return value
    .replace(/\s(?:Electron|moki-workbench)\/[\d.]+/giu, '')
    .replace(/\s{2,}/gu, ' ')
    .trim();
}

export function nativeBrowserBounds(bounds: NativeBrowserPresentation['bounds'], zoom: number, size: { width: number; height: number }) {
  const x = Math.max(0, Math.min(size.width, Math.round(bounds.x * zoom)));
  const y = Math.max(0, Math.min(size.height, Math.round(bounds.y * zoom)));
  const right = Math.max(0, Math.min(size.width, Math.round((bounds.x + bounds.width) * zoom)));
  const bottom = Math.max(0, Math.min(size.height, Math.round((bounds.y + bounds.height) * zoom)));
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}
