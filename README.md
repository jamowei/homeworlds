# Homeworlds

Eine kleine Web-App ohne Abhängigkeiten für das Spiel **Homeworlds**:
eine Kurzreferenz-Seite sowie ein interaktives Spielbrett, das zwei Spieler im
Browser gemeinsam spielen können.

- `index.html` – Kurzreferenz zu den Regeln (Deutsch)
- `guide.html` – Strategie-Guide
- `play.html` – das interaktive, gemeinsame Spielbrett (lokal, oder
  Peer-to-Peer zwischen zwei Browsern per WebRTC)

Alles ist statisch und 100% lokal: reines HTML, CSS und JavaScript, ohne Build-Schritt und ohne
Laufzeit-Abhängigkeiten.

## Starten

Den Ordner über HTTP ausliefern:

```sh
python3 -m http.server 8000
```

Danach <http://localhost:8000/> öffnen.

## Tests

```sh
npm test
```

## Optional: TURN-Relay

Standardmäßig verbinden sich beide Spieler direkt über öffentliche STUN-Server.
Hinter einem symmetrischen NAT klappt das nicht; dafür kann optional ein
TURN-Relay von [Metered](https://www.metered.ca/) genutzt werden. Dazu in
`turn.config.js` die eigene Metered-Domain und den credential-gebundenen
API-Key eintragen (Details stehen als Kommentar in der Datei). Das
TURN-Passwort wird zur Laufzeit geladen und steht nicht im Repo. Bleibt die
Datei leer, läuft alles wie bisher rein über STUN.

## Verbindung, STUN und Diagnose

- STUN wird bei jedem Verbindungsaufbau während der ICE-Sammlung abgefragt. Es
  ermittelt die öffentliche Adresse der Gegenstelle; klappt damit eine direkte
  Verbindung, fließt der Datenverkehr peer-to-peer. Nur wenn kein direktes
  Kandidatenpaar funktioniert, wird das konfigurierte TURN-Relay genutzt.
- Die Browser-Konsole (F12) zeigt unter `[Homeworlds WebRTC]`, welche
  ICE-Server konfiguriert sind, welche Kandidatentypen (`host`, `srflx`,
  `relay`) gesammelt wurden, ob STUN/TURN Fehler meldet und ob die Verbindung
  am Ende direkt oder über das Relay läuft. Nach dem Verbinden steht das auch
  in der Statusleiste („· direkt“ bzw. „· über Relay“).
- Im Einladungsfenster gibt es bei einem Fehler „Diagnose kopieren“; die
  Zwischenablage enthält dann einen JSON-Bericht ohne Zugangsdaten.
- Ein Antwort-Link hat kein festes Ablaufdatum. Er funktioniert aber nur,
  solange der Tab mit der erzeugten Einladung offen bleibt; nach „Übernehmen“
  wartet die App bis zu 25 Sekunden auf die Verbindung.

## Credits

**Homeworlds** ist ein echtes Brettspiel von [Looney Labs][store]. Es ist ein
Icehouse-Spiel, das mit Looney Pyramids gespielt wird. Dieses Projekt ist ein
inoffizieller Fan-Helfer; die gesamte Anerkennung für Design und Regeln des
Spiels gebührt Looney Labs und den Designern des Spiels.

Wenn dir das Spielen hier gefällt, unterstütze bitte das Original: kaufe eine
physische Ausgabe im [Looney-Labs-Shop][store].

- Homeworlds bei Looney Labs: <https://store.looneylabs.com/products/homeworlds>
- Looney Labs: <https://www.looneylabs.com/>

[store]: https://store.looneylabs.com/products/homeworlds

*Homeworlds*, *Icehouse* und *Looney Pyramids* sind Marken von Looney Labs.
Dieses Projekt steht in keiner Verbindung zu Looney Labs und wird von ihnen
nicht unterstützt.

## Lizenz

[MIT](LICENSE)
