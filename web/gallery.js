import { autoSave, button, copy, el, imageUrl, modal, request } from "./ui.js";

const PAGE = 15;
const TILE = 84;

export function gallery({ key, add, replace, status, onPromptsChange }) {
  const endpoint = `/cards/${key}/media`;
  let total = 0;
  let index = 0;
  let item;
  let pages = new Map();
  let thumbs = new Map();
  let generation = 0;
  let selection = 0;
  let scale = null;
  let pan = null;
  let version = 0;

  const stage = el("div", { className: "sml-stage" });
  const viewport = el("div", { className: "sml-image-viewport", tabIndex: 0, "aria-label": "Selected image" });
  const message = el("div", { className: "sml-image-empty", textContent: "No image available." });
  const previous = button("‹", () => step(-1), { className: "sml-arrow sml-prev", "aria-label": "Previous image" });
  const next = button("›", () => step(1), { className: "sml-arrow sml-next", "aria-label": "Next image" });
  stage.append(viewport, previous, next);
  const caption = el("span", { className: "sml-caption" });
  const counter = el("strong", { className: "sml-counter", "aria-live": "polite" });
  const source = el("span", { className: "sml-muted" });
  const zoom = el("div", { className: "sml-actions" }, button("−", () => zoomBy(0.8), { "aria-label": "Zoom out" }),
    button("+", () => zoomBy(1.25), { "aria-label": "Zoom in" }),
    button("Fit", () => setZoom(null)));
  const full = button("Expand image", () => toggleFull());
  const download = button("Load full size", () => fetchHD(item, selection));
  const generationDetails = button("Prompt & settings", () => editGeneration());
  const cover = button("Set as cover", () => modify("cover"));
  const backward = button("←", () => modify("move", -1, index - 1), { "aria-label": "Move image left" });
  const forward = button("→", () => modify("move", 1, index + 1), { "aria-label": "Move image right" });
  const rename = button("Caption", editCaption);
  const replacement = button("Replace", () => replace(item.id));
  const remove = button("Remove", () => {
    if (item && window.confirm("Remove this image from the gallery?")) modify("remove");
  });
  const mediaActions = el("details", { className: "sml-popover" }, el("summary", { textContent: "Image actions" }),
    el("div", { className: "sml-tool-panel" }, cover, backward, forward, rename, replacement, remove));
  const addButton = button("Add images", add);
  const aside = el("div", { className: "sml-picture-info" }, counter, source, zoom, full, download,
    generationDetails, addButton, mediaActions, caption);
  const strip = el("div", { className: "sml-strip", tabIndex: 0, "aria-label": "Image thumbnails" });
  const rail = el("div", { className: "sml-rail" });
  strip.append(rail);
  const root = el("section", { className: "sml-gallery", "aria-label": "Image gallery" }, aside, stage, strip);

  function page(at) {
    const start = Math.floor(at / PAGE) * PAGE;
    if (!pages.has(start)) {
      const cache = pages;
      cache.set(start, request(`${endpoint}?offset=${start}&limit=${PAGE}`).catch((error) => {
        cache.delete(start);
        throw error;
      }));
    }
    return pages.get(start);
  }

  async function at(position) {
    const result = await page(position);
    return result.items[position % PAGE];
  }

  async function renderStrip() {
    const revision = generation;
    for (const [position, node] of thumbs) {
      node.setAttribute("aria-pressed", String(position === index));
    }
    for (let position = 0; position < total; position++) {
      if (thumbs.has(position)) continue;
      const tile = button("", () => choose(position, true), {
        className: "sml-thumb", title: `Image ${position + 1}`, "aria-label": `Image ${position + 1}`,
        "aria-pressed": String(position === index),
      });
      tile.style.left = `${position * TILE}px`;
      thumbs.set(position, tile);
      rail.append(tile);
      at(position).then((entry) => {
        if (revision !== generation || thumbs.get(position) !== tile || !entry) return;
        if (entry.preview) {
          const tiny = el("img", { src: imageUrl(entry, "thumbnail"), loading: "lazy", decoding: "async", alt: "" });
          tiny.onerror = () => tiny.replaceWith(document.createTextNode("Unavailable"));
          tile.append(tiny);
        } else tile.append(entry.source === "civitai" ? "Civitai" : "Image unavailable");
        tile.append(el("span", { className: "sml-thumb-index", textContent: `${position + 1}` }));
      }).catch((error) => { if (revision === generation) status(error.message); });
    }
  }

  function renderMain() {
    counter.textContent = total ? `${index + 1} / ${total}` : "No images";
    previous.disabled = index <= 0;
    next.disabled = index + 1 >= total;
    backward.disabled = previous.disabled;
    forward.disabled = next.disabled;
    source.textContent = item ? (item.source === "local" ? "Local upload" :
      `Civitai · ${item.scope === "extended" ? "Extended gallery" : "Version"}${item.attribution ? ` · ${item.attribution}` : ""}`) : "";
    caption.textContent = item?.caption || "";
    caption.hidden = !item?.caption;
    mediaActions.hidden = !item;
    generationDetails.hidden = !item;
    zoom.hidden = full.hidden = !item?.cached && !item?.preview;
    strip.hidden = total < 2;
    generationDetails.classList.toggle("sml-has-generation", Boolean(item?.has_generation));
    generationDetails.title = item?.has_generation ? "View saved generation settings" : "Add generation settings";
    replacement.hidden = item?.source !== "local";
    download.hidden = !item || item.cached || item.source !== "civitai";
    viewport.replaceChildren();
    if (!item?.cached && !item?.preview) {
      message.textContent = total ? "Image unavailable locally." : "Drop images here or choose Add images.";
      viewport.append(message);
    } else {
      const image = el("img", { alt: item.caption || `Image ${index + 1}`, draggable: false,
        src: `${imageUrl(item, item.cached ? "original" : "thumbnail")}?v=${version}` });
      image.onload = () => setZoom(scale);
      image.onerror = () => {
        if (!image.isConnected) return;
        message.textContent = "Unable to display this image.";
        viewport.replaceChildren(message);
      };
      viewport.append(image);
    }
    setZoom(null);
  }

  async function fetchHD(entry, token) {
    if (!entry || entry.cached || entry.source !== "civitai") return;
    status("Loading the full-size image…");
    download.disabled = true;
    try {
      await request(`${endpoint}/${entry.id}/download`, "POST");
      entry.cached = true;
      if (token === selection) {
        version++;
        renderMain();
        status("");
      }
    } catch (error) {
      if (token === selection) status(error.message);
    } finally {
      download.disabled = false;
    }
  }

  async function choose(position, explicit = false) {
    const token = ++selection;
    index = Math.min(Math.max(position, 0), Math.max(0, total - 1));
    try {
      const result = total ? await at(index) : undefined;
      if (token !== selection) return;
      item = result;
      renderMain();
      const left = Math.max(0, index * TILE - (strip.clientWidth - TILE) / 2);
      strip.scrollTo({ left, behavior: explicit ? "smooth" : "instant" });
      renderStrip();
      for (const nearby of [index - 1, index + 1]) {
        if (nearby >= 0 && nearby < total) at(nearby).catch(() => {});
      }
    } catch (error) { status(error.message); }
  }

  const step = (direction) => {
    if (index + direction >= 0 && index + direction < total) choose(index + direction, true);
  };

  async function refresh(position = index, fromCover = false) {
    const current = ++generation;
    selection++;
    pages = new Map();
    thumbs = new Map();
    rail.replaceChildren();
    const first = await page(0);
    if (current !== generation) return;
    total = first.total;
    version++;
    rail.style.width = `${total * TILE}px`;
    await choose(fromCover ? first.cover_index : position);
  }

  async function modify(action, value, position = index) {
    if (!item) return;
    try {
      await request(`${endpoint}/${item.id}`, "PATCH", { action, value });
      await refresh(position);
      status(action === "cover" ? "Cover updated." : "Gallery updated.");
      root.dispatchEvent(new Event("gallerychange"));
    } catch (error) { status(error.message); }
  }

  async function editGeneration() {
    if (!item) return;
    const id = item.id;
    const { dialog } = modal(`Prompt & settings · Image ${index + 1}`, "sml-editor");
    const form = el("form", { className: "sml-form" });
    const message = el("output", { role: "status", textContent: "Loading…" });
    form.append(message);
    dialog.append(form);
    try {
      const saved = await request(`${endpoint}/${id}/generation`);
      if (!dialog.open) return;
      const inputs = new Map();
      const actionStatus = el("output", { className: "sml-status", role: "status" });
      const details = [
        ["prompt", "Prompt", "Image prompt", "default_prompt"],
        ["negative_prompt", "Negative prompt", "Negative prompt, if used", "default_negative_prompt"],
        ["settings", "Settings", "Seed, size, sampler, steps, CFG, or LoRA strength. Text and JSON are supported."],
      ];
      for (const [field, label, placeholder, destination] of details) {
        const input = el("textarea", { value: saved[field] ?? "", placeholder, rows: field === "negative_prompt" ? 3 : 5,
          maxLength: 262144, spellcheck: false });
        inputs.set(field, input);
        const controls = el("div", { className: "sml-actions" });
        if (destination) {
          const copyPrompt = button(field === "prompt" ? "Copy prompt" : "Copy negative prompt", async () => {
            try { await copy(input.value); actionStatus.textContent = "Copied."; }
            catch (error) { actionStatus.textContent = error.message; }
          });
          const usePrompt = button("Use as default", async () => {
            usePrompt.disabled = true;
            try {
              if (input.value.length > 65536) throw new Error("Default prompts can contain up to 65,536 characters.");
              const card = await request(`/cards/${key}`, "PATCH", { [destination]: input.value });
              onPromptsChange?.(card);
              actionStatus.textContent = `${label} saved as the LoRA default.`;
            } catch (error) { actionStatus.textContent = error.message; }
            finally { usePrompt.disabled = !input.value.trim(); }
          }, { "aria-label": field === "prompt" ? "Set the default prompt" : "Set the default negative prompt" });
          const updateButtons = () => { copyPrompt.disabled = usePrompt.disabled = !input.value.trim(); };
          input.addEventListener("input", updateButtons);
          updateButtons();
          controls.append(copyPrompt, usePrompt);
        }
        form.insertBefore(el("section", { className: "sml-example-field" }, el("label", {}, label, input), controls), message);
      }
      message.remove();
      form.append(actionStatus);
      autoSave(dialog, form, inputs, async (value) => {
        await request(`${endpoint}/${id}`, "PATCH", { action: "generation", value });
        if (item?.id === id) {
          item.has_generation = [...inputs.values()].some((input) => input.value);
          generationDetails.classList.toggle("sml-has-generation", item.has_generation);
        }
      });
    } catch (error) { message.textContent = error.message; }
  }

  function editCaption() {
    if (!item) return;
    const { id } = item;
    const { dialog } = modal("Image caption", "sml-small");
    const input = el("textarea", { value: item.caption, rows: 3, maxLength: 16384 });
    const form = el("form", { className: "sml-form" }, el("label", {}, "Caption", input));
    autoSave(dialog, form, new Map([["caption", input]]), async ({ caption: value }) => {
      await request(`${endpoint}/${id}`, "PATCH", { action: "caption", value });
      if (item?.id === id) {
        item.caption = value;
        caption.textContent = value;
        caption.hidden = !value;
      }
    });
    dialog.append(form);
    input.focus();
  }

  function setZoom(value) {
    const image = viewport.querySelector("img");
    scale = value;
    viewport.classList.toggle("sml-zoomed", value !== null);
    if (!image) return;
    image.style.width = value ? `${image.naturalWidth * value}px` : "";
    image.style.height = value ? `${image.naturalHeight * value}px` : "";
  }

  function zoomBy(factor) {
    const image = viewport.querySelector("img");
    if (!image?.naturalWidth) return;
    const fitted = Math.min((viewport.clientWidth - 60) / image.naturalWidth, viewport.clientHeight / image.naturalHeight);
    setZoom(Math.min(4, Math.max(0.05, (scale ?? fitted) * factor)));
  }

  function toggleFull() {
    const dialog = root.closest("dialog");
    const expanded = dialog.classList.toggle("sml-expanded");
    full.textContent = expanded ? "Exit expanded view" : "Expand image";
    viewport.focus({ preventScroll: true });
  }

  viewport.ondblclick = toggleFull;
  viewport.addEventListener("wheel", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    zoomBy(event.deltaY < 0 ? 1.15 : 0.87);
  }, { passive: false });
  viewport.onpointerdown = (event) => {
    if (!scale || event.button !== 0) return;
    pan = [event.clientX + viewport.scrollLeft, event.clientY + viewport.scrollTop];
    viewport.setPointerCapture(event.pointerId);
  };
  viewport.onpointermove = (event) => {
    if (pan) viewport.scrollTo(pan[0] - event.clientX, pan[1] - event.clientY);
  };
  viewport.onlostpointercapture = () => { pan = null; };
  strip.addEventListener("wheel", (event) => {
    if (Math.abs(event.deltaX) >= Math.abs(event.deltaY) || strip.scrollWidth <= strip.clientWidth) return;
    event.preventDefault();
    strip.scrollLeft += event.deltaY * (event.deltaMode === 1 ? 16 : 1);
  }, { passive: false });

  function keyboard(event) {
    if (event.target.matches?.("input:not([type=checkbox]), textarea, select, [contenteditable='true']")) return;
    const action = { ArrowLeft: () => step(-1), ArrowRight: () => step(1), "+": () => zoomBy(1.25),
      "=": () => zoomBy(1.25), "-": () => zoomBy(0.8), "0": () => setZoom(null) }[event.key];
    if (action) {
      event.preventDefault();
      event.stopPropagation();
      action();
    }
  }

  return { root, refresh, keyboard, toggleFull, dispose: () => { generation++; selection++; } };
}
