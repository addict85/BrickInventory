# Begründungen zu `core-ui/ui/components/ZoomableImageDialog.kt`

Die ausführlichen Kommentare aus `core-ui/src/main/java/ch/brickinventoryapp/ui/components/ZoomableImageDialog.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="zoomableimagedialog"></a>
## `ZoomableImageDialog`

```text
Bild bildschirmfuellend anzeigen, mit Zoom und Verschieben.

-- Warum als eigene Komponente ---------------------------------------------
Diese Ansicht gab es nur im Set-Detail (SetDetailScreen). Fuer den Katalog
wurde derselbe Zoom gewuenscht -- kopieren haette rund fuenfzig Zeilen
Gesten-, Zustands- und Layoutlogik verdoppelt, und die beiden Fassungen
waeren beim naechsten Eingriff auseinandergelaufen. Genau dieses Muster ist
in diesem Projekt schon mehrfach schiefgegangen (zwei Fassungen von
closeAcqModal, zwei Kopien der Bild-Host-Allowlist).

Beide Bildschirme benutzen deshalb diese eine Umsetzung.

-- Verhalten ---------------------------------------------------------------
- Zwei-Finger-Geste skaliert zwischen 1x und 6x.
- Verschieben erst ab Skalierung > 1 -- sonst liesse sich das Bild aus dem
  Sichtfeld ziehen, ohne es zurueckholen zu koennen.
- Der Faktor wird unten eingeblendet, sobald er merklich ueber 1 liegt.

@param imageUrl Bereits aufgeloeste Adresse (resolveFullUrl) -- diese
       Komponente baut selbst keine Adressen zusammen.
@param imageLoader Der injizierte Coil-Loader. ZWINGEND: Nur dieser haengt den
       Bearer-Token an (di/ServerClient.kt). Coils Standard-Loader tut das nicht,
       und seit alle Bilder eine Anmeldung verlangen, liefert der Server
       darauf 401 -- die Flaeche bleibt leer, ohne Fehlermeldung.
@param contentDescription Fuer Screenreader; darf null sein.
@param onDismiss Wird beim Schliessen aufgerufen.
```
