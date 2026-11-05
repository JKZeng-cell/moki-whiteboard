import {useEffect,useState} from 'react';
import type {LanSharingState} from '../shared/lan-sharing-contract.js';
const sharingChanged='moki:lan-sharing-changed';
export async function sharingAPI(path:string,init?:RequestInit):Promise<LanSharingState>{
 const response=await fetch(path,{...init,...(init?.body===undefined?{}:{headers:{'content-type':'application/json'}})}),value=await response.json();
 if(!response.ok)throw new Error(value.error??'局域网共享操作失败');
 if(typeof value.enabled!=='boolean'||!Array.isArray(value.links)||!Array.isArray(value.addresses))throw new Error('无法读取局域网共享设置');
 if(init?.method&&init.method!=='GET')window.dispatchEvent(new CustomEvent(sharingChanged,{detail:value}));return value;
}
export function useLanSharingState(onError?:(message:string)=>void){
 const [state,setState]=useState<LanSharingState>();
 useEffect(()=>{let live=true,pending=false,revision=0;
  const refresh=async()=>{if(pending)return;pending=true;const observed=revision;try{const value=await sharingAPI('/api/sharing');if(live&&observed===revision){setState(value);onError?.('');}}catch(error){if(live)onError?.(error instanceof Error?error.message:'暂时无法读取共享设置，请稍后重试。');}finally{pending=false;}};
  const changed=(event:Event)=>{revision++;setState((event as CustomEvent<LanSharingState>).detail);};
  window.addEventListener(sharingChanged,changed);window.addEventListener('focus',refresh);const timer=setInterval(()=>void refresh(),5000);void refresh();
  return()=>{live=false;clearInterval(timer);window.removeEventListener(sharingChanged,changed);window.removeEventListener('focus',refresh);};
 },[onError]);return state;
}
export async function copySharingText(text:string){
 if(window.mokiDesktop?.copyText){if(!await window.mokiDesktop.copyText(text))throw new Error('复制失败');}
 else await navigator.clipboard.writeText(text);
}
