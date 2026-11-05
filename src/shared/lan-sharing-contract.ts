export type SharedBoardLink={boardId:string;title:string;createdAt:string;urls:string[];onlineCount?:number;visitCount?:number};
export type LanSharingState={enabled:boolean;port:number|null;addresses:Array<{name:string;address:string}>;links:SharedBoardLink[]};
export type SharedPresence={onlineCount:number};
export type SharedVisit={id:number;boardId:string;boardTitle:string;startedAt:string;lastSeenAt:string;endedAt:string|null;online:boolean;address:string;client:string;durationSeconds:number};
export type SharedVisitHistory={items:SharedVisit[];total:number;onlineCount:number;page:number;pageSize:number};
export type SharedAttachment={id:string;pageId:string;name:string;url:string;previewUrl?:string;mimeType:string;kind:'image'|'media'|'resource'|'link';mediaKind?:'audio'|'video'};
