package ch.brickinventoryapp.ui

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.model.*
import ch.brickinventoryapp.data.repository.Result
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch


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
    viewModelScope.launch {
        _snackbar.value = ctx.getString(R.string.vm_barcode_searching, value)
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
                        when (val vorhanden = repo.sets.getSetExists(setNum)) {
                            is Result.Success -> if (vorhanden.data.exists) {
                                _snackbar.value = null
                                _state.update { it.copy(gallerySearchFoundSetNumber = vorhanden.data.setNumber) }
                                return@launch
                            }
                            is Result.Error -> {
                                // Die Vorabfrage ist die GANZE Entscheidung — ohne
                                // Antwort darf nicht geraten werden. Vorher musste
                                // hier `transient` von „nicht gefunden" getrennt
                                // werden, weil beides als Fehler kam; jetzt ist ein
                                // Fehler eindeutig ein Fehler.
                                _snackbar.value = meldung(vorhanden)
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
                        adding     = false
                    )}
                } else {
                    // Kein Set zur EAN → manuelle Erfassung (Nachtrag 113).
                    _snackbar.value = ctx.getString(R.string.vm_barcode_no_set, value)
                    _barcodeState.update { it.copy(manuelleErfassungAnfordern = true) }
                }
            }
            is Result.Error -> {
                // EAN nicht auflösbar → manuelle Erfassung (Nachtrag 113). Die
                // Meldung bleibt: Sie sagt, WARUM der Dialog aufgeht.
                _snackbar.value = ctx.getString(R.string.vm_barcode_not_found, value)
                _barcodeState.update { it.copy(result = null, manuelleErfassungAnfordern = true) }
            }
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
    viewModelScope.launch {
        // Wie in der Galerie: eine nackte Zahl ist die Grundvariante "-1".
        val setNum = raw.trim().let { if (it.contains("-")) it else "$it-1" }

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
        val ausTeileliste = _barcodeState.value.source == "partslist"

        // Schon vorhanden? Dann Detailansicht statt Erfassen (Nachträge 57–59),
        // inklusive derselben Trennung von Netzfehler und "nicht gefunden".
        if (!ausTeileliste) {

            // Schon vorhanden? Dann Detailansicht statt Erfassen (57–59),
            // inklusive der Trennung von Netzfehler und "nicht gefunden".
            when (val vorhanden = repo.sets.getSetExists(setNum)) {
                is Result.Success -> if (vorhanden.data.exists) {
                    _snackbar.value = null
                    _state.update { it.copy(gallerySearchFoundSetNumber = vorhanden.data.setNumber) }
                    return@launch
                }
                is Result.Error -> {
                    _snackbar.value = meldung(vorhanden)
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
                    _snackbar.value = ctx.getString(R.string.vm_barcode_no_set, setNum)
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
                    adding     = false
                )}
            }
            is Result.Error -> {
                // Auch hier bleibt keine Nummer übrig → manuelle Erfassung.
                _snackbar.value = meldung(r)
                _barcodeState.update { it.copy(manuelleErfassungAnfordern = true) }
            }
        }
    }
}

internal fun MainViewModel.gallerySearchFoundConsumed() {
    _state.update { it.copy(gallerySearchFoundSetNumber = null) }
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
                                             ownerUserId: Int? = null) {
    if (_barcodeState.value.adding) return
    if (_barcodeState.value.source == "partslist") {
        // Route to PartsListScreen instead of gallery
        _barcodeState.update { it.copy(
            result = null, setName = null,
            imageUrl = null, imageLocal = null,
            year = null, pieces = null,
            theme = null, minifigs = null,
            adding = false,
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
        when (val r = repo.sets.addSet(setNum, 1, purchasePrice, condition, ownerUserId)) {
            is Result.Success -> {
                _snackbar.value = ctx.getString(R.string.vm_set_added, setNum)
                _barcodeState.update { it.copy(adding = false) }
                // loadGallery() lädt NUR die Set-Liste. Kennzahlen und Bewertung
                // ändern sich beim Erfassen ebenso — sie blieben bisher stehen,
                // bis der jeweilige Reiter neu geöffnet wurde.
                loadGallery()
                loadStats()
                loadValuation()
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

internal fun MainViewModel.cancelBarcode() { _barcodeState.update { it.copy(result = null, setName = null, imageUrl = null, imageLocal = null, year = null, pieces = null, theme = null, minifigs = null, adding = false) } }

/**
 * Die Anforderung ist beim Bildschirm angekommen — Feld zurücksetzen.
 *
 * Ohne diese Quittierung ginge der Dialog beim nächsten Zusammensetzen erneut
 * auf (Nachtrag 113).
 */
internal fun MainViewModel.manuelleErfassungQuittieren() {
    _barcodeState.update { it.copy(manuelleErfassungAnfordern = false) }
}
