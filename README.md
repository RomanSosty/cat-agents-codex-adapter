# cat-agents-codex-adapter

Adaptér propojuje lokální relace Codex desktopu s Cat Office, aby se v kanceláři zobrazovaly jako kočky. Současné živé spuštění používá místní upravenou kopii `cat-agents@1.0.1` v `vendor/`; přijímací API zatím není dohodnuté ani vydané v původním npm balíčku.

## Živé spuštění

Vyžaduje Node.js 20+, macOS, volný port `127.0.0.1:4317` a místní kopii Cat Office v `vendor/cat-agents/`. V kořeni projektu spusťte:

```sh
npm run live:start
npm run hooks:install
```

První příkaz spustí Cat Office a adaptér jako samostatné lokální procesy. Druhý přidá sedm hooků do `~/.codex/hooks.json`, zachová ostatní hooky a před změnou vytvoří zálohu. V Codex CLI otevřete `/hooks` a potvrďte důvěru pro nové definice. Poté restartujte Codex desktop a otevřete [http://127.0.0.1:4317](http://127.0.0.1:4317).

Přijímač používá unixový socket `run/adapter.sock`; Cat Office přijímá snapshoty pouze z loopbacku s místním tokenem. Hook posílá názvy událostí, identifikátory relací a nástrojů a potřebná metadata. Obsah promptů, vstupů nástrojů a odpovědí se nepřenáší. Vstup nástroje se používá pouze k výpočtu otisku pro párování událostí.

Pro odstranění instalovaných hooků a ukončení procesů:

```sh
npm run hooks:remove
npm run live:stop
```

Po odstranění hooků znovu načtěte konfiguraci restartem Codex desktopu. Logy procesů jsou v `run/office.log` a `run/start.log`.

## Ověření

Vyžaduje Node.js 20 nebo novější. Z kořene projektu spusťte:

```sh
npm test
```

Testy ověřují převod událostí na stavy relací, souběžné a opožděné hooky, archivaci, restart procesu, odstranění obsahu promptů a nástrojů z přenášených událostí a místní přijímač. Ke spuštění testů není potřeba Cat Office ani instalace hooků.

## Stav integrace

Klient odesílá snapshot na navržený endpoint `PUT /api/external-sources/codex/sessions`. Ten existuje pouze v místní kopii Cat Office v `vendor/`. Pokud ji do Gitu nezařadíte, čtenář repozitáře nebude moci živé spuštění podle tohoto návodu použít, dokud nebude API vydané a nahrazené běžnou závislostí.
