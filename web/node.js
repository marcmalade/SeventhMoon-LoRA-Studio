import { openInfo } from "./info.js";
import { pickLoRA } from "./library.js";
import { button, categoryField, display, el, modal, promptField, request } from "./ui.js";

const nodeControls = new WeakMap();
let lastNode;
let catalogueRequest;
const defaultLayout = () => ({ grouped: false, collapsed: [] });

export function addToActiveNode(app, card) {
  const selected = Object.values(app.canvas?.selected_nodes || {});
  const node = selected.length === 1 ? selected[0] : selected.length === 0 ? lastNode : null;
  const controls = node?.graph && nodeControls.get(node);
  if (!controls || !card.present) return false;
  controls.add(card);
  return true;
}

export function installWidget(node) {
  const type = node.comfyClass || node.type;
  const originalIndex = node.widgets?.findIndex((widget) => widget.name === "sml_stack");
  if (!type?.startsWith("SMLPowerLoRA") || originalIndex === undefined || originalIndex < 0 || typeof node.addDOMWidget !== "function") return;
  const withClip = type === "SMLPowerLoRAWithCLIP";
  const rowHeight = withClip ? 53 : 40;
  const original = node.widgets[originalIndex];
  let state = { version: 1, enabled: true, rows: [], layout: defaultLayout() };
  let invalid;
  let lastHeight = 0;
  let rowsHeight = 34;
  const cards = new Map();
  const rows = el("div", { className: "sml-node-rows" });
  const host = el("div", { className: "sml sml-node", lang: "en" });
  const toggle = el("input", { type: "checkbox", checked: true, "aria-label": "Enable stack" });
  const heading = el("label", { className: "sml-check", title: "Enable this stack" }, toggle, "Enabled");
  const info = el("span", { className: "sml-node-status", role: "status" });
  const presets = button("Presets", () => openPresets());
  const groupView = button("Categories", () => {
    state.layout.grouped = !state.layout.grouped;
    commit();
  }, { "aria-pressed": "false", title: "Switch between categories and application order" });
  const collapseAll = button("Collapse all", () => {
    const groups = [...groupedRows().keys()];
    state.layout.collapsed = groups.every((group) => state.layout.collapsed.includes(group)) ? [] : groups;
    commit();
  }, { hidden: true });
  const add = button("+ Add LoRA", () => pickLoRA(addCard), { className: "sml-primary sml-node-add" });
  host.append(el("div", { className: "sml-node-header" }, heading,
    el("div", { className: "sml-actions" }, groupView, collapseAll, presets, add)), rows, info);
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
        rows: data.rows.map((row) => ({ ...row, triggers: row.triggers || [],
          ...(withClip ? { strength_clip: row.strength_clip ?? row.strength ?? 1 } : {}) })) };
      invalid = undefined;
      render();
      hydrate();
    } catch {
      invalid = typeof raw === "string" ? raw : JSON.stringify(raw);
      info.textContent = "Unreadable stack. Add a LoRA to rebuild it.";
    }
  }

  function minHeight() {
    const headerHeight = host.querySelector(".sml-node-header").offsetHeight || 44;
    return Math.min(Math.max(rowsHeight, 32), 304) + headerHeight + 24 + (invalid ? 22 : 0);
  }

  node.widgets.splice(originalIndex, 1);
  original.onRemove?.();
  const widget = node.addDOMWidget("sml_stack", "sml_stack", host, {
    getValue, setValue, getMinHeight: minHeight, getMaxHeight: minHeight, hideOnZoom: false, serialize: true,
  });
  widget.options ??= {};
  widget.options.serialize = true;
  widget.computeSize = (width) => [width, minHeight()];
  widget.serializeValue = () => invalid ?? JSON.stringify({ version: state.version, enabled: state.enabled,
    rows: state.rows.map(({ id, file, enabled, strength, strength_clip, triggers }) => ({ id, file, enabled, strength, triggers,
      ...(withClip ? { strength_clip } : {}) })) });

  function createRow(card) {
    const strength = card.data.strength ?? 1;
    return { id: card.id, file: card.file, enabled: true, strength,
      ...(withClip ? { strength_clip: strength } : {}),
      category: card.data.category?.trim().slice(0, 120) || undefined, triggers: [] };
  }

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
    const active = el("input", { type: "checkbox", checked: row.enabled !== false, "aria-label": `Enable ${label}` });
    active.onchange = () => { row.enabled = active.checked; commit(false); };
    const strength = strengthControl(row, "strength", label, withClip ? "MODEL" : null);
    const clipStrength = withClip ? strengthControl(row, "strength_clip", label, "CLIP") : null;
    const changeFile = button(label, () => pickLoRA((selected) => {
      const rowIndex = state.rows.indexOf(row);
      if (rowIndex < 0 || selected.file === row.file) return;
      remember(selected);
      state.rows[rowIndex] = { ...createRow(selected), enabled: row.enabled };
      reveal(state.rows[rowIndex]);
      commit();
    }), { className: "sml-node-name", title: card?.present === false ? `File missing · ${row.file}` : row.file });
    const open = button("ⓘ", () => openRow(row), { className: "sml-node-info", "aria-label": `Inspect ${label}` });
    const grouped = state.layout.grouped;
    const classes = ["sml-node-row", grouped && "sml-row-grouped", withClip && "sml-row-clip", card?.present === false && "sml-missing"];
    return el("div", { className: classes.filter(Boolean).join(" ") },
      active, changeFile, strength, clipStrength, open,
      grouped ? el("span", { className: "sml-row-order", title: "Position in application order", textContent: String(index + 1) }) : null,
      grouped ? null : button("↑", () => move(index, -1), { disabled: index === 0, "aria-label": "Move up" }),
      grouped ? null : button("↓", () => move(index, 1), { disabled: index === state.rows.length - 1, "aria-label": "Move down" }),
      button("…", () => editRowCategory(row, label), { "aria-label": `Set category for ${label}` }),
      button("×", () => { state.rows.splice(index, 1); commit(); }, { "aria-label": "Remove LoRA" }));
  }

  function strengthControl(row, field, label, branch) {
    const input = el("input", { type: "number", value: row[field], min: -100, max: 100, step: "any",
      "aria-label": branch ? `${branch} strength for ${label}` : `Strength for ${label}` });
    input.oninput = () => {
      if (input.value !== "" && input.validity.valid) {
        row[field] = input.valueAsNumber;
        commit(false);
      }
    };
    input.onblur = () => { input.value = row[field]; };
    return branch ? el("label", { className: "sml-branch-strength" }, branch, input) : input;
  }

  function render() {
    toggle.checked = state.enabled;
    groupView.setAttribute("aria-pressed", String(state.layout.grouped));
    rows.replaceChildren();
    rowsHeight = 34;
    const groups = state.layout.grouped ? groupedRows() : new Map();
    collapseAll.hidden = groups.size < 2;
    collapseAll.textContent = [...groups.keys()].every((group) => state.layout.collapsed.includes(group)) ? "Expand all" : "Collapse all";
    if (!state.rows.length) rows.append(el("span", { className: "sml-node-empty", textContent: "Empty stack" }));
    else if (!state.layout.grouped) {
      rowsHeight = state.rows.length * rowHeight;
      for (const [index, row] of state.rows.entries()) rows.append(renderRow(index, row));
    } else {
      rowsHeight = 0;
      for (const [group, entries] of groups) {
        const closed = state.layout.collapsed.includes(group);
        const title = group || "Uncategorized";
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
          rowsHeight += entries.length * rowHeight;
        }
      }
    }
    info.textContent = invalid ? "Unreadable stack." : "";
    const height = minHeight();
    if (height !== lastHeight) {
      const previous = lastHeight;
      lastHeight = height;
      requestAnimationFrame(() => {
        if (node.flags?.collapsed || height !== lastHeight) return;
        const width = Math.max(withClip ? 470 : 410, node.size[0]);
        const [, computed] = node.computeSize();
        const current = node.size[1];
        node.setSize([width, Math.max(computed, previous ? current + height - previous : 0, height + 60)]);
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
      catalogueRequest ??= request("/catalog").finally(() => { catalogueRequest = undefined; });
      const list = await catalogueRequest;
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
    const { dialog } = modal(`Category · ${label}`, "sml-small");
    const { input, list } = categoryField(groupFor(row), "Category in this stack");
    const save = () => {
      row.category = input.value.trim() || undefined;
      state.layout.grouped = true;
      reveal(row);
      commit();
    };
    input.oninput = save;
    const form = el("form", { className: "sml-form", onsubmit: (event) => {
      event.preventDefault();
      dialog.close();
    } }, el("label", {}, "Category in this stack", input), list,
    el("button", { type: "submit", className: "sml-primary", textContent: "Done" }));
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
    const { dialog } = modal("Stack presets", "sml-small");
    const list = el("div", { className: "sml-form" });
    const status = el("output", { role: "status" });
    dialog.append(list);
    async function renderPresets() {
      try {
        const entries = await request("/presets");
        list.replaceChildren(button("Save current stack", async () => {
          const name = await promptField("Save preset", "Preset name");
          if (!name) return;
          try { await request("/presets", "POST", { name, stack: state }); await renderPresets(); }
          catch (error) { status.textContent = error.message; }
        }, { className: "sml-primary" }), status,
        ...entries.map(({ name, stack }) => el("div", { className: "sml-actions" },
          button(name, () => { setValue(stack); commit(); dialog.close(); }), button("×", async () => {
            if (!window.confirm(`Delete preset “${name}”?`)) return;
            try { await request(`/presets?name=${encodeURIComponent(name)}`, "DELETE"); await renderPresets(); }
            catch (error) { status.textContent = error.message; }
          }, { "aria-label": `Delete ${name}` }))));
      } catch (error) { list.replaceChildren(status); status.textContent = error.message; }
    }
    renderPresets();
  }

  toggle.onchange = () => { state.enabled = toggle.checked; commit(false); };
  nodeControls.set(node, { add: addCard });
  setValue(original.value);
}
