---
name: fill-form
description: Fill supplier questionnaires (flat or fillable PDF) from a Gemini gem answers.json that points to numbered zones (Zn). Use when the user asks to fill a form/questionnaire in jobs/ or inbox/, mentions answers.json, zones.pdf, the gem or "remplis ce formulaire".
---

# Remplir un formulaire

Outil : `apps-script-test/` (JavaScript, pdf.js + pdf-lib). En CLI depuis la racine du repo :

```
node apps-script-test/cli.js prepare jobs/<nom>
node apps-script-test/cli.js run jobs/<nom>
node apps-script-test/cli.js validate jobs/<nom>
```

Libs locales (gitignorées) : `apps-script-test/vendor/{pdf.min.js,pdf.worker.min.js,pdf-lib.min.js}`. Si absentes, suivre les commandes `curl` en tête de `apps-script-test/cli.js`.

Alternative UI : page Apps Script / `Index.html` (même `prepare.js` / `run.js`).

Le gem Gemini (app web uniquement) choisit les zones. Le script détecte, valide et écrit. Pas d'API, pas d'autre IA pour le placement. PDF uniquement.

## Dossier de travail (job)

```
jobs/<nom>/
  form.pdf                 formulaire vierge (copie, jamais l'original signé)
  zones/                   produit par `prepare` — à donner au gem
    zones.pdf                formulaire avec Zn visibles
    zones.txt                liste compacte (id, page, type, texte autour)
    zones.json               carte complète (interne)
  answers.json             sortie du gem (schéma : schema/answers.schema.json)
  out/                     généré : filled.pdf, review.pdf, plan.json
```

Sans job : créer `jobs/<nom>/`, y copier le formulaire. Sans answers : lancer `prepare`, donner `zones.pdf` + `zones.txt` + `gem/PROMPT.md` à l'utilisateur pour le gem, attendre le JSON.

## Workflow

```
- [ ] 1. node apps-script-test/cli.js prepare jobs/<nom>
        → donner zones/zones.pdf + zones/zones.txt (+ formulaire) au gem
- [ ] 2. Attendre answers.json (doit contenir form.zone_map = code ZONE_MAP de zones.txt)
- [ ] 3. node apps-script-test/cli.js run jobs/<nom>
- [ ] 4. Si erreurs de validation : donner out/gem_feedback.txt à l'utilisateur pour le gem, s'arrêter
- [ ] 5. Lire `out/review.pdf` (infobulles) et le résumé affiché par `run`
        - rouge (conflit, vide, zone sans réponse) : demander au gem une correction
          (zone manquante, mauvaise Zn, conflit) via gem_feedback, ou à l'utilisateur
        - Ne pas inventer de coordonnées ni d'overrides géométriques
- [ ] 6. Questions bloquantes → AskQuestion
- [ ] 7. Résumé : fichiers rendus, jaune « à vérifier », zones rouges sans réponse, signature manuelle
```

Pas de contrôle visuel page par page. Revue humaine via `out/review.pdf` (bleu = ajout OK, jaune = à vérifier, rouge = vide / conflit / zone sans réponse).

## Rôles

| Qui | Fait quoi |
|---|---|
| Script `prepare` | Détecte large toutes les zones possibles, les numérote Z1…Zn |
| Gem Gemini (app web) | Lit le PDF + zones.pdf/txt, produit answers.json avec `zone` / `zones` |
| Script `run` | Valide les Zn, écrit, produit filled + review |
| Humain | Revue finale, signature, cases « reserved » |

## Quand une zone manque

Si le gem signale `zone: null` pour une valeur réelle, ou si `review.pdf` marque en rouge une zone texte importante « sans réponse » :

1. Vérifier d'abord que le gem n'a pas simplement oublié le numéro (souvent visible sur `zones.pdf`).
2. Si la zone n'existe vraiment pas dans `zones/` : corriger le détecteur (`apps-script-test/prepare.js`), relancer `prepare` sur **tous** les jobs, puis redemander au gem un JSON sur la **nouvelle** carte (`zone_map` différent).

Ne pas empiler de correctifs manuels de coordonnées : la carte numérotée est la source de vérité.

## Statuts (dans `out/plan.json`, et couleurs de `review.pdf`)

- `placed` : écrit
- `already_filled` : valeur déjà présente, non réécrite
- `empty` : gem sans valeur (+ note)
- `skipped` : signature / do_not_fill
- `no_zone` : réponse sans Zn utilisable
- `conflict` : zone déjà remplie avec une autre valeur
- `partial` : une partie seulement des écritures a une zone

## Règles

- Ne jamais modifier un PDF déjà signé ni le formulaire source : tout va dans `out/` et `zones/`.
- Ne pas inventer de réponse ni de numéro de zone.
- Une zone = une réponse (validateur).
- Livrer `out/review.pdf` pour la revue humaine.
