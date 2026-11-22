import { openInfo } from "./info.js";
import { button, copy, display, el, imageUrl, modal, origins, request, select, types, url } from "./ui.js";

const PER_PAGE = 32;
const logo = new URL("./logo.png", import.meta.url).href;
const normalize = (text) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("fr");

function about() {
  const { dialog } = modal("Seventh Moon LoRA Studio", "sml-small");
  const image = el("img", { src: logo, alt: "Seventh Moon Labs", className: "sml-logo" });
  dialog.append(el("div", { className: "sml-form" }, image,
    el("p", { textContent: "Bibliothèque locale de LoRA pour ComfyUI, par Seventh Moon Labs." }),
    el("p", { textContent: "Ouvrez une fiche avec ⓘ. Utilisez ← et → dans la galerie, + et − pour zoomer et Échap pour fermer." })));
}

export function library(root, { choose, type, active, expanded = false } = {}) {
  let cards = [];
  let page = 0;
  let family = "";
  let categoryValue = "";
  let loadRevision = 0;
  const search = el("input", { type: "search", placeholder: "Rechercher un LoRA…", "aria-label": "Rechercher un LoRA" });
  const origin = select([["", "Toutes les origines"], ...origins], "", "Origine");
  const category = select([["", "Toutes les catégories"]], "", "Catégorie");
  const order = select([["name", "Nom A–Z"], ["date", "Dernière modification"]], "name", "Ordre");
  const favorites = el("input", { type: "checkbox" });
  const withPrompt = el("input", { type: "checkbox" });
  const grid = el("div", { className: "sml-library-grid" });
  const state = el("output", { role: "status", className: "sml-status" });
  const paging = el("div", { className: "sml-actions sml-pages" });
  const backupFile = el("input", { type: "file", accept: ".json,.zip", hidden: true });
  const layout = button("Liste", () => {
    const listView = grid.classList.toggle("sml-list-view");
    layout.textContent = listView ? "Grille" : "Liste";
    layout.setAttribute("aria-pressed", String(listView));
  }, { "aria-pressed": "false", title: "Basculer la présentation des LoRA" });
  const tools = el("div", { className: "sml-actions" }, layout, button("Scanner", () => load(true)));
  const collator = new Intl.Collator("fr", { sensitivity: "base", numeric: true });
  if (!choose) {
    if (!expanded) tools.prepend(button("Agrandir", () => {
      const { dialog } = modal("Bibliothèque LoRA", "sml-inventory");
      const content = el("div");
      dialog.append(content);
      library(content, { active, expanded: true }).search.focus();
    }, { className: "sml-primary" }));
    tools.append(el("details", { className: "sml-library-tools" }, el("summary", { textContent: "Outils" }),
      el("div", { className: "sml-actions" },
        el("a", { href: url("/backup/zip"), download: "", textContent: "Exporter ZIP" }),
        el("a", { href: url("/backup/json"), download: "", textContent: "Exporter JSON" }),
        button("Importer", () => backupFile.click()), button("Aide", about))));
  }
  const familySwitch = el("div", { className: "sml-family-switch", role: "group", "aria-label": "Famille de modèles" });
  const families = [["", "Tous"], ...types.map((family) => [family, family])];
  for (const [value, label] of families) familySwitch.append(button(label, () => {
    family = value;
    page = 0;
    render();
  }, { "aria-pressed": String(value === "") }));
  root.replaceChildren(el("div", { className: "sml sml-library" },
    el("div", { className: "sml-library-top" }, !choose && !expanded ? el("h2", { textContent: "Bibliothèque LoRA" }) : null,
      search, tools),
    !choose ? familySwitch : null,
    el("div", { className: "sml-library-filters" }, origin, category, order),
    el("div", { className: "sml-library-facets" }, el("label", { className: "sml-check" }, favorites, "Favoris"),
      el("label", { className: "sml-check" }, withPrompt, "Avec un prompt"), state), grid, paging, backupFile));

  async function load(rescan = false) {
    const revision = ++loadRevision;
    state.textContent = rescan ? "Scan des dossiers ComfyUI…" : "Chargement du catalogue…";
    try {
      const response = await request(rescan ? "/scan" : "/catalog", rescan ? "POST" : "GET");
      if (revision !== loadRevision || !root.isConnected) return;
      cards = response;
      const categories = [...new Set(cards.map((card) => card.data.category).filter(Boolean))].sort(collator.compare);
      category.replaceChildren(new Option("Toutes les catégories", ""), ...categories.map((value) => new Option(value, value)));
      category.value = categories.includes(categoryValue) ? categoryValue : "";
      render();
    } catch (error) { if (revision === loadRevision) state.textContent = error.message; }
  }

  function render() {
    const query = normalize(search.value.trim()).split(/\s+/).filter(Boolean);
    const selectedType = type ?? family;
    [...familySwitch.children].forEach((child, index) => child.setAttribute("aria-pressed", String(families[index][0] === selectedType)));
    const results = cards.filter((card) => {
      const data = card.data;
      const text = normalize([display(card), data.name, card.file, data.author, data.category, ...(data.tags ?? [])].join(" "));
      return (!choose || card.present) && (!selectedType || data.type === selectedType || (choose && !data.type)) &&
        (!origin.value || data.origin === origin.value) && (!category.value || data.category === category.value) &&
        (!favorites.checked || data.favorite) && (!withPrompt.checked || card.has_prompt) && query.every((term) => text.includes(term));
    });
    results.sort((a, b) => (order.value === "date" ? b.updated.localeCompare(a.updated) : 0) || collator.compare(display(a), display(b)));
    const maxPage = Math.max(0, Math.ceil(results.length / PER_PAGE) - 1);
    page = Math.min(page, maxPage);
    state.textContent = results.length ? `${results.length} / ${cards.length} LoRA` : "Aucun LoRA trouvé.";
    grid.replaceChildren(...results.slice(page * PER_PAGE, (page + 1) * PER_PAGE).map((card) => {
      const share = async () => {
        if (choose) { choose(card); return; }
        if (active?.(card)) state.textContent = "LoRA ajouté au node actif.";
        else state.textContent = "Sélectionnez un node SML compatible dans le workflow.";
      };
      const copyName = async () => {
        try { await copy(card.file); state.textContent = "Nom de fichier copié."; }
        catch (error) { state.textContent = error.message; }
      };
      const inspect = () => openInfo({ key: card.id, onChange: () => load() });
      const cover = card.tile ? el("img", { src: imageUrl({ id: card.tile }, "thumbnail"), alt: "", loading: "lazy", decoding: "async" }) : null;
      if (cover) cover.onerror = () => cover.remove();
      const title = button(`${card.data.favorite ? "★ " : ""}${display(card)}`, inspect,
        { className: "sml-library-name", title: card.file });
      const details = [card.data.origin, card.data.category, !card.present ? "Fichier absent" : ""].filter(Boolean).join(" · ");
      const facts = [Number.isFinite(card.data.strength) ? `Force ${card.data.strength}` : "", card.image_count ? `${card.image_count} image(s)` : "",
        card.has_prompt ? "Prompt enregistré" : ""].filter(Boolean).join(" · ");
      return el("article", { className: "sml-library-card" },
        el("button", { type: "button", className: "sml-library-cover", onclick: inspect, "aria-label": `Fiche de ${display(card)}` }, cover,
          el("span", { className: "sml-badge", textContent: card.data.type || "Architecture à préciser" })),
        el("div", { className: "sml-card-body" }, title,
          el("span", { className: "sml-muted", textContent: details }),
          facts ? el("span", { className: "sml-card-facts", textContent: facts }) : null,
          el("div", { className: "sml-actions" }, button("Ajouter", share, { disabled: !card.present,
            title: choose ? "Ajouter à la pile" : "Ajouter au node SML actif" }), !choose ? button("Copier le nom", copyName) : null)));
    }));
    paging.replaceChildren(...(maxPage ? [button("Précédent", () => { page--; render(); }, { disabled: !page }),
      el("span", { textContent: `${page + 1} / ${maxPage + 1}` }), button("Suivant", () => { page++; render(); }, { disabled: page >= maxPage })] : []));
  }

  search.oninput = () => { page = 0; render(); };
  for (const field of [origin, category, order, favorites, withPrompt]) field.onchange = () => { categoryValue = category.value; page = 0; render(); };
  backupFile.onchange = async () => {
    const file = backupFile.files[0];
    backupFile.value = "";
    if (!file) return;
    state.textContent = "Import du catalogue…";
    try {
      const result = await request(`/backup/${file.name.toLowerCase().endsWith(".zip") ? "zip" : "json"}`, "POST", file);
      await load();
      state.textContent = `${result.loras} fiche(s) lue(s) · ${result.media} image(s) ajoutée(s)`;
    } catch (error) { state.textContent = error.message; }
  };
  load();
  return { search };
}

export function pickLoRA(type, choose) {
  const { dialog } = modal("Ajouter un LoRA", "sml-picker");
  const root = el("div");
  dialog.append(root);
  const picker = library(root, { type, choose: (card) => { choose(card); dialog.close(); } });
  picker.search.focus();
}
