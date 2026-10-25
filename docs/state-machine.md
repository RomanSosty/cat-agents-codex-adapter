# Stavový automat adaptéru

`src/state.js` převádí lifecycle události na úplný seznam relací pro budoucí Cat Office endpoint. Je nezávislý na hook transportu a Cat Office klientovi.

## Rozhraní

```js
const { SessionStateMachine } = require('../src/state');
const state = new SessionStateMachine();

state.setProcess('/Applications/ChatGPT.app/Contents/MacOS/ChatGPT:89184:process-start-time');
state.apply(hookEvent, {
  processId: '/Applications/ChatGPT.app/Contents/MacOS/ChatGPT:89184:process-start-time',
  occurredAt: '2026-10-25T19:11:54.559Z',
});
const sessions = state.snapshot();

state.setProcess(null); // hlavní proces skončil: okamžitě prázdný seznam
```

`processId` musí určit **jeden běh hlavního GUI procesu** pomocí ověřené cesty, PID a času spuštění. Samotné PID nestačí, protože se může znovu použít. Události z jiného běhu se odmítnou. Přijímač musí při vzniku události přiřadit identitu procesu a čas spuštění hooku; čas doručení nestačí k rozpoznání opožděných událostí.

Snapshot používá `codex:<session_id>` a obsahuje `idle`, `busy` nebo `waiting`, název projektu odvozený z `cwd` a pouze název/kategorii aktuálního nástroje. Neobsahuje prompt, vstup nástroje, jeho odpověď ani cestu k přepisu. Přijímač musí dál omezit velikost vstupního JSON.

## Přechody a pořadí

- `SessionStart` vytvoří nečinnou relaci; pozdější metadata `cwd` mohou doplnit její název bez změny stavu.
- `UserPromptSubmit` začne nový tah jako `busy`. Opožděný prompt stejného tahu nevymaže už viditelný nástroj.
- `PreToolUse` ukáže nástroj a drží `busy`, pokud se již nečeká na povolení.
- `PermissionRequest` přejde do `waiting`; souběžný `PreToolUse` čekání neruší.
- `PostToolUse` vrací do `busy`, pokud odpovídá čekajícímu vstupu nástroje. U ostatních nástrojů používá `tool_use_id`, aby dokončení staršího souběžného nástroje nevymazalo novější aktivitu.
- `Stop` přejde do `idle`; relace zůstává ve snapshotu.
- `SessionEnd` odstraní jednu relaci a vytvoří tombstone pro daný běh procesu. Pouze novější `SessionStart` ji může znovu otevřít.
- `setProcess(null)` nebo změna identity procesu vyprázdní všechny relace a staré události odmítne.

Události jednoho tahu se porovnávají podle času spuštění hooku a při stejné milisekundě podle pořadí `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `Stop`. Již viděné `turn_id` nelze znovu aktivovat po přechodu na další tah. Čas je přibližný: asynchronní hooky nemají společné sekvenční číslo. Pro zkoušené přechody pomáhá vyšší priorita `PermissionRequest` a vazba `PostToolUse` na vstup nástroje.

## Fixture a omezení

`test/fixtures/desktop-events.json` zachovává anonymizované pořadí, časy a typy událostí ze skutečného desktopového pokusu. ID, cesty a hodnoty `tool_input` jsou nahrazeny bezpečnými příklady; původní sonda obsah nástrojů záměrně neukládala. Testy navíc simulují opačné pořadí souběžných hooků, duplicitní a opožděné události, dvě relace, archivaci a restart.

`PermissionRequest` ve sledovaném vzorku neměl `tool_use_id`. Korelace přes obsah vstupu je proto jen nejlepší dostupný odhad. Při zamítnutém povolení nemusí přijít `PostToolUse`; `Stop` čekání ukončí, ale mezi zamítnutím a koncem tahu může stav dočasně zůstat `waiting`. Toto chování se při pokusu se zamítnutím netestovalo.
