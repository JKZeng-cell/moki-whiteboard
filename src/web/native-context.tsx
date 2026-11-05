import {createContext,useContext} from 'react';
export const NativeControlsContext=createContext<{back:()=>void; settings:()=>void;share?:()=>void}|null>(null);
export const useNativeControls=()=>useContext(NativeControlsContext);
