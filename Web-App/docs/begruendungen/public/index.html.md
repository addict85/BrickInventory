# Begründungen zu `public/index.html`

Die ausführlichen Kommentare aus `public/index.html`, wörtlich. Im Markup steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="stelle"></a>
## `Stelle`

```text
Schriften liegen selbst im Haus (public/vendor/fonts/) — kein Fremdhost
       mehr, damit auch eine reine LAN-Installation die Typografie bekommt und
       style-src/font-src in der CSP auf 'self' stehen können. preload für die
       beiden Latein-Dateien: sie werden garantiert gebraucht, und ohne den
       Hinweis findet der Browser sie erst nach dem Parsen von fonts.css.
       defer beim QR-Script: wird nur on-demand (Token-QR-Anzeige) gebraucht,
       muss das Parsing nicht blockieren.
```

<a id="startstil"></a>
## `startstil`

```text
Startgerüst: Kopf, Leiste und Kacheln als Platzhalter, bis Stile, Sprache
       und Bündel da sind. Diese Regeln stehen im Dokument, weil jede externe Datei
       bei langsamem Netz eine weitere Rundreise kostet; die CSP erlaubt genau
       diesen Block über seinen Hash (src/konto/indexHtml.ts).
```

<a id="stelle-2"></a>
## `Stelle`

```text
Gemeinsame Farbtokens, ERZEUGT aus shared/design-tokens.json. Zuerst
       geladen: Sie sind die Grundlage, styles.css und die Designs bauen
       darauf auf.
```

<a id="i-plus"></a>
## `i-plus`

```text
Setzt data-theme aus dem localStorage-Cache, bevor Anmeldung oder App
       gezeichnet werden, und gleicht danach gegen GET /api/v1/settings/theme ab.
       Blockierend, sonst blitzt kurz das falsche Design auf.
```

<a id="lu-stelle"></a>
## `lu`

```text
Ein FORM, damit Passwortmanager Speichern und Ausfuellen anbieten:
           Chrome meldet sonst „Password field is not contained in a form", und
           das Anbieten haengt dann an Heuristiken statt am Dokument.
           data-submit nennt den Knopf, den die Eingabetaste ausloesen soll —
           verdrahtet in js/11-actions.js. Der Knopf traegt type="button",
           sonst sendet er das Formular ein zweites Mal ab.
```

<a id="btn-umenu"></a>
## `btn-umenu`

```text
── DAS MENÜ IM BENUTZERNAMEN ─────────────────────────────────

             Marcos Vorgabe vom 16.10.: „die restlichen Seiten oben Rechts
             hinter dem Benutzernamen als Aufklappbares Menu mit 3 - anzeigen."
             Einen Tag später nachgezogen: „kannst du die 3 Striche oben Rechts
             in den Benutzernamen integrieren?" — der Namenszug IST jetzt der
             Knopf, die Striche stehen darin. Vorher waren es zwei Dinge
             nebeneinander: eine Plakette, die nichts tat, und ein Knopf, der
             nicht sagte, wessen Menü er öffnet.

             Dahinter liegen die sieben Seiten, die vorher alle untereinander
             im Reiter „Einstellungen" standen. Der Reiter selbst trägt nur
             noch, was ein Verwalter setzt.

             Warum die ID `ubadge` am INNEREN Feld hängt und nicht am Knopf:
             01-konto.js setzt `G('ubadge').textContent`.
             Am Knopf würde das dessen GANZEN Inhalt ersetzen — die Striche
             wären beim Anmelden weg. So schreibt der Name nur in sein eigenes
             Feld, und beide Dateien bleiben unverändert.

             `aria-expanded` wird beim Auf- und Zuklappen mitgeführt (siehe
             benutzerMenue in js/02-gallery.js): Ein Bildschirmleser sagt sonst
             nicht, ob das Menü offen ist. Das Wort „Menü" steht als
             vorgelesener Zusatz (.vh) IM Knopf und nicht mehr als
             `aria-label`: Ein `aria-label` ERSETZT den sichtbaren Namen, der
             Bildschirmleser hätte den Benutzernamen also gar nicht mehr
             genannt. Jetzt lautet der Name des Knopfes „Benutzername, Menü".
             Die Striche selbst sind `aria-hidden`, weil „☰" vorgelesen
             nichts ergibt.
```

<a id="stelle-3"></a>
## `Stelle`

```text
Abmelden steht abgesetzt, nicht als achter Punkt in einer
                 Reihe: Die sieben darueber wechseln die Sicht, dieses hier
                 beendet die Sitzung. Ein `hr` und KEIN verschachteltes div —
                 test/menue-sichten.test.js schneidet die Klappe am ersten
                 schliessenden div-Tag aus, ein zweites div haette ihr den Rest
                 der Liste weggeschnitten. (Die Pruefung streift Kommentare
                 inzwischen ab, denn dieser Text hier enthielt den Tag
                 ausgeschrieben und hat GENAU DAS ausgeloest.)
```

<a id="stelle-4"></a>
## `Stelle`

```text
Suche/Filter/Sortierung — BEWUSST unter der Erfassen-Box statt im
           Kopf (Nachtrag 32, Marcos Wunsch): Die Bedienelemente stehen damit
           direkt über der Liste, auf die sie wirken. Beim Verschieben nur den
           Container anfassen — die IDs darin sind der Vertrag mit dem JS.
```

<a id="storage-gallery"></a>
## `storage-gallery`

```text
Lagerort: dieselbe Form wie der Kontofilter daneben. Bleibt
               verborgen, solange nirgends ein Ort erfasst ist — ein Feld
               mit genau einem Eintrag („Alle“) ist nur Rauschen.
```

<a id="cat-search"></a>
## `cat-search`

```text
Suche/Filter unter dem Titel — analog Galerie, Teile, Minifiguren
           (Nachtrag 34). Der Katalog hat keine Erfassung, hier steht die
           Leiste also direkt unter der Überschrift.
```

<a id="stelle-5"></a>
## `Stelle`

```text
Katalog-Liste mit Jahres-Leiste am rechten Rand.
           Der frühere Von-Bis-Schieber ist entfallen (Nachtrag 90): Die Leiste
           SPRINGT jetzt, statt zu filtern — gefiltert wird über die beiden
           Jahres-Auswahlfelder darüber. Der Sentinel für den Endlos-Scroll ist
           ebenfalls weg; geladen wird die Seite, die gerade ins Bild kommt.
```

<a id="catalog-grid"></a>
## `catalog-grid`

```text
Die Liste rollt mit der SEITE (Nachtrag 92). Ein eigener
           Scrollbereich hier hatte zwei Nachteile: Der Balken sass mitten im
           Fenster statt am Rand, und der Beobachter, der die Seiten nachlädt,
           mass gegen diesen Bereich — nach unten kam nichts nach. Den
           Scrollbalken zeichnet jetzt die Anwendung selbst, für die GANZE
           Seite (#app-scrollbar, siehe js/15-scrollbar.js).
```

<a id="mk-kasten"></a>
## `mk-kasten`

```text
Erfassen „analog den Sets": dieselben Felder in derselben Reihenfolge
        wie im Galerie-Kasten (Nummer, Zustand, Für Konto), damit die beiden
        Ansichten sich gleich anfühlen. Anzahl und Kaufpreis fehlen bewusst —
        ein Merkposten hat weder das eine noch das andere; beides wird erst bei
        der Übernahme in die Galerie gefragt.
```

<a id="mk-csv-file"></a>
## `mk-csv-file`

```text
CSV-Einlesen, dieselbe Form wie bei Teilen und Minifiguren
               (Marcos Liste: „analog den anderen Seiten"). Das Label traegt
               KEIN for= : Es umschliesst sein Feld schon, und ein for= auf ein
               fremdes Feld faellt in test/a11y.test.js auf („ein
               umschliessendes Label traegt kein fremdes for="). Beschriftet
               ist das Feld ueber aria-label.
```

<a id="mks-stelle"></a>
## `mks`

```text
Suche/Filter/Sortierung — dieselbe Zeile wie in der Galerie, an
           derselben Stelle: unter dem Erfassen-Kasten und direkt ueber der
           Liste, auf die sie wirkt. Marcos Vorgabe vom 24.09.: „In der
           Merkliste noch einen Filter analog den Sets einbauen inkl. Inhaber."

           Der Inhaber ist #scope-merkliste — dasselbe Auswahlfeld wie in
           Galerie, Teilen, Minifiguren und Finanzen, gefuellt von
           initScopeSelects() und verborgen, solange es keine Unterkonten gibt.

           Kein Lagerortfilter: Ein Merkposten ist ein Set, das man NICHT hat,
           und was man nicht hat, liegt nirgends. Kein Themenfilter: Er kaeme
           aus rb_sets, und eine Merkliste hat ein paar Dutzend Eintraege —
           dafuer reicht die Suche. Dafuer der Zustand, den es bei den Sets
           als Filter nicht gibt: Hier steht dasselbe Set zweimal, neu und
           gebraucht, und genau das ist die Frage, die man an eine Merkliste
           stellt.
```

<a id="parts-search"></a>
## `parts-search`

```text
Suche/Filter/Sortierung — BEWUSST unter der Erfassen-Box statt im
           Kopf (Nachtrag 32, Marcos Wunsch): Die Bedienelemente stehen damit
           direkt über der Liste, auf die sie wirken. Beim Verschieben nur den
           Container anfassen — die IDs darin sind der Vertrag mit dem JS.
```

<a id="storage-parts"></a>
## `storage-parts`

```text
Lagerort: dieselbe Form wie der Kontofilter daneben. Bleibt
               verborgen, solange nirgends ein Ort erfasst ist — ein Feld
               mit genau einem Eintrag („Alle“) ist nur Rauschen.
```

<a id="manual-parts-box"></a>
## `manual-parts-box`

```text
Die manuell erfassten Teile stehen UNTER der Filterleiste
           (Nachtrag 34, Marcos Hinweis): Der Filter wirkt auf beide Listen —
           auf die manuellen und die aus Sets. Stünde er darunter, sähe es aus,
           als beträfe er nur die Set-Teile.
```

<a id="parts-sentinel"></a>
## `parts-sentinel`

```text
Ladepunkt für den Endlos-Scroll der Teileliste, analog cat-sentinel.
           Steht bewusst NEBEN #parts-main: dessen Inhalt wird bei jedem
           Filter- und Moduswechsel ersetzt, der Sentinel muss das überleben.
```

<a id="fig-search"></a>
## `fig-search`

```text
Suche/Filter/Sortierung — BEWUSST unter der Erfassen-Box statt im
           Kopf (Nachtrag 32, Marcos Wunsch): Die Bedienelemente stehen damit
           direkt über der Liste, auf die sie wirken. Beim Verschieben nur den
           Container anfassen — die IDs darin sind der Vertrag mit dem JS.
```

<a id="scope-finance"></a>
## `scope-finance`

```text
margin-left:auto (Nachtrag 66, Marcos Wunsch „rechts ausgerichtet"):
             Die Kopfzeile ist flex mit space-between, also stand der Filter auf
             breiten Fenstern schon rechts. Sie bricht aber um (flex-wrap), und
             nach einem Umbruch beginnt die neue Zeile wieder LINKS — genau das
             sieht man auf schmalen Fenstern und auf dem Handy. margin-left:auto
             schiebt ihn in beiden Fällen ans rechte Ende.
```

<a id="fin-filter"></a>
## `fin-filter`

```text
Kategoriefilter — dieselben vier Chips wie im Finanzen-Reiter der
           Android-App (FinanceSections.financeCategoryFilter). Additiv, und
           „Alle" ist kein vierter Zustand, sondern die LEERE Auswahl: Der Chip
           ist genau dann gewaehlt, wenn nichts eingeschraenkt ist. Die Regel
           steht ausformuliert in FinanceUiState.kategorien.
```

<a id="tab-settings"></a>
## `tab-settings`

```text
══ EINSTELLUNGEN — NUR, WAS EIN VERWALTER SETZT ══

         Marcos Vorgabe vom 16.10.: „Gerne den Reiter Einstellungen mit den
         Punkten belassen die nur der Administrator setzen kann, und die
         restlichen Seiten oben Rechts hinter dem Benutzernamen als
         Aufklappbares Menu mit 3 - anzeigen."

         Hier standen neun Rubriken untereinander, acht davon gehen jeden
         Benutzer an. Geblieben sind die beiden, die nur ein Verwalter
         ueberhaupt bedienen kann: die globalen Einstellungen (API-Zugaenge,
         Benutzerverwaltung, SMTP) und der Konfigurations-Export. Der Reiter
         selbst ist fuer alle anderen ausgeblendet — ein Reiter, der leer
         waere, ist schlimmer als keiner.
```

<a id="global-settings-label"></a>
## `global-settings-label`

```text
Der Schluessel sitzt am INNEREN Feld, nicht am <div>.
           `data-i18n` setzt `textContent` — am <div> haette das beim ersten
           Uebersetzen das Kind-Element geloescht, also das „(Admin)" daneben,
           und das 🌐 gleich mit. Dieselbe Falle wie beim Benutzernamen
           (test/benutzername-menueknopf.test.js) und beim Profil-Symbol im
           Menue; dies hier war der einzige verbliebene Fall im ganzen
           index.html — nachgezaehlt.
```

<a id="vouchers-card"></a>
## `vouchers-card`

```text
Marcos Vorgabe: „Im Eigenen Profil sollen Lego-Gutscheine mit
        Gutscheinnummer und Pins und Betrag hinterlegt werden können […]
        möglichst einfach erreichbar."

        Deshalb hier, direkt unter den Profil-Einstellungen, und nicht in
        einem eigenen Reiter: Es gehört zu dem, was einem selbst gehört.
```

<a id="gutschein-land"></a>
## `gutschein-land`

```text
Das Ausgabeland. Marcos Vorgaben:

               „Wichtig das Ausgabeland soll in den Einstellungen bei den
                Gutscheinen fuer alle erfasst werden koennen (wie in der
                Prototyp-App)."
               „Der rot umrandete Teil soll oberhalb der Tabelle sein."

               Deshalb steht es VOR der Liste: Es ist die Einstellung, unter
               der alles darunter abgefragt wird, und nicht ein Nachtrag
               zwischen den Knoepfen.

               „Fuer alle" heisst: EIN Wert fuer die ganze Installation, also
               eine globale Einstellung — und die setzt in diesem Baum nur ein
               Verwalter (routes/settings.ts). Deshalb `admin-only`: Ein
               Auswahlfeld, dessen Speichern beim Nicht-Verwalter stillschweigend
               nichts tut, waere schlimmer als keines. Gelesen wird der Wert
               fuer alle, die Abfrage benutzt ihn also auch bei den uebrigen
               Konten.
```

<a id="vouchers-balance-status"></a>
## `vouchers-balance-status`

```text
── GUTHABEN BEI LEGO ABFRAGEN ──────────────────────────────────

               Marcos Vorgabe: „Kannst du dies bei den Gutscheinen einbauen,
               damit dies auf Knopfdruck abgefragt und gespeichert werden
               kann?" — der Knopf je Karte steht in der Zeile selbst
               (17-gutscheine.js), hier der fuer alle auf einmal.

               „Alle" ruft dieselbe Route je Karte und WARTET zwischen den
               Karten: Hoechstens eine Abfrage je 30 Sekunden, ueber alle
               Benutzer (Marcos Vorgabe). Der Stand steht daneben im Text —
               bei mehreren Karten dauert es Minuten, und ein Knopf, der nur
               ausgegraut waere, liesse niemanden wissen, ob noch etwas
               passiert.
```

<a id="voucher-form-card"></a>
## `voucher-form-card`

```text
Der Export (Marcos Liste, Stück 3).

               Der Export ist KEIN einfacher href: Die Antwort trägt die
               Befunde in einer Kopfzeile (welcher Gutschein ersetzt wurde und
               welcher nicht, mit Grund), und die liest nur ein fetch. Ein
               Download-Link bekäme das PDF und würde die Auskunft wegwerfen.

               ── Was hier NICHT mehr steht (Marcos Durchsicht vom 15.10.) ──

               Ein zweiter Knopf „📥 PDF" für den Stapel-Import: Seine Aufgabe
               hat jetzt das Dateifeld im Erfassen-Formular unten — ein PDF
               mit mehreren Seiten ergibt dort mehrere Gutscheine, und der
               Server entscheidet das, nicht der Mensch vor zwei Feldern.

               Und die Befundliste, die hier stand. Sie zeigte „⚠ …: Der
               Betrag im PDF stimmt schon" — eine Warnung vor einem Erfolg.
               Der Fehler lag nicht in der Anzeige, sondern in der Einstufung
               (siehe ExportBefund in utils/gutscheinPdfSchreiben.ts); was
               wirklich nicht ersetzt werden konnte, sagt weiterhin die
               Meldung.
```

<a id="v-pdf-titel"></a>
## `v-pdf-titel`

```text
Der PDF-Weg. Wird eine Datei gewählt, liest der SERVER die drei
              Werte heraus; ausgefüllte Felder gewinnen gegen das Gelesene.
              Beides zusammen in einem Formular, weil es ein Vorgang ist:
              „diesen Gutschein erfassen".
```

<a id="tab-daten"></a>
## `tab-daten`

```text
margin-top: Der Knopf klebte am Eingabefeld. .75rem ist der
                 Abstand, den der Hinweistext darueber schon benutzt — kein
                 neuer Wert, sondern der im Block vorhandene.
```

<a id="stelle-6"></a>
## `Stelle`

```text
── Die BrickLink-Wanted-Liste ist UMGEZOGEN (19.10.) ───────
                 Marcos Vorgabe: „Bitte auch den Import der xml Files für
                 wanted listen in den Sets, teilen und Minifiguren ergänzen und
                 aus den Einstellungen entfernen."

                 Und das ist auch der richtige Ort: Eine Wanted-Liste wird zu
                 Teilen, Minifiguren und Sets — sie gehört neben den
                 CSV-Importer in genau diese drei Reiter, nicht in eine
                 Einstellungsseite. Der Dialog dafür steht bei den anderen
                 Dialogen (#wanted-xml-modal).
```

<a id="stelle-7"></a>
## `Stelle`

```text
── Die App holen ────────────────────────────────────────────────────
           Steht VOR dem QR-Code, weil das die Reihenfolge ist: erst die App
           installieren, dann das Gerät verknüpfen. Vorher gab es hier den
           Code — und keinen Hinweis darauf, woher die App überhaupt kommt.

           Die Adresse steht im Markup und nicht im JavaScript: Ein gewöhnlicher
           Link funktioniert auch dann, wenn das Bündel nicht geladen hat, und
           er lässt sich kopieren und weitergeben.

           Sie ist dieselbe, aus der sich die App selbst aktualisiert
           (UPDATE_RELEASE_BASIS in Android-App/.../util/AppUpdate.kt) und die
           der Workflow bei jedem grünen Lauf neu bestückt (android.yml,
           Etikett `apk-neuste`). Dass die drei nicht auseinanderlaufen, prüft
           test/apk-download.test.js — eine tote Adresse hinter einem
           Download-Knopf merkt sonst niemand, bis jemand darauf klickt.
```

<a id="stelle-8"></a>
## `Stelle`

```text
Ein eigener, schlichter Roboter — NICHT Googles Android-Marke.
               Die ist markenrechtlich gebunden und gehört nicht ungefragt in
               einen fremden Download-Knopf. Die Silhouette sagt trotzdem
               deutlich genug, worum es geht.
```

<a id="qr-validity"></a>
## `qr-validity`

```text
Wie lange soll der Zugang gelten, den DIESER Code eroeffnet?
               Die Wahl trifft die angemeldete Sitzung hier; sie wandert mit der
               Nonce zum Server. Siehe db/migrations/0016-token-laufzeit.sql.
```

<a id="qr-access-hint"></a>
## `qr-access-hint`

```text
Was der Server tatsaechlich vermerkt hat — nicht, was oben
               gewaehlt wurde. Kennt er die Wahl nicht, gilt die Gleitfrist,
               und dann soll hier das stehen und nicht die Wunschangabe.
```

<a id="stelle-9"></a>
## `Stelle`

```text
Keine Kaufadressen hier (Marcos Vorgabe): „Im Detaildialog der Sets
      sollen die Button Auf BrickLink kaufen und Preisvergleich nicht
      angezeigt werden."

      Der Grund liegt auf der Hand, sobald man fragt, WEM der Dialog gehoert:
      Er zeigt ein Set, das man BESITZT. Kaufen und Preise vergleichen will,
      wer es noch nicht hat — und genau dort stehen die beiden Knoepfe
      weiterhin: im Katalog-Detail und im Merkposten-Detail.

      Der Server liefert `bricklink` und `preisvergleich_url` am Set-Detail
      unveraendert weiter. Sie wegzunehmen waere eine Aenderung an der
      Schnittstelle fuer eine Frage der Darstellung — und die App-Fassung
      draussen liest sie noch.
```

<a id="mk-detail-modal"></a>
## `mk-detail-modal`

```text
Detail eines Merklisten-Eintrags.

  Marcos Vorgabe: „gleich wie der Detail Dialog der Sets aussehen. Ausser dem
  Kaufpreis."

  Derselbe Aufbau wie #set-modal: Kopf, Bild, Zeilenblock, Fusszeile. Was
  fehlt, fehlt aus einem Grund:

    Kaufpreis    ausdruecklich ausgenommen
    Anzahl       ein Merkposten hat keine
    Lagerort     man kann nichts einlagern, was man nicht hat
    Hinzugefuegt ersetzt durch „auf der Liste seit"
    Anleitungen  gehoeren zum Besitz; hier waere die Liste immer leer

  Was bleibt, bleibt ebenfalls aus einem Grund: Marktpreis und Preisverlauf
  sind fuer einen MERKPOSTEN das Wichtigste ueberhaupt — man wartet ja auf einen
  Preis. Beide werden von denselben Funktionen gezeichnet wie im Set-Dialog
  (renderMarketRows, priceChartSVG).
```

<a id="mk-m-bricklink"></a>
## `mk-m-bricklink`

```text
Marcos Vorgabe: die beiden Kaufadressen NEBENEINANDER, und darunter
           mit ABSTAND die Uebernahme. Der groessere Abstand ist die ganze
           Aussage: Oben zwei Wege nach draussen, unten der eine Griff, der
           hier etwas veraendert. NACHGEMESSEN (Chromium, 1440px Fenster):
           16px statt der 8px zwischen den beiden Adressen.

           `flex:1` gibt beiden denselben Anteil, SOBALD Platz da ist; in
           diesem Dialog ist keiner uebrig — gemessen 192px und 152px neben
           einer 352px breiten Spalte, also genau die Textbreiten. Faellt eine
           der Adressen weg, nimmt die andere die ganze Zeile; ein halber
           leerer Streifen waere die schlechtere Antwort auf „dafuer gibt es
           keine Adresse".

           `flex-wrap` bleibt: Auf 320px und 390px Fensterbreite braucht
           „🛒 Buy on BrickLink" allein 289px bzw. 359px — dort rutscht der
           Preisvergleich darunter, statt die Beschriftung abzuschneiden.
```

<a id="mk-take-modal"></a>
## `mk-take-modal`

```text
Uebernahme eines Merkpostens in die Galerie.

  Marcos Nachtrag: „gewisse Inhalte wie zB. Preis und Zustand, Anzahl muessen
  beim Uebernehmen angepasst werden." Dieselben drei Felder wie beim Erfassen
  eines Sets, in derselben Reihenfolge — wer das eine kennt, kennt das andere.

  Der Zustand ist mit dem des MERKPOSTENS vorbelegt, laesst sich aber aendern:
  Wer sich ein gebrauchtes gewuenscht und ein neues gefunden hat, erfasst ein
  neues. Der Merkposten, der dadurch erfuellt ist, bleibt der gebrauchte — das
  entscheidet der Server (utils/merkliste.ts).
```

<a id="cat-m-alert-dir"></a>
## `cat-m-alert-dir`

```text
Preisalarm beim Merken — Marcos „inkl. Zustand und einem
        Preisalarm". Der Zustand steht schon oben (cat-m-cond) und gilt für
        BEIDE Knöpfe; ein zweiter Zustandswähler nur für den Alarm wäre eine
        Wahl, bei der man sich widersprechen kann.

        Die Schwelle ist optional: Ein Merkposten ohne Alarm ist ein gültiger
        Merkposten. Leer heisst „kein Alarm", nicht „Schwelle 0".
```

<a id="cat-m-bricklink"></a>
## `cat-m-bricklink`

```text
Marcos Vorgabe: BrickLink eine Zeile hoeher, die beiden
           Erfassungsknoepfe nebeneinander. Bis hierher standen alle drei in
           EINER umbrechenden Reihe, und wo sie brach, entschied die Breite.
           Zwei feste Zeilen sind ueberall dieselbe Anordnung.

           NACHGEMESSEN (Chromium): bei 1440px Fenster 228px und 226px —
           `flex:1` teilt die Zeile also wirklich in zwei Haelften. Bei 320px
           und 390px Fensterbreite bleiben beide in EINER Zeile, ohne
           Ueberlauf, auch mit den laengeren englischen Texten („➕ Add to
           wanted list" braucht dort 195px von 195px).

           `width:100%` an beiden Zeilen: Die Fusszeile ist selbst ein
           umbrechendes Flex-Feld; ohne die volle Breite ruecken die zwei
           Zeilen auf einem breiten Bildschirm wieder nebeneinander.
```

<a id="wanted-xml-modal"></a>
## `wanted-xml-modal`

```text
══ BRICKLINK-WANTED-LISTE: VORSCHAU VOR DEM IMPORT ══════════════════════
     Marcos Vorgabe vom 19.10.: „noch besser wäre wenn es beim Import die zu
     importierende Liste vorgängig anzeigen wurde analog der Teileliste mit
     Bild, Farbe, Bezeichnung und ich dort noch Korrekturen vornehmen kann oder
     z.b. rebrickable ids ergänzen könnte"

     Breiter als die übrigen Dialoge: Hier steht eine Tabelle mit Bild,
     Nummer, Name, Farbe und mehreren Eingabefeldern je Zeile. In 480px wäre
     jede Spalte zu schmal zum Lesen — und gelesen werden muss sie, das ist
     ihr ganzer Zweck.

     960 -> 1360 (21.10.): Marcos Bitte „Kannst du den Dialog etwas breiter
     machen, damit man alles in der Breite sehen kann?" Seit die Spalten
     Zustand und Kaufpreis dazugekommen sind und Anzahl, Zustand und Preis
     Eingabefelder tragen, sind es zehn. GEMESSEN bei 960px: Rahmen 902px,
     Tabelle 958px — sie scrollte waagrecht, und die Spalte „Name" war auf
     60px gequetscht, zu wenig für „Brick 2 x 4" in einer Zeile.

     `width:92%` bleibt daneben stehen und gilt weiterhin zuerst: Auf einem
     schmalen Fenster ändert diese Zahl nichts.
```

<a id="wanted-xml-fortschritt"></a>
## `wanted-xml-fortschritt`

```text
Fortschritt des Imports (Marcos Wunsch vom 20.10.). Dieselben zwei
         Klassen wie das Fortschritts-Overlay der Set-Importe — ein zweiter
         Balken mit eigenem Aussehen waere eine zweite Fassung derselben
         Sache. Versteckt, solange nichts laeuft; aria-* macht ihn fuer
         Screenreader lesbar, role="progressbar" braucht die drei Werte.
```

<a id="wanted-xml-tabelle"></a>
## `wanted-xml-tabelle`

```text
`padding-right` statt nichts: Die Tabelle ist 100% breit, und die
         letzte Spalte („Farbe setzen") klebte damit an der Kante des
         Rahmens — Marcos Befund vom 21.10.: „laut deinem Screenshot ist die
         letzte Spalte abgeschnitten. Ich hätte dort gerne auch noch etwas
         Leerraum bevor der Dialog fertig ist."

         Dass die Breitenmessung davor „passt" sagte (Rahmen 1302, Tabelle
         1302, scrollt nicht), war kein Widerspruch, sondern genau das
         Problem: gleich breit heisst null Luft. Gemessen wurde die Zahl, zu
         sehen war der Rand erst auf dem Bild.

         Am RAHMEN und nicht an der letzten Zelle: So gilt der Abstand auch,
         wenn die Tabelle doch einmal waagrecht scrollt (schmales Fenster),
         und er trifft keine andere Tabelle mit Klasse `dt`.
```

<a id="man-detail-del"></a>
## `man-detail-del`

```text
Kein „Zurueck" hier (Marcos Vorgabe). Es war der zweite Weg aus
         demselben Dialog: Das ✕ im Kopf schliesst ihn bereits, und zwar an
         der Stelle, an der es in JEDEM Dialog dieses Baums steht. Zwei
         Knoepfe fuer denselben Griff sind keine Hilfe, sondern eine Frage.
         Damit steht in der Fusszeile nur noch der Papierkorb — wie im
         Set-Detail.
```

<a id="pdf-viewer-zoom-out"></a>
## `pdf-viewer-zoom-out`

```text
Zoom: Minus, Faktor, Plus, und der Faktor selbst ist der
             Zurueck-auf-100%-Knopf. Der Faktor steht als ZAHL da, nicht als
             Balken oder Farbe -- man muss ablesen koennen, wo man ist.
```

<a id="acq-modal-tit"></a>
## `acq-modal-tit`

```text
Breiter als die übrigen Dialoge (560px): Die Tabelle hat sechs Spalten,
       seit der Eigentümer dazugekommen ist — Menge, Datum, Zustand, Preis,
       Eigentümer, Löschen. Bei 560px lag darüber ein waagerechter Rollbalken,
       und ein Dialog, in dem man seitwärts scrollen muss, um den Löschknopf zu
       sehen, ist eine Falle.
       Die Klasse .acq-wide (styles.css) nimmt zusätzlich etwas Innenabstand
       weg — der Platz gehört der Tabelle.
```

<a id="stelle-10"></a>
## `Stelle`

```text
Aktive Sprachdatei. Blockierend und VOR dem Bündel, weil i18n.js beim
       Auswerten window.I18N_DE / window.I18N_EN erwartet.
       Welche Datei hier steht, entscheidet der Server (utils/indexHtml.ts)
       anhand der gespeicherten Sprache — genauso wie beim Design darüber.
       Der Wechsel zur anderen Sprache lädt sie zur Laufzeit nach
       (loadLang() in i18n.js).
```

<a id="stelle-11"></a>
## `Stelle`

```text
Ein Bündel statt zwölf Einzeldateien.
     i18n.js und js/01-*.js … js/11-*.js werden von scripts/build-frontend.js in
     genau dieser Reihenfolge aneinandergehängt und minifiziert. Die Quellen
     bleiben im Repo lesbar und einzeln editierbar; nach einer Änderung an
     public/js/ oder public/i18n.js muss `npm run build:frontend` laufen
     (npm run dev und der Docker-Build tun das automatisch).
     00-theme-boot.js bleibt oben (muss vor Anmeldung und App laufen),
     pdfjs-boot.js bleibt separat (ES-Modul), logviewer.js wird bei Bedarf
     zur Laufzeit nachgeladen.
```

<a id="lagerorte"></a>
## `lagerorte`

```text
Bekannte Lagerorte — EINE Liste für alle Eingabefelder (Set-Detail,
     Teil-Detail, Filter). Der Ortsname ist frei; der Vorschlag verhindert,
     dass „Kiste 3“ und „kiste 3“ nebeneinander entstehen.
```

<a id="stelle-12"></a>
## `Stelle`

```text
Der eigene Scrollbalken (#app-scrollbar) wird von js/15-scrollbar.js ERZEUGT,
     nicht hier ausgezeichnet. Grund: app.bundle.js ist ein klassisches Skript
     und läuft, sobald es geparst ist — also VOR allem, was danach im Markup
     steht. Ein hier notiertes Element gäbe es beim Start noch nicht, und der
     Balken erschiene nie.
```
