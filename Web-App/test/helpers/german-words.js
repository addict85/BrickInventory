// German word stems that stood in the UI code names before the English renaming.
// The language ratchet in test/ratschen.test.js looks for them in identifiers, class names, IDs, data
// attributes and i18n keys under public/. Words that are also English (art, stand, hell …) are left out.
// Lowercase, ae/oe/ue/ss spelling; umlauts are caught separately.
module.exports = new Set(
  `
  abbrechen abbruch abdeckung abfrage abfragen abgebrochen abgefragt abgeholt abgelaufen abgelehnt abgemeldet
  abgewiesen abgleich abholung ablage ablehnen abmelden absatz abschalten abschnitt abstand abweichend
  abweichung achse adresse aenderbar aendere aendern aenderung aggregat aktion aktionen aktiv aktivieren
  aktualisieren aktualisiert aktuell aktuelles akzent alarm alarme alle allein alles alte altlast andere
  anders anfrage anfragen angaben angeben angefordert angekuendigt angelegt angemeldet angepasst angewandt
  angezeigt anhang anker anlegen anleitung anleitungen anmelde anmelden anmeldewege anmeldung annehmen ansage
  ansicht anteil antwort anzahl anzeigen arten auf aufgestockt aufklappen aufraeumen auftraege auftrag
  auftrags aus ausgang ausgelastet ausgestellt ausser ausstehend ausstehenden auswahl azur balken bearbeiten
  bedien beenden beendet befunde behalten beigetreten beim bekannt belegt benannt benenne benutzer benutzung
  bereich bereit bereits bericht besetzt besitz besitzer besitzt bestaetige bestaetigen bestaetigt
  bestaetigung bestaetigungslink bestand betrag bewertet bezug bild bilder bisher blau bleibt bloecke
  brauchbare braucht braun breit breite brotkrume bruch buendig darstellung darunter datei dateien daten
  datenbank dauer davon deaktivieren deaktiviert degradiert dem der deren dezimal diagramm dienst dienste dok
  dokument doppelt drin drucker dunkel dunkeln durch durchgang eigene eigener eigenes ein einblenden eingabe
  eingeben eingerichtet eingespielt einladung einladungen einleitung einrichten einrichtung einstand
  einstellungen eintraege eintrag einzeln eltern ende endgueltig entf entfallen entfernen entfernt entschieden
  entziehen entzogen ereignis erfassen erfasst erfassung erfassungs erfolg erforderlich ergaenzung ergebnis
  erklaerung erlaubt erlaubte erledigt ernannt ernennen erneut erreichbar erst erste erstellt erster erstes
  erzeugt etikett exemplar exemplare existiert exportieren faecher faellig faktor falsch farb farbe farben
  fehlen fehlend fehler fehlgeschlagen fehlt feld feldchen felder fertig figur figuren finanzen flach flaeche
  fokus fokussieren folgt fortschritt frage frei freigabe freigeben freigeschaltet freischalten fremde fremder
  fuege fuelle fuellend fuellung fuer fuss fussnote ganz geaendert geben gedrosselt gefahr gefahrenzone
  gefiltert gefragt gefunden geheim geheimnis gekauft geklappt geladen gelb gelblich geleert gelesen gelesener
  geloescht geloest gemappt gemerkt genau genaueste geplant geprueft geraet geraten gerechnet geruest gesamt
  geschaetzt geschenk geschenkt gesendet gesetzt gespeichert gesperrt gesprenkelt gestartet gestern geteiltes
  getippt getrenntes getroffen gewaehlt gewechselt gewinn gezeichnet glanz gleich glitzer grau grenze gross
  gruen grund gruppe gruppen gueltig gueltigkeit guthaben gutschein gutscheine gutscheinen haeufig halter
  haupt haushalt herkunft heute hilfe hintergrund hinweis hinweise hinzu hinzufuegen hinzugefuegt hoch
  hochgeladen hochgleiten hoehe holz identisch immer importieren inaktiv inhaber inhalt innen interner
  inventar ist jahr jetzt kachel kacheln kaeufe kalender karte karten kastanie kasten katalog kategorie
  kategorien kauf kaufpreis kaufpreise kein keine keiner kennzahlen klappe klartext klasse klein knoepfe knopf
  kompakt konfig konfiguration konfiguriert konten kontingent kontingente konto kopf kopfteil kopien kopieren
  kopiert kopplung koralle korb korrektur korrekturen korrigiert kreis kupfer kurs kurz lachs lade laeuft
  lager lagerort lagerorte langsam laufend lavendel lebenszeichen leer leeren leerung lege legende leise
  leiste lesen lesend letzten letzter letztes leucht linie liste listenzeile loesch loesche loeschen loesen
  lokal luecke manuell manuelle manuelles marke markt mehr mehrere mehrfach meine melde meldung menge menue
  merk merker merkliste merkposten messpunkte minifiguren minimieren minuten mit mitglieder mitte mittel
  mittig monat nacharbeit nachher nachladen nachlauf nachricht nachzug naechster namen neben nebeneinander
  negativ netz neu neue neuer nicht noch nochmal noetig noppe noppen nummer nummern nur nutzer oben oder
  oeffne oeffnen offen ohne oliv optionen ordnung ort orte paar papierkorb passt passwort pausen pausiert pfad
  pfeil pflaume pflicht plakette platz platzhalter positionen posten praefix preis preise primaer profil
  protokoll prozent prozess pruef pruefen punkt punkte quelle quellen rahmen rand raus reaktiviert rechts
  regel registrierung regler regulaer reihe reihen reiter relativ richtung roh rohe rolle rollen rosa
  rueckmeldung ruht runde runter sammlung schalte schild schliesse schliessen schluessel schmal schon
  schreiben schreibend schreibt schrift schritt schritte schwarz schwebend schwelle sehr seit seite seiten
  sekunden selbst setnummer setze setzen sicherheit sicherung sicht sichtbar signatur silber sinnbild sitzung
  skelett sofort sortiere sortieren sortierung spaeter spalte spanne speicher speichere speichern sperren
  sprache sprunglink stapel stark starte statt stein steine stellen stil stoerung striche strom stueck stuecke
  stufe stufen stunden suche suchen suchfeld summe tabelle tabwert taeglich tage tagesgrenze tageslimit
  tagzeit tausch tausend teil teile teilen teilung telefon testen tiefe titel treffer trenner trotzdem typ
  ueber uebergangen ueberlappung uebernahme uebernehmen uebersicht uebersprungen uebrig uhr uhrzeit umbenannt
  umbenennen umbrechen umbruch umgerechnet umraeumen umschalten unbegrenzt unbekannt unbekannte unbekannter
  und ungleich ungueltig unlesbar unsicher unten unter unterbrochen unterstrich untertit untertitel unterzeile
  unveraendert verarbeite verbergen verbindungen vereint verfuegbar vergeben vergessen vergleich verknuepft
  verknuepfung verlangsamt verloren vermerkt versand verschieden verschoben versteckt versuch versucht
  verteilt verteilung verwalten verwalter verwaltung verweise verworfen viele violett voll von vorgabe
  vorhanden vorher vorlaeufig vorrat vorschau waehlen waehrung wahl wann warnung warten wartend wartet wdh
  wechsel wechsle weg weiss weit weiter weitere werkzeug werkzeuge wert werte widerruf widerrufen
  wiederhergestellt wiederherstellen wiederholbar wiederholung wird wirkungslos wofuer wort wurde wurzel
  zaehler zahl zahlen zeichen zeichnen zeige zeigen zeiger zeile zeilen zeit zeitplaene zeitplan zeitpunkt
  zeitraum zelle zentriert zertifikat zfpflicht ziehen ziel ziele ziffer zugaenge zugang zugriff zuletzt zum
  zuordnung zur zurueck zuruecksetzen zusammen zusammengefuehrt zusammengelegt zusatz zustand zuzuordnen zweck
  zweiten zweiter zweitpflicht zwischenspeicher
  echt geld schloss lauf frist modus ersatz klick griff masse fremd sperre gecacht zusammenfassung globus
  achsenbruch flaechen idee formular anzahl fadenkreuz kiste ruhe
`
    .trim()
    .split(/\s+/),
);
