# Seventh Moon LoRA Studio

Bibliothèque locale et nodes de pile LoRA pour ComfyUI. Organisez des adaptateurs pour tous vos modèles de base, réglez leurs forces dans le workflow et conservez leurs prompts et images de référence sur la fiche `ⓘ`.

**[Télécharger le dernier ZIP](https://github.com/marcmalade/SeventhMoon-LoRA-Studio/releases/latest/download/SeventhMoon-LoRA-Studio.zip)** · [Dernière version et nouveautés](https://github.com/marcmalade/SeventhMoon-LoRA-Studio/releases/latest) · [English documentation](README.md)

## Installation

Dans une installation ComfyUI classique, ouvrir un terminal à la racine de ComfyUI en utilisant son environnement Python.

```cmd
git clone https://github.com/marcmalade/SeventhMoon-LoRA-Studio.git custom_nodes/SeventhMoon-LoRA-Studio
python -m pip install -r custom_nodes/SeventhMoon-LoRA-Studio/requirements.txt
```

- **ZIP**. Télécharger la dernière version ci-dessus et extraire le dossier `SeventhMoon-LoRA-Studio` dans `ComfyUI/custom_nodes/`. Vérifier que `__init__.py` est à la racine du dossier du node, puis exécuter la commande `pip install` ci-dessus avec le Python de ComfyUI (3.11 ou plus récent).
- **Windows Portable**. Depuis la racine `ComfyUI_windows_portable`, après la copie ou le clonage dans `ComfyUI/custom_nodes/`, exécuter `python_embeded\python.exe -m pip install -r ComfyUI\custom_nodes\SeventhMoon-LoRA-Studio\requirements.txt`.
- **ComfyUI Manager**. Si l’installation par URL Git est disponible, utiliser l’adresse du dépôt, puis redémarrer ComfyUI. [Guide officiel d’installation](https://docs.comfy.org/installation/install_custom_node)

Redémarrer ComfyUI. `requirements.txt` contient **Pillow** et **aiohttp**. Le catalogue, les fiches privées, les prompts et les nodes sont utilisables sans compte ni clé API. L’exécution du workflow utilise le moteur ComfyUI et les poids choisis par l’utilisateur.

Pour mettre à jour une installation Git, lancer `git pull --ff-only` dans le dossier du node. Pour une installation ZIP, remplacer ce dossier par celui du dernier ZIP. Réinstaller les dépendances et redémarrer ComfyUI. La bibliothèque est stockée dans le dossier utilisateur de ComfyUI.

## Brancher le node dans un workflow

| Node | Branchement |
| --- | --- |
| **SML Power LoRA (Model Only)** | Relier `MODEL` entre le chargeur de modèle et le sampler ou le guider. |
| **SML Power LoRA (Model and CLIP)** | Relier `MODEL` et `CLIP`. Brancher la sortie `CLIP` sur le node d’encodage de texte. |

Dans le menu du graphe, chercher **SML Power LoRA** ou ouvrir la catégorie **Seventh Moon Labs**. Le node applique les LoRA sans exiger de prompt. La sortie `STRING` peut rester débranchée et ne renvoie que les trigger words cochés explicitement.

1. Cliquer sur **Ajouter un LoRA**. Sa force recommandée est copiée dans la ligne si elle existe. La valeur initiale est `1` pour une fiche sans force enregistrée.
2. Modifier la **force** directement dans la ligne. La variante Model and CLIP possède des valeurs `MODEL` et `CLIP` indépendantes. Mettre une force à `0` pour ignorer cette branche. Dans `ⓘ`, **Utiliser dans le node** recopie la force recommandée sur la branche modèle.
3. Utiliser **Catégories** pour afficher des groupes repliables. Au départ, les lignes reprennent leur catégorie de fiche. Le menu `…` range une ligne dans un groupe propre au workflow. Revenir à la vue d’ordre normal pour déplacer les LoRA avec `↑` et `↓`. Le regroupement garde l’ordre d’application, l’ordre des lignes et leurs forces.
4. Enregistrer les piles réutilisables dans **Presets**. Le workflow conserve aussi sa propre pile, ses catégories et l’état des groupes repliés.

## Bibliothèque et fiches

- Ouvrir **SML LoRA Library** dans la barre latérale. Le catalogue utilise les chemins et les extensions enregistrés par ComfyUI pour `loras`, sous-dossiers compris. **Scanner** actualise la présence des fichiers. En cas de collision de chemin relatif entre deux racines, ComfyUI choisit le fichier de la première racine correspondante.
- **Agrandir** ouvre la bibliothèque en grand. Les vues grille et liste offrent des filtres par modèle de base, catégorie, origine, favoris et présence d’un prompt enregistré. **Modèle de base** accepte une valeur libre ou celle fournie par Civitai. Les fichiers sans modèle renseigné restent consultables et sélectionnables.
- Dans **Prompts du LoRA**, écrire ou coller un **Prompt par défaut** et éventuellement un **Prompt négatif par défaut**, y compris pour un LoRA privé. Le formulaire enregistre automatiquement les modifications. **Enregistrer maintenant** permet de lancer l’écriture immédiatement ou de réessayer après une erreur. Les actions de copie de la fiche permettent de réutiliser ces prompts.
- Dans une fiche, ajouter ou déposer des PNG, JPEG et WebP. La visionneuse conserve les proportions. Utiliser `←` et `→` pour naviguer, `+` et `−` pour zoomer, `0` pour revenir à l’ajustement et `Échap` pour quitter le plein écran ou fermer la fiche. Au zoom, faire glisser l’image pour la déplacer. Le ruban accepte la molette et le trackpad.
- Les commandes de galerie permettent de déplacer une image, lui donner une légende, la choisir comme couverture, remplacer une image personnelle ou la retirer. La copie locale originale reste disponible en pleine définition pendant la consultation.
- **Prompt et réglages** présente les données de génération fournies par Civitai quand elles sont disponibles. Pour n’importe quelle image d’exemple, écris ou colle tes propres valeurs, puis utilise **Copier le prompt** ou **Définir comme défaut** pour le transférer dans la fiche. Les prompts négatifs ont les mêmes commandes. L’éditeur d’image enregistre automatiquement les saisies et propose **Enregistrer maintenant**. Les données locales et les métadonnées récupérées sont incluses dans la sauvegarde ZIP.
- Chaque trigger a sa propre zone de texte, retours à la ligne compris. Cliquer sur son libellé le copie. **Copier la sélection** copie les triggers cochés. Quand la fiche est ouverte depuis un node, ces cases déterminent aussi sa sortie `STRING`.
- Une fiche conserve son identifiant lors d’un renommage reconnu par le système de fichiers. Si un déplacement change son identité, ouvrir la fiche signalée absente et utiliser **Relier un fichier**. La fiche de destination doit être non renseignée pour éviter de fusionner deux fiches personnelles par inadvertance.

## Compatibilité

Les deux variantes utilisent le chargement LoRA natif de ComfyUI. Choisir un LoRA compatible avec le modèle ou l’encodeur relié. Pour un format ou un adaptateur qui exige un chargeur dédié, utiliser ce chargeur dans le workflow. Si aucun poids ne correspond aux entrées actives, SML indique le nom du fichier. [Chargeurs LoRA natifs](https://docs.comfy.org/built-in-nodes/LoraLoader)

Ouvrir dans ComfyUI les workflows enregistrés avec les anciens nodes propres à un modèle, puis les réenregistrer. Leurs nodes sont convertis en **SML Power LoRA (Model Only)** en gardant leurs connexions et les réglages de leur pile. Pour les anciens payloads API envoyés directement à ComfyUI, réexporter le workflow mis à jour ou remplacer le `class_type` de l’ancien node par `SMLPowerLoRA`.

Le widget s’appuie sur `addDOMWidget` et l’entrée de workflow reste un `STRING`. Sur un frontend où le widget DOM est indisponible, le champ JSON natif reste visible et les fiches sont accessibles depuis la bibliothèque. [Extensions JavaScript ComfyUI](https://docs.comfy.org/custom-nodes/js/javascript_overview) · [Barre latérale ComfyUI](https://docs.comfy.org/custom-nodes/js/javascript_sidebar_tabs)

## Civitai

Dans la fiche, choisir **Récupérer Civitai**, coller une URL de modèle, une URL de version ou un ID de version. Une URL sans version sélectionne la première version proposée par l’API. La recherche SHA256 demande une confirmation avant de communiquer l’empreinte. **Inclure la galerie étendue** ajoute la galerie du modèle et identifie séparément ses images. **Actualiser** conserve les valeurs que vous avez modifiées, les images personnelles, l’ordre et les couvertures.

Les miniatures sont mises en cache pendant la synchronisation. La grande image Civitai est téléchargée lors d’une sélection explicite ou via **Charger en HD**. **Télécharger pour hors ligne** met en cache la définition disponible pour l’ensemble de la galerie. Le serveur traite les pages que Civitai expose avec les permissions du compte et de la région. La galerie prend en charge les images PNG, JPEG et WebP. Pour authentifier les requêtes API, définir la variable `SML_CIVITAI_API_TOKEN` dans l’environnement qui démarre ComfyUI. Les lectures locales de fiche et de galerie restent hors ligne. [API publique Civitai](https://github.com/civitai/civitai-developer-docs/blob/main/site/reference/index.md) · [Pagination et permissions des images](https://github.com/civitai/civitai/blob/main/src/pages/api/v1/images/index.ts)

## Sauvegarde et migration

Les données se trouvent dans `seventh-moon-lora-studio` sous le répertoire utilisateur ComfyUI, par défaut `ComfyUI\user\`. La base SQLite distingue les valeurs personnelles des métadonnées Civitai. Les copies d’images sont stockées séparément dans `media`. Chaque import d’image valide le format réel et autorise jusqu’à 48 Mio et 64 mégapixels.

Toute personne ayant accès à l’instance ComfyUI peut consulter ce catalogue partagé. Pour un accès à distance, protège ComfyUI par une passerelle authentifiée ou utilise un réseau privé.

**Exporter ZIP** sauvegarde les fiches, les images déjà mises en cache, leur ordre, les couvertures et les presets. **Exporter JSON** sauvegarde les métadonnées et les références. **Importer** fusionne le contenu par identifiant ou chemin relatif en donnant la priorité aux modifications locales existantes. Les poids sont à copier séparément vers les chemins `loras` de la nouvelle installation. Les copies devenues orphelines restent dans le stockage local et sont exclues des nouvelles sauvegardes.

## API locale

Les routes sont accessibles sous `/api/sml-lora` dans ComfyUI. Les mutations exigent l’en-tête `X-SML-Studio: 1`. Le flux d’import des images et des archives reçoit directement les octets du fichier. Les autres corps de mutation sont des objets JSON.

| Méthode et route | Fonction |
| --- | --- |
| `GET /catalog`, `POST /scan` | Lire ou rescanner le catalogue |
| `GET /lookup?file=…`, `GET /cards/{id}` | Retrouver une fiche |
| `PATCH /cards/{id}`, `POST /cards/{id}/relink` | Modifier les champs ou relier un fichier |
| `GET /cards/{id}/media?offset=…&limit=…` | Consulter une page de galerie |
| `POST /cards/{id}/media[?replace=…]` | Importer ou remplacer une image |
| `PATCH /cards/{id}/media/{id}` | Actions `cover`, `remove`, `caption`, `move`, `generation` |
| `GET /cards/{id}/media/{id}/generation` | Lire les prompts et réglages associés à une image |
| `GET /images/{id}/original`, `GET /images/{id}/thumbnail` | Lire une image en cache |
| `POST /cards/{id}/media/{id}/download` | Mettre en cache une image Civitai en HD |
| `POST /cards/{id}/civitai` | Démarrer `url`, `hash`, `refresh` ou `offline` |
| `GET` / `DELETE /jobs/{id}` | Suivre ou annuler une opération Civitai |
| `GET` / `POST` / `DELETE /presets` | Lire, enregistrer ou supprimer un preset |
| `GET` / `POST /backup/{json\|zip}` | Exporter ou importer une sauvegarde |

## Installation sur une autre instance ComfyUI

Installer l’extension et ses dépendances dans l’environnement Python de l’autre instance. Placer les poids dans ses chemins `loras` avec les mêmes noms relatifs et la même casse. Le workflow transporte les chemins, les forces, l’ordre et les triggers sélectionnés. Pour transférer aussi les fiches et les médias, utiliser l’export ZIP puis l’import sur la nouvelle instance.

## Licence et références

Le code et la documentation sont distribués sous licence MIT. Le logo Seventh Moon Labs est un élément de marque et reste la propriété de Seventh Moon Labs. [Licence](LICENSE)

L’interface de rgthree a servi de référence fonctionnelle. Seventh Moon LoRA Studio utilise son propre code et ses propres routes. Les maquettes et les images de test ne font pas partie de l’extension. [rgthree Power LoRA Loader](https://github.com/rgthree/rgthree-comfy/blob/main/src_web/comfyui/power_lora_loader.ts) · [Licence rgthree](https://github.com/rgthree/rgthree-comfy/blob/main/LICENSE)
