export type StartupStatus='enabled'|'disabled'|'requires-approval'|'disabled-by-system'|'unavailable';
export type DesktopSettingsState={
 closeToTray:boolean;
 trayAvailable:boolean;
 trayError:string|null;
 openAtLogin:boolean;
 startupAvailable:boolean;
 startupStatus:StartupStatus;
 startupHint:string;
};
export type DesktopSettingsUpdate={closeToTray?:boolean;openAtLogin?:boolean};
export type DesktopSettingsBridge={
 get():Promise<DesktopSettingsState>;
 set(update:DesktopSettingsUpdate):Promise<DesktopSettingsState>;
 quit():Promise<void>;
};
