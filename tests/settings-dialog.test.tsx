// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {useState} from 'react';
import {SettingsDialog,type SettingsTab} from '../src/web/settings-dialog.js';
import type {ThemeMode} from '../src/web/use-theme.js';
import {WorkbenchPageHeader} from '../src/vendor/moki/web/components/workbench-page-header.js';
import {NativeControlsContext} from '../src/web/native-context.js';
const APP_VERSION='9.8.7'; // The UI renders the supplied server version, not a hard-coded product version.
import {APP_DEVELOPER_EMAIL,DEVELOPER_CONTACT_URL,isAllowedExternalUrl} from '../src/shared/app-metadata.js';
const initial={path:'C:/MOKI/whiteboard-materials',defaultPath:'C:/MOKI/whiteboard-materials',pendingPath:null,error:null};
afterEach(()=>{cleanup();delete window.mokiDesktop;vi.unstubAllGlobals();});
function Demo(){const [tab,setTab]=useState<SettingsTab>('appearance'),[themeMode,setThemeMode]=useState<ThemeMode>('light');return <SettingsDialog version={APP_VERSION} tab={tab} onTab={setTab} close={vi.fn()} themeMode={themeMode} onThemeMode={setThemeMode} mcp={<p>MCP 连接内容</p>}/>;}
describe('unified settings',()=>{
 it('offers system appearance as a distinct persisted preference, not a light/dark selection',()=>{
  window.mokiDesktop={captureWhiteboardLinkPreview:async()=>null,resourceCache:{get:async()=>initial,set:vi.fn()}};render(<Demo/>);fireEvent.click(screen.getByRole('button',{name:'跟随系统'}));expect(screen.getByRole('button',{name:'跟随系统'})).toHaveAttribute('aria-pressed','true');expect(screen.getByRole('button',{name:'浅色模式'})).toHaveAttribute('aria-pressed','false');expect(screen.getByRole('button',{name:'深色模式'})).toHaveAttribute('aria-pressed','false');
 });
 it('shows the current app version and developer contact in every category and includes the link in focus trapping',async()=>{
  window.mokiDesktop={captureWhiteboardLinkPreview:async()=>null,resourceCache:{get:async()=>initial,set:vi.fn()}};render(<Demo/>);
  for(const name of ['外观','MCP','素材缓存']){fireEvent.click(screen.getByRole('tab',{name}));expect(screen.getByText('MOKI 白板 · v'+APP_VERSION)).toBeInTheDocument();expect(screen.getByRole('link',{name:'联系开发者'})).toHaveAttribute('href',DEVELOPER_CONTACT_URL);}
  await screen.findByLabelText('素材目录');screen.getByRole('link',{name:'联系开发者'}).focus();fireEvent.keyDown(document,{key:'Tab'});expect(screen.getByRole('button',{name:'关闭设置'})).toHaveFocus();
 });
 it('uses the native external URL bridge for developer mail without navigating away',async()=>{
  const open=vi.fn(async()=>true);window.mokiDesktop={captureWhiteboardLinkPreview:async()=>null,resourceCache:{get:async()=>initial,set:vi.fn()},openExternalUrl:open};render(<Demo/>);fireEvent.click(screen.getByRole('link',{name:'联系开发者'}));await waitFor(()=>expect(open).toHaveBeenCalledWith(DEVELOPER_CONTACT_URL));expect(screen.getByRole('dialog',{name:'设置'})).toBeInTheDocument();
 });
 it('shows the email address when the device cannot open its mail application',async()=>{
  window.mokiDesktop={captureWhiteboardLinkPreview:async()=>null,resourceCache:{get:async()=>initial,set:vi.fn()},openExternalUrl:async()=>false};render(<Demo/>);fireEvent.click(screen.getByRole('link',{name:'联系开发者'}));expect(await screen.findByRole('alert')).toHaveTextContent(APP_DEVELOPER_EMAIL);
 });
 it('allows only developer mail and existing http links, not arbitrary external protocols',()=>{
  expect(isAllowedExternalUrl(DEVELOPER_CONTACT_URL)).toBe(true);expect(isAllowedExternalUrl('https://example.com')).toBe(true);
  for(const value of ['mailto:other@example.com',DEVELOPER_CONTACT_URL+'?attach=C:/private.txt','javascript:alert(1)','file:///C:/private.txt','not a url'])expect(isAllowedExternalUrl(value)).toBe(false);
 });
 it('uses a single settings entry in the editor header instead of a separate MCP button',()=>{
  const settings=vi.fn();render(<NativeControlsContext.Provider value={{back:vi.fn(),settings}}><WorkbenchPageHeader title="白板"/></NativeControlsContext.Provider>);fireEvent.click(screen.getByRole('button',{name:'设置'}));expect(settings).toHaveBeenCalledOnce();expect(screen.queryByRole('button',{name:'MCP 连接'})).not.toBeInTheDocument();
 });
 it('collects theme, MCP and material path into one tabbed settings dialog',async()=>{
  window.mokiDesktop={captureWhiteboardLinkPreview:async()=>null,resourceCache:{get:async()=>initial,set:vi.fn()}};render(<Demo/>);expect(screen.getAllByRole('dialog')).toHaveLength(1);fireEvent.click(screen.getByRole('button',{name:'深色模式'}));expect(screen.getByRole('button',{name:'深色模式'})).toHaveAttribute('aria-pressed','true');fireEvent.click(screen.getByRole('tab',{name:'MCP'}));expect(screen.getByText('MCP 连接内容')).toBeInTheDocument();fireEvent.click(screen.getByRole('tab',{name:'素材缓存'}));expect(await screen.findByLabelText('素材目录')).toHaveValue(initial.path);
 });
 it('selects a folder and saves a restart-required path without claiming immediate migration',async()=>{
  const set=vi.fn(async(path:string|null)=>({...initial,pendingPath:path}));window.mokiDesktop={captureWhiteboardLinkPreview:async()=>null,selectLocalFolder:async()=> 'D:/WhiteboardCache',resourceCache:{get:async()=>initial,set}};render(<Demo/>);fireEvent.click(screen.getByRole('tab',{name:'素材缓存'}));await screen.findByLabelText('素材目录');fireEvent.click(screen.getByRole('button',{name:'选择素材目录'}));await waitFor(()=>expect(screen.getByLabelText('素材目录')).toHaveValue('D:/WhiteboardCache'));fireEvent.click(screen.getByRole('button',{name:'保存路径'}));await waitFor(()=>expect(set).toHaveBeenCalledWith('D:/WhiteboardCache'));expect(await screen.findByText('设置已保存，重启客户端后生效。')).toBeInTheDocument();
 });
 it('shows web cache paths read-only instead of sending arbitrary server filesystem writes',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({resourceCache:initial}))));render(<Demo/>);fireEvent.click(screen.getByRole('tab',{name:'素材缓存'}));expect(await screen.findByLabelText('素材目录')).toHaveAttribute('readonly');expect(screen.getByRole('button',{name:'选择素材目录'})).toBeDisabled();expect(screen.queryByRole('button',{name:'保存路径'})).not.toBeInTheDocument();
 });
});
