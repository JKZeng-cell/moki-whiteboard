// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {THEME_STORAGE_KEY,useTheme} from '../src/web/use-theme.js';

function media(initial:boolean){
 let matches=initial;const listeners=new Set<(event:MediaQueryListEvent)=>void>();
 const query={get matches(){return matches;},addEventListener:vi.fn((_name:string,listener:(event:MediaQueryListEvent)=>void)=>listeners.add(listener)),removeEventListener:vi.fn((_name:string,listener:(event:MediaQueryListEvent)=>void)=>listeners.delete(listener))};
 vi.stubGlobal('matchMedia',vi.fn(()=>query));
 return {query,listeners,change(next:boolean){matches=next;act(()=>{for(const listener of listeners)listener({matches} as MediaQueryListEvent);});}};
}
function Probe(){const {mode,setMode,dark}=useTheme();return <><output>{mode+':'+(dark?'dark':'light')}</output><button onClick={()=>setMode('light')}>light</button><button onClick={()=>setMode('dark')}>dark</button><button onClick={()=>setMode('system')}>system</button></>;}
afterEach(()=>{cleanup();localStorage.clear();vi.unstubAllGlobals();delete document.documentElement.dataset.theme;delete document.documentElement.dataset.colorScheme;document.documentElement.style.removeProperty('color-scheme');});
describe('system-aware appearance',()=>{
 it('defaults a new user to system appearance and applies the actual dark scheme',()=>{media(true);render(<Probe/>);expect(screen.getByText('system:dark')).toBeInTheDocument();expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');expect(document.documentElement.dataset.colorScheme).toBe('dark');});
 it.each(['light','dark'] as const)('preserves the existing explicit %s preference',mode=>{media(mode==='light');localStorage.setItem(THEME_STORAGE_KEY,mode);render(<Probe/>);expect(screen.getByText(mode+':'+mode)).toBeInTheDocument();expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe(mode);});
 it('reacts to both system changes without replacing the system preference with a resolved scheme',()=>{const system=media(false);render(<Probe/>);system.change(true);expect(screen.getByText('system:dark')).toBeInTheDocument();expect(document.documentElement.dataset.theme).toBe('dark');system.change(false);expect(document.documentElement.dataset.colorScheme).toBe('light');expect(document.documentElement.style.colorScheme).toBe('light');expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');});
 it('keeps manual appearance stable and resumes current system appearance when reselected',()=>{const system=media(false);render(<Probe/>);fireEvent.click(screen.getByRole('button',{name:'dark'}));system.change(true);system.change(false);expect(screen.getByText('dark:dark')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'system'}));expect(screen.getByText('system:light')).toBeInTheDocument();system.change(true);expect(screen.getByText('system:dark')).toBeInTheDocument();});
 it('restores system preference after remount using the latest OS scheme',()=>{const system=media(false);localStorage.setItem(THEME_STORAGE_KEY,'dark');const view=render(<Probe/>);fireEvent.click(screen.getByRole('button',{name:'system'}));view.unmount();system.change(true);render(<Probe/>);expect(screen.getByText('system:dark')).toBeInTheDocument();});
 it('removes the system listener on unmount',()=>{const system=media(false);const view=render(<Probe/>);expect(system.listeners.size).toBe(1);view.unmount();expect(system.listeners.size).toBe(0);expect(system.query.removeEventListener).toHaveBeenCalledOnce();});
 it('falls back safely when matchMedia is unavailable',()=>{vi.stubGlobal('matchMedia',undefined);render(<Probe/>);expect(screen.getByText('system:light')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'dark'}));expect(document.documentElement.dataset.colorScheme).toBe('dark');});
});
