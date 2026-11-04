export type SharedBoardLink={boardId:string;title:string;createdAt:string;urls:string[]};
export type LanSharingState={enabled:boolean;port:number|null;addresses:Array<{name:string;address:string}>;links:SharedBoardLink[]};
