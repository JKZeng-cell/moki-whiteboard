import type {FastifyInstance} from 'fastify';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {WhiteboardStore} from './store.js';

export function registerThumbnailRoutes(app:FastifyInstance,store:WhiteboardStore){
 app.addContentTypeParser('application/x-moki-board-thumbnail',{parseAs:'buffer',bodyLimit:1024*1024},(_request,body,done)=>done(null,body));
 app.put('/api/boards/:id/thumbnail',{bodyLimit:1024*1024},async(request,reply)=>{
  const {id}=z.object({id:z.string().min(1)}).parse(request.params);
  const version=z.coerce.number().int().positive().parse(request.headers['x-moki-board-version']);
  const pageId=z.string().min(1).parse(request.headers['x-moki-page-id']);
  const board=store.get(id);
  if(!Object.values(board.snapshot.document.store).some(record=>record.typeName==='page'&&record.id===pageId))return reply.code(400).send({error:'截图页面不存在'});
  if(!Buffer.isBuffer(request.body))return reply.code(400).send({error:'需要二进制截图'});
  let image;
  try{
   const input=sharp(request.body,{limitInputPixels:1024*1024});const metadata=await input.metadata();
   if(!['png','jpeg','webp'].includes(metadata.format??''))throw new Error('图片格式不支持');
   image=await input.resize({width:640,height:400,fit:'inside',withoutEnlargement:true}).webp({quality:82}).toBuffer({resolveWithObject:true});
  }catch{return reply.code(400).send({error:'截图必须是有效的 PNG、JPEG 或 WebP 图片，且不超过一百万像素'});}
  return store.saveThumbnail(id,version,pageId,image.data,image.info.width,image.info.height);
 });
 app.get('/api/boards/:id/thumbnail',async(request,reply)=>{
  const {id}=z.object({id:z.string().min(1)}).parse(request.params);store.get(id);
  const thumbnail=store.thumbnail(id);if(!thumbnail)return reply.code(404).send({error:'尚无编辑截图'});
  const etag='"'+createHash('sha256').update(thumbnail.content).digest('hex')+'"';
  reply.header('etag',etag).header('cache-control','private, max-age=0, must-revalidate');
  if(request.headers['if-none-match']===etag)return reply.code(304).send();
  return reply.type('image/webp').send(thumbnail.content);
 });
}
