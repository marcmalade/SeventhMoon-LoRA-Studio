import { openInfo } from "./info.js";
import { pickLoRA } from "./library.js";
import { button, categoryField, display, el, modal, promptField, request } from "./ui.js";

export const nodeTypes = new Map([["SMLPowerLoRAKrea2", "Krea 2"], ["SMLPowerLoRAMiniMaxH3", "MiniMax H3"]]);
export const nodeControls = new WeakMap();
let lastNode;
const defaultLayout = () => ({ grouped: false, collapsed: [] });

function createRow(card) {
  return { id: card.id, file: card.file, enabled: true, strength: card.data.strength ?? 1,
    category: card.data.category?.trim().slice(0, 120) || undefined, triggers: [] };
}

export function addToActiveNode(app, card) {
  const selected = Object.values(app.canvas?.selected_nodes || {});
  const node = selected.length === 1 ? selected[0] : selected.length === 0 ? lastNode : null;
  const controls = node?.graph && nodeControls.get(node);
  const type = nodeTypes.get(node?.comfyClass || node?.type);
  if (!controls || !card.present || (card.data.type && type !== card.data.type)) return false;
  controls.add(card);
  return true;
}

export function installWidget(node) {
  const type = nodeTypes.get(node.comfyClass || node.type);
  const originalIndex = node.widgets?.findIndex((widget) => widget.name === "sml_stack");
  if (!type || originalIndex === undefined || originalIndex < 0 || typeof node.addDOMWidget !== "function") return;
  const original = node.widgets[originalIndex];
  let state = { version: 1, enabled: true, rows: [], layout: defaultLayout() };
  let invalid;
  let lastHeight = 0;
  let rowsHeight = 34;
  const cards = new Map();
  const rows = el("div", { className: "sml-node-rows" });
  const host = el("div", { className: "sml sml-node" });
  const toggle = el("input", { type: "checkbox", checked: true, "aria-label": "Activer la pile" });
  const heading = el("label", { className: "sml-check" }, toggle, "Pile active");
  const info = el("span", { className: "sml-node-status", role: "status" });
  const presets = button("Presets", () => openPresets());
  const groupView = button("Catégories", () => {
    state.layout.grouped = !state.layout.grouped;
    commit();
  }, { "aria-pressed": "false", title: "Basculer entre catégories et ordre d’application" });
  const collapseAll = button("Replier", () => {
    const groups = [...groupedRows().keys()];
    state.layout.collapsed = groups.every((group) => state.layout.collapsed.includes(group)) ? [] : groups;
    commit();
  }, { hidden: true });
  const add = button("+ Ajouter un LoRA", () => pickLoRA(type, addCard), { className: "sml-node-add" });
  host.append(el("div", { className: "sml-node-header" }, heading,
    el("div", { className: "sml-actions" }, groupView, collapseAll, presets)), rows, add, info);
  host.addEventListener("pointerdown", (event) => { lastNode = node; event.stopPropagation(); });
  host.addEventListener("keydown", (event) => event.stopPropagation());
  host.addEventListener("wheel", (event) => {
    if (rows.scrollHeight > rows.clientHeight && rows.contains(event.target)) event.stopPropagation();
  });

  function getValue() { return invalid ?? JSON.stringify(state); }

  function setValue(raw) {
    try {
      const data = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!data || !Array.isArray(data.rows)) throw new Error();
      const layout = { grouped: data.layout?.grouped === true,
        collapsed: Array.isArray(data.layout?.collapsed) ? [...data.layout.collapsed] : [] };
      state = { version: data.version ?? 1, enabled: data.enabled !== false, layout,
        rows: data.rows.map((row) => ({ ...row, triggers: row.triggers || [] })) };
      invalid = undefined;
      render();
      hydrate();
    } catch {
      invalid = typeof raw === "string" ? raw : JSON.stringify(raw);
      info.textContent = "Pile illisible. Ajoutez un LoRA pour la recréer.";
    }
  }

  function minHeight() { return Math.min(Math.max(rowsHeight, 34), 304) + 76; }

  node.widgets.splice(originalIndex, 1);
  original.onRemove?.();
  const widget = node.addDOMWidget("sml_stack", "sml_stack", host, {
    getValue, setValue, getMinHeight: minHeight, getMaxHeight: minHeight, hideOnZoom: false, serialize: true,
  });
  widget.options ??= {};
  widget.options.serialize = true;
  widget.computeSize = (width) => [width, minHeight()];
  widget.serializeValue = () => invalid ?? JSON.stringify({ version: state.version, enabled: state.enabled,
    rows: state.rows.map(({ id, file, enabled, strength, triggers }) => ({ id, file, enabled, strength, triggers })) });

  function groupFor(row) {
    return row.category || (cards.get(row.id) || cards.get(row.file))?.data.category?.trim().slice(0, 120) || "";
  }

  function groupedRows() {
    const groups = new Map();
    for (const [index, row] of state.rows.entries()) {
      const group = groupFor(row);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push([index, row]);
    }
    return groups;
  }

  function renderRow(index, row) {
    const card = cards.get(row.id) || cards.get(row.file);
    const label = card ? display(card) : row.file.split("/").pop();
    const active = el("input", { type: "checkbox", checked: row.enabled !== false, "aria-label": `Activer ${label}` });
    active.onchange = () => { row.enabled = active.checked; commit(false); };
    const strength = el("input", { type: "number", value: row.strength, min: -100, max: 100, step: "any", "aria-label": `Force de ${label}` });
    strength.onchange = () => {
      if (strength.value !== "" && strength.validity.valid) row.strength = strength.valueAsNumber;
      else strength.value = row.strength;
      commit(false);
    };
    const changeFile = button(label, () => pickLoRA(type, (selected) => {
      const rowIndex = state.rows.indexOf(row);
      if (rowIndex < 0 || selected.file === row.file) return;
      remember(selected);
      state.rows[rowIndex] = { ...createRow(selected), enabled: row.enabled };
      reveal(state.rows[rowIndex]);
      commit();
    }), { className: "sml-node-name", title: card?.present === false ? `Fichier absent · ${row.file}` : row.file });
    const open = button("ⓘ", () => openRow(row), { className: "sml-node-info", "aria-label": `Infos de ${label}` });
    const grouped = state.layout.grouped;
    return el("div", { className: `sml-node-row${grouped ? " sml-row-grouped" : ""}${card?.present === false ? " sml-missing" : ""}` },
      active, changeFile, strength, open,
      grouped ? el("span", { className: "sml-row-order", title: "Position dans l’ordre d’application", textContent: String(index + 1) }) : null,
      grouped ? null : button("↑", () => move(index, -1), { disabled: index === 0, "aria-label": "Monter" }),
      grouped ? null : button("↓", () => move(index, 1), { disabled: index === state.rows.length - 1, "aria-label": "Descendre" }),
      button("…", () => editRowCategory(row, label), { "aria-label": `Ranger ${label}` }),
      button("×", () => { state.rows.splice(index, 1); commit(); }, { "aria-label": "Retirer le LoRA" }));
  }

  function render() {
    toggle.checked = state.enabled;
    groupView.setAttribute("aria-pressed", String(state.layout.grouped));
    rows.replaceChildren();
    rowsHeight = 34;
    const groups = state.layout.grouped ? groupedRows() : new Map();
    collapseAll.hidden = groups.size < 2;
    collapseAll.textContent = [...groups.keys()].every((group) => state.layout.collapsed.includes(group)) ? "Déplier" : "Replier";
    if (!state.rows.length) rows.append(el("span", { className: "sml-node-empty", textContent: "Aucun LoRA dans la pile" }));
    else if (!state.layout.grouped) {
      rowsHeight = state.rows.length * 40;
      for (const [index, row] of state.rows.entries()) rows.append(renderRow(index, row));
    } else {
      rowsHeight = 0;
      for (const [group, entries] of groups) {
        const closed = state.layout.collapsed.includes(group);
        const title = group || "Sans catégorie";
        const toggleGroup = button("", () => {
          state.layout.collapsed = closed ? state.layout.collapsed.filter((key) => key !== group) : [...state.layout.collapsed, group];
          commit();
          [...rows.querySelectorAll(".sml-node-group")].find((control) => control.dataset.group === group)?.focus();
        }, { className: "sml-node-group", "aria-expanded": String(!closed), "aria-label": `${title}, ${entries.length} LoRA` });
        toggleGroup.dataset.group = group;
        toggleGroup.append(el("span", { "aria-hidden": "true", textContent: closed ? "▸" : "▾" }),
          el("span", { textContent: title }), el("span", { className: "sml-count", textContent: String(entries.length) }));
        rows.append(toggleGroup);
        rowsHeight += 34;
        if (!closed) {
          for (const [index, row] of entries) rows.append(renderRow(index, row));
          rowsHeight += entries.length * 40;
        }
      }
    }
    info.textContent = invalid ? "Pile illisible." : "";
    const height = minHeight();
    if (height !== lastHeight) {
      const previous = lastHeight;
      lastHeight = height;
      requestAnimationFrame(() => {
        if (node.flags?.collapsed || height !== lastHeight) return;
        const width = Math.max(410, node.size[0]);
        const [, computed] = node.computeSize();
        const current = node.size[1];
        node.setSize([width, Math.max(computed, previous ? current + height - previous : current, height + 60)]);
        node.setDirtyCanvas(true, true);
      });
    }
  }

  function remember(card) {
    cards.set(card.id, card);
    cards.set(card.file, card);
  }

  async function hydrate() {
    if (!state.rows.length) return;
    try {
      const list = await request("/catalog");
      for (const card of list) remember(card);
      render();
    } catch { /* la configuration du workflow reste utilisable hors ligne */ }
  }

  function addCard(card) {
    if (invalid !== undefined) state = { version: 1, enabled: true, rows: [], layout: defaultLayout() };
    remember(card);
    const row = createRow(card);
    state.rows.push(row);
    reveal(row);
    commit();
  }

  function reveal(row) {
    state.layout.collapsed = state.layout.collapsed.filter((group) => group !== groupFor(row));
  }

  function editRowCategory(row, label) {
    const { dialog } = modal(`Catégorie · ${label}`, "sml-small");
    const { input, list } = categoryField(groupFor(row), "Catégorie dans ce node");
    const form = el("form", { className: "sml-form", onsubmit: (event) => {
      event.preventDefault();
      row.category = input.value.trim() || undefined;
      state.layout.grouped = true;
      reveal(row);
      commit();
      dialog.close();
    } }, el("label", {}, "Catégorie dans ce node", input), list,
    el("button", { type: "submit", className: "sml-primary", textContent: "Ranger" }));
    dialog.append(form);
    input.focus();
  }

  function move(index, delta) {
    const destination = index + delta;
    [state.rows[index], state.rows[destination]] = [state.rows[destination], state.rows[index]];
    commit();
  }

  function commit(redraw = true) {
    invalid = undefined;
    widget.callback?.(getValue());
    node.graph?.change();
    node.setDirtyCanvas(true, true);
    if (redraw) render();
  }

  function openRow(row) {
    const card = cards.get(row.id) || cards.get(row.file);
    openInfo({ key: card?.id ?? row.id, file: row.file,
      stack: { get: () => row.triggers, set: (words) => { row.triggers = words; commit(false); },
        useStrength: (strength) => { row.strength = strength; commit(); } },
      onChange: (changed) => {
        remember(changed);
        if (row.id === changed.id && row.file === changed.file) { render(); return; }
        row.id = changed.id;
        row.file = changed.file;
        commit();
      } });
  }

  async function openPresets() {
    const { dialog } = modal("Presets de pile", "sml-small");
    const list = el("div", { className: "sml-form" });
    const status = el("output", { role: "status" });
    dialog.append(list);
    async function renderPresets() {
      try {
        const entries = await request("/presets");
        list.replaceChildren(button("Enregistrer la pile actuelle", async () => {
          const name = await promptField("Enregistrer le preset", "Nom du preset");
          if (!name) return;
          try { await request("/presets", "POST", { name, stack: state }); await renderPresets(); }
          catch (error) { status.textContent = error.message; }
        }, { className: "sml-primary" }), status,
        ...entries.map(({ name, stack }) => el("div", { className: "sml-actions" },
          button(name, () => { setValue(stack); commit(); dialog.close(); }), button("×", async () => {
            if (!window.confirm(`Supprimer le preset « ${name} » ?`)) return;
            try { await request(`/presets?name=${encodeURIComponent(name)}`, "DELETE"); await renderPresets(); }
            catch (error) { status.textContent = error.message; }
          }, { "aria-label": `Supprimer ${name}` }))));
      } catch (error) { list.replaceChildren(status); status.textContent = error.message; }
    }
    renderPresets();
  }

  toggle.onchange = () => { state.enabled = toggle.checked; commit(false); };
  nodeControls.set(node, { add: addCard });
  setValue(original.value);
}
