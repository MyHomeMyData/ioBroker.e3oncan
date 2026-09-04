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

- `UdsTransport`-Facade: `readDid(ecu, did)` / `writeDid(ecu, did, bytes, svc)`
  als Promise. Lokale Implementierung umhüllt `lib/canUds.js` unverändert;
  neue `GatewayUdsTransport` ruft (1) auf.
- Passiver Frame-Listener: Gateway-Kanalobjekt bietet dieselbe
  `addListener('onMessage', cb)`-Schnittstelle wie der heutige
  socketcan-Kanal, gespeist aus (2) — `lib/udsScan.js` (Collect-Erkennung)
  und `lib/canCollect.js` laufen dadurch unverändert.
- Neue Verbindungsart in `admin/jsonConfig.json` pro Bus (ext/int):
  „CAN-Interface (lokal)" vs. „Gateway (open3e-esp32)" — bei Gateway:
  REST-Basis-URL, MQTT-Broker-URL/Zugangsdaten, Raw-Topic-Präfix.
