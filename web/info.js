import { gallery } from "./gallery.js";
import { autoSave, button, categoryField, copy, display, el, modal, origins, request, select } from "./ui.js";

const jobs = new Map();
const fields = [
  ["name", "Nom original"], ["display_name", "Nom d’affichage"], ["type", "Modèle de base"],
  ["version", "Version"], ["author", "Auteur"], ["origin", "Origine"],
  ["strength", "Force recommandée"], ["category", "Catégorie"], ["favorite", "Favori"],
  ["description", "Description"], ["notes", "Notes privées"], ["tags", "Tags"],
];
const prompts = [["default_prompt", "Prompt par défaut"], ["default_negative_prompt", "Prompt négatif par défaut"]];

function cardField(label, value, className = "") {
  return el("div", { className: `sml-field ${className}` }, el("dt", { textContent: label }), el("dd", {}, value ?? "—"));
}

function readLink(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol === "https:" && url.hostname === "civitai.com" && !url.username && !url.password) return url.href;
  } catch { /* aucune association */ }
}

function editDefaultPrompts(card, onSave) {
  const { dialog } = modal(`Prompts du LoRA · ${display(card)}`, "sml-editor");
  const form = el("form", { className: "sml-form" });
  const inputs = new Map();
  for (const [key, label] of prompts) {
    const input = el("textarea", { value: card.data[key] ?? "", rows: 5, maxLength: 65536,
      placeholder: "Écrire ou coller un prompt…", spellcheck: false });
    form.append(el("label", {}, label, input));
    inputs.set(key, input);
  }
  autoSave(dialog, form, inputs, async (changes) => {
    const values = Object.fromEntries(Object.entries(changes).map(([key, value]) => [key, value || null]));
    onSave(await request(`/cards/${card.id}`, "PATCH", values));
  });
  dialog.append(form);
  inputs.values().next().value.focus();
}

function editCard(card, onSave) {
  const { dialog } = modal("Modifier la fiche", "sml-editor");
  const form = el("form", { className: "sml-form" });
  const error = el("output", { role: "status" });
  const read = {};
  const resets = new Set();
  const grid = el("div", { className: "sml-form-grid" });
  const reset = (key, field) => {
    if (!Object.hasOwn(card.user_overrides, key)) return null;
    return button("Rétablir", (event) => {
      resets.add(key);
      field.querySelectorAll("input,textarea,select,button").forEach((node) => { node.disabled = true; });
      event.currentTarget.disabled = true;
      event.currentTarget.textContent = "Sera rétabli";
    }, { className: "sml-text-button", title: "Rétablir la valeur Civitai ou la valeur par défaut" });
  };
  for (const [key, label] of fields) {
    const value = card.data[key];
    let input;
    let suggestions;
    if (key === "origin") {
      input = select(origins, value, label);
    } else if (key === "type") {
      input = el("input", { type: "text", value: value ?? "", maxLength: 500, placeholder: "Nom ou famille du modèle" });
    } else if (key === "category") {
      ({ input, list: suggestions } = categoryField(value ?? "", label));
    } else if (["description", "notes", "tags"].includes(key)) {
      input = el("textarea", { value: Array.isArray(value) ? value.join("\n") : value ?? "", rows: 3 });
    } else {
      input = el("input", { type: key === "favorite" ? "checkbox" : key === "strength" ? "number" : "text",
        value: value ?? "", checked: Boolean(value), min: -100, max: 100, step: "any" });
    }
    const content = el("label", {}, label, input);
    grid.append(el("div", {}, content, suggestions, reset(key, content)));
    read[key] = () => {
      if (key === "favorite") return input.checked;
      if (key === "strength") return input.value === "" ? null : Number(input.value);
      if (key === "tags") return input.value.split("\n").map((tag) => tag.trim()).filter(Boolean);
      if (key === "category") return input.value.trim();
      if (key === "type") return input.value.trim() || null;
      return input.value;
    };
  }
  const words = el("div", { className: "sml-trigger-edit" });
  function addWord(text = "") {
    const input = el("textarea", { value: text, rows: 2, "aria-label": "Trigger word" });
    const row = el("div", {}, input, button("×", () => row.remove(), { "aria-label": "Retirer ce trigger" }));
    words.append(row);
    return input;
  }
  for (const word of card.data.triggers ?? []) addWord(word);
  const wordControls = el("fieldset", {}, el("legend", { textContent: "Trigger words" }), words,
    button("Ajouter un trigger", () => addWord().focus()));
  read.triggers = () => [...words.querySelectorAll("textarea")].map((input) => input.value).filter((word) => word.trim());
  const before = Object.fromEntries(Object.entries(read).map(([key, get]) => [key, JSON.stringify(get())]));
  const save = el("button", { type: "submit", className: "sml-primary", textContent: "Enregistrer" });
  form.append(grid, wordControls, reset("triggers", wordControls), error,
    el("div", { className: "sml-actions" }, button("Prompts du LoRA", () => editDefaultPrompts(card, (updated) => {
      card = updated;
      onSave(updated);
    })), button("Annuler", () => dialog.close()), save));
  form.onsubmit = async (event) => {
    event.preventDefault();
    const changes = {};
    for (const [key, get] of Object.entries(read)) {
      const value = get();
      if (resets.has(key)) changes[key] = null;
      else if (JSON.stringify(value) !== before[key]) changes[key] = value;
    }
    save.disabled = true;
    try {
      const updated = await request(`/cards/${card.id}`, "PATCH", changes);
      dialog.close();
      onSave(updated);
    } catch (failure) {
      error.textContent = failure.message;
      save.disabled = false;
    }
  };
  dialog.append(form);
}

function syncOptions(card, run) {
  const { dialog } = modal("Associer à Civitai", "sml-small");
  const address = el("input", { placeholder: "https://civitai.com/models/… ou ID de version", "aria-label": "URL ou ID de version" });
  const extended = el("input", { type: "checkbox" });
  const form = el("form", { className: "sml-form", onsubmit: (event) => {
    event.preventDefault();
    if (!address.value.trim()) { address.focus(); return; }
    dialog.close();
    run({ method: "url", value: address.value, extended: extended.checked });
  } }, el("label", {}, "URL du modèle, URL de version ou ID de version", address),
  el("label", { className: "sml-check" }, extended, "Inclure la galerie étendue du modèle"),
  el("div", { className: "sml-actions" }, button("Rechercher par SHA256", () => {
    if (!window.confirm("Envoyer l’empreinte SHA256 de ce LoRA à Civitai pour identifier sa version ?")) return;
    dialog.close();
    run({ method: "hash", extended: extended.checked });
  }, { disabled: !card.present }), el("button", { type: "submit", className: "sml-primary", textContent: "Récupérer" })));
  dialog.append(form);
  address.focus();
}

export async function openInfo({ key, file, stack, onChange }) {
  const { dialog, heading, tools } = modal("SML LoRA Info", "sml-info");
  const model = el("section", { className: "sml-meta", "aria-label": "Informations du modèle" });
  const statusLine = el("output", { className: "sml-status", role: "status" });
  const status = (value) => { statusLine.textContent = value; };
  const footer = el("footer", { className: "sml-footer" }, statusLine);
  const actions = el("div", { className: "sml-actions" });
  footer.append(actions);
  dialog.append(model, footer);
  status("Chargement de la fiche…");
  try {
    let card;
    if (key) {
      try { card = await request(`/cards/${key}`); }
      catch (error) { if (!file || error.status !== 404) throw error; }
    }
    if (!card && file) {
      key = (await request(`/lookup?file=${encodeURIComponent(file)}`)).id;
      card = await request(`/cards/${key}`);
    }
    if (!dialog.open) return;
    let selected = new Set(stack?.get?.() ?? []);
    let polling;
    let pollVersion = 0;
    let currentJob;
    const input = el("input", { type: "file", accept: "image/png,image/jpeg,image/webp", multiple: true, hidden: true });
    let replacement;
    const images = gallery({ key, status, add: () => chooseFiles(), replace: (mid) => chooseFiles(mid),
      onPromptsChange: replaceCard });
    dialog.insertBefore(images.root, footer);
    dialog.append(input);
    const stop = button("Annuler l’opération", async () => {
      try { await request(`/jobs/${currentJob}`, "DELETE"); }
      catch (error) { status(error.message); }
    }, { hidden: true });
    footer.insertBefore(stop, actions);

    function chooseFiles(id) {
      replacement = id;
      input.multiple = !id;
      input.click();
    }

    async function importFiles(files, replace) {
      if (!files.length) return;
      const failures = [];
      for (const [index, file] of [...files].entries()) {
        status(`Import ${index + 1} / ${files.length} · ${file.name}`);
        try {
          await request(`/cards/${key}/media${replace ? `?replace=${replace}` : ""}`, "POST", file);
        } catch (error) { failures.push(`${file.name} · ${error.message}`); }
      }
      await update();
      await images.refresh(replace ? undefined : Math.max(0, card.image_count - 1));
      status(failures.join(" • ") || `${files.length} image(s) importée(s).`);
    }

    input.onchange = () => {
      importFiles([...input.files], replacement).catch((error) => status(error.message));
      input.value = "";
    };
    for (const event of ["dragenter", "dragover"]) images.root.addEventListener(event, (ev) => {
      if (ev.dataTransfer.types.includes("Files")) {
        ev.preventDefault();
        ev.dataTransfer.dropEffect = "copy";
        images.root.classList.add("sml-drop");
      }
    });
    images.root.ondragleave = (event) => {
      if (!images.root.contains(event.relatedTarget)) images.root.classList.remove("sml-drop");
    };
    images.root.ondrop = (event) => {
      event.preventDefault();
      images.root.classList.remove("sml-drop");
      importFiles(event.dataTransfer.files).catch((error) => status(error.message));
    };
    images.root.addEventListener("gallerychange", () => update().catch((error) => status(error.message)));
    function onKeyboard(event) {
      const open = document.querySelectorAll("dialog[open]");
      if (open[open.length - 1] === dialog) images.keyboard(event);
    }
    document.addEventListener("keydown", onKeyboard, true);
    dialog.addEventListener("cancel", (event) => {
      event.stopPropagation();
      if (dialog.classList.contains("sml-expanded")) { event.preventDefault(); images.toggleFull(); }
    });
    dialog.addEventListener("close", () => {
      pollVersion++;
      clearTimeout(polling);
      document.removeEventListener("keydown", onKeyboard, true);
      images.dispose();
    }, { once: true });

    async function update() {
      replaceCard(await request(`/cards/${key}`));
    }

    function replaceCard(updated) {
      card = updated;
      if (!dialog.open) return;
      render();
      onChange?.(card);
    }

    async function relink() {
      try {
        const cards = (await request("/scan", "POST")).filter((candidate) => candidate.present);
        const { dialog: picker } = modal("Relier un fichier local", "sml-small");
        const pick = select(cards.map((candidate) => [candidate.file, candidate.file]), cards[0]?.file, "Fichier de remplacement");
        const error = el("output", { role: "status" });
        const submit = button("Relier la fiche", async () => {
          submit.disabled = true;
          try {
            await request(`/cards/${key}/relink`, "POST", { file: pick.value });
            picker.close();
            await update();
            status("Fichier relié à la fiche.");
          } catch (failure) { error.textContent = failure.message; submit.disabled = false; }
        }, { disabled: !cards.length, className: "sml-primary" });
        picker.append(el("div", { className: "sml-form" }, pick, error, submit));
      } catch (error) { status(error.message); }
    }

    function render() {
      const meta = card.data;
      const remote = card.remote_metadata;
      heading.textContent = display(card);
      tools.replaceChildren(el("span", { className: "sml-badge", textContent: meta.origin }),
        button(meta.favorite ? "★" : "☆", async () => {
          try {
            await request(`/cards/${key}`, "PATCH", { favorite: !meta.favorite });
            await update();
          } catch (error) { status(error.message); }
        }, { className: "sml-icon", "aria-label": meta.favorite ? "Retirer des favoris" : "Ajouter aux favoris" }));
      const link = readLink(remote.url);
      const date = Date.parse(remote.synced_at);
      const triggers = el("div", { className: "sml-triggers" });
      const words = [...new Set([...(meta.triggers || []), ...selected])];
      const copyWords = async (values) => {
        try { await copy(values.join(", ")); status("Trigger words copiés."); }
        catch (error) { status(error.message); }
      };
      for (const word of words) {
        const check = el("input", { type: "checkbox", checked: selected.has(word), "aria-label": `Sélectionner ${word}` });
        check.onchange = () => { if (check.checked) selected.add(word); else selected.delete(word); stack?.set([...selected]); };
        triggers.append(el("span", { className: "sml-trigger" }, check,
          button(word, () => copyWords([word]), { title: "Copier ce trigger" })));
      }
      if (words.length) triggers.append(button("Copier la sélection", () => copyWords([...selected]), { className: "sml-text-button" }));
      const promptActions = el("div", { className: "sml-actions" });
      for (const [key, label] of prompts) if (meta[key]) promptActions.append(button(key === "default_prompt" ? "Copier le prompt" : "Copier le négatif", async () => {
        try { await copy(meta[key]); status(`${label} copié.`); }
        catch (error) { status(error.message); }
      }, { className: "sml-text-button" }));
      const strengthActions = el("div", { className: "sml-field-actions" }, meta.strength?.toString() ?? "—",
        stack && Number.isFinite(meta.strength) ? button("Utiliser dans le node", () => {
          stack.useStrength(meta.strength);
          status(`Force ${meta.strength} copiée dans la ligne du node.`);
        }, { className: "sml-text-button" }) : null);
      const grid = el("dl", { className: "sml-meta-grid" },
        cardField("Nom original", meta.name), cardField("Modèle de base", meta.type), cardField("Origine", meta.origin),
        cardField("Fichier", card.file), cardField("Version", meta.version), cardField("Auteur", meta.author),
        cardField("Nom d’affichage", meta.display_name), cardField("Force recommandée", strengthActions), cardField("Catégorie", meta.category),
        cardField("Trigger words", words.length ? triggers : null), cardField("Tags", meta.tags?.length ? meta.tags.join(", ") : null),
        cardField("Images", String(card.image_count)), cardField("Description", meta.description),
        cardField("Notes privées", meta.notes), cardField("Synchronisé le", Number.isFinite(date) ? new Date(date).toLocaleString("fr-FR") : null),
        cardField("Civitai", link ? el("a", { href: link, target: "_blank", rel: "noopener noreferrer", textContent: "Ouvrir la page Civitai" }) : null),
        cardField("Fichier local", card.present ? "Disponible" : "Absent"),
        ...prompts.filter(([key]) => meta[key]).map(([key, label]) => cardField(label, meta[key], "sml-field-wide")));
      model.replaceChildren(el("div", { className: "sml-section-head" }, el("h3", { textContent: "Informations du modèle" }),
        el("div", { className: "sml-actions" }, promptActions, !card.present ? button("Relier un fichier", relink) : null,
          button("Prompts du LoRA", () => editDefaultPrompts(card, replaceCard)),
          button("Modifier la fiche", () => editCard(card, replaceCard), { className: "sml-text-button" }))), grid);
      actions.replaceChildren(button("Récupérer Civitai", () => syncOptions(card, start)));
      if (remote.version_id) actions.append(button("Actualiser", () => start({ method: "refresh" })),
        button("Télécharger pour hors ligne", () => start({ method: "offline" }), { className: "sml-primary" }));
    }

    async function poll(id) {
      const revision = ++pollVersion;
      currentJob = id;
      stop.hidden = false;
      try {
        const job = await request(`/jobs/${id}`);
        if (!dialog.open || revision !== pollVersion) return;
        status([job.message, ...job.warnings].join(" · "));
        if (job.state === "running") polling = setTimeout(() => poll(id), 650);
        else {
          jobs.delete(key);
          stop.hidden = true;
          await update();
          await images.refresh();
        }
      } catch (error) { if (revision === pollVersion) { stop.hidden = true; status(error.message); } }
    }

    async function start(data) {
      try {
        const result = await request(`/cards/${key}/civitai`, "POST", data);
        jobs.set(key, result.job);
        if (dialog.open) poll(result.job);
      } catch (error) { status(error.message); }
    }

    render();
    await images.refresh(0, true);
    status("");
    if (jobs.has(key)) poll(jobs.get(key));
  } catch (error) { status(error.message); }
}
