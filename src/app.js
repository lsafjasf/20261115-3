import { closeDialog, initDialogs, openDialog } from "./focus-manager.js";
import { initCanvas } from "./canvas.js";

const toast = document.querySelector("#toast");
let toastTimer;

function showToast(message) {
  window.clearTimeout(toastTimer);
  toast.textContent = "";
  toast.classList.add("is-visible");
  requestAnimationFrame(() => {
    toast.textContent = message;
  });
  toastTimer = window.setTimeout(() => {
    toast.classList.remove("is-visible");
    toast.textContent = "";
  }, 3200);
}

function clearFieldError(errorElement, field) {
  if (!errorElement) return;
  errorElement.textContent = "";
  errorElement.hidden = true;
  field?.removeAttribute("aria-invalid");
}

function showFieldError(errorElement, field, message) {
  errorElement.hidden = false;
  errorElement.textContent = message;
  field?.setAttribute("aria-invalid", "true");
  field?.focus();
}

function resetDialogErrors(dialog) {
  dialog.querySelectorAll(".form-error").forEach((error) => {
    error.textContent = "";
    error.hidden = true;
  });
  dialog.querySelectorAll("[aria-invalid='true']").forEach((field) => {
    field.removeAttribute("aria-invalid");
  });
}

initDialogs();

const dialogPairs = [
  ["#open-share", "#share-dialog"],
  ["#open-export", "#export-dialog"],
  ["#open-board", "#board-dialog"],
  ["#open-shortcuts", "#shortcuts-dialog"],
];

function openFrom(trigger, dialog) {
  resetDialogErrors(dialog);
  openDialog(dialog, trigger);
}

dialogPairs.forEach(([triggerSelector, dialogSelector]) => {
  const trigger = document.querySelector(triggerSelector);
  const dialog = document.querySelector(dialogSelector);
  trigger.addEventListener("click", () => openFrom(trigger, dialog));
  dialog.addEventListener("dialog:open", () => resetDialogErrors(dialog));
});

const shortcutsDialog = document.querySelector("#shortcuts-dialog");

initCanvas({
  openShortcuts: () => {
    const trigger = document.querySelector("#open-shortcuts");
    openDialog(shortcutsDialog, trigger);
  },
});

const shareForm = document.querySelector("#share-form");
const shareEmail = document.querySelector("#share-email");
const shareErrors = document.querySelector("#share-errors");

shareForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const addresses = shareEmail.value
    .split(/[,;]/)
    .map((value) => value.trim())
    .filter(Boolean);
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (addresses.length === 0) {
    showFieldError(shareErrors, shareEmail, "请输入受邀成员的邮箱地址。");
    return;
  }

  if (addresses.some((address) => !emailPattern.test(address))) {
    showFieldError(shareErrors, shareEmail, "邮箱格式不正确，请检查后重试，例如 name@studio.com。");
    return;
  }

  clearFieldError(shareErrors, shareEmail);
  closeDialog(shareForm.closest("dialog"));
  showToast(`邀请已发送给 ${addresses.length} 位成员`);
});

shareEmail.addEventListener("input", () => clearFieldError(shareErrors, shareEmail));

const exportForm = document.querySelector("#export-form");
const exportErrors = document.querySelector("#export-errors");

exportForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const format = exportForm.querySelector("input[name='format']:checked");

  if (!format) {
    exportErrors.hidden = false;
    exportErrors.textContent = "请选择一种文件格式。";
    exportForm.querySelector("input[name='format']").focus();
    return;
  }

  exportErrors.hidden = true;
  exportErrors.textContent = "";
  const dialog = exportForm.closest("dialog");
  closeDialog(dialog);
  showToast(`${format.value.toUpperCase()} 文件已生成`);
});

const boardForm = document.querySelector("#board-form");
const boardName = document.querySelector("#board-name");
const boardNameError = document.querySelector("#board-name-error");

boardForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!boardName.value.trim()) {
    showFieldError(boardNameError, boardName, "请输入画板名称后再创建。");
    return;
  }

  clearFieldError(boardNameError, boardName);
  const selectedSize = boardForm.querySelector("input[name='boardSize']:checked");
  closeDialog(boardForm.closest("dialog"));
  showToast(`${boardName.value.trim()} · ${selectedSize.value} 已创建`);
});

boardName.addEventListener("input", () => clearFieldError(boardNameError, boardName));

const layerSearch = document.querySelector("#tool-search");
layerSearch.addEventListener("input", () => {
  const query = layerSearch.value.trim().toLowerCase();
  document.querySelectorAll(".layer-item").forEach((item) => {
    item.hidden = Boolean(query) && !item.textContent.toLowerCase().includes(query);
  });
});

document.querySelectorAll(".property-field input").forEach((input) => {
  input.addEventListener("change", () => showToast("图层尺寸已更新"));
});

let zoom = 82;
const artboardWrap = document.querySelector(".artboard-wrap");
const zoomValue = document.querySelector("#zoom-value");

function updateZoom(nextZoom) {
  zoom = Math.min(120, Math.max(50, nextZoom));
  artboardWrap.style.transform = `scale(${zoom / 82})`;
  artboardWrap.style.transformOrigin = "center center";
  zoomValue.textContent = `${zoom}%`;
}

document.querySelector("#zoom-in").addEventListener("click", () => updateZoom(zoom + 8));
document.querySelector("#zoom-out").addEventListener("click", () => updateZoom(zoom - 8));
