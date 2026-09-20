package ch.brickinventoryapp.ui

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.repository.Result
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Wunschliste — was man haben moechte, getrennt vom Besitz.
 *
 * ── Was hier NICHT entschieden wird ─────────────────────────────────────────
 *
 * Wie ein Wunsch angelegt wird, was beim Uebernehmen mit Eintrag und
 * Preisalarm geschieht und wessen Wuensche man sieht — all das beantwortet der
 * Server (utils/wunschliste.ts). Die App zeigt, was zurueckkommt. Eine zweite
 * Fassung dieser Regeln hier waere genau die Doppelung, an der in diesem
 * Projekt schon mehrere Zahlen auseinandergelaufen sind.
 *
 * ── Der Zustand geht ueberall mit ───────────────────────────────────────────
 *
 * Neu und gebraucht sind ZWEI Wuensche mit zwei Schwellen — er gehoert zum
 * Schluessel, genau wie beim Preisalarm. Jede Funktion hier traegt ihn mit.
 */

/** Die Liste laden. */
internal fun MainViewModel.ladeWunschliste() {
    viewModelScope.launch {
        _wunschState.update { it.copy(laedt = true) }
        when (val r = repo.sets.getWunschliste()) {
            is Result.Success ->
                _wunschState.update { it.copy(wuensche = r.data.wuensche, laedt = false) }
            is Result.Error -> {
                _wunschState.update { it.copy(laedt = false) }
                _snackbar.value = text(R.string.vm_error, meldung(r))
            }
        }
    }
}

/**
 * Einen Wunsch eintragen.
 *
 * `besitzer` ist das Zielkonto — der Grossvater traegt einen Wunsch fuer den
 * Enkel ein. Ohne Angabe schreibt der Server auf das eigene Konto; die
 * RICHTUNG prueft er selbst (resolveWriteTarget), nicht die App.
 *
 * Nach dem Erfolg wird die Liste neu geladen statt lokal ergaenzt: Der Server
 * fuellt die Stammdaten aus dem Katalog nach, und die kennt die App hier
 * nicht. Eine selbstgebaute Zeile stuende ohne Namen und ohne Bild da, bis
 * jemand den Bildschirm wechselt.
 */
internal fun MainViewModel.legeWunschAn(
    setNumber: String, zustand: String, notiz: String?, besitzer: Int? = null,
) {
    val nummer = setNumber.trim()
    if (nummer.isBlank()) { _snackbar.value = text(R.string.wishlist_need_number); return }
    viewModelScope.launch {
        when (val r = repo.sets.legeWunschAn(nummer, zustand, notiz?.takeIf { it.isNotBlank() }, besitzer)) {
            is Result.Success -> {
                // „stand schon drauf" ist kein Fehler, aber auch kein Neuzugang
                // — wer zweimal auf denselben Knopf drueckt, soll den
                // Unterschied sehen.
                _snackbar.value = text(
                    if (r.data.warNeu) R.string.wishlist_added else R.string.wishlist_already)
                ladeWunschliste()
            }
            is Result.Error -> _snackbar.value = text(R.string.vm_error, meldung(r))
        }
    }
}

/** Einen Wunsch entfernen — genau EINEN Zustand. */
internal fun MainViewModel.loescheWunsch(setNumber: String, zustand: String, besitzer: Int?) {
    viewModelScope.launch {
        when (val r = repo.sets.loescheWunsch(setNumber, zustand, besitzer)) {
            is Result.Success -> { _snackbar.value = text(R.string.wishlist_deleted); ladeWunschliste() }
            is Result.Error   -> _snackbar.value = text(R.string.vm_error, meldung(r))
        }
    }
}

/**
 * In die Galerie uebernehmen.
 *
 * Der Server ruft dafuer addSet() — die eine Wahrheit fuers Erfassen — und
 * raeumt danach Eintrag UND Preisalarm weg (Marcos Festlegung).
 *
 * 'exists' heisst: Das Set war schon im Blickfeld. Der Wunsch ist trotzdem
 * erfuellt und verschwindet; er stuende sonst fuer etwas, das man laengst hat.
 *
 * Danach wird auch die Galerie neu geladen: Das Set ist jetzt dort, und wer
 * hinueberwechselt, soll es sehen und nicht eine Ansicht von vorhin.
 */
internal fun MainViewModel.uebernimmWunsch(
    setNumber: String, zustand: String, besitzer: Int?,
    anzahl: Int = 1, kaufpreisRoh: String = "", erfasstAls: String? = null,
) {
    viewModelScope.launch {
        // Dieselbe Zahlenerkennung wie beim Preisalarm: Komma wie Punkt, und
        // leer heisst „kein Kaufpreis" — der Server setzt dann den Marktpreis
        // ein, genau wie auf dem normalen Erfassungsweg.
        val preis = ch.brickinventoryapp.alarm.Alarmeingabe.zahl(kaufpreisRoh)
        when (val r = repo.sets.uebernimmWunsch(setNumber, zustand, anzahl, preis,
                                                erfasstAls, besitzer)) {
            is Result.Success -> {
                _snackbar.value = text(
                    if (r.data.action == "exists") R.string.wishlist_taken_existing
                    else R.string.wishlist_taken)
                ladeWunschliste()
                loadSets()
            }
            is Result.Error -> _snackbar.value = text(R.string.vm_error, meldung(r))
        }
    }
}

/**
 * Wunsch UND Preisalarm in einem Griff — der Weg aus dem Katalog-Detail.
 *
 * Marcos Vorgabe: „Aus dem Katalog sollen in der Detailansicht Sets in die
 * Wunschliste hinzugefuegt werden koennen inkl. Zustand und einem
 * Preisalarm."
 *
 * ── Warum ZWEI Aufrufe und nicht ein Feld am Wunsch ────────────────────────
 *
 * Der Alarm lebt in price_alerts und ist genau derselbe, den die
 * Set-Detailansicht setzt — gleicher Schluessel, gleiche Tabelle. Eine
 * Schwelle am Wunsch waere eine ZWEITE Stelle, an der eine Preisschwelle
 * steht, und die beiden liefen beim ersten Aendern auseinander.
 *
 * ── Warum die Schwelle optional ist ────────────────────────────────────────
 *
 * Ein Wunsch ohne Alarm ist ein gueltiger Wunsch. Leer heisst „kein Alarm",
 * nicht „Schwelle 0" — dieselbe Regel wie im Set-Detail.
 *
 * Der Alarm wird erst NACH dem erfolgreichen Wunsch gesetzt: Andersherum
 * stuende eine Schwelle fuer ein Set da, das auf keiner Liste steht.
 */
internal fun MainViewModel.wuenscheMitAlarm(
    setNumber: String, zustand: String, richtung: String, schwelleRoh: String,
    besitzer: Int? = null,
) {
    viewModelScope.launch {
        when (val r = repo.sets.legeWunschAn(setNumber, zustand, null, besitzer)) {
            is Result.Error -> { _snackbar.value = text(R.string.vm_error, meldung(r)); return@launch }
            is Result.Success -> {
                // Dieselbe Zahlenerkennung wie beim Preisalarm im Set-Detail:
                // Komma wie Punkt, und nur ein positiver Wert ist eine
                // Schwelle (ch.brickinventoryapp.alarm.Alarmeingabe).
                val schwelle = ch.brickinventoryapp.alarm.Alarmeingabe.zahl(schwelleRoh)
                if (schwelle != null) {
                    repo.sets.setPreisalarm(setNumber, richtung, schwelle, zustand)
                }
                _snackbar.value = text(
                    if (r.data.warNeu) R.string.wishlist_added else R.string.wishlist_already)
                ladeWunschliste()
            }
        }
    }
}

/**
 * Was das Detail eines Wunsches zusaetzlich braucht.
 *
 * ── Zwei Abrufe, und beide gibt es schon ────────────────────────────────────
 *
 *   * /catalog/sets/:sn  — Thema, Teile, Minifiguren, BrickLink,
 *     Preisvergleich. Derselbe Aufruf, den das Katalog-Detail macht.
 *   * /sets/:sn/price-history — Marktpreis JE ZUSTAND und der Verlauf, beides
 *     aus einer Antwort.
 *
 * Der zweite ist der interessante: Er verlangt KEINEN Besitz — die Route ruft
 * getSetPriceHistory ohne Besitzpruefung, und price_cache/price_history
 * haengen am Set, nicht am Konto. /sets/:sn/price dagegen antwortet mit 404,
 * wenn einem das Set nicht gehoert; fuer einen Wunsch also unbrauchbar.
 * Nachgesehen, nicht vermutet.
 *
 * Damit braucht das Wunsch-Detail keinen einzigen neuen Endpunkt.
 *
 * ── Warum beide Fehler still bleiben ────────────────────────────────────────
 *
 * Ein Set, das rb_sets nicht kennt, hat kein Katalog-Detail; ein Set, das nie
 * abgefragt wurde, keinen Preis. Beides ist normal und kein Fehler, den man
 * jemandem melden muesste — die Ansicht zeigt dann „—" statt einer Zahl. Eine
 * Schnellmeldung dafuer waere Laerm.
 */
internal fun MainViewModel.ladeWunschDetail(setNumber: String) {
    viewModelScope.launch {
        _wunschDetailState.value = WunschDetailUiState(laedt = true)

        // Der Alarm gehoert dem Set-Detail-Zustand, und das ist Absicht: Der
        // Abschnitt, der ihn zeigt (setDetailAlarmSection), schreibt nach dem
        // Speichern DORTHIN zurueck. Ein eigenes Feld hier waere nach der
        // ersten Aenderung veraltet.
        loadPreisalarme(setNumber)

        val katalog = (repo.admin.getCatalogSetDetail(setNumber) as? Result.Success)
            ?.data?.takeIf { it.success }?.set
        _wunschDetailState.update { it.copy(katalog = katalog) }

        // ZUERST die Preise, DANN der Verlauf: Die Preisroute holt frisch und
        // fuellt dabei den Cache, aus dem der Verlauf liest. Andersherum
        // saehe der erste Blick auf einen neuen Wunsch leer aus.
        val preise = (repo.sets.getWunschPreise(setNumber) as? Result.Success)
            ?.data?.takeIf { it.success }
        _wunschDetailState.update { it.copy(preise = preise) }

        val historie = (repo.finanzen.getSetPriceHistory(setNumber) as? Result.Success)
            ?.data?.takeIf { it.success }
        _wunschDetailState.update { it.copy(historie = historie, laedt = false) }
    }
}
