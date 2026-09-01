package ch.brickinventoryapp.ui

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.model.*
import ch.brickinventoryapp.data.repository.Result
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import ch.brickinventoryapp.data.ScopeFilter


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
    loadSets()
    loadStats()
}

// ── Sets ─────────────────────────────────────────────────────────────────
// Entprellte Suche und Filter-Generation stehen als FELDER im MainViewModel
// (wie partsJob dort seit jeher). Auf Dateiebene waren sie prozessweit: Zwei
// Instanzen haetten sich Abbruch-Job und Generation geteilt, und die eine
// Ladung haette die andere abgebrochen.

/**
 * Erste Seite der Galerie laden — mit den aktuell eingestellten Filtern.
 *
 * ── Warum serverseitig (Marcos Vorgabe) ─────────────────────────────────────
 * Vorher holte die App ALLE Sets und filterte im Gerät. Das war eine zweite
 * Fassung der Suche neben der des Servers, und sie konnte weniger: kein Jahr
 * im Suchtext, keine Sortierung, und die Themenliste entstand aus der
 * geladenen Liste statt aus dem Bestand. Dieselbe Eingabe fand im Browser
 * etwas, am Telefon nicht.
 *
 * Jetzt reicht die App `search`, `theme`, `sort` und `page` durch und zeigt,
 * was zurückkommt. Die Abfrage ist dieselbe wie in der Webapp
 * (utils/handlers.ts, getSets).
 */
internal fun MainViewModel.loadSets() {
    val gen = ++galleryGeneration
    galleryListJob?.cancel()
    galleryListJob = viewModelScope.launch {
        // Zwei Fluesse, weil zwei Domaenen: `isLoading` ist der App-weite
        // Ladezustand, die beiden anderen gehoeren zur Galerie.
        _state.update { it.copy(isLoading = true) }
        _galleryState.update { it.copy(galleryLoadingMore = false, galleryPage = 1) }
        val g = _galleryState.value
        val r = retryOnNetwork {
            repo.sets.getSets(scopeFor(ScopeFilter.View.GALLERY),
                search = g.galleryQuery, theme = g.galleryTheme, sort = g.gallerySort, page = 1)
        }
        if (gen != galleryGeneration) return@launch   // inzwischen neuer Filter
        when (r) {
            is Result.Success -> {
                _galleryState.update {
                    it.copy(sets = r.data.sets, galleryTotal = r.data.total,
                        galleryPage = 1,
                        // Themen nur übernehmen, wenn welche kommen: Der Server
                        // schickt sie ausschliesslich mit der ersten Seite, und
                        // eine leere Liste würde die Auswahl sonst leerräumen.
                        galleryThemes = if (r.data.themes.isNotEmpty()) r.data.themes else it.galleryThemes)
                }
                _state.update { it.copy(isLoading = false) }
            }
            is Result.Error   -> {
                _state.update { it.copy(isLoading = false) }
                _snackbar.value = meldung(r)
            }
        }
    }
}

/**
 * Nächste Seite anhängen (Endlos-Scroll).
 *
 * Antworten einer älteren Filter-Generation werden verworfen — sonst hinge
 * eine späte Seite 2 des ALTEN Filters an der neuen Liste, mit gemischtem
 * Inhalt und doppelten Schlüsseln im Raster.
 */
internal fun MainViewModel.loadMoreSets() {
    // `isLoading` lebt im App-Zustand, alles Uebrige in der Galerie — der
    // Waechter braucht deshalb beide.
    val s = _state.value
    val g = _galleryState.value
    if (s.isLoading || g.galleryLoadingMore) return
    if (g.galleryTotal > 0 && g.sets.size >= g.galleryTotal) return
    val gen = galleryGeneration

    // ── Die Sperre MUSS vor dem launch stehen (Nachtrag 106) ─────────────────
    //
    // Marcos Befund: „Wenn ich schnell nach unten scrolle, springt die Liste
    // nach einer Sekunde wieder nach oben — immer auf dieselbe Zeile."
    //
    // Der Endlos-Scroll in GalleryScreen hängt an einem snapshotFlow, dessen
    // LaunchedEffect bei JEDER Änderung von `sets.size` neu startet und sofort
    // wieder auswertet. Beim schnellen Wischen feuert er mehrfach kurz
    // hintereinander.
    //
    // `galleryLoadingMore` wurde bisher INNERHALB der Koroutine gesetzt, also
    // erst beim nächsten Ablaufschritt. Zwei Aufrufe im selben Frame lasen
    // deshalb beide `false`, kamen beide am Wächter vorbei und forderten beide
    // `s.galleryPage + 1` an — DIESELBE Seite. Die 100 Sets landeten zweimal in
    // der Liste, und `items(sets, key = { it.setNumber })` bekam doppelte
    // Schlüssel. Ein Raster löst eine Position dann auf das ERSTE Vorkommen des
    // Schlüssels auf — daher der Sprung, und daher immer auf dieselbe Zeile.
    //
    // Synchron gesetzt, vor dem launch: Der zweite Aufruf sieht `true` und
    // kehrt um.
    _galleryState.update { it.copy(galleryLoadingMore = true) }

    viewModelScope.launch {
        val next = g.galleryPage + 1
        val r = retryOnNetwork {
            repo.sets.getSets(scopeFor(ScopeFilter.View.GALLERY),
                search = g.galleryQuery, theme = g.galleryTheme, sort = g.gallerySort, page = next)
        }
        if (gen != galleryGeneration) {
            // Sperre lösen, sonst bleibt der Endlos-Scroll für immer blockiert:
            // Sie wird jetzt VOR dem launch gesetzt, also auch dann, wenn diese
            // Antwort verworfen wird (Nachtrag 106).
            _galleryState.update { it.copy(galleryLoadingMore = false) }
            return@launch
        }
        when (r) {
            is Result.Success -> _galleryState.update {
                // ── Zweite Sicherung: keine doppelten Schlüssel (Nachtrag 106)
                //
                // Der Wächter oben schliesst das Wettrennen im Client. Der
                // Server kann Überschneidungen aber auch von sich aus liefern:
                // Bei einer Sortierung mit gleichen Werten (etwa nach Jahr)
                // steht die Reihenfolge innerhalb einer Gruppe nicht fest, und
                // zwischen zwei Seitenabfragen kann derselbe Datensatz erneut
                // auftauchen.
                //
                // Ein doppelter Schlüssel im Raster ist keine Kleinigkeit:
                // LazyVerticalGrid löst Positionen über den Schlüssel auf und
                // landet beim ersten Vorkommen — genau Marcos Sprung.
                val vorhanden = it.sets.mapTo(HashSet()) { s2 -> s2.setNumber }
                val neue = r.data.sets.filterNot { s2 -> s2.setNumber in vorhanden }
                it.copy(galleryLoadingMore = false, sets = it.sets + neue,
                    galleryTotal = r.data.total, galleryPage = next)
            }
            is Result.Error   -> _galleryState.update { it.copy(galleryLoadingMore = false) }
        }
    }
}

/** Suchtext: entprellt, damit nicht jeder Tastendruck eine Abfrage auslöst. */
internal fun MainViewModel.setGalleryQuery(q: String) {
    // Suchtext gewechselt: Die gemerkte Stelle zeigt auf Sets, die in der neuen
    // Liste woanders oder gar nicht stehen (ScrollMemory.kt).
    scrollMemory.vergiss("gallery")
    _galleryState.update { it.copy(galleryQuery = q) }
    gallerySearchJob?.cancel()
    gallerySearchJob = viewModelScope.launch {
        delay(350)
        loadSets()
    }
}

internal fun MainViewModel.setGalleryTheme(theme: String) {
    // Thema gewechselt: Die gemerkte Stelle zeigt auf Sets, die in der neuen
    // Liste woanders oder gar nicht stehen (ScrollMemory.kt).
    scrollMemory.vergiss("gallery")
    _galleryState.update { it.copy(galleryTheme = theme) }
    loadSets()
}

internal fun MainViewModel.setGallerySort(sort: String) {
    // Sortierung gewechselt: Die gemerkte Stelle zeigt auf Sets, die in der neuen
    // Liste woanders oder gar nicht stehen (ScrollMemory.kt).
    scrollMemory.vergiss("gallery")
    _galleryState.update { it.copy(gallerySort = sort) }
    loadSets()
}

internal fun MainViewModel.addSet(setNumber: String, quantity: Int = 1, purchasePrice: Double? = null,
                                  condition: String? = null, ownerUserId: Int? = null) {
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
        // Ladehäkchen: `isLoading` speist den Aktualisieren-Kringel der Galerie,
        // die Oberfläche sah also beschäftigt aus, während man schon die nächste
        // Nummer tippen wollte. Das Nachladen unten setzt sein eigenes Flag; für
        // den Abruf hier braucht es keines.
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
        val r = try {
            zeigePruefung(sn, Pruefphase.BESTAND)
            repo.sets.addSet(eingabe, quantity, purchasePrice, condition, ownerUserId)
        } finally {
            pruefungFertig()
        }
        when (r) {
            is Result.Success -> {
                if (r.data.success && r.data.action == "exists") {
                    // Schon im Blickfeld — der Server hat nichts geschrieben.
                    // Detailansicht öffnen, wie beim Scanner.
                    // Zwei Fluesse, zwei Domaenen — wie oben in loadSets().
                    _state.update { it.copy(isLoading = false) }
                    _galleryState.update { it.copy(gallerySearchFoundSetNumber = r.data.setNumber ?: sn) }
                } else if (r.data.success) {
                    _snackbar.value = ctx.getString(if (r.data.action == "added") R.string.vm_added else R.string.vm_updated, r.data.setNumber)
                    loadSets()
                    // Alles nachladen, was sich mitverändert hat.
                    //
                    // Vorher nur loadSets(): Die Kennzahlen im Kopf blieben auf
                    // dem alten Stand (deleteSet lädt sie schon immer nach), und
                    // beim Hinzufügen eines BEREITS vorhandenen Sets — der Server
                    // legt dann eine weitere Erfassung an — blieb eine offene
                    // Detailansicht samt Erfassungsliste unverändert.
                    loadStats()
                    loadValuation()
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
    _snackbar.value = ctx.getString(
        R.string.vm_add_failed, setNumber,
        grund ?: ctx.getString(R.string.pdfexp_unknown_error)
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
                loadValuation()
            }
            is Result.Error ->
                // Fehler nicht mehr verschlucken — sonst ist ein fehlgeschlagener
                // Save für den Nutzer unsichtbar.
                _snackbar.value = ctx.getString(R.string.vm_error, meldung(r))
        }
    }
}

internal fun MainViewModel.deleteSet(setNumber: String) {
    viewModelScope.launch {
        when (val r = repo.sets.deleteSet(setNumber)) {
            is Result.Success -> {
                // Sofort aus dem State entfernen, damit die Kachel nicht bis zum
                // Neuladen der Liste sichtbar bleibt; danach mit dem Server syncen.
                _galleryState.update { st -> st.copy(sets = st.sets.filterNot { it.setNumber == setNumber }) }
                _snackbar.value = ctx.getString(R.string.vm_set_deleted, setNumber)
                loadSets()
                loadStats()
                // Die Portfolio-Bewertung enthält Sets — deletePart lädt sie
                // schon immer nach, deleteSet bisher nicht.
                loadValuation()
                // Der Server löscht die Teile und Minifiguren DES SETS mit
                // (deleteSetRows in utils/handlers.ts). Ohne dieses Nachladen
                // zeigten die beiden Reiter sie weiter, bis man sie neu
                // öffnet — die Webapp lädt sie seit jeher nach.
                loadParts()
                loadMinifigs()
            }
            is Result.Error -> _snackbar.value = meldung(r)
        }
    }
}

// ── Stats ────────────────────────────────────────────────────────────────
internal fun MainViewModel.loadStats() {
    viewModelScope.launch {
        when (val r = repo.finanzen.getStats(scopeFor(ScopeFilter.View.GALLERY))) {
            is Result.Success -> _galleryState.update { it.copy(stats = r.data.stats) }
            is Result.Error -> {}
        }
    }
}

internal fun MainViewModel.loadGallery() {
    viewModelScope.launch {
        when (val r = repo.sets.getSets()) {
            is Result.Success -> _galleryState.update { it.copy(sets = r.data.sets) }
            is Result.Error -> {}
        }
    }
}
