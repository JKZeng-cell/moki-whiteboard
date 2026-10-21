import {createContext,useContext} from 'react';
export const NativeControlsContext=createContext<{back:()=>void; settings:()=>void}|null>(null);
export const useNativeControls=()=>useContext(NativeControlsContext);
