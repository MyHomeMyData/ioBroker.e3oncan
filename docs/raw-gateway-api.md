# Raw-Gateway-API (open3e-esp32 ↔ ioBroker.e3oncan) — Arbeitsstand

Referenz für die Umsetzung auf feature/raw-gateway in beiden Repos. Details
der konkreten Implementierung stimmen wir bei Bedarf später mit boonkerz ab.

## 1. UDS Lesen/Schreiben (REST)

### GET /api/rawread

Query: `ecu=0x680&did=268,269` (Batch durch Komma-Liste)

Response 200:
```json
{
  "ecu": "0x680",
  "results": [
    { "did": 268, "data": "6201..." , "len": 12 },
    { "did": 269, "error": "timeout" }
  ]
}
```

Wichtig für den Scan-Anwendungsfall: eine nicht antwortende DID ist ein
**normaler, erwarteter** Ausgang (die meisten DIDs im Bereich 256–4000
existieren nicht) – kein HTTP-Fehler, sondern ein `error`-Feld pro Ergebnis
in einer sonst erfolgreichen Response. Nur Transport-/Gateway-Probleme
(Bus nicht erreichbar, ECU-Adresse ungültig) sollen als HTTP-Fehler
zurückkommen.

Obergrenze für die Batch-Größe pro Aufruf: 10 DIDs. Der ESP32 ist deutlich
langsamer als ein Raspi — hier bewusst zurückhaltend, damit die
Bus-Owner-Queue nicht zu lange von einem einzelnen Request blockiert wird.

### POST /api/rawwrite

Body:
```json
{ "ecu": "0x680", "did": 396, "svc": "0x2E", "data": "1600" }
```

`svc`: `"0x2E"` oder `"0x77"`. Response `{"ok": true}` oder
`{"ok": false, "error": "..."}`.

`data` sind in beiden Fällen die reinen Wertbytes, **ohne** Service-Envelope
— für `0x77` also nicht das Viessmann-spezifische Prefix
(`43 01 82 <didLo> <didHi> <lenCode>` + Padding), das die lokale
Implementierung heute noch selbst baut. Das Envelope baut die Firmware,
analog dazu, wie sie eingehende 0x77-Antworten laut README schon heute
vollständig decodiert, ohne dass der Aufrufer das Protokoll-Detail sehen
muss. Grund: der ganze Sinn des Raw-Wegs ist, dass ioBroker.e3oncan der
einzige Ort bleibt, der die Bedeutung der Bytes kennt — das Envelope ist
aber reines Transport-/Service-Framing, kein Datenpunkt-Wissen, und gehört
damit konsistent zur selben Schicht wie das ISO-TP-Framing, das die
Firmware für `0x2E` ja bereits übernimmt.

## 2. Passive Rohdaten (Collect/E380) — MQTT

Topic: `open3e/raw/<ecu-hex-3-stellig>`, z. B. `open3e/raw/251`.

Payload (JSON, nicht nur Hex — DLC und Zeitstempel werden für die
Collect-Geräte-Erkennung in ioBroker.e3oncan gebraucht):
```json
{ "dlc": 8, "data": "21fa01b3...", "ts": 1725455669123 }
```

Nur IDs, die in einer neuen Einstellung `raw_canids` (Komma-Liste,
Default leer) enthalten sind, werden veröffentlicht — nach dem Muster der
bestehenden `collect_canids`-Einstellung. Unabhängig von decodierten
Topics, `points.json` und Auto-Discovery.

## 3. Status & Fähigkeits-Erkennung

### Abfragen (REST)

`/api/sysinfo` bekommt zusätzliche Felder:
```json
{
  "rawApiVersion": 1,
  "canState": "running",
  "mqttConnected": true
}
```
`canState`: `"running"` | `"error-passive"` | `"bus-off"` | `"stopped"`
(TWAI-Treiberzustand). ioBroker.e3oncan prüft das beim Verbindungsaufbau —
sowohl `rawApiVersion` (Firmware unterstützt die neue API?) als auch
`canState`/`mqttConnected` (ist der Gateway gerade überhaupt betriebsbereit?).

### Push (MQTT)

Neuer, **retained** Topic `open3e/status`, veröffentlicht bei jeder
Zustandsänderung:
```json
{ "can": "running", "mqtt": true, "tec": 0, "rec": 0 }
```
Retained, damit ein neu verbindender Client den aktuellen Zustand sofort
bekommt, ohne auf die nächste Änderung warten zu müssen. Für den Fall, dass
die Firmware selbst komplett weg ist (Absturz, Stromausfall), bleibt das
bestehende `open3e/LWT` zuständig — dafür braucht es keinen Heartbeat auf
`open3e/status` zusätzlich.

### Auf ioBroker.e3oncan-Seite

Der Gateway-Transport abonniert `open3e/LWT` und `open3e/status` beim
Verbindungsaufbau und speist daraus **denselben** `info.connection`-State,
den heute schon `onCanExtStopped`/`onCanIntStopped` für den lokalen Bus
setzen (`true` nur wenn LWT=online *und* `can`="running"). Damit sieht ein
gestörter Gateway-Betrieb für den Rest des Adapters — und für einen
künftigen Watchdog nach demselben Muster wie bei #255 — genauso aus wie ein
gestörter lokaler Bus. Solange `info.connection=false`, werden keine neuen
`rawread`/`rawwrite`-Anfragen abgeschickt, statt sie ins Leere laufen und
timeouten zu lassen.

## 4. ioBroker.e3oncan — Transportabstraktion

- **UDS Lesen/Schreiben:** `lib/canUds.js`s `uds`-Klasse ist kein reiner
  Protokoll-Codec, sondern ein sich selbst steuernder Worker (eigene
  Kommando-Queue, State-Subscriptions, Timeout-/Statistik-Handling). Eine
  vorgeschaltete Facade passt hier nicht. Stattdessen: neue Klasse
  `udsGateway`, die von `uds` **erbt** und nur die drei Stellen mit
  Frame-I/O überschreibt — `readByDid`, `writeByDid2E`, `writeByDid77`.
  Diese rufen statt `sendFrame()`+Warten auf die `msgUds`-State-Machine
  direkt `rawread`/`rawwrite` (1) auf und lösen bei Erfolg `decodeDataCAN()`
  + `setDidDone()` aus (genau das, was `msgUds` beim Abschluss der
  SF/MF-Zusammensetzung heute tut), bei Fehler dieselben Callback-/Log-Pfade
  wie `onTimeout`. `sendFrame`/`msgUds` werden für Gateway-Worker nie
  aufgerufen. Alles andere (Queue, Scheduling, `onUdsStateChange`,
  Statistik) bleibt geerbt und unverändert.
  Auswahl per neuem Config-Feld `transport` (`'local'` Default /
  `'gateway'`) an den Worker-Konstruktionsstellen: `main.js:setupUdsWorkers`,
  `lib/udsScan.js` (Geräte- und DID-Scan), plus Weiterreichen an
  `startupUdsWorkerService77` in `canUds.js`.
- **Passive Rohdaten (Collect/E380):** `lib/canCollect.js` kennt `socketcan`
  gar nicht — es decodiert nur aus einem transportunabhängigen
  Nachrichtenformat (`msg.id`, `msg.data`, `msg.ts_sec/ts_usec`). Genauso
  wenig kennt der Dispatch dazu (`main.js: onCanMsgExt`/`onCanMsgInt`) oder
  die Ad-hoc-Listener in `lib/udsScan.js` (Collect-Geräte-Erkennung,
  Energy-Meter-Listener) `socketcan` direkt — sie hängen nur von der
  Kanal-Event-Schnittstelle ab. Deshalb reicht hier ein neues
  Gateway-Kanalobjekt, das dieselbe `addListener('onMessage', cb)`/
  `addListener('onStopped', cb)`/`start()`/`stop()`-Schnittstelle wie der
  heutige socketcan-Kanal bereitstellt, gespeist aus (2) — und tritt einfach
  an die Stelle von `this.channelExt`/`this.channelInt`.
  `lib/canCollect.js`, `onCanMsgExt`/`onCanMsgInt` und die Ad-hoc-Listener
  in `lib/udsScan.js` bleiben dadurch **komplett unverändert**.
- Neue Verbindungsart in `admin/jsonConfig.json` pro Bus (ext/int):
  „CAN-Interface (lokal)" vs. „Gateway (open3e-esp32)" — bei Gateway:
  REST-Basis-URL, MQTT-Broker-URL/Zugangsdaten, Raw-Topic-Präfix.
