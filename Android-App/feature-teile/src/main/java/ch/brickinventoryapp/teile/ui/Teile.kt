package ch.brickinventoryapp.teile.ui

import ch.brickinventoryapp.zustand.ui.ladefehler
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.lokal.Lokal
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.model.fach.FarbeAnsicht
import ch.brickinventoryapp.model.fach.FigurAnsicht
import ch.brickinventoryapp.model.fach.FigurenKennzahlenAnsicht
import ch.brickinventoryapp.model.fach.FilterFarbeAnsicht
import ch.brickinventoryapp.model.fach.KategorieAnsicht
import ch.brickinventoryapp.model.fach.ManuelleFigurAnsicht
import ch.brickinventoryapp.model.fach.ManuellesTeilAnsicht
import ch.brickinventoryapp.model.fach.TeilAnsicht
import ch.brickinventoryapp.model.fach.TeileKennzahlenAnsicht
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import ch.brickinventoryapp.model.ui.Listenansicht

/** Die Abrufe neben der Teileliste: Kennzahlen und Filterwerte; Blickfeld setzt der Aufrufer. */
internal interface TeileQuelle {
    suspend fun teileKennzahlen(): Ergebnis<TeileKennzahlenAnsicht?>
    suspend fun filterFarben(): Ergebnis<List<FilterFarbeAnsicht>>
    suspend fun kategorien(): Ergebnis<List<KategorieAnsicht>>
    suspend fun alleFarben(): Ergebnis<List<FarbeAnsicht>>
}

/**
 * Die Listen für einen Filter, und wie sie gefüllt werden — die einzige Quelle der Anzeige
 * wie in der Galerie: die Ablage, wo Konto, Lagerort oder „In Sets“ es verlangen die
 * Kontosicht. Der Abruf füllt nur die Quelle.
 */
internal class TeileLokal(
    val teile: (TeileUiState) -> Flow<Lokal<TeilAnsicht>>,
    val manuelleTeile: (TeileUiState) -> Flow<Lokal<ManuellesTeilAnsicht>>,
    val aktualisiere: suspend (TeileUiState) -> Ergebnis<Unit>,
)

/** Dasselbe für die Figuren. */
internal class FigurenLokal(
    val figuren: (FigurenUiState) -> Flow<Lokal<FigurAnsicht>>,
    val manuelleFiguren: (FigurenUiState) -> Flow<Lokal<ManuelleFigurAnsicht>>,
    val aktualisiere: suspend (FigurenUiState) -> Ergebnis<Unit>,
    val kennzahlen: suspend () -> Ergebnis<FigurenKennzahlenAnsicht>,
)

/**
 * Folgt der Ablage und meldet den Abruf — gemeinsam für Teile und Figuren. Ein neuer
 * Auftrag bricht den alten ab: Eine langsame alte Antwort überschriebe sonst eine neuere,
 * und beim Tippen löscht jeder Tastendruck den entprellten vorigen.
 */
internal class Listenfolge<S>(
    private val scope: CoroutineScope,
    private val zustand: MutableStateFlow<S>,
    private val meldeFehler: (Ergebnis.Fehler) -> Unit,
    private val suchPause: Long,
) {
    private var folgen: List<Job> = emptyList()
    private var auftrag: Job? = null

    /** Eine nie geladene Liste (ohne Stand) leert nichts. */
    fun <T> folge(quelle: Flow<Lokal<T>>, neu: (S, List<T>) -> S): Job =
        scope.launch { quelle.collect { l -> if (l.stand != null) zustand.update { st -> neu(st, l.liste) } } }

    fun starte(entprellt: Boolean, laden: suspend () -> Unit) {
        abbrechen()
        auftrag = scope.launch {
            if (entprellt) delay(suchPause)
            laden()
        }
    }

    fun folgeAllen(neu: List<Job>) { folgen = neu }

    /** Ohne Netz bleibt die Ablage mit ihrem Stand; ohne Ablage ist es ein Fehler. */
    fun ausgang(r: Ergebnis<Unit>, stand: Long?, fertig: (S, Long?) -> S, fehler: (S, Ergebnis.Fehler) -> S) {
        when {
            r is Ergebnis.Erfolg -> zustand.update { fertig(it, null) }
            r is Ergebnis.Fehler && r.transient && stand != null -> zustand.update { fertig(it, stand) }
            r is Ergebnis.Fehler -> {
                zustand.update { fehler(it, r) }
                meldeFehler(r)
            }
        }
    }

    fun abbrechen() {
        auftrag?.cancel()
        folgen.forEach { it.cancel() }
    }
}

/**
 * Zustand der Teileliste und wie er sich ändert — wie die Galerie: privater Fluss,
 * benannte Methoden, Quellen von aussen. Die Filter liest jeder Lader aus dem Zustand:
 * So passen Quelle und Abruf immer zu dem, was die Filterchips zeigen.
 */
internal class Teile(
    private val scope: CoroutineScope,
    private val quelle: TeileQuelle,
    meldeFehler: (Ergebnis.Fehler) -> Unit,
    /** Filterwechsel: Die gemerkte Scrollstelle zeigt auf eine andere Liste. */
    private val vergissScroll: () -> Unit,
    suchPause: Long = 350,
    private val listen: TeileLokal,
    /** Jeder neue Filter, damit der Aufrufer ihn merken kann. */
    private val filterGeaendert: (Teilefilter) -> Unit = {},
) {
    private val _state = MutableStateFlow(TeileUiState())
    val state: StateFlow<TeileUiState> = _state.asStateFlow()
    private val folge = Listenfolge(scope, _state, meldeFehler, suchPause)

    /** Alles steht auf einmal da; eine weitere Seite gibt es nicht mehr. */
    fun laden(seite: Int = 1, entprellt: Boolean = false) {
        if (seite > 1) return
        folge.starte(entprellt) { ladeTeile() }
    }

    /** Nach dem Entprellen gelesen: Der zuletzt gestartete Auftrag sieht den neuesten Filter. */
    private suspend fun ladeTeile() {
        val st = _state.value
        folge.folgeAllen(listOf(
            folge.folge(listen.teile(st)) { s, l ->
                s.copy(parts = sortiert(l, s.filter.ordnung), partsTotal = l.size, partsPage = 1)
            },
            folge.folge(listen.manuelleTeile(st)) { s, l -> s.copy(manualParts = l) },
        ))
        _state.update { it.copy(teileAbruf = Laden.Laedt) }
        val r = listen.aktualisiere(st)
        folge.ausgang(r, listen.teile(st).first().stand,
            { s, stand -> s.copy(teileAbruf = Laden.Daten(Unit), teileOfflineStand = stand) },
            { s, r -> s.copy(teileAbruf = ladefehler(r)) })
        ladeKennzahlen()
    }

    /** Kennzahlen sind Beiwerk: Ein Fehlschlag lässt die Liste stehen. */
    suspend fun ladeKennzahlen() {
        (quelle.teileKennzahlen() as? Ergebnis.Erfolg)
            ?.let { s -> _state.update { it.copy(partsStats = s.data) } }
    }

    /**
     * Einen neuen Filter setzen. Ein Klick ist ein fertiger Wunsch; nur das Tippen der Suche
     * wird entprellt. Die Ordnung sortiert nur um: Die ganze Liste liegt schon vor.
     */
    fun setzeFilter(neu: Teilefilter) {
        val alt = _state.value.filter
        if (alt == neu) return
        if (neu.copy(ansicht = alt.ansicht) != alt) vergissScroll()
        _state.update { it.copy(filter = neu, parts = if (neu.ordnung != alt.ordnung) sortiert(it.parts, neu.ordnung) else it.parts) }
        filterGeaendert(neu)
        if (neu.copy(ordnung = alt.ordnung) == alt) return
        laden(entprellt = neu.suche != alt.suche)
    }

    /**
     * Farb- und Kategorieliste der Filter. Still bei Fehlern: Ein fehlender
     * Filter ist kein Grund, die Liste zurückzuhalten oder zu stören.
     */
    fun ladeFilter() {
        scope.launch {
            (quelle.filterFarben() as? Ergebnis.Erfolg)?.data
                ?.let { d -> _state.update { it.copy(partsFilterColors = d) } }
            (quelle.kategorien() as? Ergebnis.Erfolg)?.data
                ?.let { d -> _state.update { it.copy(partsCategories = d) } }
        }
    }

    /** Farbauswahl im Erfassungsdialog; fehlt sie, tippt man die Farb-ID. */
    fun ladeFarben() {
        scope.launch {
            (quelle.alleFarben() as? Ergebnis.Erfolg)?.data
                ?.let { d -> _state.update { it.copy(partsColors = d) } }
        }
    }

    /** Einen gemerkten Filter übernehmen, ohne zu laden. */
    fun stelleFilterWieder(f: Teilefilter) = _state.update { it.copy(filter = f) }

    /** Abmelden: nichts vom vorigen Konto stehen lassen, laufende Abrufe verwerfen. */
    fun zuruecksetzen() {
        folge.abbrechen()
        _state.value = TeileUiState()
    }
}

/** Zustand der Figurenliste, gebaut wie [Teile]. */
internal class Figuren(
    private val scope: CoroutineScope,
    meldeFehler: (Ergebnis.Fehler) -> Unit,
    suchPause: Long = 350,
    private val listen: FigurenLokal,
) {
    private val _zustand = MutableStateFlow(FigurenUiState())
    val zustand: StateFlow<FigurenUiState> = _zustand.asStateFlow()
    private val folge = Listenfolge(scope, _zustand, meldeFehler, suchPause)

    suspend fun ladeKennzahlen() {
        (listen.kennzahlen() as? Ergebnis.Erfolg)
            ?.let { r -> _zustand.update { it.copy(minifigStats = r.data) } }
    }

    /**
     * Figurenliste laden. Die Kennzahlen kommen nebenher und zeigen den ganzen
     * Bestand — beim Tippen nicht, sonst zählte jeder Tastendruck neu, ohne
     * Auftrag, der ihn abbrechen könnte.
     */
    fun laden(entprellt: Boolean = false) {
        if (!entprellt) scope.launch { ladeKennzahlen() }
        folge.starte(entprellt) { folgeFiguren() }
    }

    private suspend fun folgeFiguren() {
        val st = _zustand.value
        folge.folgeAllen(listOf(
            folge.folge(listen.figuren(st)) { s, l -> s.copy(minifigs = l) },
            folge.folge(listen.manuelleFiguren(st)) { s, l -> s.copy(manualFigs = l) },
        ))
        _zustand.update { it.copy(figurenAbruf = Laden.Laedt) }
        val r = listen.aktualisiere(st)
        folge.ausgang(r, listen.figuren(st).first().stand,
            { s, stand -> s.copy(figurenAbruf = Laden.Daten(Unit), figurenOfflineStand = stand) },
            { s, r -> s.copy(figurenAbruf = ladefehler(r)) })
    }

    fun setzeSuche(q: String) {
        _zustand.update { it.copy(minifigsQuery = q) }
        laden(entprellt = true)
    }

    /** Karten oder Tabelle; ohne Neuladen, die Felder sind schon da. */
    fun setzeAnsicht(wert: Listenansicht) = _zustand.update { it.copy(minifigsView = wert) }

    /** Gemerkte Suche und Ansicht übernehmen, ohne zu laden. */
    fun stelleWieder(suche: String, ansicht: Listenansicht) =
        _zustand.update { it.copy(minifigsQuery = suche, minifigsView = ansicht) }

    fun zuruecksetzen() {
        folge.abbrechen()
        _zustand.value = FigurenUiState()
    }
}
