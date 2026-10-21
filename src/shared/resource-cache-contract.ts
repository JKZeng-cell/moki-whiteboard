export type ResourceCacheSettings={path:string;defaultPath:string;pendingPath:string|null;error:string|null};
export type ResourceCacheBridge={get():Promise<ResourceCacheSettings>;set(path:string|null):Promise<ResourceCacheSettings>};
