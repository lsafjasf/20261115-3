const root = document.documentElement;
const toggle = document.getElementById("themeToggle");

function applyTheme(theme) {
  root.dataset.theme = theme;
  toggle.textContent = theme === "light" ? "切换到深色主题" : "切换到浅色主题";
}

toggle.addEventListener("click", () => {
  applyTheme(root.dataset.theme === "light" ? "dark" : "light");
});

const vol = document.getElementById("vol");
const volValue = document.getElementById("volValue");
vol.addEventListener("input", () => {
  volValue.textContent = vol.value;
});

document.querySelectorAll(".tag-remove").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tag = btn.closest(".tag");
    if (tag) tag.remove();
  });
});
