const DIALOG_SELECTOR = "dialog[open]";
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
  "[contenteditable='true']",
].join(",");

const triggers = new WeakMap();

function focusSentinel() {
  const sentinel = document.querySelector("#dialog-focus-sentinel");
  if (!(sentinel instanceof HTMLElement)) return null;
  sentinel.inert = false;
  sentinel.focus({ preventScroll: true });
  return sentinel;
}

function isVisible(element) {
  if (!(element instanceof HTMLElement) || element.hidden) return false;
  const style = getComputedStyle(element);
  return style.visibility !== "hidden" && style.display !== "none";
}

export function getFocusableElements(dialog) {
  return [...dialog.querySelectorAll(FOCUSABLE_SELECTOR)].filter(
    (element) => !element.closest("[inert]") && isVisible(element),
  );
}

function focusInitialControl(dialog) {
  const preferred = dialog.querySelector("[data-autofocus]");
  const target =
    preferred instanceof HTMLElement && isVisible(preferred)
      ? preferred
      : getFocusableElements(dialog)[0];

  target?.focus({ preventScroll: true });
}

export function openDialog(dialog, trigger) {
  if (!(dialog instanceof HTMLDialogElement) || dialog.open) return;

  if (trigger instanceof HTMLElement) {
    triggers.set(dialog, trigger);
  }

  focusSentinel();
  dialog.showModal();
  dialog.setAttribute("aria-modal", "true");
  focusInitialControl(dialog);
  dialog.dispatchEvent(new CustomEvent("dialog:open"));
}

export function closeDialog(dialog, { restoreFocus = true } = {}) {
  if (!(dialog instanceof HTMLDialogElement) || !dialog.open) return;

  const sentinel = document.querySelector("#dialog-focus-sentinel");
  if (sentinel instanceof HTMLElement) sentinel.inert = true;
  dialog.dataset.restoreFocus = String(restoreFocus);
  dialog.close();
}

function trapTab(event, dialog) {
  const focusable = getFocusableElements(dialog);
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;

  if (!dialog.contains(active)) {
    event.preventDefault();
    first.focus();
    return;
  }

  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

export function initDialogs(root = document) {
  const dialogs = [...root.querySelectorAll("dialog")];

  dialogs.forEach((dialog) => {
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Tab") trapTab(event, dialog);
    });

    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeDialog(dialog);
    });

    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closeDialog(dialog);
    });

    dialog.addEventListener("close", () => {
      const shouldRestore = dialog.dataset.restoreFocus !== "false";
      const trigger = triggers.get(dialog);
      dialog.removeAttribute("aria-modal");
      delete dialog.dataset.restoreFocus;

      if (shouldRestore && trigger?.isConnected) {
        trigger.focus({ preventScroll: true });
      }
      dialog.dispatchEvent(new CustomEvent("dialog:closed"));
    });
  });

  root.addEventListener("click", (event) => {
    const closeButton = event.target.closest("[data-dialog-close]");
    if (closeButton) {
      closeDialog(closeButton.closest("dialog"));
    }
  });
}

export function activeDialog() {
  return document.querySelector(DIALOG_SELECTOR);
}
