# Vérifications Seventh Moon LoRA Studio

Environnement vérifié le 22 novembre 2026. Windows, ComfyUI 0.44.0 (`2c75dc1b3`), frontend 1.57.6, Python 3.13 et PyTorch 2.15 CPU. L’extension a été lancée sur une instance ComfyUI isolée. Les images utilisées pour le test du navigateur sont des fixtures locales distinctes du package.

## Réussi

| Vérification | Résultat |
| --- | --- |
| Inscription ComfyUI | Les deux nodes figurent dans `/object_info`, avec des ports `MODEL` et une sortie de triggers `STRING`. |
| Widget dans Chromium | Ajout via le catalogue, ligne compacte sans miniature, ouverture de la fiche `ⓘ` en mode classique et avec Nodes 2.0. |
| Modale Full HD | Fenêtre de 1 600 × 900 px sur un viewport de 1 920 × 1 080 px, tableau défilant au-dessus de la galerie. |
| Galerie privée | Import par lot de 24 images dans Chromium, ouverture de l’original à 1 600 px, navigation au clavier, couverture, zoom, affichage agrandi et fermeture par `Échap`. Le ruban déborde horizontalement et conserve une partie des miniatures dans le DOM. |
| Workflow | Branchement `UNETLoader → SML Power LoRA → BasicGuider` par les ports `MODEL`. La sérialisation puis le rechargement dans ComfyUI conservent les chemins, les forces, l’ordre et les catégories repliées. Le prompt API garde la pile d’exécution et omet la disposition de l’interface. |
| Forces | Une force recommandée de `0.63` est reprise à l’ajout et à la demande dans la fiche. Un changement manuel à `0.41` persiste dans le workflow. Une recommandation à `0` est conservée. |
| Stockage local | Import, remplacement, légende, réorganisation, couverture et réouverture après redémarrage du catalogue. Renommage, reliaison, Unicode, chemins Windows et sous-dossiers testés. |
| Prompts par fiche et par image | Saisie multiligne avec Unicode, enregistrement automatique et manuel, copie et transfert du prompt d’exemple vers la fiche. Les valeurs manuelles restent distinctes des métadonnées Civitai. Migration SQLite et sauvegardes vérifiées. |
| Civitai en direct | Un modèle public a fourni deux pages avec curseur, une miniature et une image HD décodables. La vérification sans token a retrouvé des prompts sur huit images d’exemple. |
| Civitai simulé | Parcours version et galerie étendue, dédoublonnage, téléchargements HD différés, copie hors ligne, maintien des triggers personnels et des images privées après actualisation. |
| Vie privée | L’ouverture et l’édition d’une fiche privée ne déclenchent aucune session réseau Civitai. Les mutations provenant d’une autre origine sont refusées. |
| Sauvegardes | Export et réimport JSON et ZIP. Déduplication après réimport, priorité locale, galerie, couverture et mapping des presets testés. |
| Poids réels Krea 2 et H3 vidéo | Les en-têtes de deux checkpoints installés ont fourni les formes de diffusion. Sans prompt ni trigger, les chargeurs natifs ont enregistré 264 patchs pour un LoRA Krea 2 et 208 pour un LoRA H3. Le test calcule aussi un patch réel par modèle sur CPU. |

## Non exécuté

- Génération complète d’un workflow image Krea 2 ou vidéo MiniMax H3. L’essai de chargement a utilisé les formes des checkpoints et les poids réels des LoRA, avec calcul d’un patch sur chaque famille.
- Authentification Civitai avec un compte personnel. Le contrôle en direct a utilisé des données publiques.
- Exécution et disponibilité des fichiers sur un worker Modal. Le code du Bridge a été inspecté localement.

## Bloqué

- La génération intégrale MiniMax H3 avec le checkpoint local d’environ 66 Go dépasse la mémoire disponible sur le poste CPU de vérification. Aucun workflow de génération validé n’est fourni.

## Relancer les tests

Depuis le dossier `SeventhMoon-LoRA-Studio`, dans un environnement avec les dépendances installées.

```cmd
python -m unittest discover -s tests -v
```

Les dix tests Python ont réussi.

Pour le contrôle natif avec des fichiers locaux, exécuter le script suivant avec le Python de ComfyUI. `--krea-lora` et `--h3-lora` attendent le nom relatif au dossier `loras`, tel qu’affiché dans ComfyUI. Les chemins de checkpoints peuvent être absolus.

```cmd
python tests\check_native.py --help
```
