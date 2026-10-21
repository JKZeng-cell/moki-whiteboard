#!/usr/bin/env node
import { resolve } from "node:path";
import {fileURLToPath} from 'node:url';
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WhiteboardStore } from "../server/store.js";
import { createMcpServer } from "./create-server.js";

const dataPath = process.env.MOKI_WHITEBOARD_DATA ?? fileURLToPath(new URL('../../data/moki-whiteboard.db',import.meta.url));
const store = new WhiteboardStore(dataPath);
const server = createMcpServer(store);
const transport = new StdioServerTransport();

let closed=false;
const close = async () => {
  if(closed)return;closed=true;
  await server.close();
  store.close();
};
process.on("SIGINT", () => void close());
process.on("SIGTERM", () => void close());

await server.connect(transport);
const onClose=transport.onclose;transport.onclose=()=>{onClose?.();void close();};
console.error(`MOKI 白板 MCP 已连接；数据文件：${dataPath}`);
