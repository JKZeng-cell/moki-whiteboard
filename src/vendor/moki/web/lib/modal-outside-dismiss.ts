const MODAL_SELECTOR = [
  '[role="dialog"][aria-modal="true"]',
  '[role="alertdialog"][aria-modal="true"]',
].join(",");
const FULLSCREEN_LAYER_SELECTOR = ".fixed.inset-0, .absolute.inset-0";
const CLOSE_BUTTON_SELECTOR = [
  "button[data-modal-close]",
  'button[aria-label*="关闭"]',
  'button[aria-label*="取消"]',
  'button[aria-label*="稍后"]',
].join(",");
const TRANSIENT_SELECTOR = [
  '[role="menu"]',
  '[role="listbox"]',
  '.moki-menu-surface:not([data-outside-dismiss="false"])',
  '[data-outside-dismiss="true"]',
].join(",");

function isAvailableModal(element: HTMLElement): boolean {
  return !element.hidden
    && element.getAttribute("aria-hidden") !== "true"
    && getComputedStyle(element).display !== "none"
    && getComputedStyle(element).visibility !== "hidden";
}

function findCloseButton(dialog: HTMLElement): HTMLButtonElement | undefined {
  const labelledButton = dialog.querySelector<HTMLButtonElement>(CLOSE_BUTTON_SELECTOR);
  if (labelledButton && !labelledButton.disabled) return labelledButton;

  return Array.from(dialog.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => !button.disabled && ["取消", "稍后", "稍后设置"].includes(button.textContent?.trim() ?? ""));
}

function shouldPreserveFormPointer(target: Element): boolean {
  return Boolean(target.closest([
    "input:not(:disabled)",
    "textarea:not(:disabled)",
    "select:not(:disabled)",
    "label",
    '[contenteditable="true"]',
    '[role="textbox"]',
  ].join(",")));
}

function dismissTopTransientFromTarget(target: Element): boolean {
  const surface = Array.from(document.querySelectorAll<HTMLElement>(TRANSIENT_SELECTOR))
    .filter((element) => isAvailableModal(element) && element.dataset.outsideDismiss !== "false")
    .at(-1);
  if (!surface || surface.contains(target)) return false;
  // Closing an unrelated menu must not consume the first click intended to
  // focus a form control. Chromium suppresses the native focus step whenever
  // pointerdown is prevented, which otherwise makes inputs appear to work only
  // on a second click in the desktop client.
  const passThrough = surface.dataset.outsideDismiss === "pass-through"
    || shouldPreserveFormPointer(target);

  const id = surface.id;
  const controlledTrigger = id
    ? document.querySelector<HTMLButtonElement>(`button[aria-controls="${CSS.escape(id)}"][aria-expanded="true"]`)
    : undefined;
  const localTrigger = surface.parentElement?.querySelector<HTMLButtonElement>(
    ':scope > button[aria-expanded="true"], :scope > button[aria-haspopup], :scope > button[data-popup-trigger]',
  );
  const expandedTrigger = surface.dataset.mokiSubmenuPortal
    ? document.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"][aria-expanded="true"]')
    : undefined;
  const trigger = controlledTrigger ?? localTrigger ?? expandedTrigger;
  if (trigger?.contains(target)) return false;
  if (trigger && !trigger.disabled) {
    trigger.click();
    return !passThrough;
  }

  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  surface.dispatchEvent(escape);
  if (!escape.defaultPrevented) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  return !passThrough;
}

export function dismissTopModalFromTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(".desktop-window-resize-handle")) return false;
  if (target.closest("[data-moki-floating-layer='true'], .moki-assistant-floating")) return false;

  if (dismissTopTransientFromTarget(target)) return true;

  const dialog = Array.from(document.querySelectorAll<HTMLElement>(`${MODAL_SELECTOR}, ${FULLSCREEN_LAYER_SELECTOR}`))
    .filter((element) => isAvailableModal(element)
      && (element.matches(MODAL_SELECTOR) || Boolean(findCloseButton(element))))
    .at(-1);
  if (!dialog || dialog.dataset.outsideDismiss === "false") return false;

  const dialogIsBackdrop = dialog.matches(FULLSCREEN_LAYER_SELECTOR);
  if (dialog.contains(target) && !(dialogIsBackdrop && target === dialog)) return false;

  const closeButton = findCloseButton(dialog);
  if (!closeButton) return false;
  closeButton.click();
  return true;
}

export function installModalOutsideDismiss(): () => void {
  const handlePointerDown = (event: PointerEvent) => {
    if (!dismissTopModalFromTarget(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
  };
  document.addEventListener("pointerdown", handlePointerDown, true);
  return () => document.removeEventListener("pointerdown", handlePointerDown, true);
}
