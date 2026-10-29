// English discovery metadata complements the existing Chinese descriptions.
// Tool names, schemas, permissions, and execution semantics remain unchanged.
export const MCP_TOOL_DESCRIPTIONS_EN: Record<string, string> = {
  whiteboard_list: 'List local whiteboards. Start here to choose an explicit boardId before inspecting or editing.',
  whiteboard_create: 'Create a local whiteboard with one empty page. Returns the new board ID and version.',
  whiteboard_inspect: 'Inspect pages, element IDs, text, bounds, styles, version, and agent context. Read before and after editing. The default board is the most recently updated, not necessarily the board open in the UI.',
  whiteboard_rename: 'Rename an explicit board. Supply expectedVersion from inspect for conflict protection.',
  whiteboard_duplicate: 'Duplicate all pages and content of a board, preserving image and file references.',
  whiteboard_delete_board: 'Permanently delete an explicit board; requires confirm=true. Prefer expectedVersion. Does not delete original mapped files.',
  whiteboard_get_thumbnail: 'Read the last saved board screenshot and its version. A thumbnail may be unavailable until the board has been opened and saved in the UI.',
  whiteboard_create_page: 'Create a page in an explicit board and make it the current page.',
  whiteboard_manage_pages: 'List, rename, reorder, group, or delete pages. Deleting a page also deletes its content; at least one page must remain.',
  whiteboard_manage_page_groups: 'List, create, rename, or delete page groups. Deleting a group preserves its pages as ungrouped.',
  whiteboard_add_elements: 'Add sticky notes, text, shapes, arrows, drawings, mind maps, images, files, or links in batches. Positions use canvas world coordinates; omitted positions are arranged automatically.',
  whiteboard_update_elements: 'Update text, position, size, color, or rotation by exact element IDs.',
  whiteboard_align_elements: 'Align or evenly distribute two or more elements using their exact IDs.',
  whiteboard_delete_elements: 'Delete only the explicitly listed element IDs, not pages or entire boards.',
  whiteboard_export: 'Export a snapshot and .moki download URL (requires the HTTP API). With includeArchive=true, return a self-contained Base64 ZIP with images/files, up to 8 MiB; use app or HTTP export for larger boards.',
  whiteboard_native_edit: 'Use the native canvas editor for properties, grouping, collapsing groups into virtual folders, expanding folders, and mind-map branches. Inspect/export exact IDs and records first. Rotation is in degrees.',
};
