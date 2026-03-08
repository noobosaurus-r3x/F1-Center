# F1 Center
https://noobosaurus-r3x.github.io/F1-Center/
Application web OpenF1 en français.
Usage perso, c'est pas la peine d'espérer un truc intéressant, c'est de l'AI slop a 100%.

Fonctions principales :

- Vue d'ensemble : Grand Prix, sessions, pilotes, météo, direction de course, classements
- Télémétrie : vitesse, commandes pilote, comparaison, trace XY
- Stratégie : tours, relais, stands, écarts, dépassements, radio, grille et résultats
- Explorateur API : les 18 endpoints gratuits, filtres, URL brute, export CSV

## Lancer le projet

```bash
npm install
npm run dev
```

## Build de production

```bash
npm run build
```

## Notes

- L'application consomme directement l'API publique OpenF1 depuis le navigateur.
- Le client espace les requêtes pour respecter la limite publique de 3 requêtes par seconde.
- Les timestamps OpenF1 avec microsecondes sont normalisés côté client.
- La télémétrie haute fréquence est fenêtrée côté client pour éviter les réponses instables sur certains filtres de date.
