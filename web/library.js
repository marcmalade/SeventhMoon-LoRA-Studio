import { openInfo } from "./info.js";
import { automaticCivitaiEnabled, button, cardSource, copy, display, el, imageUrl, modal,
  origins, request, select, setAutomaticCivitai, url, watchCivitai } from "./ui.js";

const logo = new URL("./logo.png", import.meta.url).href;
const normalize = (text) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

function about() {
  const { dialog } = modal("Seventh Moon LoRA Studio", "sml-small");
  dialog.append(el("div", { className: "sml-form" }, el("img", {
    src: logo, alt: "Seventh Moon Labs", className: "sml-logo",
  }), el("p", { textContent: "Local LoRA library and stack loaders for ComfyUI." })));
}

export function library(root, { choose, active, expanded = false } = {}) {
  let cards = [];
  let loadRevision = 0;
  let lookup;
  const search = el("input", { type: "search", placeholder: "Search LoRAs…", "aria-label": "Search LoRAs" });
  const origin = select([["", "Any source"], ["Local", "Local"], ...origins.map(([, label]) => label)], "", "Source");
  const family = select([["", "Any base model"]], "", "Base model");
  const category = select([["", "Any category"]], "", "Category");
  const order = select([["name", "Name A–Z"], ["date", "Recently updated"]], "name", "Sort");
  const favorites = el("input", { type: "checkbox" });
  const withPrompt = el("input", { type: "checkbox" });
  const auto = el("input", { type: "checkbox", checked: automaticCivitaiEnabled() });
  const list = el("ul", { className: "sml-library-list", "aria-label": "LoRA results" });
  const resultCount = el("span", { className: "sml-muted" });
  const state = el("output", { role: "status", className: "sml-status" });
  const progress = el("span", { className: "sml-muted" });
  const backupFile = el("input", { type: "file", accept: ".json,.zip", hidden: true });
  const filters = el("details", { className: "sml-popover" }, el("summary", { textContent: "Filters" }),
    el("div", { className: "sml-filter-panel" }, family, category, origin, order,
      el("label", { className: "sml-check" }, favorites, "Favorites"),
      el("label", { className: "sml-check" }, withPrompt, "Has a prompt")));
  const tools = el("details", { className: "sml-popover" }, el("summary", { textContent: "Tools" }),
    el("div", { className: "sml-tool-panel" },
      el("label", { className: "sml-check", title: "Look up files by SHA-256. Cards explicitly set to Private are skipped." },
        auto, "Auto Civitai lookup"),
      button("Rescan files", async () => { await load(true); startLookup(); }),
      !choose ? el("a", { href: url("/backup/zip"), download: "", textContent: "Export ZIP" }) : null,
      !choose ? el("a", { href: url("/backup/json"), download: "", textContent: "Export JSON" }) : null,
      !choose ? button("Import backup", () => backupFile.click()) : null,
      !choose ? button("About", about) : null));
  const expand = !choose && !expanded ? button("Expand", () => {
    const { dialog } = modal("LoRA Library", "sml-inventory");
    const content = el("div", { className: "sml-library-slot" });
    dialog.append(content);
    library(content, { active, expanded: true }).search.focus();
  }) : null;
  root.replaceChildren(el("div", { className: "sml sml-library", lang: "en" },
    el("div", { className: "sml-library-top" }, search, filters, tools, expand),
    el("div", { className: "sml-library-status" }, resultCount, progress, state),
    list, backupFile));

  function options(control, label, values) {
    const selected = control.value;
    control.replaceChildren(new Option(label, ""), ...values);
    if ([...control.options].some((option) => option.value === selected)) control.value = selected;
  }

  async function load(rescan = false, quiet = false) {
    const revision = ++loadRevision;
    if (!quiet) state.textContent = rescan ? "Scanning files…" : "Loading…";
    try {
      const response = await request(rescan ? "/scan" : "/catalog", rescan ? "POST" : "GET");
      if (revision !== loadRevision || !root.isConnected) return;
      cards = response.filter((card) => !choose || card.present).map((card) => {
        const data = card.data;
        return { card, searchText: normalize([display(card), data.name, card.file, data.type, data.author,
          data.category, ...(data.tags ?? [])].join(" ")) };
      });
      const families = [...new Set(cards.map(({ card }) => card.data.type).filter(Boolean))].sort(collator.compare);
      options(family, "Any base model", [...families.map((name) => new Option(name, "type:" + name)),
        ...(cards.some(({ card }) => !card.data.type) ? [new Option("Unassigned", "unknown")] : [])]);
      const categories = [...new Set(cards.map(({ card }) => card.data.category).filter(Boolean))].sort(collator.compare);
      options(category, "Any category", categories.map((name) => new Option(name, name)));
      if (!quiet) state.textContent = "";
      render();
    } catch (error) { if (revision === loadRevision) state.textContent = error.message; }
  }

  function startLookup() {
    if (lookup || !auto.checked || !root.isConnected) return;
    lookup = watchCivitai(root, () => load(false, true), (job) => {
      progress.textContent = job.running && job.total ? `Civitai ${job.checked}/${job.total}` : "";
    }).finally(() => { lookup = null; progress.textContent = ""; });
  }

  function render() {
    const query = normalize(search.value.trim()).split(/\s+/).filter(Boolean);
    const results = cards.filter(({ card, searchText }) => {
      const data = card.data;
      return (!family.value || (data.type ? "type:" + data.type : "unknown") === family.value) &&
        (!origin.value || cardSource(card) === origin.value) && (!category.value || data.category === category.value) &&
        (!favorites.checked || data.favorite) && (!withPrompt.checked || card.has_prompt) &&
        query.every((term) => searchText.includes(term));
    }).map(({ card }) => card);
    results.sort((a, b) => (order.value === "date" ? b.updated.localeCompare(a.updated) : 0) || collator.compare(display(a), display(b)));
    resultCount.textContent = results.length === cards.length ? `${results.length} LoRAs` : `${results.length} of ${cards.length} LoRAs`;
    const focusKey = list.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
    const nodes = results.map((card) => {
      const name = display(card);
      const inspect = () => openInfo({ key: card.id, onChange: () => load(false, true) });
      const title = button((card.data.favorite ? "★ " : "") + name, inspect,
        { className: "sml-library-name", title: card.file });
      title.dataset.focusKey = card.id + ":details";
      const share = button(choose ? "Add" : "+", () => {
        if (choose) choose(card);
        else state.textContent = active?.(card) ? "Added to the active stack." : "Select an SML Power LoRA node first.";
      }, { disabled: !card.present, title: "Add to stack", "aria-label": "Add " + name + " to stack" });
      share.dataset.focusKey = card.id + ":add";
      const cover = card.tile ? el("img", { src: imageUrl({ id: card.tile }, "thumbnail"), alt: "", loading: "lazy",
        decoding: "async", width: 44, height: 44 }) : null;
      if (cover) cover.onerror = () => { cover.hidden = true; };
      const details = [card.data.type, card.data.category, cardSource(card),
        !card.present ? "File missing" : null].filter(Boolean).join(" · ");
      return el("li", { className: "sml-library-row" }, el("span", { className: "sml-list-cover", "aria-hidden": "true" }, cover),
        el("div", { className: "sml-list-details" }, title, el("span", { className: "sml-muted", textContent: details })),
        !choose ? button("Copy filename", async () => {
          try { await copy(card.file); state.textContent = "Filename copied."; }
          catch (error) { state.textContent = error.message; }
        }, { className: "sml-text-button sml-copy-name", "aria-label": "Copy filename for " + name }) : null, share);
    });
    list.replaceChildren(...(nodes.length ? nodes : [el("li", { className: "sml-list-empty", textContent: "No matching LoRAs." })]));
    if (focusKey) [...list.querySelectorAll("[data-focus-key]")].find((item) => item.dataset.focusKey === focusKey)?.focus({ preventScroll: true });
  }

  search.oninput = render;
  for (const field of [family, origin, category, order, favorites, withPrompt]) field.onchange = render;
  auto.onchange = () => {
    setAutomaticCivitai(auto.checked);
    if (auto.checked) startLookup();
    else {
      progress.textContent = "";
      request("/civitai/auto", "DELETE").catch((error) => { state.textContent = error.message; });
    }
  };
  backupFile.onchange = async () => {
    const file = backupFile.files[0];
    backupFile.value = "";
    if (!file) return;
    state.textContent = "Importing…";
    try {
      const result = await request("/backup/" + (file.name.toLowerCase().endsWith(".zip") ? "zip" : "json"), "POST", file);
      await load();
      state.textContent = `${result.loras} cards read · ${result.media} images added`;
    } catch (error) { state.textContent = error.message; }
  };
  load().then(startLookup);
  return { search };
}

export function pickLoRA(choose) {
  const { dialog } = modal("Add LoRA", "sml-picker");
  const root = el("div", { className: "sml-library-slot" });
  dialog.append(root);
  library(root, { choose: (card) => { choose(card); dialog.close(); } }).search.focus();
}
