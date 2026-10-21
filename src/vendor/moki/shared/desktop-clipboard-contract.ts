export type DesktopClipboardResource = {
  kind: "local_file" | "local_folder" | "url";
  name: string;
  target: string;
};
