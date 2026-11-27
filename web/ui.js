import { api } from "../../scripts/api.js";

export const origins = [["Privé", "Private"], ["Civitai", "Civitai"], ["Hybride", "Mixed"]];
export const originLabel = (value) => origins.find(([key]) => key === value)?.[1] || value;
export const cardSource = (card) => card.unlinked && card.data.origin === "Privé" ? "Local" : originLabel(card.data.origin);
export const categories = ["Characters", "Actions", "Art styles", "Detailers", "Sliders"];
export const display = (card) => card.data.display_name || card.data.name || card.file;
export const url = (path) => api.apiURL(`/sml-lora${path}`);

export async function request(path, method = "GET", data) {
  const headers = { "X-SML-Studio": "1" };
  const binary = data instanceof Blob;
  if (data !== undefined && !binary) headers["Content-Type"] = "application/json";
  const response = await api.fetchApi(`/sml-lora${path}`, {
    method, headers, body: data === undefined || binary ? data : JSON.stringify(data),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    const error = new Error(result?.error || `Request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return result;
}

export function el(tag, options = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined || value === null) continue;
    if (key.startsWith("aria-") || key === "role") node.setAttribute(key, value);
    else node[key] = value;
  }
  node.append(...children.flat().filter((child) => child !== undefined && child !== null));
  return node;
}

export function button(label, run, options = {}) {
  return el("button", { type: "button", textContent: label, onclick: run, ...options });
}

export function select(values, selected, label) {
  const field = el("select", { "aria-label": label });
  for (const value of values) {
    const [key, name] = Array.isArray(value) ? value : [value, value];
    field.add(new Option(name, key));
  }
  field.value = selected ?? "";
  return field;
}

export function categoryField(value, label) {
  const id = `sml-categories-${Math.random().toString(36).slice(2)}`;
  const input = el("input", { type: "text", value, maxLength: 120, "aria-label": label });
  input.setAttribute("list", id);
  const list = el("datalist", { id }, categories.map((category) => new Option(category, category)));
  return { input, list };
}

export function modal(title, classes = "") {
  const heading = el("h2", { id: `sml-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`, textContent: title });
  const tools = el("div", { className: "sml-actions" });
  const dialog = el("dialog", { className: `sml sml-dialog ${classes}`, lang: "en", "aria-labelledby": heading.id });
  const close = button("×", () => dialog.close(), { className: "sml-icon", "aria-label": "Close", autofocus: true });
  const header = el("header", { className: "sml-header" }, heading, tools, close);
  dialog.append(header);
  const previous = document.activeElement;
  dialog.addEventListener("close", () => {
    dialog.remove();
    if (previous?.isConnected) previous.focus({ preventScroll: true });
  }, { once: true });
  dialog.addEventListener("pointerdown", (event) => event.stopPropagation());
  document.body.append(dialog);
  dialog.showModal();
  return { dialog, heading, tools, close };
}

export function promptField(title, label, initial = "", inputType = "text") {
  return new Promise((resolve) => {
    const { dialog } = modal(title, "sml-small");
    const input = el("input", { type: inputType, value: initial, required: true });
    const form = el("form", { className: "sml-form", onsubmit: (event) => {
      event.preventDefault();
      resolve(input.value);
      dialog.close();
    } }, el("label", {}, label, input),
    el("div", { className: "sml-actions" }, button("Cancel", () => dialog.close()),
      el("button", { type: "submit", className: "sml-primary", textContent: "Apply" })));
    dialog.append(form);
    dialog.addEventListener("close", () => resolve(null), { once: true });
    input.focus();
  });
}

export async function copy(value) {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = el("textarea", { value, className: "sml-copy-fallback" });
  (document.querySelector("dialog[open]:last-of-type") || document.body).append(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("Clipboard unavailable.");
}

export function imageUrl(item, variant) {
  return url(`/images/${item.id}/${variant}`);
}

const autoKey = "sml.autoCivitai";
export function automaticCivitaiEnabled() {
  try { return localStorage.getItem(autoKey) !== "false"; }
  catch { return true; }
}

export function setAutomaticCivitai(enabled) {
  try { localStorage.setItem(autoKey, String(enabled)); }
  catch { /* This browser does not allow persistent preferences. */ }
}

export async function watchCivitai(root, onUpdate, onProgress, first) {
  if (!automaticCivitaiEnabled()) return;
  try {
    let state = await request("/civitai/auto", "POST", { first });
    let revision = 0;
    while (root.isConnected && automaticCivitaiEnabled()) {
      onProgress?.(state);
      if (state.revision !== revision) {
        revision = state.revision;
        await onUpdate();
      }
      if (!state.running) break;
      await new Promise((resolve) => setTimeout(resolve, 2200));
      if (!root.isConnected || !automaticCivitaiEnabled()) break;
      state = await request("/civitai/auto");
    }
  } catch { /* The library remains available while Civitai is offline. */ }
}

export function autoSave(dialog, form, inputs, persist) {
  let pending = {};
  let timer;
  let running;
  const message = el("output", { className: "sml-status", role: "status", textContent: "Autosave on" });
  const save = el("button", { type: "submit", className: "sml-primary", textContent: "Save now", disabled: true });
  form.append(el("div", { className: "sml-autosave" }, message,
    el("div", { className: "sml-actions" }, button("Close", closeAfterSave), save)));

  function flush() {
    clearTimeout(timer);
    if (running) return running;
    if (!Object.keys(pending).length) return Promise.resolve(true);
    save.disabled = true;
    running = (async () => {
      while (Object.keys(pending).length) {
        const changes = pending;
        pending = {};
        message.textContent = "Saving…";
        try {
          await persist(changes);
          message.textContent = "Saved.";
        } catch (error) {
          pending = { ...changes, ...pending };
          message.textContent = `Could not save. ${error.message}`;
          return false;
        }
      }
      return true;
    })().finally(() => {
      running = undefined;
      save.disabled = !Object.keys(pending).length;
    });
    return running;
  }

  async function closeAfterSave() {
    if (await flush()) dialog.close();
  }

  function queue(key, value) {
    pending[key] = value;
    save.disabled = Boolean(running);
    if (running) return;
    message.textContent = "Saving…";
    clearTimeout(timer);
    timer = setTimeout(flush, 350);
  }

  for (const [key, field] of inputs) {
    const { input, read } = field.input ? field : { input: field, read: () => field.value };
    input.addEventListener("input", () => {
      if (!input.validity || input.validity.valid) queue(key, read());
    });
  }
  form.onsubmit = (event) => { event.preventDefault(); flush(); };
  dialog.querySelector(".sml-header > .sml-icon").onclick = closeAfterSave;
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); closeAfterSave(); });
  dialog.addEventListener("close", flush, { once: true });
  return { queue, flush };
}
