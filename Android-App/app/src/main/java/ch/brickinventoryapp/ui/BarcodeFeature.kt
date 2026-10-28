package ch.brickinventoryapp.ui

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.model.*
import ch.brickinventoryapp.data.repository.Result
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import ch.brickinventoryapp.data.repository.Fehlerart
import ch.brickinventoryapp.data.SetAnlegenSseClient
import kotlinx.coroutines.delay


/**
 * Barcode-Scanner: Auflösung, Galerie-Suche, Bestätigungs-Flow.
 *
 * Feature-Modul des MainViewModel: Die Funktionen sind Extension-
 * Functions auf dem VM — die Körper sind 1:1 aus MainViewModel.kt
 * verschoben und greifen über internal-Sichtbarkeit auf die geteilten
 * Flows (_state, _snackbar, …) zu. Aufrufer (Screens/Navigation)
 * bleiben unverändert: vm.funktion() löst die Extension auf.
 */

internal fun MainViewModel.setScannerSource(source: String) {
    _barcodeState.update { it.copy(source = source) }
}

internal fun MainViewModel.resolveBarcode(value: String) {
    // ── Sichtbar prüfen statt still arbeiten (Marcos Befund) ────────────────
    //
    // Hier lag vorher nur eine Schnellmeldung („Suche Set für …"). Die
    // verschwindet von selbst, und der Scanner-Bildschirm ist zu diesem
    // Zeitpunkt bereits geschlossen: nav/ToolsGraph.kt ruft `popBackStack()`
    // VOR `resolveBarcode()`. Wer in dieser Lücke den Scanner erneut öffnet,
    // scannt das nächste Set, während das vorige noch geprüft wird.
    //
    // Der Dialog aus zeigePruefung() bleibt stehen, bis die Frage beantwortet
    // ist, und hält damit genau so lange an, wie die App noch nicht weiss, ob
    // das Set schon vorhanden ist.
    //
    // Ein laufender Vorgang wird abgebrochen: Kommt trotzdem ein zweiter Scan
    // durch, gilt der neue — sonst beantwortete die Anzeige eine Frage, die
    // niemand mehr gestellt hat.
    erfassungsJob?.cancel()
    erfassungsJob = viewModelScope.launch {
      // Das `finally` ist der Kern und kein Beiwerk: Der Körper hat sechs
      // Rückwege, davon vier vorzeitige. Ein einziger übersehener liesse den
      // Dialog stehen, und die App wirkte eingefroren.
      try {
        zeigePruefung(value, Pruefphase.BARCODE)
        when (val r = repo.sets.resolveBarcode(value)) {
            is Result.Success -> {
                val setNum = r.data.setNumber
                val name   = r.data.name ?: setNum
                if (setNum.isNotBlank()) {
                    if (_barcodeState.value.source == "gallery_search") {
                        // Beim SERVER nachfragen statt in der geladenen Liste
                        // suchen (Nachtrag 58, Marcos Vorgabe: „in der ganzen
                        // Liste inkl. Unteraccounts prüfen").
                        //
                        // `_state.value.sets` taugt dafür nicht, gleich doppelt:
                        // Die Galerie lädt SEITENWEISE — ein noch nicht
                        // nachgeladenes Set fehlt dort —, und sie hängt am
                        // eingestellten Kontofilter. Wer gerade „nur eigene"
                        // gewählt hatte, bekam ein Set des Unterkontos als neu
                        // angeboten und hätte es ein zweites Mal erfasst.
                        //
                        // Gefragt wird der Server (GET /sets/exists/:nummer):
                        // Das Blickfeld des Haushalts und die Normalisierung
                        // der Nummer sind SEINE Regel, dieselbe, die beim
                        // Erfassen danach greift. Ein Kontofilter der Ansicht
                        // spielt dabei keine Rolle — die Frage lautet „habe
                        // ich das schon", nicht „sehe ich das gerade".
                        //
                        // Nur ein ausdrückliches `exists: false` führt weiter
                        // zum Zwischendialog. Scheitert die Abfrage, wird
                        // abgebrochen statt auf gut Glück ein womöglich
                        // vorhandenes Set anzubieten.
                        // Ab hier ist die Setnummer bekannt — die Anzeige
                        // nennt jetzt SIE statt der EAN. Beim schnellen
                        // Scannen ist das der Unterschied zwischen „irgendein
                        // Strichcode" und „42200-1 wird geprüft".
                        zeigePruefung(setNum, Pruefphase.BESTAND)
                        when (val vorhanden = repo.sets.getSetExists(setNum)) {
                            is Result.Success -> if (vorhanden.data.exists) {
                                _snackbar.value = null
                                _barcodeState.update { it.copy(gefundenesSet = vorhanden.data.setNumber) }
                                return@launch
                            }
                            is Result.Error -> {
                                // Die Vorabfrage ist die GANZE Entscheidung — ohne
                                // Antwort darf nicht geraten werden. Vorher musste
                                // hier `transient` von „nicht gefunden" getrennt
                                // werden, weil beides als Fehler kam; jetzt ist ein
                                // Fehler eindeutig ein Fehler.
                                _snackbar.value = meldungFuerSnackbar(vorhanden)
                                return@launch
                            }
                        }
                        // Nicht vorhanden (oder Server nicht erreichbar) → wie
                        // bisher weiter zum Erfassen-Dialog unten.
                    }
                    // Show confirmation dialog via barcodeResult state
                    _snackbar.value = null
                    _barcodeState.update { it.copy(
                        result     = setNum,
                        setName    = name,
                        imageUrl   = r.data.imageUrl,
                        imageLocal = r.data.imageLocal,
                        year       = r.data.year,
                        pieces     = r.data.pieces,
                        theme      = r.data.theme,
                        minifigs   = r.data.minifigs,
                        // Ausdruecklich gesetzt, nicht weggelassen: copy()
                        // behielte sonst den Wert des VORIGEN Scans, und ein
                        // sicherer Treffer traege die Warnung des letzten.
                        unsicher   = r.data.unsicher,
                        adding     = false
                    )}
                } else {
                    // Kein Set zur EAN → manuelle Erfassung (Nachtrag 113).
                    _snackbar.value = text(R.string.vm_barcode_no_set, value)
                    _barcodeState.update { it.copy(manuelleErfassungAnfordern = true) }
                }
            }
            is Result.Error -> {
                // EAN nicht auflösbar → manuelle Erfassung (Nachtrag 113). Die
                // Meldung bleibt: Sie sagt, WARUM der Dialog aufgeht.
                _snackbar.value = text(R.string.vm_barcode_not_found, value)
                _barcodeState.update { it.copy(result = null, manuelleErfassungAnfordern = true) }
            }
        }
      } finally {
        pruefungFertig()
      }
    }
}

/** Called after navigation to SetDetail was triggered from gallery search. */
/**
 * Per TEXTERKENNUNG gelesene Setnummer verwenden (Nachtrag 60, Marcos Wunsch).
 *
 * Der entscheidende Unterschied zu resolveBarcode(): Hier steht die Setnummer
 * bereits fest. Die EAN-Auflösung entfällt vollständig — sie würde nicht nur
 * Rebrickable-Kontingent kosten (bis zu acht Aufrufe je Scan), sondern
 * scheitern: Zu einer Setnummer gibt es keinen Barcode-Eintrag.
 *
 * Der Rest ist bewusst identisch zum Scanner-Weg, damit sich beides gleich
 * anfühlt: erst prüfen, ob das Set schon vorhanden ist (dann Detailansicht),
 * sonst Setdaten aus dem KATALOG holen und denselben Bestätigungsdialog zeigen.
 * Der Katalog ist hier die richtige Quelle — er kennt Name, Bild und Kennzahlen
 * auch für Sets, die noch niemand erfasst hat.
 */
internal fun MainViewModel.useScannedSetNumber(raw: String) {
    // Dieser Weg war bisher der STILLSTE der vier: keine Schnellmeldung, keine
    // Anzeige — zwischen dem gelesenen Text und dem Zwischendialog liegen ein
    // getSetExists() und ein Katalogabruf, und der Bildschirm zeigte davon
    // nichts. Siehe resolveBarcode() oben für die vollständige Begründung.
    erfassungsJob?.cancel()
    erfassungsJob = viewModelScope.launch {
      try {
        // Wie in der Galerie: eine nackte Zahl ist die Grundvariante "-1".
        val setNum = raw.trim().let { if (it.contains("-")) it else "$it-1" }

        // Die EAN-Auflösung entfällt hier — die Nummer steht bereits fest.
        // Angezeigt wird deshalb sofort die Bestandsfrage.
        zeigePruefung(setNum, Pruefphase.BESTAND)

        // HERKUNFT ZUERST (Nachtrag 64, Marcos Fehlerbericht).
        //
        // Diese Prüfung fehlte — und sie erklärt BEIDE gemeldeten Symptome:
        // Eine in der TEILELISTE gelesene Nummer lief in den Galerie-Weg.
        //   • Kannte der Server das Set, wurde zur Detailansicht navigiert
        //     statt es in die Liste aufzunehmen. Die Teileliste hält ihre Sets
        //     im lokalen Zustand des Bildschirms; beim Verlassen ist er weg —
        //     daher „das erste Set verschwindet, wenn ich ein zweites scanne".
        //   • Kannte er es nicht, erschien der Erfassen-Dialog der Galerie.
        // In beiden Fällen kam nichts in der Liste an.
        //
        // confirmAddBarcode() macht es seit jeher richtig; hier fehlte die
        // gleiche Verzweigung. Wieder „dieselbe Regel fehlt am zweiten Weg" —
        // und wieder an einem Weg, den ich selbst neu gebaut habe.
        // Aus der TEILELISTE: NICHT prüfen, ob das Set schon erfasst ist
        // (Nachtrag 65). Dort geht es nicht um den Bestand, sondern um eine
        // Zusammenstellung — ein bereits erfasstes Set gehört genauso in die
        // Liste, und die Detailansicht zu öffnen wäre hier falsch.
        //
        // Die Nummer wird aber auch NICHT mehr stumm eingefügt (das war mein
        // Nachtrag 64): Marco will denselben Bestätigungsdialog wie beim
        // Barcode. Also überspringen wir nur die Bestandsprüfung und laufen
        // unten in den gemeinsamen Katalog-Zweig, der den Dialog füllt. Beim
        // Bestätigen reicht confirmAddBarcode() die Nummer an die Liste weiter
        // — der Weg, den der Barcode seit jeher nimmt.
        // Die Merkliste ueberspringt die Bestandspruefung aus demselben
        // Grund wie die Teileliste, nur mit anderer Begruendung: Sich ein Set
        // zu merken, das man schon hat, ist legitim — ein zweites
        // Exemplar, ein Geschenk. Die Detailansicht zu oeffnen waere hier
        // genauso falsch wie dort.
        val ausTeileliste = _barcodeState.value.source in setOf("partslist", "wanted")

        // Schon vorhanden? Dann Detailansicht statt Erfassen (Nachträge 57–59),
        // inklusive derselben Trennung von Netzfehler und "nicht gefunden".
        if (!ausTeileliste) {

            // Schon vorhanden? Dann Detailansicht statt Erfassen (57–59),
            // inklusive der Trennung von Netzfehler und "nicht gefunden".
            when (val vorhanden = repo.sets.getSetExists(setNum)) {
                is Result.Success -> if (vorhanden.data.exists) {
                    _snackbar.value = null
                    _barcodeState.update { it.copy(gefundenesSet = vorhanden.data.setNumber) }
                    return@launch
                }
                is Result.Error -> {
                    _snackbar.value = meldungFuerSnackbar(vorhanden)
                    return@launch
                }
            }
        }

        when (val r = repo.admin.getCatalogSetDetail(setNum)) {
            is Result.Success -> {
                val d = r.data.set
                if (d == null) {
                    // Gelesene Zahl ergibt kein Set — das ist der erwartete
                    // Ausgang einer Fehllesung und deshalb eine normale Meldung,
                    // kein Fehler.
                    // Texterkennung ohne verwertbare Nummer → manuelle Erfassung.
                    _snackbar.value = text(R.string.vm_barcode_no_set, setNum)
                    _barcodeState.update { it.copy(manuelleErfassungAnfordern = true) }
                    return@launch
                }
                _snackbar.value = null
                _barcodeState.update { it.copy(
                    result     = d.setNumber,
                    setName    = d.name ?: d.setNumber,
                    imageUrl   = d.imageUrl,
                    imageLocal = d.imageLocal,
                    year       = d.year,
                    pieces     = d.numParts,
                    theme      = d.themeName,
                    minifigs   = d.minifigs,
                    // IMMER unsicher: Hierher kommt, was die Texterkennung
                    // gelesen hat. Die Zahl ergibt ein echtes Set — sonst
                    // waere d null und wir waeren oben ausgestiegen —, aber ob
                    // es das Set auf dem Papier ist, weiss niemand. Auf einer
                    // Anleitung stehen mehrere sechs- und siebenstellige
                    // Nummern, und nur eine davon ist die Setnummer.
                    unsicher   = true,
                    adding     = false
                )}
            }
            is Result.Error -> {
                // Auch hier bleibt keine Nummer übrig → manuelle Erfassung.
                _snackbar.value = meldungFuerSnackbar(r)
                _barcodeState.update { it.copy(manuelleErfassungAnfordern = true) }
            }
        }
      } finally {
        pruefungFertig()
      }
    }
}

internal fun MainViewModel.gallerySearchFoundConsumed() {
    _barcodeState.update { it.copy(gefundenesSet = null) }
}

/**
 * Hinzufügen aus dem Barcode-Zwischendialog.
 *
 * DOPPELERFASSUNG: Der Dialog reagiert träge, deshalb wird der Knopf in der
 * Praxis zweimal getippt — vorher landete das Set dann zweimal in der Galerie.
 * Das `enabled`-Flag am Knopf allein genügt nicht: Es wirkt erst nach der
 * Rekomposition, und genau die ist ja die langsame Stelle. Die Sperre muss
 * deshalb hier stehen, **synchron vor** `viewModelScope.launch` — der zweite
 * Aufruf sieht `adding == true` und kehrt sofort um. Bitte nicht in
 * den Coroutine-Block verschieben; dann ist das Rennen wieder offen.
 */
internal fun MainViewModel.confirmAddBarcode(setNum: String, purchasePrice: Double? = null, condition: String? = null,
                                             ownerUserId: Int? = null, storage: String? = null) {
    if (_barcodeState.value.adding) return
    if (_barcodeState.value.source == "wanted") {
        // Der vierte Scan-Weg (Nachtrag 179): Dieselbe Kamera, dasselbe
        // Erkennen, derselbe Bestaetigungsdialog — nur landet die Nummer in
        // der Merkliste statt in der Galerie.
        //
        // Der Zustand kommt aus dem Dialog (condition), nicht aus dem
        // Merklisten-Kasten: Wer gerade einen Karton abscannt, entscheidet
        // dort, ob es der neue oder der gebrauchte sein soll.
        viewModelScope.launch {
            when (val r = repo.sets.legeMerkpostenAn(setNum, if (condition == "U") "U" else "N", ownerUserId)) {
                is Result.Success -> _snackbar.value =
                    text(if (r.data.warNeu) R.string.wanted_added else R.string.wanted_already)
                is Result.Error -> _snackbar.value = meldungFuerSnackbar(r)?.let { text(R.string.vm_error, it) }
            }
            bestand.melde(Aenderung.Merkliste)
        }
        cancelBarcode()
        return
    }
    if (_barcodeState.value.source == "partslist") {
        // Route to PartsListScreen instead of gallery
        _barcodeState.update { it.copy(
            result = null, setName = null,
            imageUrl = null, imageLocal = null,
            year = null, pieces = null,
            theme = null, minifigs = null,
            adding = false, unsicher = false,
            fuerTeileliste = setNum
        )}
        return
    }
    // ── Dialog SOFORT zu, Erfassung im Hintergrund (Nachtrag 88) ────────────
    //
    // Marcos Befund: „Der Dialog scheint zu warten, bis das Set komplett
    // importiert wurde (dauert meist 5-10 Sek)."
    //
    // Genau so war es: `barcodeResult` wurde erst NACH der Antwort geleert, der
    // Dialog stand also mit gesperrtem Knopf und Kringel da, bis der Server
    // fertig war. Beim Erfassen mit dem Scanner ist das die schlechteste Stelle
    // zum Warten — dort erfasst man mehrere Sets hintereinander und will das
    // nächste sofort scannen.
    //
    // Der Galerie-Dialog schloss längst sofort; der Scanner-Dialog war der
    // Nachzügler. Wieder „dieselbe Regel fehlt am zweiten Weg".
    //
    // ── Was das für die Doppelklick-Sperre heisst ───────────────────────────
    // `barcodeAdding` kam gegen den zweiten Klick auf denselben Knopf (der
    // Dialog reagierte träge). Ein Dialog, der sofort verschwindet, kann gar
    // nicht mehr zweimal getippt werden — die Sperre bleibt trotzdem stehen und
    // wird SYNCHRON vor dem Start gesetzt: Sie schützt weiterhin das Fenster
    // zwischen Tipp und Rekomposition, das der frühere Bericht beschreibt.
    _barcodeState.update {
        it.copy(adding = true,
                result = null, setName = null,
                imageUrl = null, imageLocal = null,
                year = null, pieces = null,
                theme = null, minifigs = null)
    }
    viewModelScope.launch {
        // ownerUserId durchreichen (Nachtrag 44): Repository, API-Vertrag und
        // Server-Route kannten den Eigentümer längst — der Barcode-Weg war der
        // einzige der vier Erfassungswege, der ihn nicht mitgab und damit still
        // immer für das eigene Konto erfasste.
        when (val r = repo.sets.addSet(setNum, 1, purchasePrice, condition, ownerUserId,
                                       storage?.trim()?.takeIf { it.isNotEmpty() })) {
            is Result.Success -> {
                _snackbar.value = text(R.string.vm_set_added, setNum)
                _barcodeState.update { it.copy(adding = false) }
                // loadSets() und nicht loadGallery(): Der zweite Lader rief
                // getSets() OHNE Argumente und warf damit Haushaltsfilter,
                // Suchtext, Themenfilter und Sortierung weg. Er ist entfernt;
                // die Begründung steht an seiner Stelle in GalleryFeature.kt.
                //
                // Kennzahlen und Bewertung ändern sich beim Erfassen ebenso —
                // sie blieben früher stehen, bis der Reiter neu geöffnet wurde.
                bestand.melde(Aenderung.Sets)
            }
            is Result.Error -> {
                // Dieselbe Meldung wie im Galerie-Weg: MIT Setnummer. Der Dialog
                // ist längst zu, und wer mehrere Sets hintereinander scannt, muss
                // wissen, WELCHES nicht durchkam — „Fehler: Zeitüberschreitung"
                // allein sagt das nicht.
                meldeFehlgeschlageneErfassung(setNum, meldung(r))
                _barcodeState.update { it.copy(adding = false) }
            }
        }
    }
}

internal fun MainViewModel.cancelBarcode() { _barcodeState.update { it.copy(result = null, setName = null, imageUrl = null, imageLocal = null, year = null, pieces = null, theme = null, minifigs = null, adding = false, unsicher = false) } }

/**
 * Die Anforderung ist beim Bildschirm angekommen — Feld zurücksetzen.
 *
 * Ohne diese Quittierung ginge der Dialog beim nächsten Zusammensetzen erneut
 * auf (Nachtrag 113).
 */
internal fun MainViewModel.manuelleErfassungQuittieren() {
    _barcodeState.update { it.copy(manuelleErfassungAnfordern = false) }
}

internal fun MainViewModel.addSet(setNumber: String, quantity: Int = 1, purchasePrice: Double? = null,
                                  condition: String? = null, ownerUserId: Int? = null,
                                  storage: String? = null) {
    viewModelScope.launch {
        // Auf die Grundvariante normalisieren (Nachtrag 63) — DAS war der
        // Grund, warum ein vorhandenes Set trotzdem angelegt wurde: Der Nutzer
        // tippt „42200", gespeichert ist aber „42200-1". Die Prüfung fragte
        // nach der nackten Nummer, bekam 404 und hielt das Set für neu.
        // useScannedSetNumber() macht es seit Nachtrag 60 richtig — hier fehlte
        // es. Wieder „dieselbe Regel fehlt am zweiten Weg", diesmal von mir
        // selbst eingebaut.
        //
        // Nur für die PRÜFUNG normalisieren; angelegt wird weiterhin mit der
        // Eingabe, damit der Server wie bisher entscheidet.
        val eingabe = setNumber.trim()
        val sn = if (eingabe.contains("-")) eingabe else "$eingabe-1"

        // KEINE Vorabprüfung mehr hier: Ob das Set schon im Blickfeld steht,
        // entscheidet der Server beim Erfassen selbst (utils/setAdd.ts) und
        // antwortet dann mit `action = "exists"`, ohne etwas zu schreiben.
        //
        // Vorher stand hier ein eigener getSetDetail()-Aufruf mit einer
        // Auswertung von Netzfehler gegen „nicht gefunden". Das war eine
        // zweite Fassung derselben Regel — die Webapp hatte sie gar nicht und
        // erhöhte deshalb still die Menge. Ein Aufruf weniger ist es
        // nebenbei auch.
        //
        // Der Scanner und die Texterkennung fragen weiterhin VORHER
        // (GET /sets/exists/:nummer), weil dort die Antwort über den
        // Zwischendialog entscheidet, bevor überhaupt etwas erfasst wird.
        // ── Kein isLoading für das Erfassen selbst (Nachtrag 87) ────────────
        //
        // Marcos Wunsch: „Wenn ein Set hinzugefügt wird, soll der Dialog direkt
        // geschlossen werden, damit das nächste Set direkt erfasst werden kann.
        // Die Erfassung soll dann im Hintergrund erfolgen."
        //
        // Der Dialog schloss schon vorher sofort — was blieb, war das
        // Ladehäkchen: Der Aktualisieren-Kringel der Galerie hing daran (damals
        // an `isLoading`, heute an `galleryLoading`), die Oberfläche sah also
        // beschäftigt aus, während man schon die nächste Nummer tippen wollte.
        // Das Nachladen unten setzt sein eigenes Flag; für den Abruf hier
        // braucht es keines.
        //
        // ── Die Prüfung dagegen SCHON, und nur sie ──────────────────────────
        //
        // Marcos zweiter Befund: „man sieht nicht, dass die App am Prüfen ist,
        // ob man das Set bereits besitzt." Das ist kein Widerspruch zu
        // Nachtrag 87, sondern dessen Ergänzung — dort ging es um das
        // Nachladen der Galerie, hier um die Frage davor.
        //
        // Anders als beim Scanner gibt es hier keine eigene Vorabfrage: Der
        // Server beantwortet die Bestandsfrage IM Erfassungsaufruf und meldet
        // `action = "exists"`, ohne etwas zu schreiben. Eine zweite Abfrage
        // davorzusetzen hiesse, seine Regel im Client nachzubauen — genau das,
        // was zwanzig Zeilen weiter oben als Fehler beschrieben ist. Die
        // Wartezeit auf DIESE Antwort ist die Prüfung.
        //
        // Das `finally` umschliesst deshalb NUR den Abruf, nicht die
        // Auswertung: Stünde die Anzeige noch während loadSets()/loadStats()/
        // loadValuation(), wartete man wieder auf das Nachladen — und Nachtrag
        // 87 wäre zurückgenommen.
        //
        // ABBRECHBAR IST DAS HIER NICHT, und das ist Absicht: Der Aufruf
        // SCHREIBT bereits. Ihn abzubrechen liesse offen, ob der Server das Set
        // angelegt hat. Deshalb wird `erfassungsJob` hier auch nicht gesetzt —
        // der Abbrechen-Knopf räumt dann nur die Anzeige, und die Erfassung
        // läuft im Hintergrund zu Ende. Genau das ist Marcos Vorgabe.
        //
        // ── Und der Weg fuehrt jetzt ueber den Ereignisstrom (Nachtrag 131) ──
        //
        // Die Webapp legt seit jeher ueber /sets/add-stream an und zeigt dabei,
        // WAS gerade passiert. Die App schickte ein gewoehnliches POST und
        // zeigte einen Kringel, bis alles vorbei war — gleiches Ergebnis,
        // andere Rueckmeldung. Bei einem grossen Set dauert der Unterschied
        // lange genug, um aufzufallen.
        //
        // Der letzte Schritt ist die Antwort, die vorher das POST lieferte —
        // die Auswertung darunter bleibt deshalb unveraendert.
        val r = try {
            zeigePruefung(sn, Pruefphase.BESTAND)
            var letzte: Result<AddSetResponse> =
                Result.Error("", art = Fehlerart.LEERE_ANTWORT)
            setAnlegenSse.anlegen(eingabe, quantity, purchasePrice, condition, ownerUserId,
                                  storage?.trim()?.takeIf { it.isNotEmpty() })
                .collect { schritt ->
                    when (schritt) {
                        is SetAnlegenSseClient.Schritt.Stammdaten ->
                            zeigePruefung(schritt.name ?: sn, Pruefphase.ANLEGEN_STAMMDATEN)
                        SetAnlegenSseClient.Schritt.Bild ->
                            zeigePruefung(sn, Pruefphase.ANLEGEN_BILD)
                        SetAnlegenSseClient.Schritt.FastFertig ->
                            zeigePruefung(sn, Pruefphase.ANLEGEN_ABSCHLUSS)
                        is SetAnlegenSseClient.Schritt.Fertig ->
                            letzte = Result.Success(schritt.ergebnis)
                        is SetAnlegenSseClient.Schritt.Fehler ->
                            // Der Satz kommt schon uebersetzt vom Server
                            // (utils/fehlerTexte.ts). Leer heisst: Die
                            // Verbindung kam nicht zustande — dann sagt
                            // meldung() weiter unten, was los ist.
                            letzte = if (schritt.meldung.isBlank()) {
                                Result.Error("", art = Fehlerart.NETZ)
                            } else {
                                Result.Success(AddSetResponse(success = false, error = schritt.meldung))
                            }
                    }
                }
            letzte
        } finally {
            pruefungFertig()
        }
        when (r) {
            is Result.Success -> {
                if (r.data.success && r.data.action == "exists") {
                    // Schon im Blickfeld — der Server hat nichts geschrieben.
                    // Detailansicht öffnen, wie beim Scanner.
                    //
                    // Das frühere `isLoading = false` hier ist ersatzlos weg: Der
                    // Erfassungsweg setzt es nirgends auf `true` (Nachtrag 87,
                    // gleich darüber), es räumte also nur eine Anzeige ab, die
                    // einer ANDEREN Domäne gehörte — im Zweifel dem laufenden
                    // Galerie-Abruf.
                    _barcodeState.update { it.copy(gefundenesSet = r.data.setNumber ?: sn) }
                } else if (r.data.success) {
                    _snackbar.value = text(if (r.data.action == "added") R.string.vm_added else R.string.vm_updated, r.data.setNumber)
                    // Alles nachladen, was sich mitverändert hat.
                    //
                    // Vorher nur loadSets(): Die Kennzahlen im Kopf blieben auf
                    // dem alten Stand (deleteSet lädt sie schon immer nach), und
                    // beim Hinzufügen eines BEREITS vorhandenen Sets — der Server
                    // legt dann eine weitere Erfassung an — blieb eine offene
                    // Detailansicht samt Erfassungsliste unverändert.
                    bestand.melde(Aenderung.Sets)
                    if (_setDetailState.value.setDetail?.setNumber == sn) {
                        loadSetDetail(sn)
                        loadAcquisitions(sn)
                    }
                } else {
                    meldeFehlgeschlageneErfassung(sn, r.data.error)
                }
            }
            is Result.Error -> meldeFehlgeschlageneErfassung(sn, meldung(r))
        }
    }
}

/**
 * Eine gescheiterte Erfassung SICHTBAR machen.
 *
 * ── Warum das nötig war ─────────────────────────────────────────────────────
 * Marcos Wunsch: „Sollte es beim Hinzufügen ein Problem geben, soll eine
 * Meldung angezeigt werden, dass das Set nicht hinzugefügt werden konnte."
 *
 * Vorher legte der Fehler sich in `state.error` — einem Feld, das nur der
 * Anmeldebildschirm auswertete. Ein Fehlschlag verschwand also spurlos; man
 * tippte die nächste Nummer und merkte erst viel später, dass ein Set fehlt.
 * Genau der Fall, der durch das sofortige Schliessen des Dialogs häufiger wird.
 *
 * Diese Stelle war die erste, an der das auffiel. Erst in Nachtrag 118 kam
 * heraus, dass es die anderen siebzehn Fehlerpfade genauso traf — das Feld
 * heisst seither `loginError` und wird nur noch dort beschrieben, wo es auch
 * gelesen wird.
 *
 * Die Meldung nennt die Setnummer: Wer mehrere hintereinander erfasst, muss
 * wissen, WELCHES nicht durchkam.
 */
internal fun MainViewModel.meldeFehlgeschlageneErfassung(setNumber: String, grund: String?) {
    _snackbar.value = text(
        R.string.vm_add_failed, setNumber,
        grund ?: text(R.string.pdfexp_unknown_error)
    )
}
