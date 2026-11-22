import { api } from "../../scripts/api.js";

export const origins = ["Privé", "Civitai", "Hybride"];
export const categories = ["Personnages", "Actions", "Style graphique", "Detailers", "Sliders"];
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
    const error = new Error(result?.error || `Requête impossible (${response.status}).`);
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
  const dialog = el("dialog", { className: `sml sml-dialog ${classes}`, "aria-labelledby": heading.id });
  const close = button("×", () => dialog.close(), { className: "sml-icon", "aria-label": "Fermer", autofocus: true });
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
    el("div", { className: "sml-actions" }, button("Annuler", () => dialog.close()),
      el("button", { type: "submit", className: "sml-primary", textContent: "Valider" })));
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
  if (!copied) throw new Error("Presse-papiers inaccessible.");
}

export function imageUrl(item, variant) {
  return url(`/images/${item.id}/${variant}`);
}

export function autoSave(dialog, form, inputs, persist) {
  let pending = {};
  let timer;
  let running;
  const message = el("output", { className: "sml-status", role: "status", textContent: "Enregistrement automatique activé." });
  const save = el("button", { type: "submit", className: "sml-primary", textContent: "Enregistrer maintenant", disabled: true });
  form.append(el("div", { className: "sml-autosave" }, message,
    el("div", { className: "sml-actions" }, button("Fermer", closeAfterSave), save)));

  function flush() {
    clearTimeout(timer);
    if (running) return running;
    if (!Object.keys(pending).length) return Promise.resolve(true);
    save.disabled = true;
    running = (async () => {
      while (Object.keys(pending).length) {
        const changes = pending;
        pending = {};
        message.textContent = "Enregistrement…";
        try {
          await persist(changes);
          message.textContent = "Enregistré.";
        } catch (error) {
          pending = { ...changes, ...pending };
          message.textContent = `Enregistrement impossible. ${error.message}`;
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

  for (const [key, input] of inputs) {
    input.addEventListener("input", () => {
      pending[key] = input.value;
      save.disabled = Boolean(running);
      if (running) return;
      message.textContent = "Modifications en attente…";
      clearTimeout(timer);
      timer = setTimeout(flush, 450);
    });
  }
  form.onsubmit = (event) => { event.preventDefault(); flush(); };
  dialog.querySelector(".sml-header > .sml-icon").onclick = closeAfterSave;
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); closeAfterSave(); });
  dialog.addEventListener("close", flush, { once: true });
}
