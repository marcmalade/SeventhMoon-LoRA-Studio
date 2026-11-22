import { app } from "../../scripts/app.js";
import { library } from "./library.js";
import { addToActiveNode, installWidget } from "./node.js";
import { button, el, modal } from "./ui.js";

app.registerExtension({
  name: "SeventhMoon.LoRAStudio",
  setup() {
    document.head.append(el("link", { rel: "stylesheet", href: new URL("./studio.css", import.meta.url).href }));
    const active = (card) => addToActiveNode(app, card);
    if (app.extensionManager?.registerSidebarTab) {
      app.extensionManager.registerSidebarTab({
        id: "seventh-moon-lora-library", title: "SML LoRA Library", tooltip: "Bibliothèque de LoRA",
        icon: "icon-[lucide--library-big]", type: "custom", render: (root) => library(root, { active }),
      });
    } else {
      document.body.append(button("SML LoRA Library", () => {
        const { dialog } = modal("SML LoRA Library", "sml-picker");
        const root = el("div");
        dialog.append(root);
        library(root, { active });
      }, { className: "sml sml-library-fallback" }));
    }
  },
  nodeCreated(node) { installWidget(node); },
});
