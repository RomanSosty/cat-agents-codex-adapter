# cat-agents-codex-adapter

Rozpracovaný adaptér pro zobrazení lokálních relací Codex desktopu v Cat Office. Zpracování hooků, sledování procesu a stavový automat jsou implementované a testované. Napojení na Cat Office zatím závisí na přijímacím API, které není dohodnuté ani vydané v balíčku `cat-agents`.

## Ověření

Vyžaduje Node.js 20 nebo novější. Z kořene projektu spusťte:

```sh
npm test
```

Testy ověřují převod událostí na stavy relací, souběžné a opožděné hooky, archivaci, restart procesu, odstranění obsahu promptů a nástrojů z přenášených událostí a místní přijímač. Ke spuštění testů není potřeba Cat Office ani instalace hooků.

## Stav integrace

Adaptér přijímá vybraná metadata z hooků Codexu přes místní unixový socket a sestavuje úplný snapshot relací. Klient pro odeslání snapshotu cílí na navržený endpoint `PUT /api/external-sources/codex/sessions`. Tento endpoint zatím není součástí vydaného `cat-agents`, proto aktuální verze neposkytuje podporovaný postup pro živé spuštění ani instalaci hooků.

Po dohodnutí a vydání přijímacího API bude možné doplnit závislost na Cat Office a postup instalace. Místní pokusná kopie Cat Office v `vendor/` není součástí projektu určeného ke commitu.
