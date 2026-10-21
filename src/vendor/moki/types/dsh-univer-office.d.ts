declare module "dsh-univer-office" {
  export type ResolvedUniverConfig = Record<string, unknown>;

  export function resolveConfig(config?: Record<string, unknown>): ResolvedUniverConfig;

  export class GatewayUniverService {
    constructor(context: unknown, config: ResolvedUniverConfig);
    ensureGateway(): Promise<{ ok: true; gateway: string; reused: boolean } | { ok: false; reason: string }>;
    newFile(request: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>;
    status(request: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>;
    fileState(request: Record<string, unknown>): Promise<Record<string, unknown>>;
    worktree(request: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>;
    unit(request: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>;
    importUnitContent(request: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>;
    exportUnitContent(request: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>;
    inspectUnitContent(request: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>;
    executeUnitContent(request: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>;
    lintUnitLayout(request: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>;
    screenshotUnit(request: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>;
    compileSvg(request: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>;
    apiReference(request: Record<string, unknown>): Promise<Record<string, unknown>>;
    resources(request: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>;
    dispose(): Promise<void>;
  }
}
