package ch.brickinventoryapp.ui

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.model.*
import ch.brickinventoryapp.data.repository.Result
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import ch.brickinventoryapp.data.ScopeFilter
import ch.brickinventoryapp.data.SetAnlegenSseClient
import ch.brickinventoryapp.data.repository.Fehlerart


/**
 * Galerie & Dashboard: Sets laden/hinzufügen/ändern/löschen, Stats.
 *
 * Feature-Modul des MainViewModel: Die Funktionen sind Extension-
 * Functions auf dem VM — die Körper sind 1:1 aus MainViewModel.kt
 * verschoben und greifen über internal-Sichtbarkeit auf die geteilten
 * Flows (_state, _snackbar, …) zu. Aufrufer (Screens/Navigation)
 * bleiben unverändert: vm.funktion() löst die Extension auf.
 */

// ── Dashboard ────────────────────────────────────────────────────────────
internal fun MainViewModel.loadDashboard() {
    // Clear any stale CSV import state from previous session
    _csvImportState.value = CsvImportUiState()
    // Haushalt ZUERST: Die gespeicherten Filterwerte und die Mitgliederliste
    // entscheiden, mit welchem `accounts=` die folgenden Abfragen laufen und
    // ob der Kontofilter überhaupt erscheint. Beides läuft nebenläufig — bei
    // einem Konto ohne Unterkonten ändert sich dadurch nichts.
    loadScopeModes()
    loadHouseholdMembers()
    // Die Lagerorte in EINEM Zug mit den Mitgliedern: Beide speisen Filter,
    // die nebeneinander stehen.
    loadLagerorte()
    // Und der VORRAT, aus dem beim Erfassen gewaehlt wird. Das ist nicht
    // dieselbe Liste: loadLagerorte() sagt, was BELEGT ist (Filter),
    // ladeEigeneLagerorte() sagt, was zur WAHL steht — auch ein leeres Regal.
    // Seit die Erfassungsdialoge ein Lagerortfeld haben, wird sie ueberall
    // gebraucht und nicht mehr nur in den Einstellungen.
    ladeEigeneLagerorte()
    loadSets()
    loadStats()
}

// ── Sets ─────────────────────────────────────────────────────────────────

/** Erste Seite mit den eingestellten Filtern — Regeln und Zustand stehen in [Galerie]. */
internal fun MainViewModel.loadSets() = galerie.laden()

/** Nächste Seite anhängen (Endlos-Scroll). */
internal fun MainViewModel.loadMoreSets() = galerie.mehrLaden()

internal fun MainViewModel.setGalleryQuery(q: String) = galerie.setzeSuche(q)
internal fun MainViewModel.setGalleryTheme(theme: String) = galerie.setzeThema(theme)
internal fun MainViewModel.setGallerySort(sort: String) = galerie.setzeSortierung(sort)

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
                    galerie.zeigeDetail(r.data.setNumber ?: sn)
                } else if (r.data.success) {
                    _snackbar.value = text(if (r.data.action == "added") R.string.vm_added else R.string.vm_updated, r.data.setNumber)
                    loadSets()
                    // Alles nachladen, was sich mitverändert hat.
                    //
                    // Vorher nur loadSets(): Die Kennzahlen im Kopf blieben auf
                    // dem alten Stand (deleteSet lädt sie schon immer nach), und
                    // beim Hinzufügen eines BEREITS vorhandenen Sets — der Server
                    // legt dann eine weitere Erfassung an — blieb eine offene
                    // Detailansicht samt Erfassungsliste unverändert.
                    loadStats()
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

internal fun MainViewModel.updateQuantity(setNumber: String, quantity: Int, purchasePrice: Double? = null, condition: String? = null) {
    viewModelScope.launch {
        when (val r = repo.sets.updateQuantity(setNumber, quantity, purchasePrice, condition)) {
            is Result.Success -> {
                // Die WIRKLICHE Gesamtmenge kommt vom Server (Nachtrag 87).
                //
                // Angezeigt wird die Menge aller Konten, geschrieben wird die
                // Differenz auf das eigene. Beim Verringern deckelt der Server
                // bei den eigenen Exemplaren — fremde lassen sich nicht
                // wegnehmen —, und dann steht in der Antwort eine andere Zahl
                // als die gesendete. Ohne diese Übernahme zeigte der Regler bis
                // zum nächsten vollständigen Laden seine eigene Annahme.
                //
                // Sofort in den Zustand, nicht erst über loadSetDetail(): Der
                // Abruf läuft ohnehin gleich, aber er braucht eine Rundreise,
                // und genau in der Zeit sieht man die falsche Zahl.
                r.data.quantity?.let { echt ->
                    _setDetailState.update { st ->
                        if (st.setDetail?.setNumber == setNumber)
                            st.copy(setDetail = st.setDetail.copy(quantity = echt)) else st
                    }
                }
                loadSets()
                // setDetail hat im Detail-Screen Vorrang vor state.sets — ohne
                // Refresh bliebe dort der alte Kaufpreis stehen ("wird nicht
                // gespeichert"-Symptom, obwohl der Server längst gespeichert hat).
                if (_setDetailState.value.setDetail?.setNumber == setNumber) {
                    loadSetDetail(setNumber)
                    // Auch die Erfassungsliste nachladen.
                    //
                    // Eine Mengenänderung verändert IMMER die Erfassungen: Der
                    // Server (adjustAcquisitionsToQuantity in routes/sets.ts)
                    // erhöht die heutige Erfassung — oder legt eine NEUE an,
                    // wenn die neueste nicht von heute ist. Beim Verringern baut
                    // er nach LIFO ab und löscht die heutige gegebenenfalls ganz.
                    //
                    // loadSetDetail() holt aber nur die Set-Stammdaten;
                    // acquisitions kommen aus loadAcquisitions() und blieben
                    // deshalb auf dem Stand von vor der Änderung. Der zweite
                    // Eintrag existierte in der Datenbank und war im Dialog
                    // trotzdem nicht zu sehen.
                    //
                    // Dieselbe Ursache wie in der Webapp, wo manQtySave() die
                    // Liste nur beim Erhöhen nachlud.
                    loadAcquisitions(setNumber)
                }
                    // Menge und Preis wirken auf Kennzahlen und Portfolio-Wert.
                    // Beide blieben sonst stehen, bis der jeweilige Reiter neu
                    // geöffnet wurde.
                loadStats()
                bestand.melde(Aenderung.Sets)
            }
            is Result.Error ->
                // Fehler nicht mehr verschlucken — sonst ist ein fehlgeschlagener
                // Save für den Nutzer unsichtbar.
                _snackbar.value = meldungFuerSnackbar(r)?.let { text(R.string.vm_error, it) }
        }
    }
}

internal fun MainViewModel.deleteSet(setNumber: String) {
    viewModelScope.launch {
        when (val r = repo.sets.deleteSet(setNumber)) {
            is Result.Success -> {
                // Sofort aus dem State entfernen, damit die Kachel nicht bis zum
                // Neuladen der Liste sichtbar bleibt; danach mit dem Server syncen.
                galerie.entferne(setNumber)
                _snackbar.value = text(R.string.vm_set_deleted, setNumber)
                loadSets()
                loadStats()
                // Die Portfolio-Bewertung enthält Sets — deletePart lädt sie
                // schon immer nach, deleteSet bisher nicht.
                bestand.melde(Aenderung.Sets)
                // Der Server löscht die Teile und Minifiguren DES SETS mit
                // (deleteSetRows in utils/handlers.ts). Ohne dieses Nachladen
                // zeigten die beiden Reiter sie weiter, bis man sie neu
                // öffnet — die Webapp lädt sie seit jeher nach.
                loadParts()
                loadMinifigs()
            }
            is Result.Error -> _snackbar.value = meldungFuerSnackbar(r)
        }
    }
}

// ── Stats ────────────────────────────────────────────────────────────────
internal fun MainViewModel.loadStats() = galerie.ladeKennzahlen()

// Hier stand loadGallery(): ein ZWEITER Lader fuer dieselbe Liste, der
// `repo.sets.getSets()` ohne jedes Argument rief.
//
// Er verwarf damit VIER Dinge, die loadSets() mitfuehrt — den Haushaltsfilter,
// den Suchtext, den Themenfilter und die Sortierung — und liess galleryTotal
// und galleryPage unberuehrt stehen. Wer mit gesetztem Filter ein Set per
// Barcode erfasste, bekam danach eine ungefilterte Seite 1 in einer Ansicht,
// deren Filterchips weiter den alten Stand zeigten.
//
// Schlimmer noch die Paginierung: loadMoreSets() prueft
// `sets.size >= galleryTotal`. Danach standen dort eine UNGEFILTERTE Liste und
// eine GEFILTERTE Gesamtzahl nebeneinander — je nachdem entweder gar kein
// Nachladen mehr oder gefilterte Seiten, an eine ungefilterte Liste gehaengt.
//
// Es gibt genau einen Weg, die Galerie zu laden, und das ist loadSets().

/**
 * Lagerort eines Sets setzen.
 *
 * ── Warum die Liste danach neu geladen wird ─────────────────────────────────
 *
 * Der Detailbildschirm liest sein `SetItem` aus derselben Liste wie die
 * Galerie. Ohne Neuladen zeigte er nach dem Speichern weiter den alten Ort —
 * der Server hat ihn zwar, aber niemand fragt danach.
 *
 * Genau wie in der Webapp (public/js/07-admin.js, speichereSetLagerort) wird
 * dabei der NORMALISIERTE Ort aus der Antwort massgeblich: getrimmt, leer wird
 * null. Sonst zeigte die Ansicht „ Kiste 3 " mit Leerzeichen, waehrend in der
 * Datenbank „Kiste 3" steht, und beim naechsten Oeffnen spraenge der Wert.
 */
internal fun MainViewModel.setzeSetLagerort(setNumber: String, ort: String) {
    // ── Entprellt, und die Ruhezeit liegt im ViewModel ───────────────────────
    //
    // Bis hierher speicherte der Bildschirm beim Verlassen des Feldes. Genau
    // das war Marcos Befund beim Preisalarm: Am Telefon tippt man, schliesst
    // die Tastatur und geht zurueck — dieser Fokuswechsel kommt nie. Fuer den
    // Lagerort galt dasselbe, es hat nur noch niemand gemeldet.
    //
    // Dieselbe Ruhezeit wie dort (Alarmeingabe.RUHE_MS): Ein Speichern je
    // Zeichen erzeugte sechs Anfragen fuer „Kiste 3" und legte dabei fuenf
    // Orte im Vorrat an, die niemand wollte — „K", „Ki", „Kis" …
    //
    // Im viewModelScope und nicht in einem LaunchedEffect, damit die Ruhezeit
    // das Verlassen des Bildschirms ueberlebt.
    lagerJob?.cancel()
    lagerJob = viewModelScope.launch {
        kotlinx.coroutines.delay(ch.brickinventoryapp.alarm.Alarmeingabe.RUHE_MS)
        when (val r = repo.sets.setSetStorage(setNumber, ort)) {
            is Result.Success -> {
                if (!r.data.success) { _snackbar.emit(r.data.error ?: ""); return@launch }
                loadSets()
            }
            is Result.Error -> _snackbar.emit(meldungFuerSnackbar(r))
        }
    }
}
