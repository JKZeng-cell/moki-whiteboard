export const WORKBENCH_DATA_UPDATED_EVENT = "workbench:data-updated";
export const ASSISTANT_MEDIA_INSERT_EVENT = "workbench:assistant-media-insert";
export const PENDING_ASSISTANT_MEDIA_KEY = "moki.pending-assistant-media";

export type AssistantMediaInsertRequest = {
  requestId?: string;
  url: string;
  name: string;
  mediaType?: string;
  kind?: "image";
};

export function dispatchAssistantMediaInsert(
  detail: AssistantMediaInsertRequest,
): void {
  window.dispatchEvent(
    new CustomEvent<AssistantMediaInsertRequest>(ASSISTANT_MEDIA_INSERT_EVENT, {
      detail,
    }),
  );
}

export type WhiteboardExportEventRequest = {
  pageId: string;
  scope: "selection" | "canvas";
  shapeIds: string[];
  padding: number;
  fileName?: string;
};

export type WorkbenchDataUpdatedDetail = {
  origin?: string;
  resource?: string;
  operation?: string;
  actionId?: string;
  itemId?: string;
  version?: number;
  pageVersion?: number;
  pageId?: string;
  changedShapeIds?: string[];
  exportRequests?: WhiteboardExportEventRequest[];
};

export function dispatchWorkbenchDataUpdated(
  detail?: WorkbenchDataUpdatedDetail,
): void {
  window.dispatchEvent(
    new CustomEvent<WorkbenchDataUpdatedDetail>(
      WORKBENCH_DATA_UPDATED_EVENT,
      detail ? { detail } : undefined,
    ),
  );
}

export function forwardWorkbenchServerUpdate(event: Event): void {
  let detail: WorkbenchDataUpdatedDetail | undefined;
  const data = "data" in event ? (event as MessageEvent<unknown>).data : undefined;
  if (typeof data === "string" && data) {
    try {
      const decoded = JSON.parse(data) as WorkbenchDataUpdatedDetail & {
        payload?: WorkbenchDataUpdatedDetail;
      };
      detail = decoded.payload ?? decoded;
    } catch {
      // Older or malformed event payloads should still trigger a general refresh.
    }
  }
  dispatchWorkbenchDataUpdated(detail);
}

export function isWorkbenchDataUpdateFor(
  event: Event,
  resource: string,
): boolean {
  const detail = (event as CustomEvent<WorkbenchDataUpdatedDetail>).detail;
  return !detail?.resource || detail.resource === resource;
}
