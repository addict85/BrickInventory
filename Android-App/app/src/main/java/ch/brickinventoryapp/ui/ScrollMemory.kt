package ch.brickinventoryapp.ui

import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow

/**
 * Gemerkte Rollpositionen je Reiter. Mitschreiben und beim Betreten ausdrücklich
 * scrollToItem(index, offset) — der Weg, der im Katalog zuverlässig an dieselbe
 * Zeile führt; ein über den NavHost geretteter LazyGridState stand danach
 * verschoben. Eine schlichte Karte statt eines StateFlow, weil sich die Position
 * bei jeder Bewegung ändert und nur beim Betreten gelesen wird. Ein Singleton,
 * damit ViewModels und Navigation dieselbe Karte sehen.
 */
@javax.inject.Singleton
class ScrollMemory @javax.inject.Inject constructor() {
    private val positionen = mutableMapOf<String, Pair<Int, Int>>()

    fun lies(schluessel: String): Pair<Int, Int> = positionen[schluessel] ?: (0 to 0)

    fun merke(schluessel: String, index: Int, offset: Int) {
        positionen[schluessel] = index to offset
    }

    /** Nach einem Filterwechsel: Die alte Stelle zeigt auf Einträge, die es nicht mehr gibt. */
    fun vergiss(schluessel: String) {
        positionen.remove(schluessel)
    }
}

/**
 * Die Reihenfolge ist die ganze Regel: erst zurückspringen, dann melden.
 *
 * - Der Merker darf den Ausflug nicht überleben (`remember`, nicht
 *   `rememberSaveable`), sonst ist die Wiederherstellung nach dem ersten Betreten
 *   für immer aus.
 * - Der Melder darf nicht vorher loslaufen: Ein frisches Raster steht auf null und
 *   überschriebe die gemerkte Stelle.
 *
 * `bereit` sagt, ob die Liste Inhalt hat — vorher gibt es keine Stelle zum
 * Springen.
 */
@Composable
fun ScrollPositionKeeper(
    schluessel: String,
    gridState: LazyGridState,
    bereit: Boolean,
    speicher: ScrollMemory,
    /**
     * Wie viele Einträge können nachträglich oben in die Liste kommen? Beim Betreten
     * der Teile sind die Set-Teile meist vor den manuellen da; LazyGrid hält beim
     * Einfügen den sichtbaren Eintrag fest, und die manuellen landen über dem
     * Sichtfenster. Deshalb eine ausdrückliche Korrektur, sobald die Nachzügler da
     * sind.
     */
    obenNachziehend: Int = 0,
) {
    var wiederhergestellt by remember { mutableStateOf(false) }
    // Gab es eine gespeicherte Position? Nur dann ist ein Sprung nach oben
    // falsch — wer aus der Detailansicht zurückkommt, will an seine Stelle.
    var hatteGespeicherte by remember { mutableStateOf(false) }
    // Hat sich die Liste bewegt, bevor die Nachzügler da waren? `isScrollInProgress`
    // heisst hier nur eine Geste: Der einzige programmatische Bildlauf ist die
    // Korrektur unten, und die läuft nur ohne wiederhergestellte Position.
    // (`interactionSource` wäre sauberer; ob LazyGridState es in dieser
    // Compose-Fassung hat, ist nicht belegt.)
    var nutzerGeste by remember { mutableStateOf(false) }

    LaunchedEffect(gridState) {
        snapshotFlow { gridState.isScrollInProgress }
            .collect { laeuft -> if (laeuft) nutzerGeste = true }
    }

    LaunchedEffect(bereit) {
        if (wiederhergestellt || !bereit) return@LaunchedEffect
        val (index, offset) = speicher.lies(schluessel)
        if (index > 0 || offset > 0) {
            hatteGespeicherte = true
            gridState.scrollToItem(index, offset)
        }
        wiederhergestellt = true
    }

    // Nachzügler oben: an den Anfang, aber nur wenn niemand etwas anderes
    // wollte — weder eine gespeicherte Position noch eine eigene Wischgeste.
    LaunchedEffect(obenNachziehend) {
        if (obenNachziehend > 0 && !hatteGespeicherte && !nutzerGeste &&
            gridState.firstVisibleItemIndex > 0
        ) {
            gridState.scrollToItem(0)
        }
    }

    LaunchedEffect(gridState, wiederhergestellt) {
        if (!wiederhergestellt) return@LaunchedEffect
        snapshotFlow { gridState.firstVisibleItemIndex to gridState.firstVisibleItemScrollOffset }
            .collect { (index, offset) -> speicher.merke(schluessel, index, offset) }
    }
}

/** Dasselbe für eine LazyColumn. */
@Composable
fun ScrollPositionKeeper(
    schluessel: String,
    listState: LazyListState,
    bereit: Boolean,
    speicher: ScrollMemory,
) {
    var wiederhergestellt by remember { mutableStateOf(false) }
    LaunchedEffect(bereit) {
        if (wiederhergestellt || !bereit) return@LaunchedEffect
        val (index, offset) = speicher.lies(schluessel)
        if (index > 0 || offset > 0) listState.scrollToItem(index, offset)
        wiederhergestellt = true
    }
    LaunchedEffect(listState, wiederhergestellt) {
        if (!wiederhergestellt) return@LaunchedEffect
        snapshotFlow { listState.firstVisibleItemIndex to listState.firstVisibleItemScrollOffset }
            .collect { (index, offset) -> speicher.merke(schluessel, index, offset) }
    }
}

/**
 * Dasselbe für eine gewöhnliche Column(verticalScroll(…)). Sie hat kein „bereit“:
 * Ihre Höhe wächst, während die Karten Daten bekommen, und ScrollState.value lässt
 * sich nicht über maxValue setzen — ein zu früher Sprung würde gekappt und die
 * Stelle wäre verloren. Deshalb wird gewartet, bis die Seite so hoch ist, wie die
 * Stelle tief liegt.
 */
@Composable
fun ScrollPositionKeeper(
    schluessel: String,
    scrollState: ScrollState,
    speicher: ScrollMemory,
) {
    // Der Merker darf den Ausflug NICHT überleben — `remember` und nicht
    // `rememberSaveable`, aus demselben Grund wie oben.
    var wiederhergestellt by remember { mutableStateOf(false) }
    // Die gemerkte Stelle EINMAL lesen und festhalten: Der Melder unten
    // schreibt laufend, und ein zweites Lesen später läse den eigenen
    // Zwischenstand.
    val ziel = remember { speicher.lies(schluessel).first }

    LaunchedEffect(scrollState.maxValue) {
        if (wiederhergestellt) return@LaunchedEffect
        if (ziel <= 0) { wiederhergestellt = true; return@LaunchedEffect }
        if (scrollState.maxValue < ziel) return@LaunchedEffect
        scrollState.scrollTo(ziel)
        wiederhergestellt = true
    }
    LaunchedEffect(scrollState, wiederhergestellt) {
        if (!wiederhergestellt) return@LaunchedEffect
        // Der zweite Platz bleibt leer: Eine Column hat nur EINE Zahl, keinen
        // Eintrag mit Versatz darin. Ihn mit etwas zu füllen wäre eine Angabe,
        // die niemand liest und die beim nächsten Leser wie eine gilt.
        snapshotFlow { scrollState.value }.collect { speicher.merke(schluessel, it, 0) }
    }
}

/**
 * Ein Reiter wurde unten angetippt → seine gemerkte Rollposition verwerfen: „Ich
 * komme zurück“ behält die Stelle, „ich gehe auf diesen Reiter“ fängt oben an, wo
 * die manuell erfassten Einträge stehen. Die Routennamen sind zugleich die
 * Schlüssel des Merkers, damit es keine zweite Zuordnung gibt.
 */
fun ScrollMemory.vergissReiter(route: String) {
    vergiss(route)
}
