import { resolve } from "node:path";
import { createApp } from "./app.js";
import { WhiteboardStore } from "./store.js";

const host = process.env.MOKI_WHITEBOARD_HOST ?? "127.0.0.1";
const port = Number(process.env.MOKI_WHITEBOARD_PORT ?? 4321);
const dataPath = process.env.MOKI_WHITEBOARD_DATA ?? resolve(process.cwd(), "data/moki-whiteboard.db");
const store = new WhiteboardStore(dataPath);
const app = await createApp({ store });

const close = async () => {
  await app.close();
  store.close();
  process.exit(0);
};
process.on("SIGINT", () => void close());
process.on("SIGTERM", () => void close());

await app.listen({ host, port });
process.stdout.write(`MOKI 白板 API: http://${host}:${port}\n`);
