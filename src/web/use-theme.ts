import {useEffect,useState} from 'react';

export type ThemeMode='light'|'dark'|'system';
export const THEME_STORAGE_KEY='moki-whiteboard-theme';
function readMode():ThemeMode{try{const value=localStorage.getItem(THEME_STORAGE_KEY);return value==='light'||value==='dark'?value:'system';}catch{return 'system';}}
function systemDark(){return window.matchMedia?.('(prefers-color-scheme: dark)').matches??false;}

export function useTheme(){
 const [mode,setMode]=useState<ThemeMode>(readMode),[system,setSystem]=useState(systemDark);
 const dark=mode==='dark'||(mode==='system'&&system);
 useEffect(()=>{
  const media=window.matchMedia?.('(prefers-color-scheme: dark)');if(!media)return;
  const change=(event:MediaQueryListEvent)=>setSystem(event.matches);setSystem(media.matches);
  if(media.addEventListener){media.addEventListener('change',change);return()=>media.removeEventListener('change',change);}
  media.addListener?.(change);return()=>media.removeListener?.(change);
 },[]);
 useEffect(()=>{try{localStorage.setItem(THEME_STORAGE_KEY,mode);}catch{/* Keep the in-memory preference when browser storage is unavailable. */}},[mode]);
 useEffect(()=>{const scheme=dark?'dark':'light';document.documentElement.dataset.theme=scheme;document.documentElement.dataset.colorScheme=scheme;document.documentElement.style.colorScheme=scheme;},[dark]);
 return {mode,setMode,dark};
}
