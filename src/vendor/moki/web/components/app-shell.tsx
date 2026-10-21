import type { ReactNode } from 'react';
export function AppShell({ children }: {children: ReactNode; hideMainScrollbar?: boolean; fitMainContent?: boolean}) {
  return <main className="moki-native-page">{children}</main>;
}
