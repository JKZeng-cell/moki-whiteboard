export type DesktopUpdateState =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "not-available"
  | "unsupported"
  | "error";

export type DesktopUpdateStatus = {
  state: DesktopUpdateState;
  currentVersion: string;
  availableVersion?: string | undefined;
  ignoredVersion?: string | undefined;
  releaseNotes?: string | undefined;
  percent?: number | undefined;
  transferred?: number | undefined;
  total?: number | undefined;
  message?: string | undefined;
};

export function normalizeDesktopReleaseNotes(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }
  if (!Array.isArray(value)) return undefined;
  const notes = value
    .map((entry) => {
      if (!entry || typeof entry !== "object" || !("note" in entry)) return "";
      const note = (entry as { note?: unknown }).note;
      return typeof note === "string" ? note.trim() : "";
    })
    .filter(Boolean);
  return notes.length > 0 ? notes.join("\n\n") : undefined;
}
