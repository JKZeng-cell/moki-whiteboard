type FetchImplementation = typeof globalThis.fetch;

export type ApiFetchOptions = {
  fetchImpl?: FetchImplementation;
  readAttempts?: number;
  readAttemptTimeoutMs?: number;
  readRecoveryTimeoutMs?: number;
  safeWriteAttempts?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
};

const RETRYABLE_STATUS = new Set([502, 503, 504]);
const READ_TIMEOUT_HEADER = "x-moki-read-timeout-ms";

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method ?? (input instanceof Request ? input.method : "GET"))
    .toUpperCase();
}

function requestUrl(input: RequestInfo | URL): string {
  if (input instanceof Request) return input.url;
  return String(input);
}

function isWorkbenchApiRequest(input: RequestInfo | URL): boolean {
  const value = requestUrl(input);
  if (value.startsWith("/api/")) return true;
  try {
    const url = new URL(value, globalThis.location?.href ?? "http://localhost/");
    return url.origin === globalThis.location?.origin && url.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function requestSignal(
  input: RequestInfo | URL,
  init?: RequestInit,
): AbortSignal | undefined {
  return init?.signal ?? (input instanceof Request ? input.signal : undefined);
}

function timedSignal(
  source: AbortSignal | undefined,
  timeoutMs: number,
): {
  signal: AbortSignal;
  didTimeOut(): boolean;
  dispose(): void;
} {
  const controller = new AbortController();
  let timedOut = false;
  const forwardAbort = () => controller.abort(source?.reason);
  if (source?.aborted) {
    forwardAbort();
  } else {
    source?.addEventListener("abort", forwardAbort, { once: true });
  }
  const timer = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    didTimeOut: () => timedOut,
    dispose() {
      globalThis.clearTimeout(timer);
      source?.removeEventListener("abort", forwardAbort);
    },
  };
}

function isSafeRetryableWrite(init?: RequestInit): boolean {
  return new Headers(init?.headers).get("x-moki-retryable-write") === "true";
}

function requestedReadTimeout(init?: RequestInit): number | undefined {
  const raw = new Headers(init?.headers).get(READ_TIMEOUT_HEADER);
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) return undefined;
  return Math.max(250, Math.min(120_000, Math.round(value)));
}

function connectionError(error: unknown, retried: boolean): Error {
  return new Error(
    retried
      ? "本地工作台服务连接短暂中断，已等待服务恢复并自动重试，但本次请求仍未完成。请稍候再次操作。"
      : "本地工作台服务连接短暂中断，本次操作未自动重放，请确认页面状态后再试。",
    { cause: error },
  );
}

export function createApiFetch(options: ApiFetchOptions = {}): FetchImplementation {
  const fetchImpl: FetchImplementation = options.fetchImpl ??
    ((input, init) => globalThis.fetch(input, init));
  const readAttempts = Math.max(1, options.readAttempts ?? 6);
  const readAttemptTimeoutMs = Math.max(
    250,
    options.readAttemptTimeoutMs ?? 4_000,
  );
  const readRecoveryTimeoutMs = Math.max(
    readAttemptTimeoutMs,
    options.readRecoveryTimeoutMs ?? 8_000,
  );
  const safeWriteAttempts = Math.max(1, options.safeWriteAttempts ?? 4);
  const sleep = options.sleep ?? delay;
  const random = options.random ?? Math.random;

  const retryDelay = (attempt: number, remainingMs: number) =>
    Math.min(
      1_200,
      150 * 2 ** (attempt - 1) + Math.floor(random() * 350),
      Math.max(0, remainingMs),
    );

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const isLocalApi = isWorkbenchApiRequest(input);
    if (!isLocalApi) return fetchImpl(input, init);

    const method = requestMethod(input, init);
    const isRead = method === "GET" || method === "HEAD";
    const safeWrite = !isRead && isSafeRetryableWrite(init);
    const canRetry = isRead || safeWrite;
    const attempts = isRead
      ? readAttempts
      : safeWrite
        ? safeWriteAttempts
        : 1;
    const requestReadAttemptTimeoutMs = isRead
      ? requestedReadTimeout(init) ?? readAttemptTimeoutMs
      : readAttemptTimeoutMs;
    // Long-polling endpoints deliberately wait for state changes. Give an
    // explicitly declared long read enough time to complete and retain a
    // small recovery window for an actual transient disconnect.
    const requestReadRecoveryTimeoutMs = isRead
      ? Math.max(
          readRecoveryTimeoutMs,
          requestReadAttemptTimeoutMs + (requestedReadTimeout(init) ? 4_000 : 0),
        )
      : readRecoveryTimeoutMs;
    const readDeadline = isRead
      ? Date.now() + requestReadRecoveryTimeoutMs
      : Number.POSITIVE_INFINITY;
    const sourceSignal = requestSignal(input, init);
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const remainingMs = readDeadline - Date.now();
      if (isRead && remainingMs <= 0) break;
      const attemptSignal = isRead
        ? timedSignal(
            sourceSignal,
            Math.max(1, Math.min(requestReadAttemptTimeoutMs, remainingMs)),
          )
        : undefined;
      try {
        const requestInit = isRead
          ? {
              ...init,
              cache: "no-store" as const,
              signal: attemptSignal!.signal,
            }
          : init;
        const response = await fetchImpl(input, requestInit);
        if (canRetry && RETRYABLE_STATUS.has(response.status)) {
          lastError = new Error(`Local API returned HTTP ${response.status}`);
          await response.body?.cancel().catch(() => undefined);
          if (attempt < attempts) {
            await sleep(retryDelay(attempt, readDeadline - Date.now()));
            continue;
          }
          break;
        }
        return response;
      } catch (error) {
        if (sourceSignal?.aborted) throw error;
        lastError = attemptSignal?.didTimeOut()
          ? new Error("Local API read timed out", { cause: error })
          : error;
        if (isAbortError(error) && !attemptSignal?.didTimeOut()) {
          throw error;
        }
        if (attempt < attempts) {
          await sleep(retryDelay(attempt, readDeadline - Date.now()));
          continue;
        }
      } finally {
        attemptSignal?.dispose();
      }
    }

    throw connectionError(lastError, attempts > 1);
  };
}

export function scopedApiUrl(input: string): string {
  if (!input.startsWith('/api/')) return input;
  const match = globalThis.location?.pathname.match(/^\/board\/([^/]+)/);
  if (!match?.[1]) return input;
  const url = new URL(input, globalThis.location.origin);
  url.searchParams.set('boardId', decodeURIComponent(match[1]));
  return url.pathname + url.search;
}

export function getNativeClientActor(): string {
  if(!globalThis.sessionStorage)return 'native-ui';
  let id=sessionStorage.getItem('moki-whiteboard-client');
  if(!id){id=crypto.randomUUID();sessionStorage.setItem('moki-whiteboard-client',id);}
  return 'native-ui:'+id;
}
export const apiFetch=createApiFetch({fetchImpl:(input,init)=>{
  if(typeof input!=='string'||!input.startsWith('/api/'))return fetch(input,init);
  const headers=new Headers(init?.headers);headers.set('x-moki-actor',getNativeClientActor());
  return fetch(scopedApiUrl(input),{...init,headers});
}});
