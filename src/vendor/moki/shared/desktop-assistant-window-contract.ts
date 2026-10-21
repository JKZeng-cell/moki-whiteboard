export type DesktopAssistantWindowState = {
  open: boolean;
  active: boolean;
  alwaysOnTop: boolean;
  pinned: boolean;
  floatingBallEnabled: boolean;
  floatingBallVisible: boolean;
};

export type DesktopAssistantFloatingBallMove = {
  screenX: number;
  screenY: number;
  offsetX: number;
  offsetY: number;
};

export const DESKTOP_WORKBENCH_ROUTES = [
  "/",
  "/whiteboard",
  "/library",
  "/tasks",
  "/automations",
  "/reports",
  "/heatmap",
  "/tools",
  "/settings",
  "/settings?tab=ai",
] as const;

export type DesktopWorkbenchRoute = (typeof DESKTOP_WORKBENCH_ROUTES)[number] | `/library?itemId=${string}`;

export function isDesktopWorkbenchRoute(value: unknown): value is DesktopWorkbenchRoute {
  if (typeof value !== "string") return false;
  if ((DESKTOP_WORKBENCH_ROUTES as readonly string[]).includes(value)) return true;
  const match = value.match(/^\/library\?itemId=([^&]+)$/u);
  if (!match?.[1]) return false;
  try {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(decodeURIComponent(match[1]));
  } catch {
    return false;
  }
}
