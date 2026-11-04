# Homeworlds Shared Board

Eine kleine Web-App ohne Abhängigkeiten für das Pyramiden-Spiel **Homeworlds**:
eine Kurzreferenz-Seite sowie ein interaktives Spielbrett, das zwei Spieler im
Browser gemeinsam nutzen können.

- `index.html` – Kurzreferenz zu den Regeln (Deutsch)
- `guide.html` – Strategie-Guide
- `play.html` – das interaktive, gemeinsame Spielbrett (lokal, oder
  Peer-to-Peer zwischen zwei Browsern per WebRTC, mit Einladungs-Links und
  Export/Import als Ausweichmöglichkeit)

Alles ist statisch: reines HTML, CSS und ES-Module, ohne Build-Schritt und ohne
Laufzeit-Abhängigkeiten.

## Starten

Den Ordner über HTTP ausliefern (ES-Module und WebRTC brauchen einen echten
Origin, `file://` funktioniert also nicht):

```sh
python3 -m http.server 8000
```

Danach <http://localhost:8000/> öffnen.

## Tests

```sh
npm test
```

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
