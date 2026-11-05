export type SharedBoardLink={boardId:string;title:string;createdAt:string;urls:string[]};
export type LanSharingState={enabled:boolean;port:number|null;addresses:Array<{name:string;address:string}>;links:SharedBoardLink[]};
export type SharedAttachment={id:string;pageId:string;name:string;url:string;previewUrl?:string;mimeType:string;kind:'image'|'media'|'resource'|'link';mediaKind?:'audio'|'video'};
