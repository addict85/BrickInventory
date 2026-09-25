package ch.brickinventoryapp.ui

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.repository.Result
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Merkliste — was man haben moechte, getrennt vom Besitz.
 *
 * ── Was hier NICHT entschieden wird ─────────────────────────────────────────
 *
 * Wie ein Merkposten angelegt wird, was beim Uebernehmen mit Eintrag und
 * Preisalarm geschieht und wessen Merkposten man sieht — all das beantwortet der
 * Server (utils/merkliste.ts). Die App zeigt, was zurueckkommt. Eine zweite
 * Fassung dieser Regeln hier waere genau die Doppelung, an der in diesem
 * Projekt schon mehrere Zahlen auseinandergelaufen sind.
 *
 * ── Der Zustand geht ueberall mit ───────────────────────────────────────────
 *
 * Neu und gebraucht sind ZWEI Merkposten mit zwei Schwellen — er gehoert zum
 * Schluessel, genau wie beim Preisalarm. Jede Funktion hier traegt ihn mit.
 */

/**
 * Die Liste laden — mit Suche, Zustand, Sortierung und Inhaber.
 *
 * ── Marcos Vorgabe vom 24.09. ───────────────────────────────────────────────
 *
 *   „In der Merkliste noch einen Filter analog den Sets einbauen inkl.
 *    Inhaber."
 *
 * Gefiltert wird am SERVER (routes/api_v1/wanted.ts), nicht hier. Nicht wegen
 * der Menge — eine Merkliste hat ein paar Dutzend Eintraege —, sondern weil
 * beide Oberflaechen dasselbe Ergebnis zeigen sollen: Die Sortierung nach
 * Marktpreis braucht price_cache, und den kennt kein Client.
 *
 * Leere Werte werden zu null und fallen damit aus der Adresse: Ein Aufruf ohne
 * Filter ergibt dieselbe Adresse wie vor dieser Aenderung.
 */
internal fun MainViewModel.ladeMerkliste() {
    viewModelScope.launch {
        val f = _merklisteState.value
        _merklisteState.update { it.copy(laedt = true) }
        val r = repo.sets.getMerkliste(
            search    = f.query.trim().ifBlank { null },
            condition = f.zustandFilter.ifBlank { null },
            sort      = f.sortierung.ifBlank { null },
            accounts  = scopeFor(ch.brickinventoryapp.data.ScopeFilter.View.MERKLISTE),
        )
        when (r) {
            is Result.Success ->
                _merklisteState.update { it.copy(merkposten = r.data.merkposten, laedt = false) }
            is Result.Error -> {
                _merklisteState.update { it.copy(laedt = false) }
                _snackbar.value = meldungFuerSnackbar(r)?.let { text(R.string.vm_error, it) }
            }
        }
    }
}

/**
 * Suchtext — entprellt, damit nicht jeder Tastendruck eine Abfrage ausloest.
 *
 * Dieselben 350 ms wie bei der Galerie (setGalleryQuery). Der Wert steht sofort
 * im Zustand, damit das Feld nicht ruckelt; nur der Abruf wartet.
 */
internal fun MainViewModel.setzeMerklisteSuche(q: String) {
    _merklisteState.update { it.copy(query = q) }
    merklisteSearchJob?.cancel()
    merklisteSearchJob = viewModelScope.launch {
        delay(350)
        ladeMerkliste()
    }
}

/** Zustandsfilter — "N", "U" oder leer fuer beide. Keine Entprellung: eine Wahl trifft man einmal. */
internal fun MainViewModel.setzeMerklisteZustand(zustand: String) {
    _merklisteState.update { it.copy(zustandFilter = zustand) }
    ladeMerkliste()
}

/** Sortierung — ein Schluessel aus MERK_SORTS (utils/merkliste.ts). */
internal fun MainViewModel.setzeMerklisteSortierung(sortierung: String) {
    _merklisteState.update { it.copy(sortierung = sortierung) }
    ladeMerkliste()
}

/**
 * Einen Merkposten eintragen.
 *
 * `besitzer` ist das Zielkonto — der Grossvater traegt einen Merkposten fuer den
 * Enkel ein. Ohne Angabe schreibt der Server auf das eigene Konto; die
 * RICHTUNG prueft er selbst (resolveWriteTarget), nicht die App.
 *
 * Nach dem Erfolg wird die Liste neu geladen statt lokal ergaenzt: Der Server
 * fuellt die Stammdaten aus dem Katalog nach, und die kennt die App hier
 * nicht. Eine selbstgebaute Zeile stuende ohne Namen und ohne Bild da, bis
 * jemand den Bildschirm wechselt.
 */
internal fun MainViewModel.legeMerkpostenAn(
    setNumber: String, zustand: String, besitzer: Int? = null,
) {
    val nummer = setNumber.trim()
    if (nummer.isBlank()) { _snackbar.value = text(R.string.wanted_need_number); return }
    viewModelScope.launch {
        when (val r = repo.sets.legeMerkpostenAn(nummer, zustand, besitzer)) {
            is Result.Success -> {
                // „stand schon drauf" ist kein Fehler, aber auch kein Neuzugang
                // — wer zweimal auf denselben Knopf drueckt, soll den
                // Unterschied sehen.
                _snackbar.value = text(
                    if (r.data.warNeu) R.string.wanted_added else R.string.wanted_already)
                ladeMerkliste()
            }
            is Result.Error -> _snackbar.value = meldungFuerSnackbar(r)?.let { text(R.string.vm_error, it) }
        }
    }
}

/**
 * Den Inhaber eines Merkpostens wechseln.
 *
 * Marcos Befund: „Auf dem Detail-Dialog der Merkliste kann der Inhaber
 * nicht geaendert werden. Auch in der Android-App nicht."
 *
 * Die Liste wird danach neu geladen und nicht von Hand nachgezogen: Wandert
 * der Merkposten aus dem Blickfeld heraus, verschwindet er — und das soll man
 * sehen. Der Detailbildschirm merkt es von selbst, er sucht seinen Eintrag in
 * genau dieser Liste (siehe der Absatz in MerkpostenDetailScreen).
 */
internal fun MainViewModel.verschiebeMerkposten(
    setNumber: String, zustand: String, vonId: Int, zuId: Int,
) {
    if (vonId == zuId) return
    viewModelScope.launch {
        when (val r = repo.sets.verschiebeMerkposten(setNumber, zustand, vonId, zuId)) {
            is Result.Success -> {
                if (!r.data.success) { _snackbar.value = r.data.error ?: text(R.string.err_unknown); return@launch }
                // „stand dort schon" ist kein Fehler, aber auch kein Umzug.
                // vm_saved statt eines neuen Textes: „Gespeichert" steht schon
                // da, und ein zweiter gleichlautender Eintrag ist genau das,
                // was StringResourceParityTest verhindert.
                _snackbar.value = text(
                    if (r.data.zusammengefuehrt) R.string.wanted_already else R.string.vm_saved)
                ladeMerkliste()
            }
            is Result.Error -> _snackbar.value = meldungFuerSnackbar(r)?.let { text(R.string.vm_error, it) }
        }
    }
}

/** Einen Merkposten entfernen — genau EINEN Zustand. */
internal fun MainViewModel.loescheMerkposten(setNumber: String, zustand: String, besitzer: Int?) {
    viewModelScope.launch {
        when (val r = repo.sets.loescheMerkposten(setNumber, zustand, besitzer)) {
            is Result.Success -> { _snackbar.value = text(R.string.wanted_deleted); ladeMerkliste() }
            is Result.Error   -> _snackbar.value = meldungFuerSnackbar(r)?.let { text(R.string.vm_error, it) }
        }
    }
}

/**
 * In die Galerie uebernehmen.
 *
 * Der Server ruft dafuer addSet() — die eine Wahrheit fuers Erfassen — und
 * raeumt danach Eintrag UND Preisalarm weg (Marcos Festlegung).
 *
 * 'exists' heisst: Das Set war schon im Blickfeld. Der Merkposten ist trotzdem
 * erledigt und verschwindet; er stuende sonst fuer etwas, das man laengst hat.
 *
 * Danach wird auch die Galerie neu geladen: Das Set ist jetzt dort, und wer
 * hinueberwechselt, soll es sehen und nicht eine Ansicht von vorhin.
 */
internal fun MainViewModel.uebernimmMerkposten(
    setNumber: String, zustand: String, besitzer: Int?,
    anzahl: Int = 1, kaufpreisRoh: String = "", erfasstAls: String? = null,
    lagerort: String? = null,
) {
    viewModelScope.launch {
        // Dieselbe Zahlenerkennung wie beim Preisalarm: Komma wie Punkt, und
        // leer heisst „kein Kaufpreis" — der Server setzt dann den Marktpreis
        // ein, genau wie auf dem normalen Erfassungsweg.
        val preis = ch.brickinventoryapp.alarm.Alarmeingabe.zahl(kaufpreisRoh)
        when (val r = repo.sets.uebernimmMerkposten(setNumber, zustand, anzahl, preis,
                                                erfasstAls, besitzer,
                                                lagerort?.trim()?.takeIf { it.isNotEmpty() })) {
            is Result.Success -> {
                _snackbar.value = text(
                    if (r.data.action == "exists") R.string.wanted_taken_existing
                    else R.string.wanted_taken)
                ladeMerkliste()
                loadSets()
            }
            is Result.Error -> _snackbar.value = meldungFuerSnackbar(r)?.let { text(R.string.vm_error, it) }
        }
    }
}

/**
 * Merkposten UND Preisalarm in einem Griff — der Weg aus dem Katalog-Detail.
 *
 * Marcos Vorgabe: „Aus dem Katalog sollen in der Detailansicht Sets in die
 * Merkliste hinzugefuegt werden koennen inkl. Zustand und einem
 * Preisalarm."
 *
 * ── Warum ZWEI Aufrufe und nicht ein Feld am Merkposten ────────────────────────
 *
 * Der Alarm lebt in price_alerts und ist genau derselbe, den die
 * Set-Detailansicht setzt — gleicher Schluessel, gleiche Tabelle. Eine
 * Schwelle am Merkposten waere eine ZWEITE Stelle, an der eine Preisschwelle
 * steht, und die beiden liefen beim ersten Aendern auseinander.
 *
 * ── Warum die Schwelle optional ist ────────────────────────────────────────
 *
 * Ein Merkposten ohne Alarm ist ein gueltiger Merkposten. Leer heisst „kein Alarm",
 * nicht „Schwelle 0" — dieselbe Regel wie im Set-Detail.
 *
 * Der Alarm wird erst NACH dem erfolgreich angelegten Merkposten gesetzt:
 * Andersherum stuende eine Schwelle fuer ein Set da, das auf keiner Liste
 * steht.
 */
internal fun MainViewModel.merkpostenMitAlarm(
    setNumber: String, zustand: String, richtung: String, schwelleRoh: String,
    besitzer: Int? = null,
) {
    viewModelScope.launch {
        when (val r = repo.sets.legeMerkpostenAn(setNumber, zustand, besitzer)) {
            is Result.Error -> { _snackbar.value = meldungFuerSnackbar(r)?.let { text(R.string.vm_error, it) }; return@launch }
            is Result.Success -> {
                // Dieselbe Zahlenerkennung wie beim Preisalarm im Set-Detail:
                // Komma wie Punkt, und nur ein positiver Wert ist eine
                // Schwelle (ch.brickinventoryapp.alarm.Alarmeingabe).
                val schwelle = ch.brickinventoryapp.alarm.Alarmeingabe.zahl(schwelleRoh)
                if (schwelle != null) {
                    repo.sets.setPreisalarm(setNumber, richtung, schwelle, zustand)
                }
                _snackbar.value = text(
                    if (r.data.warNeu) R.string.wanted_added else R.string.wanted_already)
                ladeMerkliste()
            }
        }
    }
}

/**
 * Was das Detail eines Merkpostens zusaetzlich braucht.
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
 * wenn einem das Set nicht gehoert; fuer einen Merkposten also unbrauchbar.
 * Nachgesehen, nicht vermutet.
 *
 * Damit braucht das Merkposten-Detail keinen einzigen neuen Endpunkt.
 *
 * ── Warum beide Fehler still bleiben ────────────────────────────────────────
 *
 * Ein Set, das rb_sets nicht kennt, hat kein Katalog-Detail; ein Set, das nie
 * abgefragt wurde, keinen Preis. Beides ist normal und kein Fehler, den man
 * jemandem melden muesste — die Ansicht zeigt dann „—" statt einer Zahl. Eine
 * Schnellmeldung dafuer waere Laerm.
 */
internal fun MainViewModel.ladeMerkpostenDetail(setNumber: String) {
    viewModelScope.launch {
        _merkpostenDetailState.value = MerkpostenDetailUiState(setNumber = setNumber, laedt = true)

        // Der Alarm gehoert dem Set-Detail-Zustand, und das ist Absicht: Der
        // Abschnitt, der ihn zeigt (setDetailAlarmSection), schreibt nach dem
        // Speichern DORTHIN zurueck. Ein eigenes Feld hier waere nach der
        // ersten Aenderung veraltet.
        loadPreisalarme(setNumber)

        val katalog = (repo.admin.getCatalogSetDetail(setNumber) as? Result.Success)
            ?.data?.takeIf { it.success }?.set
        _merkpostenDetailState.update { it.copy(katalog = katalog) }

        // ZUERST die Preise, DANN der Verlauf: Die Preisroute holt frisch und
        // fuellt dabei den Cache, aus dem der Verlauf liest. Andersherum
        // saehe der erste Blick auf einen neuen Merkposten leer aus.
        val preise = (repo.sets.getMerkpostenPreise(setNumber) as? Result.Success)
            ?.data?.takeIf { it.success }
        _merkpostenDetailState.update { it.copy(preise = preise) }

        val historie = (repo.finanzen.getSetPriceHistory(setNumber) as? Result.Success)
            ?.data?.takeIf { it.success }
        _merkpostenDetailState.update { it.copy(historie = historie, laedt = false) }
    }
}
