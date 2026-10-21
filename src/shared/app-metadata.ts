export const APP_NAME='MOKI 白板';
export const APP_DEVELOPER_EMAIL='jkzeng@moge.tv';
export const DEVELOPER_CONTACT_URL='mailto:'+APP_DEVELOPER_EMAIL;
export function isAllowedExternalUrl(value:string){try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)||url.href===DEVELOPER_CONTACT_URL;}catch{return false;}}
