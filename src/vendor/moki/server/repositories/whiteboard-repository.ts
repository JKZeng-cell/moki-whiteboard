import { createHash } from "node:crypto";
import {
  WhiteboardSnapshotSchema,
  type WhiteboardLatest,
  type WhiteboardPageSyncResult,
  type WhiteboardSaveResult,
  type WhiteboardSnapshot,
  type WhiteboardVersion,
  type WhiteboardVersionSummary,
} from "../../domain/whiteboard.js";
import type { WorkbenchDatabase } from "../db/database.js";

type WhiteboardRow = {
  version: number;
  snapshot_json: string;
  content_digest: string;
  page_id: string;
  page_name: string;
  page_version: number;
  created_at: string;
};

type WhiteboardPageTarget = {
  pageId: string;
  pageName?: string;
};

export type WhiteboardAsset = {
  id: string;
  mimeType: string;
  fileName: string;
  byteSize: number;
  width?: number;
  height?: number;
  content: Buffer;
  createdAt: string;
};

type WhiteboardAssetRow = {
  id: string;
  mime_type: string;
  file_name: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  content: Uint8Array;
  created_at: string;
};

type WhiteboardAssetMetadataRow = Omit<WhiteboardAssetRow, "content">;

function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function summary(row: WhiteboardRow): WhiteboardVersionSummary {
  return {
    version: Number(row.version),
    pageId: row.page_id,
    pageName: row.page_name,
    pageVersion: Number(row.page_version),
    contentDigest: row.content_digest,
    createdAt: row.created_at,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function resolvePageTarget(
  snapshot: WhiteboardSnapshot,
  target?: WhiteboardPageTarget,
): Required<WhiteboardPageTarget> {
  const records = Object.values(snapshot.document.store);
  const requestedPageId = target?.pageId;
  const sessionPageId = isRecord(snapshot.session)
    ? snapshot.session.currentPageId
    : undefined;
  const page = records.find(
    (record) =>
      record.typeName === "page" &&
      record.id ===
        (requestedPageId ??
          (typeof sessionPageId === "string" ? sessionPageId : undefined)),
  ) ?? records.find((record) => record.typeName === "page");
  const pageId = requestedPageId ?? page?.id ?? "legacy:board";
  return {
    pageId,
    pageName:
      target?.pageName?.trim() ||
      (isRecord(page) && typeof page.name === "string" && page.name.trim()
        ? page.name.trim()
        : "白板"),
  };
}

function pageTargets(snapshot: WhiteboardSnapshot): Array<Required<WhiteboardPageTarget>> {
  return Object.values(snapshot.document.store)
    .filter((record) => record.typeName === "page")
    .sort((left, right) => {
      const leftIndex = typeof left.index === "string" ? left.index : "";
      const rightIndex = typeof right.index === "string" ? right.index : "";
      return leftIndex.localeCompare(rightIndex) || left.id.localeCompare(right.id);
    })
    .map((record) => ({
      pageId: record.id,
      pageName:
        typeof record.name === "string" && record.name.trim()
          ? record.name.trim()
          : "白板",
    }));
}

function pageContentDigest(
  snapshot: WhiteboardSnapshot,
  pageId: string,
): string {
  const records = Object.values(snapshot.document.store) as Array<
    Record<string, unknown> & { id: string; typeName: string }
  >;
  const included = pageRecordIds(records, pageId, true);
  const pageRecords = records
    .filter((record) => included.has(record.id) && record.id !== pageId)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((record) => [record.id, record]);
  return digest(JSON.stringify(pageRecords));
}

function pageRecordIds(
  records: Array<Record<string, unknown> & { id: string; typeName: string }>,
  pageId: string,
  includeAssets: boolean,
): Set<string> {
  const included = new Set([pageId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of records) {
      if (
        typeof record.parentId === "string" &&
        included.has(record.parentId) &&
        !included.has(record.id)
      ) {
        included.add(record.id);
        changed = true;
      }
    }
  }
  for (const record of records) {
    if (record.typeName !== "binding") continue;
    const fromId = typeof record.fromId === "string" ? record.fromId : "";
    const toId = typeof record.toId === "string" ? record.toId : "";
    if (included.has(fromId) || included.has(toId)) included.add(record.id);
  }
  if (includeAssets) {
    for (const record of records) {
      if (!included.has(record.id) || !isRecord(record.props)) continue;
      const assetId = record.props.assetId;
      if (typeof assetId === "string") included.add(assetId);
    }
  }
  return included;
}

function pageSnapshot(
  snapshot: WhiteboardSnapshot,
  pageId: string,
): WhiteboardSnapshot {
  const records = Object.values(snapshot.document.store) as Array<
    Record<string, unknown> & { id: string; typeName: string }
  >;
  const included = pageRecordIds(records, pageId, true);
  const store = Object.fromEntries(
    [...included]
      .sort((left, right) => left.localeCompare(right))
      .flatMap((id) => {
        const record = snapshot.document.store[id];
        return record ? [[id, record] as const] : [];
      }),
  );
  const session = isRecord(snapshot.session)
    ? {
        ...snapshot.session,
        currentPageId: pageId,
        ...(Array.isArray(snapshot.session.pageStates)
          ? {
              pageStates: snapshot.session.pageStates.filter(
                (state) => isRecord(state) && state.pageId === pageId,
              ),
            }
          : {}),
      }
    : { currentPageId: pageId };
  return {
    ...snapshot,
    document: {
      ...snapshot.document,
      store,
    },
    session,
  };
}

function mergePageSnapshot(
  base: WhiteboardSnapshot,
  incoming: WhiteboardSnapshot,
  pageId: string,
): WhiteboardSnapshot {
  const baseRecords = Object.values(base.document.store) as Array<
    Record<string, unknown> & { id: string; typeName: string }
  >;
  const incomingRecords = Object.values(incoming.document.store) as Array<
    Record<string, unknown> & { id: string; typeName: string }
  >;
  const mergedStore = { ...base.document.store };
  for (const id of pageRecordIds(baseRecords, pageId, false)) {
    delete mergedStore[id];
  }
  for (const id of pageRecordIds(incomingRecords, pageId, true)) {
    const record = incoming.document.store[id];
    if (record) mergedStore[id] = record;
  }
  return {
    ...base,
    ...incoming,
    document: {
      ...base.document,
      ...incoming.document,
      store: mergedStore,
    },
  };
}

function parseRow(row: WhiteboardRow): WhiteboardVersion | undefined {
  try {
    const parsed = WhiteboardSnapshotSchema.safeParse(
      JSON.parse(row.snapshot_json),
    );
    if (!parsed.success) return undefined;
    return {
      ...summary(row),
      snapshot: parsed.data,
    };
  } catch {
    return undefined;
  }
}

export class WhiteboardRepository {
  constructor(private readonly db: WorkbenchDatabase) {}

  ensureInitialized(
    value: WhiteboardSnapshot,
    createdAt = new Date().toISOString(),
  ): boolean {
    if (this.latest().snapshot) return false;
    this.save(value, createdAt);
    return true;
  }

  saveAsset(
    content: Buffer,
    input: {
      mimeType: string;
      fileName?: string;
      width?: number;
      height?: number;
      createdAt?: string;
    },
  ): Omit<WhiteboardAsset, "content"> & { src: string; deduplicated: boolean } {
    const id = digest(content);
    const existing = this.findAssetMetadata(id);
    if (!existing) {
      this.db.prepare(`
        INSERT INTO whiteboard_assets(
          id, mime_type, file_name, byte_size, width, height, content, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.mimeType,
        input.fileName?.trim() || "whiteboard-image",
        content.byteLength,
        input.width ?? null,
        input.height ?? null,
        content,
        input.createdAt ?? new Date().toISOString(),
      );
    }
    const value = existing ?? this.findAssetMetadata(id)!;
    return {
      id: value.id,
      mimeType: value.mimeType,
      fileName: value.fileName,
      byteSize: value.byteSize,
      ...(value.width ? { width: value.width } : {}),
      ...(value.height ? { height: value.height } : {}),
      createdAt: value.createdAt,
      src: `/api/whiteboard/assets/${id}`,
      deduplicated: Boolean(existing),
    };
  }

  findAsset(id: string): WhiteboardAsset | undefined {
    const row = this.db.prepare(`
      SELECT id, mime_type, file_name, byte_size, width, height, content, created_at
      FROM whiteboard_assets
      WHERE id = ?
    `).get(id) as WhiteboardAssetRow | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      mimeType: row.mime_type,
      fileName: row.file_name,
      byteSize: Number(row.byte_size),
      ...(row.width ? { width: Number(row.width) } : {}),
      ...(row.height ? { height: Number(row.height) } : {}),
      content: Buffer.from(row.content),
      createdAt: row.created_at,
    };
  }

  private findAssetMetadata(id: string): Omit<WhiteboardAsset, "content"> | undefined {
    const row = this.db.prepare(`
      SELECT id, mime_type, file_name, byte_size, width, height, created_at
      FROM whiteboard_assets
      WHERE id = ?
    `).get(id) as WhiteboardAssetMetadataRow | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      mimeType: row.mime_type,
      fileName: row.file_name,
      byteSize: Number(row.byte_size),
      ...(row.width ? { width: Number(row.width) } : {}),
      ...(row.height ? { height: Number(row.height) } : {}),
      createdAt: row.created_at,
    };
  }

  private externalizeInlineAssets(
    value: WhiteboardSnapshot,
    createdAt: string,
  ): WhiteboardSnapshot {
    const snapshot = structuredClone(value);
    for (const record of Object.values(snapshot.document.store)) {
      if (record.typeName !== "asset" || !isRecord(record.props)) continue;
      const source = record.props.src;
      if (typeof source !== "string" || !source.startsWith("data:image/")) continue;
      const match = /^data:(image\/[a-z0-9.+-]+)(;base64)?,(.*)$/isu.exec(source);
      if (!match) continue;
      try {
        const content = match[2]
          ? Buffer.from(match[3]!, "base64")
          : Buffer.from(decodeURIComponent(match[3]!), "utf8");
        const saved = this.saveAsset(content, {
          mimeType: match[1]!.toLowerCase(),
          ...(typeof record.props.name === "string" ? { fileName: record.props.name } : {}),
          ...(typeof record.props.w === "number" ? { width: record.props.w } : {}),
          ...(typeof record.props.h === "number" ? { height: record.props.h } : {}),
          createdAt,
        });
        record.props = {
          ...record.props,
          src: saved.src,
          fileSize: saved.byteSize,
        };
      } catch {
        // Leave malformed historical inline assets untouched for recovery.
      }
    }
    return snapshot;
  }

  private updateLatestState(
    serialized: string,
    value: WhiteboardVersionSummary,
    updatedAt: string,
  ): void {
    this.db.prepare(`
      INSERT INTO whiteboard_latest_state(
        singleton, version, snapshot_json, content_digest,
        page_id, page_name, page_version, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(singleton) DO UPDATE SET
        version = excluded.version,
        snapshot_json = excluded.snapshot_json,
        content_digest = excluded.content_digest,
        page_id = excluded.page_id,
        page_name = excluded.page_name,
        page_version = excluded.page_version,
        updated_at = excluded.updated_at
    `).run(
      value.version,
      serialized,
      value.contentDigest,
      value.pageId,
      value.pageName,
      value.pageVersion,
      updatedAt,
    );
  }

  private findMatchingPageVersion(
    pageId: string,
    contentDigest: string,
    snapshot: WhiteboardSnapshot,
  ): WhiteboardRow | undefined {
    const exact = this.db
      .prepare(`
        SELECT version, snapshot_json, content_digest,
               page_id, page_name, page_version, created_at
        FROM whiteboard_versions
        WHERE page_id = ? AND content_digest = ?
      `)
      .get(pageId, contentDigest) as WhiteboardRow | undefined;
    if (exact) return exact;
    const latest = this.db
      .prepare(`
        SELECT version, snapshot_json, content_digest,
               page_id, page_name, page_version, created_at
        FROM whiteboard_versions
        WHERE page_id = ?
        ORDER BY page_version DESC
        LIMIT 1
      `)
      .get(pageId) as WhiteboardRow | undefined;
    if (!latest) return undefined;
    const parsed = parseRow(latest);
    if (
      !parsed ||
      pageContentDigest(parsed.snapshot, pageId) !==
        pageContentDigest(snapshot, pageId)
    ) {
      return undefined;
    }
    this.db.prepare(`
      UPDATE whiteboard_versions
      SET content_digest = ?
      WHERE version = ?
    `).run(contentDigest, latest.version);
    return { ...latest, content_digest: contentDigest };
  }

  save(
    value: WhiteboardSnapshot,
    createdAt = new Date().toISOString(),
    target?: WhiteboardPageTarget,
  ): WhiteboardSaveResult {
    const incoming = this.externalizeInlineAssets(
      WhiteboardSnapshotSchema.parse(value),
      createdAt,
    );
    const page = resolvePageTarget(incoming, target);
    const latestSnapshot = this.latest().snapshot;
    const snapshot = latestSnapshot
      ? mergePageSnapshot(latestSnapshot, incoming, page.pageId)
      : incoming;
    const serialized = JSON.stringify(snapshot);
    const serializedPage = JSON.stringify(pageSnapshot(snapshot, page.pageId));
    const contentDigest = digest(
      `${page.pageId}:${pageContentDigest(snapshot, page.pageId)}`,
    );
    this.db.prepare(`
      UPDATE whiteboard_versions
      SET page_name = ?
      WHERE page_id = ? AND page_name <> ?
    `).run(page.pageName, page.pageId, page.pageName);
    const existing = this.findMatchingPageVersion(
      page.pageId,
      contentDigest,
      snapshot,
    );
    if (existing) {
      this.updateLatestState(serialized, summary(existing), createdAt);
      return {
        ...summary(existing),
        deduplicated: true,
      };
    }

    this.db.exec("BEGIN");
    try {
      const pageVersionRow = this.db
        .prepare(`
          SELECT COALESCE(MAX(page_version), 0) + 1 AS page_version
          FROM whiteboard_versions
          WHERE page_id = ?
        `)
        .get(page.pageId) as { page_version: number };
      const inserted = this.db
        .prepare(`
          INSERT INTO whiteboard_versions(
            snapshot_json, content_digest, page_id, page_name,
            page_version, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `)
        .run(
          serializedPage,
          contentDigest,
          page.pageId,
          page.pageName,
          Number(pageVersionRow.page_version),
          createdAt,
        );
      const insertedSummary: WhiteboardVersionSummary = {
        version: Number(inserted.lastInsertRowid),
        pageId: page.pageId,
        pageName: page.pageName,
        pageVersion: Number(pageVersionRow.page_version),
        contentDigest,
        createdAt,
      };
      this.updateLatestState(serialized, insertedSummary, createdAt);
      this.db.prepare(`
        DELETE FROM whiteboard_versions
        WHERE page_id = ? AND version NOT IN (
          SELECT version
          FROM whiteboard_versions
          WHERE page_id = ?
          ORDER BY version DESC
          LIMIT 20
        )
      `).run(page.pageId, page.pageId);
      this.db.exec("COMMIT");
      return {
        ...insertedSummary,
        deduplicated: false,
      };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  syncPages(
    value: WhiteboardSnapshot,
    createdAt = new Date().toISOString(),
  ): WhiteboardPageSyncResult {
    const incoming = this.externalizeInlineAssets(
      WhiteboardSnapshotSchema.parse(value),
      createdAt,
    );
    const incomingPages = pageTargets(incoming);
    if (incomingPages.length === 0) {
      throw new Error("白板至少需要保留一个页面");
    }

    const latestSnapshot = this.latest().snapshot;
    const previousPages = latestSnapshot ? pageTargets(latestSnapshot) : [];
    const incomingPageIds = new Set(incomingPages.map((page) => page.pageId));
    const deletedPageIds = previousPages
      .map((page) => page.pageId)
      .filter((pageId) => !incomingPageIds.has(pageId));
    const changedPages = incomingPages.filter((page) => {
      if (!latestSnapshot?.document.store[page.pageId]) return true;
      return pageContentDigest(latestSnapshot, page.pageId) !==
        pageContentDigest(incoming, page.pageId);
    });
    const changedPageIds = changedPages.map((page) => page.pageId);
    const currentPage = resolvePageTarget(incoming);
    const versionTargets = [...changedPages];
    const serialized = JSON.stringify(incoming);

    this.db.exec("BEGIN");
    try {
      for (const page of incomingPages) {
        this.db.prepare(`
          UPDATE whiteboard_versions
          SET page_name = ?
          WHERE page_id = ? AND page_name <> ?
        `).run(page.pageName, page.pageId, page.pageName);
      }
      const currentExisting = this.db
        .prepare(`
          SELECT version, snapshot_json, content_digest,
                 page_id, page_name, page_version, created_at
          FROM whiteboard_versions
          WHERE page_id = ?
          ORDER BY page_version DESC
          LIMIT 1
        `)
        .get(currentPage.pageId) as WhiteboardRow | undefined;
      if (
        !currentExisting &&
        !versionTargets.some((page) => page.pageId === currentPage.pageId)
      ) {
        versionTargets.push(currentPage);
      }
      let currentResult: WhiteboardSaveResult | undefined = currentExisting
        ? { ...summary(currentExisting), pageName: currentPage.pageName, deduplicated: true }
        : undefined;
      let lastResult: WhiteboardSaveResult | undefined = currentResult;
      for (const page of versionTargets) {
        const contentDigest = digest(
          `${page.pageId}:${pageContentDigest(incoming, page.pageId)}`,
        );
        const existing = this.findMatchingPageVersion(
          page.pageId,
          contentDigest,
          incoming,
        );
        let result: WhiteboardSaveResult;
        if (existing) {
          result = { ...summary(existing), deduplicated: true };
        } else {
          const pageVersionRow = this.db
            .prepare(`
              SELECT COALESCE(MAX(page_version), 0) + 1 AS page_version
              FROM whiteboard_versions
              WHERE page_id = ?
            `)
            .get(page.pageId) as { page_version: number };
          const pageVersion = Number(pageVersionRow.page_version);
          const inserted = this.db
            .prepare(`
              INSERT INTO whiteboard_versions(
                snapshot_json, content_digest, page_id, page_name,
                page_version, created_at
              ) VALUES (?, ?, ?, ?, ?, ?)
            `)
            .run(
              JSON.stringify(pageSnapshot(incoming, page.pageId)),
              contentDigest,
              page.pageId,
              page.pageName,
              pageVersion,
              createdAt,
            );
          result = {
            version: Number(inserted.lastInsertRowid),
            pageId: page.pageId,
            pageName: page.pageName,
            pageVersion,
            contentDigest,
            createdAt,
            deduplicated: false,
          };
          this.db.prepare(`
            DELETE FROM whiteboard_versions
            WHERE page_id = ? AND version NOT IN (
              SELECT version
              FROM whiteboard_versions
              WHERE page_id = ?
              ORDER BY version DESC
              LIMIT 20
            )
          `).run(page.pageId, page.pageId);
        }
        lastResult = result;
        if (page.pageId === currentPage.pageId) currentResult = result;
      }

      for (const pageId of deletedPageIds) {
        this.db.prepare("DELETE FROM whiteboard_versions WHERE page_id = ?")
          .run(pageId);
      }
      const result = currentResult ?? lastResult;
      if (!result) throw new Error("白板页面同步失败");
      this.updateLatestState(serialized, result, createdAt);
      this.db.exec("COMMIT");
      return {
        ...result,
        changedPageIds,
        deletedPageIds,
      };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  list(pageId?: string): WhiteboardVersionSummary[] {
    const rows = (pageId
      ? this.db
          .prepare(`
            SELECT version, snapshot_json, content_digest,
                   page_id, page_name, page_version, created_at
            FROM whiteboard_versions
            WHERE page_id = ?
            ORDER BY page_version DESC
          `)
          .all(pageId)
      : this.db
          .prepare(`
            SELECT version, snapshot_json, content_digest,
                   page_id, page_name, page_version, created_at
            FROM whiteboard_versions
            ORDER BY version DESC
          `)
          .all()) as unknown as WhiteboardRow[];
    return rows.map(summary);
  }

  find(version: number): WhiteboardVersion | undefined {
    const row = this.db
      .prepare(`
        SELECT version, snapshot_json, content_digest,
               page_id, page_name, page_version, created_at
        FROM whiteboard_versions
        WHERE version = ?
      `)
      .get(version) as WhiteboardRow | undefined;
    return row ? parseRow(row) : undefined;
  }

  latest(pageId?: string): WhiteboardLatest {
    if (!pageId) {
      const state = this.db
        .prepare(`
          SELECT version, snapshot_json, content_digest,
                 page_id, page_name, page_version,
                 updated_at AS created_at
          FROM whiteboard_latest_state
          WHERE singleton = 1
        `)
        .get() as WhiteboardRow | undefined;
      if (state) {
        const latestState = parseRow(state);
        if (latestState) {
          return {
            version: latestState.version,
            pageId: latestState.pageId,
            pageName: latestState.pageName,
            pageVersion: latestState.pageVersion,
            snapshot: latestState.snapshot,
            contentDigest: latestState.contentDigest,
            createdAt: latestState.createdAt,
          };
        }
      }
    }
    const rows = (pageId
      ? this.db
          .prepare(`
            SELECT version, snapshot_json, content_digest,
                   page_id, page_name, page_version, created_at
            FROM whiteboard_versions
            WHERE page_id = ?
            ORDER BY page_version DESC
          `)
          .all(pageId)
      : this.db
          .prepare(`
            SELECT version, snapshot_json, content_digest,
                   page_id, page_name, page_version, created_at
            FROM whiteboard_versions
            ORDER BY version DESC
          `)
          .all()) as unknown as WhiteboardRow[];
    const newestVersion = rows[0]?.version;
    if (!pageId) {
      const restoredPageIds = new Set<string>();
      let newestValid: WhiteboardVersion | undefined;
      let restoredSnapshot: WhiteboardSnapshot | undefined;
      for (const row of rows) {
        const version = parseRow(row);
        if (!version) continue;
        newestValid ??= version;
        restoredSnapshot ??= {
          ...version.snapshot,
          document: {
            ...version.snapshot.document,
            store: {},
          },
        };
        const targets = pageTargets(version.snapshot);
        for (const target of targets) {
          if (restoredPageIds.has(target.pageId)) continue;
          restoredPageIds.add(target.pageId);
          Object.assign(
            restoredSnapshot.document.store,
            pageSnapshot(version.snapshot, target.pageId).document.store,
          );
        }
      }
      if (newestValid && restoredSnapshot) {
        return {
          version: newestValid.version,
          pageId: newestValid.pageId,
          pageName: newestValid.pageName,
          pageVersion: newestValid.pageVersion,
          snapshot: restoredSnapshot,
          contentDigest: newestValid.contentDigest,
          createdAt: newestValid.createdAt,
          ...(newestVersion && newestVersion !== newestValid.version
            ? { recoveredFromVersion: Number(newestVersion) }
            : {}),
        };
      }
    }
    for (const row of rows) {
      const version = parseRow(row);
      if (!version) continue;
      return {
        version: version.version,
        pageId: version.pageId,
        pageName: version.pageName,
        pageVersion: version.pageVersion,
        snapshot: version.snapshot,
        contentDigest: version.contentDigest,
        createdAt: version.createdAt,
        ...(newestVersion && newestVersion !== version.version
          ? { recoveredFromVersion: Number(newestVersion) }
          : {}),
      };
    }
    return {
      version: null,
      snapshot: null,
      ...(newestVersion
        ? { recoveredFromVersion: Number(newestVersion) }
        : {}),
    };
  }
}
