![Logo](admin/e3oncan_small.png)
# ioBroker.e3oncan

[![NPM version](https://img.shields.io/npm/v/iobroker.e3oncan.svg)](https://www.npmjs.com/package/iobroker.e3oncan)
[![Downloads](https://img.shields.io/npm/dm/iobroker.e3oncan.svg)](https://www.npmjs.com/package/iobroker.e3oncan)
![Number of Installations](https://iobroker.live/badges/e3oncan-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/e3oncan-stable.svg)

[![NPM](https://nodei.co/npm/iobroker.e3oncan.png?downloads=true)](https://nodei.co/npm/iobroker.e3oncan/)

**Tests:** ![Test and Release](https://github.com/MyHomeMyData/ioBroker.e3oncan/workflows/Test%20and%20Release/badge.svg)

## e3oncan Adapter für ioBroker

> Dieses Dokument ist die deutsche Version der Dokumentation. [English version: README.md](README.md)

## Inhaltsverzeichnis

- [Übersicht](#übersicht)
- [Was ist neu in v1.0.0](#was-ist-neu-in-v100)
- [Schnellstart](#schnellstart)
- [Konfigurationsanleitung](#konfigurationsanleitung)
  - [Schritt 1 – CAN-Adapter](#schritt-1--can-adapter)
  - [Schritt 2 – Gerätescan und Energiezähler-Erkennung](#schritt-2--gerätescan-und-energiezähler-erkennung)
  - [Schritt 3 – Datenpunktscan](#schritt-3--datenpunktscan)
  - [Schritt 4 – Zuweisungen und Zeitpläne](#schritt-4--zuweisungen-und-zeitpläne)
- [e3oncan Datenpunkte-Seite](#e3oncan-datenpunkte-seite)
- [Datenpunkte lesen](#datenpunkte-lesen)
- [Datenpunkte schreiben](#datenpunkte-schreiben)
- [Datenpunkte und Metadaten](#datenpunkte-und-metadaten)
- [Energiezähler](#energiezähler)
  - [E380 – Daten und Einheiten](#e380--daten-und-einheiten)
  - [E3100CB – Daten und Einheiten](#e3100cb--daten-und-einheiten)
- [FAQ und Einschränkungen](#faq-und-einschränkungen)
- [Spenden](#spenden)
- [Changelog](#changelog)

---

## Übersicht

Viessmann-Geräte der E3-Serie (One Base Ökosystem) tauschen über den CAN-Bus eine große Datenmenge aus. Dieser Adapter klinkt sich in diese Kommunikation ein und stellt die Daten in ioBroker zur Verfügung.

Zwei Betriebsmodi arbeiten unabhängig voneinander und können kombiniert werden:

| Modus | Beschreibung |
|---|---|
| **Collect** | Hört passiv auf dem CAN-Bus zu und extrahiert Daten in Echtzeit, während die Geräte sie austauschen. Es werden keine Anfragen gesendet. Ideal für sich schnell ändernde Werte wie Energiefluss. |
| **UDSonCAN** | Liest und schreibt Datenpunkte aktiv über das UDS-Protokoll (Universal Diagnostic Services over CAN). Erforderlich für Sollwerte, Zeitprogramme und Daten, die nicht spontan gesendet werden. |

Welche Modi verfügbar sind, hängt von der Gerätekonfiguration ab. Weitere Details in der [Diskussion zur Gerätetopologie](https://github.com/MyHomeMyData/ioBroker.e3oncan/discussions/34). Anwendungsbeispiele sind in der [Diskussion zu Anwendungsfällen](https://github.com/MyHomeMyData/ioBroker.e3oncan/discussions/35) zu finden.

> Wichtige Teile dieses Adapters basieren auf dem [open3e](https://github.com/open3e)-Projekt.
> Eine Python-basierte Collect-only-Implementierung mit MQTT ist unter [E3onCAN](https://github.com/MyHomeMyData/E3onCAN) verfügbar.

---

## Was ist neu in v1.0.0

### Datenpunkte-Seite

Eine neue **e3oncan Datenpunkte**-Seite ist direkt in der Instanzzeile des Adapters in der ioBroker-Instanzansicht verankert. Sie bietet eine dedizierte Oberfläche zum Verwalten von Zeitplänen und Collect-Einstellungen je Gerät und Datenpunkt — ohne dass der vollständige Adapterkonfigurationsdialog geöffnet werden muss.

### Automatische Erkennung von Energiezählern

Energiezähler (E380 und E3100CB) werden jetzt während des Gerätescans **automatisch erkannt**, indem passiv auf beiden CAN-Kanälen gelauscht wird. Die State-Namen werden anhand der erkannten CAN-Adresse und des Kanals automatisch vergeben. Der Aktiv/Inaktiv-Schalter und die Collect-Verzögerung für jeden Energiezähler werden ausschließlich in der Datenpunkte-Seite konfiguriert.

Beim ersten Start nach einem Upgrade von einer früheren Version wird die bisherige Energiezähler-Konfiguration automatisch migriert.

### Automatische Erkennung von Collect-fähigen Geräten

Während des Datenpunktscans lauscht der Adapter passiv auf dem CAN-Bus, um zu erkennen, welche Geräte den Collect-Modus unterstützen. Erkannte Geräte werden mit einem Pin-Symbol im Gerätekarten-Header der Datenpunkte-Seite hervorgehoben.

### Flexibler Datenpunktscan

Eine neue Option **Datenpunktwerte während des Scans im Objektbaum speichern** steuert, ob die aktuellen Werte während des Scans in den Objektbaum geschrieben werden. Wenn diese Option deaktiviert ist, aktualisiert der Adapter Werte und Metadaten für bereits vorhandene Datenpunkt-Objekte, erstellt aber keine neuen — diese werden automatisch angelegt, wenn nach dem Scan erstmals Daten empfangen werden.

---

## Schnellstart

**Voraussetzungen**

- Ein USB-to-CAN- oder CAN-Adapter, der mit dem externen oder internen CAN-Bus des Viessmann-E3-Geräts verbunden ist.
- Ein Linux-basiertes Hostsystem (nur Linux wird unterstützt).
- Der CAN-Adapter ist aktiv und im System sichtbar, z. B. als `can0` (prüfen mit `ifconfig`).
- Zur Einrichtung des CAN-Adapters siehe das [open3e-Projekt-Wiki](https://github.com/open3e/open3e/wiki/020-Inbetriebnahme-CAN-Adapter-am-Raspberry).

> **Wichtig:** Stellen Sie sicher, dass kein anderer UDSonCAN-Client (z. B. open3e) läuft, während dieser Adapter zum ersten Mal eingerichtet wird. Parallele UDS-Kommunikation verursacht Fehler in beiden Anwendungen.

**Ersteinrichtung – Kurzübersicht**

1. Adapter installieren und Konfigurationsdialog öffnen.
2. CAN-Adapter auf dem Tab **CAN Adapter** konfigurieren und speichern.
3. E3-Geräte auf dem Tab **Liste der UDS-Geräte** scannen.
4. Datenpunkte auf dem Tab **Liste der Datenpunkte** scannen (dauert bis zu 5 Minuten).
5. Leseintervalle auf dem Tab **Zuweisungen** einrichten und speichern.

Die detaillierten Schritte sind in der [Konfigurationsanleitung](#konfigurationsanleitung) weiter unten beschrieben.

> **Nach einem Node.js-Upgrade:** Native Module dieses Adapters müssen neu kompiliert werden, wenn sich die Node.js-Version ändert. Falls der Adapter nach einem Node.js-Upgrade nicht startet, Adapter stoppen, `iob rebuild` auf der Kommandozeile ausführen und Adapter neu starten.

---

## Konfigurationsanleitung

### Schritt 1 – CAN-Adapter

Öffnen Sie den Adapterkonfigurationsdialog und wechseln Sie zum Tab **CAN Adapter**.

- Namen der CAN-Schnittstelle eingeben (Standard: `can0`).
- **Mit Adapter verbinden** für jede gewünschte Schnittstelle aktivieren.
- **SPEICHERN** drücken. Die Adapterinstanz wird neu gestartet und stellt die CAN-Bus-Verbindung her.

Falls ein zweiter CAN-Bus vorhanden ist (z. B. interner Bus), kann er hier als zweiter Adapter konfiguriert werden. Ein zweiter **Zuweisungen**-Tab erscheint, sobald der zweite Adapter konfiguriert ist.

### Schritt 2 – Gerätescan und Energiezähler-Erkennung

Zum Tab **Liste der UDS-Geräte** wechseln und **Scan** drücken.

- Der Scan dauert einige Sekunden. Der Fortschritt ist im Adapter-Log sichtbar (zweiten Browser-Tab öffnen).
- Alle auf dem Bus gefundenen E3-Geräte werden aufgelistet. Die Geräte können in der zweiten Spalte umbenannt werden — diese Namen werden als Bezeichner im ioBroker-Objektbaum verwendet.
- **SPEICHERN** drücken, wenn fertig. Die Instanz wird neu gestartet.

> Während des Gerätescans liest der Adapter auch die Datenformatkonfiguration des Geräts (Datenpunkt 382) aus, einschließlich Temperatureinheiten (°C oder °F) und Datums-/Zeitformaten. Diese werden gespeichert und beim nachfolgenden Datenpunktscan verwendet.

**Energiezähler-Erkennung**

Während der Gerätescan läuft, lauscht der Adapter passiv auf dem CAN-Bus auf Broadcasts von E380- und E3100CB-Energiezählern. Es ist keine zusätzliche Scanzeit erforderlich — die Erkennung läuft parallel. Das Ergebnis wird gespeichert und angezeigt:

- Im Adapterkonfigurationsdialog (Tab **Liste der UDS-Geräte**) als Textzusammenfassung.
- In der **e3oncan Datenpunkte**-Seite als einzelne Karten für jeden erkannten Zählertyp (siehe [unten](#e3oncan-datenpunkte-seite)).

### Schritt 3 – Datenpunktscan

Tab **Liste der Datenpunkte** öffnen, **Scan starten …** drücken und mit **OK** bestätigen.

> **Geduld** – der Scan kann bis zu 5 Minuten dauern. Der Fortschritt ist im Adapter-Log sichtbar.

Was der Scan tut:
- Ermittelt alle verfügbaren Datenpunkte für jedes Gerät.
- Fügt Metadaten (Beschreibung, Einheit, Lese-/Schreibzugriff) zu jedem Datenpunkt-Objekt hinzu.
- Setzt physikalische Einheiten gemäß der in Schritt 2 gefundenen Datenformatkonfiguration.
- Erstellt den vollständigen Objektbaum für jedes Gerät in ioBroker.
- Erkennt Collect-fähige Geräte, indem passiv auf deren Zeitübertragungen auf dem CAN-Bus gelauscht wird (keine zusätzliche Scanzeit — läuft parallel). Ein Pin-Symbol erscheint im Gerätekarten-Header der **e3oncan Datenpunkte**-Seite für jedes erkannte Gerät.

Dieser Schritt ist für die reine Lesenutzung nicht zwingend erforderlich, wird aber **dringend empfohlen** — und ist **notwendig**, wenn Datenpunkte geschrieben werden sollen.

**Datenpunktwerte während des Scans im Objektbaum speichern**

Standardmäßig schreibt der Scan auch den aktuellen Wert jedes Datenpunkts in den Objektbaum (`json`-, `raw`- und `tree`-States). Das Verhalten kann über die Option **Datenpunktwerte im Objektbaum während des Scans speichern** oberhalb der Scan-Schaltfläche angepasst werden. Wenn diese Option deaktiviert ist, aktualisiert der Adapter Werte und Metadaten für bereits vorhandene Datenpunkt-Objekte, erstellt aber keine neuen — diese werden automatisch angelegt, wenn nach dem Scan erstmals Daten empfangen werden.

Diese Option ist nützlich, wenn eine große Anzahl von State-Schreibvorgängen während des Scans vermieden werden soll (z. B. auf Systemen mit vielen Geräten). Wenn zuvor ein Scan mit gespeicherten Werten durchgeführt wurde und jetzt ein sauberer Neuanfang gewünscht wird, können die `json`-, `raw`- oder `tree`-Unterobjekte eines Geräts aus dem ioBroker-Objektbaum gelöscht werden — der Adapter legt sie automatisch neu an, wenn er das nächste Mal Daten empfängt. **Hinweis:** Das gleichzeitige Löschen vieler Objekte veranlasst ioBroker, viele interne Ereignisse auf einmal auszulösen, was kurzzeitig den RAM-Verbrauch erhöhen kann. Auf Systemen mit knappem Arbeitsspeicher besser in kleinen Batches löschen.

> **Hinweis zu History-Adaptern:** Das Löschen von Objekten löscht **nicht** die historischen Daten, die von einem History-Adapter (History, InfluxDB, SQL) gespeichert wurden. Die aufgezeichneten Werte bleiben im Backend des Adapters erhalten und erscheinen in Diagrammen wieder, sobald die State-ID neu erstellt wurde. Die History-Abonnement-Konfiguration (das „enabled"-Flag am Objekt) geht jedoch beim Löschen verloren und muss am neuen Objekt manuell wieder aktiviert werden.

> **Warnung:** Den `info`-Kanal niemals löschen (z. B. `e3oncan.0.info`). Er enthält Scan-Ergebnisse, Energiezähler-Erkennung, Verzögerungen, Aktiv-Flags und den CAN-Verbindungsstatus. Ein Löschen führt zum Verlust von Konfigurationsdaten, die nicht automatisch wiederhergestellt werden können.

Nach dem Scan können die gefundenen Datenpunkte über die **e3oncan Datenpunkte**-Seite durchsucht und verwaltet werden (siehe [unten](#e3oncan-datenpunkte-seite)).

### Schritt 4 – Zuweisungen und Zeitpläne

Die empfohlene Vorgehensweise zum Konfigurieren von Leseintervallen und geräteindividuellem Collect-Modus ist die **e3oncan Datenpunkte**-Seite (siehe [unten](#e3oncan-datenpunkte-seite)).

**Energiezähler**

Wenn der Gerätescan E380- oder E3100CB-Energiezähler erkannt hat, erscheint für jeden erkannten Zähler eine Karte in der **e3oncan Datenpunkte**-Seite. Das Sammeln mit dem **Collect**-Schalter auf der Karte aktivieren. Im Feld **Verzögerung (s)** das Mindestintervall zwischen Wertaktualisierungen in ioBroker einstellen. Der Standardwert von 5 Sekunden ist empfohlen — Energiezähler übertragen mehr als 20 Werte pro Sekunde, und ein Wert von 0 würde ioBroker stark belasten.

**Speichern & Schließen** drücken, wenn fertig. Den Objektbaum prüfen, ob Daten gesammelt werden.

---

## e3oncan Datenpunkte-Seite

Die **e3oncan Datenpunkte**-Seite ist die zentrale Stelle zum Durchsuchen von Datenpunkten und zum Konfigurieren von UDSonCAN-Leseintervallen und geräteindividuellem Collect-Modus. Sie öffnet sich in einem neuen Browser-Tab, wenn in der ioBroker-Admin-Instanzansicht auf die Schaltfläche **Datenpunkte** in der Instanzzeile des Adapters geklickt wird.

**Datenpunkte durchsuchen**

Alle Geräte und erkannte Energiezähler werden als aufklappbare Karten angezeigt, standardmäßig zugeklappt für einen schnellen Überblick über das gesamte System. Ein Klick auf den Karten-Header klappt die Karte auf. Das Suchfeld filtert nach Name oder ID, passende Karten werden automatisch ausgeklappt.

Wenn für ein Gerät noch kein Datenpunktscan durchgeführt wurde, erscheint oben auf der Seite ein Warnbanner als Erinnerung.

**Gerätekarten**

Jede Gerätekarte listet ihre Datenpunkte mit ID, Name, Codec und Zeitplaneinstellungen auf. Der Collect-Schalter und die minimale Aktualisierungszeit erscheinen im Karten-Header. Wenn während des Datenpunktscans Collect-Traffic vom Gerät erkannt wurde, wird im Karten-Header ein grünes Pin-Symbol als Bestätigung angezeigt.

**Energiezähler-Karten**

Wenn während des Gerätescans Energiezähler erkannt wurden (siehe [Schritt 2](#schritt-2--gerätescan-und-energiezähler-erkennung)), erscheint oben auf der Seite für jeden erkannten Zähler eine Karte. Den **Collect**-Schalter zum Aktivieren der Datenerfassung verwenden und im Feld **Verzögerung (s)** das Mindestintervall zwischen Wertaktualisierungen in ioBroker einstellen.

**Zeitpläne**

Für jeden Datenpunkt kann Folgendes eingestellt werden:
- **Beim Start** aktivieren – der Datenpunkt wird einmal beim Start des Adapters gelesen.
- **Intervall (s)** eingeben – der Datenpunkt wird in diesem Abstand wiederholt gelesen.

Beide Optionen können kombiniert werden. Den Zeitplan-Filter (Alle / Beim Start / Intervall) verwenden, um schnell auf bereits eingeplante Datenpunkte zu fokussieren.

**Speichern**

**Speichern** drückt die Änderungen an, ohne den Tab zu schließen. **Speichern & Schließen** speichert und schließt den Tab und kehrt zur Instanzansicht zurück. **Verwerfen & Schließen** schließt den Tab ohne Speichern — kein Adapter-Neustart wird ausgelöst. Ein **Nicht gespeicherte Änderungen**-Badge erscheint, sobald ausstehende Änderungen vorhanden sind.

---

## Datenpunkte lesen

Datenpunkte werden automatisch gemäß den konfigurierten Zeitplänen gelesen. Die Werte erscheinen im ioBroker-Objektbaum unter dem Gerätenamen, aufgeteilt in `json`-, `raw`- und `tree`-Unterobjekte mit lesbaren Namen und Metadaten.

**Einzelnen Datenpunkt auf Abruf lesen**

Jeder Datenpunkt kann jederzeit abgefragt werden, indem der State `e3oncan.0.<GERÄT>.cmnd.udsReadByDid` bearbeitet und eine Liste von Datenpunkt-IDs eingegeben wird, z. B. `[3350, 3351, 3352]`. Wenn der Datenpunkt auf dem Gerät verfügbar ist, erscheint der Wert im Objektbaum und kann in Leseintervallen verwendet werden.

Der numerische Scanbereich ist derzeit begrenzt (z. B. 256–3338 in Version 0.11.0). Mit `udsReadByDid` können Datenpunkte außerhalb dieses Bereichs abgerufen werden.

---

## Datenpunkte schreiben

Das Schreiben ist bewusst einfach gehalten: Den Wert des entsprechenden States in ioBroker ändern und speichern, **ohne** das Kontrollkästchen `Bestätigt` (ack) zu aktivieren. Der Adapter erkennt den unbestätigten Schreibvorgang und sendet ihn an das Gerät.

Etwa 2,5 Sekunden nach dem Schreiben liest der Adapter den Datenpunkt vom Gerät zurück und speichert den bestätigten Wert. Wenn der State danach nicht bestätigt ist, bitte das Adapter-Log auf Fehlerdetails prüfen.

**Whitelist schreibbarer Datenpunkte**

Das Schreiben ist auf Datenpunkte einer Whitelist beschränkt, gespeichert unter:

```
e3oncan.0.<GERÄT>.info.udsDidsWritable
```

Die Liste kann durch Bearbeiten dieses States erweitert werden. Speichern **ohne** `Bestätigt` zu aktivieren.

Einige Datenpunkte können auch nach der Aufnahme in die Whitelist nicht geändert werden — das Gerät liefert dann eine negative Antwort. Der Adapter versucht es dann mit einem alternativen Dienst (nur interner CAN-Bus). Schreibvorgänge immer durch Prüfen des bestätigten Werts verifizieren.

---

## Datenpunkte und Metadaten

Ausführliche Informationen zur Struktur der Datenpunkte, zur Funktionsweise von Varianten-Datenpunkten und Metadaten sowie zur Handhabung von Temperatur-, Datums- und Zeitformaten sind in [data-points.md](lib/data-points.md) (englisch) zu finden.

---

## Energiezähler

Energiezähler werden während des Gerätescans automatisch erkannt. Eine manuelle Konfiguration ist nicht erforderlich. Der Adapter vergibt einen State-Namen im ioBroker-Objektbaum basierend darauf, wo jeder Zähler gefunden wurde:

| Kanal | CAN-Adresse | State-Name |
|---|---|---|
| UDS CAN | 98 | `e380` |
| UDS CAN | 97 | `e380_97` |
| 2. CAN | 98 | `e380_98` |
| 2. CAN | 97 | `e380_97` |

`e380` (ohne Suffix) wird für CAN-Adresse 98 auf dem UDS-CAN-Kanal verwendet, um die Abwärtskompatibilität mit bestehenden Installationen zu erhalten. `e3100cb` wird immer für den E3100CB verwendet.

Die Collect-Verzögerung (Standard 5 s) kann pro Zählertyp in der **e3oncan Datenpunkte**-Seite angepasst werden. Änderungen werden nach einem Adapter-Neustart wirksam.

### E380 – Daten und Einheiten

Es werden bis zu zwei E380-Energiezähler unterstützt. Die Datenpunkt-IDs hängen von der CAN-Adresse des Geräts ab:

- **CAN-Adresse 97:** Datenpunkte mit geraden IDs
- **CAN-Adresse 98:** Datenpunkte mit ungeraden IDs

| ID | Daten | Einheit |
|---|---|---|
| 592, 593 | Wirkleistung L1, L2, L3, Gesamt | W |
| 594, 595 | Blindleistung L1, L2, L3, Gesamt | var |
| 596, 597 | Betragsstrom L1, L2, L3; cosPhi | A, — |
| 598, 599 | Spannung L1, L2, L3; Frequenz | V, Hz |
| 600, 601 | Kumulierter Bezug, Einspeisung | kWh |
| 602, 603 | Gesamtwirkleistung, Gesamtblindleistung | W, var |
| 604, 605 | Kumulierter Bezug | kWh |

### E3100CB – Daten und Einheiten

| ID | Daten | Einheit |
|---|---|---|
| 1385_01 | Kumulierter Bezug | kWh |
| 1385_02 | Kumulierte Einspeisung | kWh |
| 1385_03 | Status: −1 = Einspeisung / +1 = Bezug | — |
| 1385_04 | Wirkleistung Gesamt | W |
| 1385_08 | Wirkleistung L1 | W |
| 1385_12 | Wirkleistung L2 | W |
| 1385_16 | Wirkleistung L3 | W |
| 1385_05 | Blindleistung Gesamt | var |
| 1385_09 | Blindleistung L1 | var |
| 1385_13 | Blindleistung L2 | var |
| 1385_17 | Blindleistung L3 | var |
| 1385_06 | Betragsstrom L1 | A |
| 1385_10 | Betragsstrom L2 | A |
| 1385_14 | Betragsstrom L3 | A |
| 1385_07 | Spannung L1 | V |
| 1385_11 | Spannung L2 | V |
| 1385_15 | Spannung L3 | V |

---

## FAQ und Einschränkungen

**Warum Collect und UDSonCAN kombinieren?**

Collect liefert Echtzeitdaten für alles, was die Geräte untereinander austauschen — schnell wechselnde Werte wie Energiefluss und langsam wechselnde wie Temperaturen, jeweils aktualisiert in dem Moment, in dem sie sich ändern. UDSonCAN ermöglicht den Zugriff auf Daten, die nicht spontan gesendet werden, typischerweise Sollwerte und Konfigurationswerte. Die Kombination beider Modi liefert das vollständigste und aktuellste Bild des Systems.

**Welche Geräte unterstützen den Collect-Modus?**

Derzeit ist das Collect-Protokoll bekannt für:
- Vitocal (lauscht auf CAN-ID `0x693`, interner CAN-Bus)
- Vitocharge VX3 und Vitoair (lauschen auf CAN-ID `0x451`, externer und interner CAN-Bus)

**Kann open3e gleichzeitig genutzt werden?**

Ja, mit Einschränkungen. Wenn in diesem Adapter nur der Collect-Modus verwendet wird, kann open3e ohne Einschränkungen parallel laufen. Wenn UDSonCAN hier genutzt wird, open3e nicht gleichzeitig für dieselben Geräte betreiben — das verursacht sporadische Kommunikationsfehler in beiden Anwendungen.

**Der Adapter funktioniert nach einem Node.js-Upgrade nicht mehr. Was tun?**

Dieser Adapter verwendet native Module, die bei einem Wechsel der Node.js-Version neu kompiliert werden müssen. Adapter stoppen, `iob rebuild` auf der Kommandozeile ausführen, dann Adapter neu starten. Falls das Problem weiterhin besteht, bitte ein Issue eröffnen.

**Was ist der Unterschied zum open3e-Projekt?**

- Direkte Integration in ioBroker: Konfiguration über Dialoge, Daten direkt im Objektbaum sichtbar.
- Echtzeit-Collect-Modus zusätzlich zu UDSonCAN.
- Schreiben von Daten ist einfacher: einfach einen State-Wert ändern und ohne Bestätigung speichern.
- Kein MQTT erforderlich (MQTT ist natürlich über die normale ioBroker-Konfiguration verfügbar).
- 64-Bit-Integer-Kodierung beim Schreiben ist auf Werte unterhalb von 2^52 (4.503.599.627.370.496) begrenzt. Das Dekodieren funktioniert korrekt über den vollen 64-Bit-Bereich.

**Können Datenpunkte außerhalb des Scanbereichs abgefragt werden?**

Ja. Den State `e3oncan.0.<GERÄT>.cmnd.udsReadByDid` bearbeiten und eine Liste von Datenpunkt-IDs eingeben, z. B. `[3350, 3351, 3352, 3353]`. Verfügbare Datenpunkte erscheinen im Objektbaum und können in Leseintervallen verwendet werden. Nicht verfügbare Datenpunkte erzeugen eine „Negative response"-Meldung im Log.

---

## Spenden

<a href="https://www.paypal.com/donate/?hosted_button_id=WKY6JPYJNCCCQ"><img src="https://raw.githubusercontent.com/MyHomeMyData/ioBroker.e3oncan/main/admin/bluePayPal.svg" height="40"></a>  
Wenn Ihnen dieses Projekt gefällt — oder Sie einfach großzügig sind — würde ich mich über ein Bier freuen. Prost! :beers:

## Changelog
<!--
    Placeholder for the next version (at the beginning of the line):
    ### **WORK IN PROGRESS**
-->
### **WORK IN PROGRESS**
* (MyHomeMyData) Neue e3oncan Datenpunkte-Webseite, direkt in der Adapterinstanzzeile verankert
* (MyHomeMyData) Energiezähler (E380, E3100CB) werden jetzt während des Gerätescans durch passives CAN-Lauschen auf beiden Kanälen automatisch erkannt
* (MyHomeMyData) State-Namen für Energiezähler werden automatisch anhand von CAN-Adresse und Kanal vergeben; Details im Readme
* (MyHomeMyData) Collect-Schalter und Verzögerung für Energiezähler werden ausschließlich in der e3oncan Datenpunkte-Seite konfiguriert; Änderungen werden nach Adapter-Neustart wirksam
* (MyHomeMyData) Beim ersten Start nach einem Upgrade wird die Aktiv-Einstellung automatisch aus der bisherigen Adapterkonfiguration migriert
* (MyHomeMyData) Collect-fähige Geräte werden jetzt während des Datenpunktscans durch passives CAN-Lauschen automatisch erkannt; ein Pin-Symbol wird im Gerätekarten-Header für jedes erkannte Gerät angezeigt
* (MyHomeMyData) Option hinzugefügt, das Speichern von Datenpunktwerten während des Datenpunktscans zu unterdrücken

### 0.11.1 (2026-04-23)
* (MyHomeMyData) Robustheit verbessert: Ein Datenpunkt der Länge null wird als „negative response" behandelt
* (MyHomeMyData) Metadaten werden jetzt auch nach dem Löschen eines Datenpunkts wiederhergestellt
* (MyHomeMyData) Testfälle für deutsche Systemsprache angepasst

### 0.11.0 (2026-04-14)
* (MyHomeMyData) Für volle Unterstützung von Varianten-Datenpunkten und Metadaten bitte einen Gerätescan gefolgt von einem Datenpunktscan durchführen
* (MyHomeMyData) Unterstützung für Varianten-Datenpunkte und Geräte-Datenformatkonfiguration hinzugefügt; Details unter https://github.com/MyHomeMyData/ioBroker.e3oncan/lib/data-points.md
* (MyHomeMyData) Metadaten zu mehreren Datenpunkten hinzugefügt, z. B. Beschreibung, Einheit, Link zu weiteren Infos
* (MyHomeMyData) Beim Datenpunktscan werden jetzt Metadaten zu den Datenpunkt-Objekten hinzugefügt
* (MyHomeMyData) Handhabung schreibbarer Datenpunkte geändert; diese Information ist jetzt auch in der Datenpunktdefinition verfügbar; die Handhabung der Whitelist für Schreibzugriffe ist unverändert
* (MyHomeMyData) Beim Gerätescan werden die verwendeten Datenformate (Datenpunkt 382) ausgewertet
* (MyHomeMyData) Struktur vieler Datenpunkte aktualisiert; Details im [Changelog](lib/data-points.md#changelog-of-data-point-definitions)

### 0.10.14 (2025-11-03)
* (MyHomeMyData) Elemente zu enums.js basierend auf PR Nr. 182 von open3e hinzugefügt
* (MyHomeMyData) Konfiguration der Dids-Scan-Grenzen im Quellcode vereinfacht
* (MyHomeMyData) Scan bis Did 3338 erweitert
* (MyHomeMyData) Hinweis zum Scanbereich im Readme ergänzt
* (MyHomeMyData) Korrekturen für Issue #169 (Repository Checker)
* (MyHomeMyData) Bugfix: Manuelle Änderung gerätespezifischer Dids wurde für Collect-Worker nicht ausgewertet
* (MyHomeMyData) Liste der Datenpunkte für E3-Geräte auf Version 20251102 aktualisiert

### 0.10.13 (2025-09-30)
* (MyHomeMyData) Fix für Issue #162

### 0.10.12 (2025-09-15)
* (MyHomeMyData) Migration zu ESLint 9, siehe Issues #141 und #152

### 0.10.11 (2025-09-06)
* (MyHomeMyData) Fix für Issues #152 (Repository Checker) und #126 (node.js 24)
* (MyHomeMyData) Hinweis im Readme zu erforderlicher Aktion nach Node.js-Versionsupgrade ergänzt
* (MyHomeMyData) Liste der Datenpunkte für E3-Geräte auf Version 20250903 aktualisiert

Ältere Changelog-Einträge sind in [CHANGELOG_OLD.md](CHANGELOG_OLD.md) zu finden.

## Lizenz
MIT License

Copyright (c) 2024-2026 MyHomeMyData <juergen.bonfert@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
