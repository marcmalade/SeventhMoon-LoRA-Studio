import { autoSave, button, copy, el, imageUrl, modal, promptField, request } from "./ui.js";

const PAGE = 40;
const TILE = 146;

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
  let resizeTimeout;

  const stage = el("div", { className: "sml-stage" });
  const viewport = el("div", { className: "sml-image-viewport", tabIndex: 0, "aria-label": "Image sélectionnée" });
  const message = el("div", { className: "sml-image-empty", textContent: "Aucune image disponible." });
  const previous = button("‹", () => step(-1), { className: "sml-arrow sml-prev", "aria-label": "Image précédente" });
  const next = button("›", () => step(1), { className: "sml-arrow sml-next", "aria-label": "Image suivante" });
  stage.append(viewport, previous, next);
  const caption = el("span", { className: "sml-caption" });
  const counter = el("strong", { className: "sml-counter", "aria-live": "polite" });
  const source = el("span", { className: "sml-muted" });
  const zoomLabel = el("span", { className: "sml-zoom-label", textContent: "Ajustée" });
  const zoom = el("div", { className: "sml-actions" }, button("−", () => zoomBy(0.8), { "aria-label": "Zoom arrière" }),
    button("100 %", () => setZoom(1)), button("+", () => zoomBy(1.25), { "aria-label": "Zoom avant" }),
    button("Ajuster", () => setZoom(null)));
  const full = button("Plein écran", () => toggleFull(), { className: "sml-primary" });
  const download = button("Charger en HD", () => fetchHD(item, selection));
  const generationDetails = button("Prompt et réglages", () => editGeneration());
  const cover = button("Définir la couverture", () => modify("cover"));
  const backward = button("←", () => modify("move", -1, index - 1), { "aria-label": "Reculer dans le ruban" });
  const forward = button("→", () => modify("move", 1, index + 1), { "aria-label": "Avancer dans le ruban" });
  const rename = button("Légende", async () => {
    const id = item?.id;
    const value = await promptField("Légende de l’image", "Texte", item?.caption || "");
    if (value !== null && item?.id === id) await modify("caption", value);
  });
  const replacement = button("Remplacer", () => replace(item.id));
  const remove = button("Retirer", () => {
    if (item && window.confirm("Retirer cette image de la galerie ?")) modify("remove");
  });
  const mediaActions = el("div", { className: "sml-actions sml-media-actions" }, generationDetails,
    cover, backward, forward, rename, replacement, remove);
  const addButton = button("Ajouter des images", add);
  const aside = el("aside", { className: "sml-picture-info" }, el("strong", { textContent: "Image sélectionnée" }),
    counter, source, caption, zoomLabel, zoom, el("div", { className: "sml-actions" }, full, download, addButton), mediaActions);
  const strip = el("div", { className: "sml-strip", tabIndex: 0, "aria-label": "Miniatures défilantes" });
  const rail = el("div", { className: "sml-rail" });
  strip.append(rail);
  const root = el("section", { className: "sml-gallery", "aria-label": "Galerie d’images" },
    el("div", { className: "sml-gallery-top" }, el("h3", { textContent: "Galerie d’images" }),
      el("span", { className: "sml-muted", textContent: "← → Naviguer · + / − Zoom" })),
    el("div", { className: "sml-gallery-main" }, stage, aside),
    el("div", { className: "sml-strip-label", textContent: "Miniatures" }), strip);
  const resize = new ResizeObserver(() => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(renderStrip, 35);
  });
  resize.observe(strip);

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
    const start = Math.max(0, Math.floor(strip.scrollLeft / TILE) - 2);
    const end = Math.min(total, Math.ceil((strip.scrollLeft + strip.clientWidth) / TILE) + 2);
    for (const [position, node] of thumbs) {
      if (position < start || position >= end) {
        node.remove();
        thumbs.delete(position);
      } else {
        node.setAttribute("aria-pressed", String(position === index));
      }
    }
    for (let position = start; position < end; position++) {
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
          tiny.onerror = () => tiny.replaceWith(document.createTextNode("Indisponible"));
          tile.append(tiny);
        } else tile.append(entry.source === "civitai" ? "Civitai" : "Image indisponible");
        tile.append(el("span", { className: "sml-thumb-index", textContent: `${position + 1}` }));
      }).catch((error) => { if (revision === generation) status(error.message); });
    }
  }

  function renderMain() {
    counter.textContent = total ? `${index + 1} / ${total}` : "0 image";
    previous.disabled = index <= 0;
    next.disabled = index + 1 >= total;
    backward.disabled = previous.disabled;
    forward.disabled = next.disabled;
    source.textContent = item ? (item.source === "local" ? "Import personnel" :
      `Civitai · ${item.scope === "extended" ? "Galerie étendue" : "Version"}${item.attribution ? ` · ${item.attribution}` : ""}`) : "";
    caption.textContent = item?.caption || "";
    mediaActions.hidden = !item;
    generationDetails.classList.toggle("sml-has-generation", Boolean(item?.has_generation));
    generationDetails.title = item?.has_generation ? "Afficher les données de génération enregistrées" : "Ajouter des données de génération";
    replacement.hidden = item?.source !== "local";
    download.hidden = !item || item.cached || item.source !== "civitai";
    viewport.replaceChildren();
    if (!item?.cached && !item?.preview) {
      message.textContent = total ? "Image indisponible localement." : "Déposez vos images ici ou utilisez « Ajouter des images ».";
      viewport.append(message);
    } else {
      const image = el("img", { alt: item.caption || `Image ${index + 1}`, draggable: false,
        src: `${imageUrl(item, item.cached ? "original" : "thumbnail")}?v=${version}` });
      image.onload = () => setZoom(scale);
      image.onerror = () => {
        if (!image.isConnected) return;
        message.textContent = "Impossible d’afficher cette image.";
        viewport.replaceChildren(message);
      };
      viewport.append(image);
    }
    setZoom(null);
  }

  async function fetchHD(entry, token) {
    if (!entry || entry.cached || entry.source !== "civitai") return;
    status("Chargement de l’image Civitai en haute définition…");
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
      if (explicit) fetchHD(item, token);
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
      status(action === "cover" ? "Couverture mise à jour." : "Galerie mise à jour.");
      root.dispatchEvent(new Event("gallerychange"));
    } catch (error) { status(error.message); }
  }

  async function editGeneration() {
    if (!item) return;
    const id = item.id;
    const { dialog } = modal(`Prompt et réglages · Image ${index + 1}`, "sml-editor");
    const form = el("form", { className: "sml-form" });
    const message = el("output", { role: "status", textContent: "Chargement…" });
    form.append(message);
    dialog.append(form);
    try {
      const saved = await request(`${endpoint}/${id}/generation`);
      if (!dialog.open) return;
      const inputs = new Map();
      const actionStatus = el("output", { className: "sml-status", role: "status" });
      const details = [
        ["prompt", "Prompt", "Prompt de l’image", "default_prompt"],
        ["negative_prompt", "Prompt négatif", "Prompt négatif, si utilisé", "default_negative_prompt"],
        ["settings", "Réglages", "Par exemple seed, dimensions, sampler, steps, CFG et force LoRA. Le texte et le JSON sont acceptés."],
      ];
      for (const [field, label, placeholder, destination] of details) {
        const input = el("textarea", { value: saved[field] ?? "", placeholder, rows: field === "negative_prompt" ? 3 : 5,
          maxLength: 262144, spellcheck: false });
        inputs.set(field, input);
        const controls = el("div", { className: "sml-actions" });
        if (destination) {
          const copyPrompt = button(field === "prompt" ? "Copier le prompt" : "Copier le négatif", async () => {
            try { await copy(input.value); actionStatus.textContent = "Copié."; }
            catch (error) { actionStatus.textContent = error.message; }
          });
          const usePrompt = button("Définir comme défaut", async () => {
            usePrompt.disabled = true;
            try {
              if (input.value.length > 65536) throw new Error("Le prompt par défaut accepte jusqu’à 65 536 caractères.");
              const card = await request(`/cards/${key}`, "PATCH", { [destination]: input.value });
              onPromptsChange?.(card);
              actionStatus.textContent = `${label} enregistré par défaut dans la fiche.`;
            } catch (error) { actionStatus.textContent = error.message; }
            finally { usePrompt.disabled = !input.value.trim(); }
          }, { "aria-label": field === "prompt" ? "Définir le prompt par défaut" : "Définir le prompt négatif par défaut" });
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

  function setZoom(value) {
    const image = viewport.querySelector("img");
    scale = value;
    zoomLabel.textContent = value ? `${Math.round(value * 100)} %` : "Ajustée";
    viewport.classList.toggle("sml-zoomed", value !== null);
    if (!image) return;
    image.style.width = value ? `${image.naturalWidth * value}px` : "";
    image.style.height = value ? `${image.naturalHeight * value}px` : "";
  }

  function zoomBy(factor) {
    const image = viewport.querySelector("img");
    if (!image?.naturalWidth) return;
    const fitted = image.clientWidth / image.naturalWidth;
    setZoom(Math.min(4, Math.max(0.05, (scale ?? fitted) * factor)));
  }

  function toggleFull() {
    const dialog = root.closest("dialog");
    const expanded = dialog.classList.toggle("sml-expanded");
    full.textContent = expanded ? "Quitter le plein écran" : "Plein écran";
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
  strip.onscroll = renderStrip;
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

  return { root, refresh, keyboard, toggleFull, dispose: () => resize.disconnect() };
}
