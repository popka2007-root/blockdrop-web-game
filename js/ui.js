export function byId(id, root = document) {
  return root.getElementById(id);
}

export function setHidden(element, hidden) {
  if (element) element.hidden = Boolean(hidden);
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}
