# Požadavky na API Cat Office pro Codex adapter

Tento dokument je podklad pro autora Cat Office. Popisuje **místní prototyp** nad npm balíčkem `cat-agents@1.0.1` ve `vendor/cat-agents/`. API ještě není součástí původního npm vydání a jeho finální podobu je třeba domluvit s autorem Cat Office. Adaptér sestavuje úplný seznam relací; Cat Office jej přijímá a zobrazuje společně s relacemi Claude Code.

## Přijetí snapshotu

```http
PUT /api/external-sources/codex/sessions
Host: 127.0.0.1:4317
Authorization: Bearer <CAT_AGENTS_EXTERNAL_TOKEN>
Content-Type: application/json
```

```json
{
  "schemaVersion": 1,
  "sessions": [
    {
      "id": "codex:thr_123",
      "source": "codex",
      "name": "example-project",
      "cwd": "/work/example-project",
      "project": "example-project",
      "status": "waiting",
      "statusSince": 1792955400000,
      "startedAt": 1792955300000,
      "activity": { "name": "Bash", "category": "shell", "detail": "Bash", "ts": 1792955400000 },
      "subagents": []
    }
  ]
}
```

Každý platný požadavek **nahradí celý Codex snapshot**. `sessions: []` jej okamžitě vyprázdní. Server sloučí Codex relace s Claude relacemi v existujících `/api/state` a `/api/events`. Cizí zdroje snapshot Codexu nemění.

Endpoint vyžaduje proměnnou `CAT_AGENTS_EXTERNAL_TOKEN`, hlavičku Bearer a spojení z loopback adresy. Bez tokenu vrací `503`, chybný token `401`, spojení mimo loopback `403`, chybná data `400`, jiná HTTP metoda `405` a tělo nad 256 KiB `413`. Přijímá nejvýše 100 relací, pouze jedinečná ID `codex:*`, stavy `busy|waiting|idle`, předepsaná pole a prázdné `subagents`. Odmítá další pole včetně promptů, příkazů a odpovědí nástrojů. Úspěch vrací `204` bez těla. Neplatný požadavek nesmí změnit poslední platný snapshot.

Adaptér musí poslat úplný snapshot každých nejvýše 5 sekund a ihned po změně stavu. Cat Office odstraní Codex snapshot po 15 sekundách bez aktualizace; tento timeout chrání proti výpadku adaptéru, **neukončuje jednotlivé nečinné chaty**. Po restartu Cat Office je snapshot prázdný, dokud ho adaptér znovu nepošle. Identita běhu procesu a ochrana proti opožděným hookům zůstává odpovědností adaptéru.

## Akceptační kritéria pro vydání API

1. Dvě různá `codex:*` ID vytvoří dvě kočky vedle existujících Claude relací.
2. Nový snapshot nahradí pouze Codex relace; `sessions: []` je odstraní ihned.
3. Změny `busy → waiting → busy → idle` se projeví v `/api/state`, `/api/events` a ve webovém rozhraní bez další aktivity Claude Code.
4. Průběžně obnovovaná `idle` relace zůstane viditelná; po výpadku adaptéru zmizí celý Codex snapshot po 15 sekundách.
5. Neplatný požadavek nezmění uložený snapshot ani relace Claude Code.
6. Po restartu Cat Office jsou externí relace prázdné a další platný snapshot je znovu zobrazí.

## Místní ověření

```sh
CAT_AGENTS_HOOKS=off CAT_AGENTS_EXTERNAL_TOKEN=local-prototype-only \
  DATA_DIR="$PWD/vendor/cat-agents/data" node vendor/cat-agents/server/index.js

CAT_AGENTS_EXTERNAL_TOKEN=local-prototype-only \
  node experiments/replay-to-office.js --keepalive

CAT_AGENTS_EXTERNAL_TOKEN=local-prototype-only \
  node experiments/check-office-api.js
```

Při skutečném testu prošlo 17 anonymizovaných událostí z fixture přes `SessionStateMachine`, klienta, `PUT` endpoint a `/api/state`. `/api/events` obsahoval relaci Codexu a v předpřipraveném webovém rozhraní se zobrazila kočka s projektem `example-project`. Při zastavení replaye po 11. události rozhraní ukázalo **dvě současné kočky** a nadpis „MAKAJÍ 2 Z 2 KOČEK“. Chybný token, schéma, pole navíc a nadměrné tělo byly odmítnuty. Po zastavení obnovování snapshotu kočka z `/api/state` zmizela po TTL; samostatný prázdný snapshot odstranil obě kočky okamžitě. Po restartu Cat Office byl Codex snapshot prázdný a nový replay ho znovu naplnil. Testovací replay používá pevnou identitu procesu a nahrazená metadata. Nový přijímač navíc prošel testem `node experiments/test-live-transport.js` přes unixový socket až do Cat Office; skutečné hooky po instalaci vyžadují načtení konfigurace Codex desktopem.
