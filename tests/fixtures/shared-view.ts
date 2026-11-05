import {createNativeWhiteboardStore,NativeWhiteboardEditor} from '../../src/vendor/moki/web/components/native-whiteboard.js';
import type {WhiteboardSnapshot} from '../../src/core/types.js';
import {nativeRichText} from '../../src/vendor/moki/whiteboard/native-whiteboard-model.js';
export function fixture(){
 const store=createNativeWhiteboardStore(),editor=new NativeWhiteboardEditor(store),snapshot=structuredClone(store.snapshot) as WhiteboardSnapshot,page=editor.getCurrentPageId();
 for(let i=1;i<=2;i++){const id='shape:'+i;snapshot.document.store[id]={id,typeName:'shape',type:'text',x:i*180,y:80,parentId:page,index:'a'+i,rotation:0,opacity:1,props:{w:160,h:60,richText:nativeRichText('内容 '+i),mokiGroupId:'test',mokiGroupLabel:'灵感编组'}};}
 return snapshot;
}
