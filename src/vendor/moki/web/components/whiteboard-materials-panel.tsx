import {ExternalLink,Eye,File as FileIcon,Image as ImageIcon,Link2,PanelRightClose,PanelRightOpen,Search,X} from 'lucide-react';
export type WhiteboardMaterial = {
  shapeId: string;
  name: string;
  kind: "image" | "link" | "resource" | "media";
  previewUrl?: string;
  openUrl?: string;
  localPath?: string;
  mediaKind?: "audio" | "video";
  libraryItemId?: string;
};
type Props={
 materialPanelOpen:boolean;setMaterialPanelOpen:(open:boolean)=>void;currentMaterials:WhiteboardMaterial[];filteredMaterials:WhiteboardMaterial[];materialQuery:string;setMaterialQuery:(query:string)=>void;
 locateMaterial:(id:string)=>void;setPreviewMaterial:(material:WhiteboardMaterial)=>void;openMaterial:(material:WhiteboardMaterial)=>void;
 canOpenMaterial?:(material:WhiteboardMaterial)=>boolean;
 renamingMaterialId?:string|undefined;materialRenameValue?:string;setMaterialRenameValue?:(value:string)=>void;beginMaterialRename?:(material:WhiteboardMaterial)=>void;commitMaterialRename?:(material:WhiteboardMaterial)=>void;cancelMaterialRename?:()=>void;
};
export function WhiteboardMaterialsPanel({materialPanelOpen,setMaterialPanelOpen,currentMaterials,filteredMaterials,materialQuery,setMaterialQuery,locateMaterial,setPreviewMaterial,openMaterial,canOpenMaterial,renamingMaterialId,materialRenameValue='',setMaterialRenameValue,beginMaterialRename,commitMaterialRename,cancelMaterialRename}:Props){
 return <>{materialPanelOpen ? (
                <aside
                  aria-label="当前页面素材列表"
                  data-whiteboard-control-surface
                  className="absolute bottom-24 right-3 top-16 z-30 flex w-72 flex-col overflow-hidden rounded-2xl border border-[#e2e4ed] bg-white/95 shadow-[0_14px_36px_rgba(35,39,61,.18)] backdrop-blur"
                >
                  <header className="flex h-9 shrink-0 items-center justify-between px-3">
                    <div className="flex min-w-0 items-center gap-1.5"><b className="truncate text-[0.75rem] leading-none text-[#30364d]">当前页面素材</b><span className="inline-flex h-4 shrink-0 items-center rounded-full bg-[#efedff] px-1.5 text-[0.5625rem] font-bold leading-none text-[#625bc5]">{currentMaterials.length} 项</span></div>
                    <button type="button" aria-label="收起素材列表" onClick={() => setMaterialPanelOpen(false)} className="grid size-7 place-items-center border-0 bg-transparent p-0 text-[#73798b] shadow-none transition hover:text-[#625bc5]"><PanelRightClose size={15}/></button>
                  </header>
                  <div className="border-b border-[#eceef4] px-3 pb-2">
                    <label className="relative block">
                      <Search size={13} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9ba0af]"/>
                      <input aria-label="搜索当前页面素材" value={materialQuery} onChange={(event) => setMaterialQuery(event.target.value)} placeholder="搜索素材名称或路径" className="h-8 w-full rounded-lg border border-[#e1e4ed] bg-[#f8f9fc] pl-8 pr-8 text-[0.6875rem] font-semibold text-[#43495d] outline-none transition placeholder:text-[#a0a5b5] focus:border-[#8881da] focus:bg-white"/>
                      {materialQuery ? <button type="button" aria-label="清除素材搜索" onClick={() => setMaterialQuery("")} className="absolute right-1 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-[#9297a7] hover:bg-[#eceafd] hover:text-[#625bc5]"><X size={12}/></button> : null}
                    </label>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto p-2">
                    {filteredMaterials.length ? filteredMaterials.map((material) => {
                      const Icon = material.kind === "image" ? ImageIcon : material.kind === "link" ? Link2 : FileIcon;
                      return <article key={material.shapeId} role="button" tabIndex={renamingMaterialId === material.shapeId ? -1 : 0} aria-label={`定位 ${material.name}`} onClick={() => { if (renamingMaterialId !== material.shapeId) locateMaterial(material.shapeId); }} onKeyDown={(event) => { if (renamingMaterialId !== material.shapeId && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); locateMaterial(material.shapeId); } }} className="group mb-1.5 cursor-pointer rounded-xl border border-[#eceef4] bg-[#fafbfe] p-2 transition hover:border-[#d7d3f5] hover:bg-white"><div className="flex items-center gap-1.5">{material.kind === "image" && material.previewUrl ? <img src={material.previewUrl} alt="" aria-hidden="true" className="size-8 shrink-0 rounded-lg border border-[#e0e2ec] bg-white object-cover" /> : <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#ebeafd] text-[#625bc5]"><Icon size={14}/></span>}{renamingMaterialId === material.shapeId ? <input autoFocus aria-label={`重命名 ${material.name}`} value={materialRenameValue} maxLength={200} onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onChange={(event) => setMaterialRenameValue?.(event.target.value)} onBlur={() => commitMaterialRename?.(material)} onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter") { event.preventDefault(); commitMaterialRename?.(material); } else if (event.key === "Escape") { event.preventDefault(); cancelMaterialRename?.(); } }} className="h-7 min-w-0 flex-1 rounded-md border border-[#8881da] bg-white px-2 text-[0.6875rem] font-bold text-[#43495d] outline-none ring-2 ring-[#8881da]/15" /> : <span className="min-w-0 flex-1 truncate text-left text-[0.6875rem] font-bold text-[#43495d]" title={beginMaterialRename ? `${material.name} · 双击重命名` : material.name} onDoubleClick={(event) => { event.stopPropagation(); beginMaterialRename?.(material); }}>{material.name}</span>}<div className="flex shrink-0 items-center gap-0.5"><button type="button" aria-label={`预览 ${material.name}`} title="预览" disabled={!material.previewUrl || renamingMaterialId === material.shapeId} onClick={(event) => { event.stopPropagation(); setPreviewMaterial(material); }} className="grid size-7 place-items-center rounded-lg text-[#6761bf] hover:bg-[#f5f3ff] disabled:opacity-35"><Eye size={13}/></button><button type="button" aria-label={`打开 ${material.name}`} title="打开" disabled={renamingMaterialId === material.shapeId || (canOpenMaterial && !canOpenMaterial(material))} onClick={(event) => { event.stopPropagation(); openMaterial(material); }} className="grid size-7 place-items-center rounded-lg text-[#6761bf] hover:bg-[#f5f3ff] disabled:opacity-35"><ExternalLink size={13}/></button></div></div></article>;
                    }) : <div className="grid h-full min-h-32 place-items-center px-4 text-center"><p className="text-[0.6875rem] text-[#979cad]">{currentMaterials.length ? "没有匹配的素材。" : "当前页面暂无图片、链接或资料库文件。"}</p></div>}
                  </div>
                </aside>
              ) : (
                <button type="button" data-whiteboard-control-button aria-label="展开素材列表" title="当前页面素材" onClick={() => setMaterialPanelOpen(true)} className="absolute right-3 top-16 z-30 grid size-9 place-items-center rounded-xl border border-[#e2e4ed] bg-white/95 text-[#625bc5] shadow-sm"><PanelRightOpen size={16}/></button>
              )}</>;
}
