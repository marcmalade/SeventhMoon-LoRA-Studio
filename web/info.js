import { gallery } from "./gallery.js";
import { autoSave, button, cardSource, categoryField, copy, display, el, modal, origins, request, select, watchCivitai } from "./ui.js";

const jobs = new Map();
const MAX_IMAGES = 15;
const fields = [
  ["name", "Original name"], ["display_name", "Display name"], ["type", "Base model"],
  ["version", "Version"], ["author", "Author"], ["origin", "Source"],
  ["strength", "Recommended strength"], ["category", "Category"],
  ["description", "Description"], ["notes", "Private notes"], ["tags", "Tags"],
];
const prompts = [["default_prompt", "Default prompt"], ["default_negative_prompt", "Default negative prompt"]];

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
  const { dialog } = modal(`LoRA prompts · ${display(card)}`, "sml-editor");
  const form = el("form", { className: "sml-form" });
  const inputs = new Map();
  for (const [key, label] of prompts) {
    const input = el("textarea", { value: card.data[key] ?? "", rows: 5, maxLength: 65536,
      placeholder: "Type or paste a prompt…", spellcheck: false });
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
  const { dialog } = modal("Edit LoRA", "sml-editor");
  const form = el("form", { className: "sml-form" });
  const inputs = new Map();
  const grid = el("div", { className: "sml-form-grid" });
  const advanced = el("div", { className: "sml-form-grid" });
  const quickFields = new Set(["display_name", "type", "category", "strength", "origin", "notes"]);
  let saver;
  const reset = (key, field) => Object.hasOwn(card.user_overrides, key) ? button("↺", (event) => {
    event.currentTarget.disabled = true;
    field.querySelectorAll("input,textarea,select,button").forEach((node) => { node.disabled = true; });
    saver.queue(key, null);
  }, { className: "sml-text-button sml-reset", title: "Restore the imported or default value",
    "aria-label": "Reset " + (fields.find(([field]) => field === key)?.[1] ?? "triggers") }) : null;
  for (const [key, label] of fields) {
    const value = card.data[key];
    let input;
    let suggestions;
    if (key === "origin") {
      input = select([["", "Automatic"], ...origins], card.user_overrides.origin ?? "", label);
    } else if (key === "type") {
      input = el("input", { type: "text", value: value ?? "", maxLength: 500, placeholder: "Model or family name" });
    } else if (key === "category") {
      ({ input, list: suggestions } = categoryField(value ?? "", label));
    } else if (["description", "notes", "tags"].includes(key)) {
      input = el("textarea", { value: Array.isArray(value) ? value.join("\n") : value ?? "", rows: key === "notes" ? 2 : 3 });
    } else {
      input = el("input", { type: key === "strength" ? "number" : "text",
        value: value ?? "", min: -100, max: 100, step: "any" });
    }
    const read = () => {
      if (key === "origin") return input.value || null;
      if (key === "strength") return input.value === "" ? null : Number(input.value);
      if (key === "tags") return input.value.split("\n").map((tag) => tag.trim()).filter(Boolean);
      if (key === "category" || key === "type" || key === "display_name") return input.value.trim() || null;
      return input.value;
    };
    const field = el("label", {}, label, input);
    (quickFields.has(key) ? grid : advanced).append(el("div", { className: "sml-edit-field" +
      (key === "notes" || key === "description" ? " sml-form-wide" : "") },
      field, suggestions, reset(key, field)));
    inputs.set(key, { input, read });
  }
  const words = el("div", { className: "sml-trigger-edit" });
  const readWords = () => [...words.querySelectorAll("textarea")].map((input) => input.value).filter((word) => word.trim());
  function addWord(text = "") {
    const input = el("textarea", { value: text, rows: 1, "aria-label": "Trigger word" });
    const row = el("div", {}, input, button("×", () => {
      row.remove();
      saver.queue("triggers", readWords());
    }, { "aria-label": "Remove trigger" }));
    words.append(row);
    return input;
  }
  for (const word of card.data.triggers ?? []) addWord(word);
  const wordControls = el("fieldset", { className: "sml-edit-field" }, el("legend", { textContent: "Trigger words" }), words,
    button("Add trigger", () => addWord().focus()), reset("triggers", words));
  inputs.set("triggers", { input: words, read: readWords });
  form.append(grid, el("details", { className: "sml-details" }, el("summary", { textContent: "More fields" }),
    advanced, wordControls));
  saver = autoSave(dialog, form, inputs, async (changes) => {
    onSave(await request(`/cards/${card.id}`, "PATCH", changes));
  });
  dialog.append(form);
}

function syncOptions(card, run) {
  const { dialog } = modal("Link Civitai model", "sml-small");
  const address = el("input", { placeholder: "https://civitai.com/models/… or version ID", "aria-label": "URL or version ID" });
  const form = el("form", { className: "sml-form", onsubmit: (event) => {
    event.preventDefault();
    if (!address.value.trim()) { address.focus(); return; }
    dialog.close();
    run({ method: "url", value: address.value });
  } }, el("label", {}, "Model URL, version URL, or version ID", address),
  el("button", { type: "submit", className: "sml-primary", textContent: "Link model" }));
  dialog.append(form);
  address.focus();
}

export async function openInfo({ key, file, stack, onChange }) {
  const { dialog, heading, tools } = modal("SML LoRA Info", "sml-info");
  const model = el("section", { className: "sml-meta", "aria-label": "Model details" });
  const statusLine = el("output", { className: "sml-status", role: "status" });
  const status = (value) => { statusLine.textContent = value; };
  const footer = el("footer", { className: "sml-footer" }, statusLine);
  const actions = el("div", { className: "sml-actions" });
  footer.append(actions);
  dialog.append(model, footer);
  status("Loading LoRA…");
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
    const stop = button("Cancel sync", async () => {
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
      const batch = [...files].slice(0, replace ? 1 : Math.max(0, MAX_IMAGES - card.local_images));
      const failures = [];
      let imported = 0;
      for (const [index, file] of batch.entries()) {
        status(`Importing ${index + 1} / ${batch.length} · ${file.name}`);
        try {
          await request(`/cards/${key}/media${replace ? `?replace=${replace}` : ""}`, "POST", file);
          imported++;
        } catch (error) { failures.push(`${file.name} · ${error.message}`); }
      }
      await update();
      await images.refresh(replace ? undefined : Math.max(0, card.image_count - 1));
      if (batch.length < files.length) failures.push("This LoRA can hold up to 15 personal images. Remove or replace one to make room.");
      status([imported ? `${imported} images imported` : "", ...failures]
        .filter(Boolean).join(" · "));
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
        const { dialog: picker } = modal("Relink local file", "sml-small");
        const pick = select(cards.map((candidate) => [candidate.file, candidate.file]), cards[0]?.file, "Replacement file");
        const error = el("output", { role: "status" });
        const submit = button("Relink file", async () => {
          submit.disabled = true;
          try {
            await request(`/cards/${key}/relink`, "POST", { file: pick.value });
            picker.close();
            await update();
            status("File relinked.");
          } catch (failure) { error.textContent = failure.message; submit.disabled = false; }
        }, { disabled: !cards.length, className: "sml-primary" });
        picker.append(el("div", { className: "sml-form" }, pick, error, submit));
      } catch (error) { status(error.message); }
    }

    function render() {
      const meta = card.data;
      const remote = card.remote_metadata;
      heading.textContent = display(card);
      tools.replaceChildren(button("Edit", () => editCard(card, replaceCard)),
        button("Prompts", () => editDefaultPrompts(card, replaceCard)),
        button(meta.favorite ? "★" : "☆", async () => {
          try {
            await request(`/cards/${key}`, "PATCH", { favorite: !meta.favorite });
            await update();
          } catch (error) { status(error.message); }
        }, { className: "sml-icon", "aria-label": meta.favorite ? "Remove from favorites" : "Add to favorites" }));
      const link = readLink(remote.url);
      const more = model.querySelector(".sml-details")?.open ?? false;
      const triggers = el("div", { className: "sml-triggers" });
      const words = [...new Set([...(meta.triggers || []), ...selected])];
      const copyWords = async (values) => {
        try { await copy(values.join(", ")); status("Triggers copied."); }
        catch (error) { status(error.message); }
      };
      for (const word of words) {
        const check = stack ? el("input", { type: "checkbox", checked: selected.has(word), "aria-label": `Select ${word}` }) : null;
        if (check) check.onchange = () => { if (check.checked) selected.add(word); else selected.delete(word); stack.set([...selected]); };
        triggers.append(el("span", { className: "sml-trigger" }, check,
          button(word, () => copyWords([word]), { title: "Copy trigger" })));
      }
      if (words.length && stack) triggers.append(button("Copy selected", () => copyWords([...selected]), { className: "sml-text-button" }));
      const promptActions = el("div", { className: "sml-actions" });
      for (const [key, label] of prompts) if (meta[key]) promptActions.append(button(key === "default_prompt" ? "Copy prompt" : "Copy negative prompt", async () => {
        try { await copy(meta[key]); status(`${label} copied.`); }
        catch (error) { status(error.message); }
      }, { className: "sml-text-button" }));
      const strengthActions = el("span", { className: "sml-field-actions" }, `Strength ${meta.strength}`,
        stack && Number.isFinite(meta.strength) ? button("Apply to stack", () => {
          stack.useStrength(meta.strength);
          status(`Applied strength ${meta.strength} to the stack.`);
        }, { className: "sml-text-button" }) : null);
      const values = [["File", card.file], ["Original name", meta.name !== display(card) && meta.name], ["Version", meta.version],
        ["Tags", meta.tags?.join(", ")], ["Description", meta.description], ["Private notes", meta.notes]];
      model.replaceChildren(...[
        el("div", { className: "sml-summary" },
          el("span", { textContent: [meta.type, meta.category, cardSource(card), meta.author].filter(Boolean).join(" · ") }),
          Number.isFinite(meta.strength) ? strengthActions : null,
          !card.present ? button("Relink missing file", relink) : null),
        words.length ? el("div", { className: "sml-trigger-line" },
          el("span", { className: "sml-muted", textContent: "Triggers" }), triggers) : null,
        promptActions.childElementCount ? promptActions : null,
        el("details", { className: "sml-details", open: more }, el("summary", { textContent: "Details" }),
          el("dl", { className: "sml-meta-grid" }, values.filter(([, value]) => value)
            .map(([label, value]) => cardField(label, value, label === "Description" || label === "Private notes" ? "sml-field-wide" : ""))))].filter(Boolean));
      const menu = el("details", { className: "sml-popover" }, el("summary", { textContent: "Civitai" }),
        el("div", { className: "sml-tool-panel" },
          card.present ? button("Look up by SHA-256", () => start({ method: "hash" })) : null,
          button("Link manually", () => syncOptions(card, start)),
          remote.version_id ? button("Refresh", () => start({ method: "refresh" })) : null,
          remote.version_id ? button("Download images for offline use", () => start({ method: "offline" })) : null));
      actions.replaceChildren(...[card.archived_images ? el("span", { className: "sml-muted",
        title: "Older images are still included in your library exports.", textContent: `${card.archived_images} archived` }) : null,
        link ? el("a", { href: link, target: "_blank", rel: "noopener noreferrer", textContent: "Open on Civitai ↗" }) : null, menu].filter(Boolean));
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
    watchCivitai(dialog, async () => {
      const updated = await request(`/cards/${key}`);
      if (updated.remote_metadata.synced_at !== card.remote_metadata.synced_at && dialog.open) {
        replaceCard(updated);
        await images.refresh();
      }
    }, undefined, key);
  } catch (error) { status(error.message); }
}
