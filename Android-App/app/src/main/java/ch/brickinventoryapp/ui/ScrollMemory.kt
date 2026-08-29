package ch.brickinventoryapp.ui

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
 * Gemerkte Rollpositionen je Reiter.
 *
 * ── Warum ein eigener Speicher und kein `rememberLazyGridState()` (Nachtrag 95)
 *
 * In Nachtrag 92/94 lag der Zustand oberhalb des NavHost. Die Idee: Das Objekt
 * überlebt den Ausflug in die Detailseite, also überlebt auch die Position.
 * Marcos Befund war ein anderer — „in der Galerie ist sie verschoben": nicht
 * ganz oben, aber auch nicht dort, wo sie war. Der Zustand überlebt also, nur
 * misst das Raster beim Wiederanhängen offenbar nicht dieselbe Stelle heraus.
 *
 * Was dagegen NACHWEISLICH funktioniert, ist der Weg des Katalogs: Position
 * mitschreiben und beim Betreten ausdrücklich `scrollToItem(index, offset)`
 * aufrufen. Marco dazu im selben Bericht: „im Katalog ist sie auf der korrekten
 * Zeile". Genau dieser Weg steht hier — einmal, für alle Reiter, statt dreimal
 * unterschiedlich abgeschrieben.
 *
 * Bewusst eine schlichte Karte und KEIN StateFlow: Die Position ändert sich bei
 * jeder Rollbewegung. Läge sie im beobachteten Zustand, würde der ganze
 * Bildschirm bei jedem Bildlauf neu zusammengesetzt. Gelesen wird sie ohnehin
 * nur beim Betreten.
 *
 * Sie lebt im ViewModel und stirbt mit ihm — wie die Listen selbst.
 */
class ScrollMemory {
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
 * Die REIHENFOLGE ist die ganze Regel: erst zurückspringen, DANN wieder melden.
 *
 * Beide Fallen sind in dieser Reihe schon einmal zugeschnappt (Nachtrag 93):
 *
 *  - Der Merker darf den Ausflug NICHT überleben. Als `rememberSaveable` tat er
 *    es und schaltete die Wiederherstellung nach dem ersten Betreten für immer
 *    ab. `remember` gilt je Komposition — nach der Rückkehr ist es eine neue.
 *
 *  - Der Melder darf nicht vorher loslaufen. Ein frisch angehängtes Raster steht
 *    auf null, `snapshotFlow` gibt diesen Wert sofort heraus — und überschreibt
 *    damit die gemerkte Position, bevor jemand sie lesen kann.
 *
 * `bereit` sagt, ob die Liste ihren Inhalt hat. Vor dem ersten Eintrag gibt es
 * keine Stelle, an die gesprungen werden könnte.
 */
@Composable
fun ScrollPositionKeeper(
    schluessel: String,
    gridState: LazyGridState,
    bereit: Boolean,
    speicher: ScrollMemory,
    /**
     * Wie viele Einträge können NACHTRÄGLICH oben in die Liste kommen?
     *
     * ── Wofür das da ist (Nachtrag 122) ─────────────────────────────────────
     *
     * Marcos Befund: „Der Reiter Teile startet nicht zuoberst. Man sieht die
     * Teile aus den Sets und muss nach oben scrollen, um die manuell erfassten
     * zu sehen." Seine Vermutung, die Listen würden unabhängig geladen, war
     * richtig — und der Rest folgt daraus:
     *
     *  1. Beim Betreten laufen `loadParts()` und `loadValuation()` GLEICHZEITIG
     *     los. Die Set-Teile sind meist zuerst da.
     *  2. Das Raster zeigt sie, Position 0.
     *  3. Die manuellen Teile treffen ein und werden mit zwei Zwischenüberschriften
     *     OBEN eingefügt.
     *  4. Und jetzt der entscheidende Teil: LazyGrid hält beim Ändern der Daten
     *     den SICHTBAREN Eintrag fest, nicht den Index — es sucht den Schlüssel
     *     des ersten sichtbaren Elements in der neuen Liste wieder. Das ist
     *     normalerweise genau richtig (beim Nachladen unten springt nichts),
     *     hier aber nicht: Der festgehaltene Eintrag ist ein Set-Teil, und alles
     *     neu Eingefügte landet ÜBER dem Sichtfenster.
     *
     * Deshalb genügt es nicht, die Reihenfolge im Raster zu prüfen — die stimmt.
     * Es braucht eine ausdrückliche Korrektur, nachdem die Nachzügler da sind.
     */
    obenNachziehend: Int = 0,
) {
    var wiederhergestellt by remember { mutableStateOf(false) }
    // Gab es eine gespeicherte Position? Nur dann ist ein Sprung nach oben
    // falsch — wer aus der Detailansicht zurückkommt, will an seine Stelle.
    var hatteGespeicherte by remember { mutableStateOf(false) }
    // Hat sich die Liste bewegt, bevor die Nachzügler da waren?
    //
    // `isScrollInProgress` kann eine Wischgeste ODER einen eigenen
    // scrollToItem-Aufruf bedeuten — hier aber nur eine Geste, und zwar aus
    // einem Grund, der in beide Richtungen gilt: Der EINZIGE programmatische
    // Bildlauf auf diesem Weg ist die Korrektur unten, und die läuft nur, wenn
    // `hatteGespeicherte` FALSCH ist. Ist eine Position wiederhergestellt
    // worden, ist die Korrektur ohnehin abgeschaltet. Die Fälle überschneiden
    // sich also nie.
    //
    // (Sauberer wäre `interactionSource`, das nur echte Gesten meldet — ob es
    // LazyGridState in der hier eingebundenen Compose-Fassung hat, konnte ich
    // nicht belegen, und eine geratene API bricht den Bau.)
    var nutzerGeste by remember { mutableStateOf(false) }

    LaunchedEffect(gridState) {
        snapshotFlow { gridState.isScrollInProgress }
            .collect { laeuft -> if (laeuft) nutzerGeste = true }
    }

    LaunchedEffect(bereit) {
        if (wiederhergestellt || !bereit) return@LaunchedEffect
        val (index, offset) = speicher.lies(schluessel)
        if (index > 0 || offset > 0) {
            // Der Rücksprung, der hier vermutet wurde, kam von woanders: Der
            // SSE-Strom des CSV-Imports löste alle paar Sekunden ein
            // vollständiges Neuladen aus (Nachtrag 110). Die Diagnosezeile hat
            // das gezeigt und ist damit erledigt.
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
 * Ein Reiter wurde unten angetippt → seine gemerkte Rollposition verwerfen.
 *
 * ── Marcos Vorgabe (Nachtrag 114) ───────────────────────────────────────────
 * „Im Reiter Teile muss ich beim Öffnen nach oben scrollen, damit die manuell
 * erfassten Teile angezeigt werden. Wenn der Reiter geöffnet wird, soll die
 * Seite direkt die manuell erfassten Teile anzeigen."
 *
 * Der Merker ist dafür da, dass die Liste beim ZURÜCKKEHREN aus einer
 * Detailansicht wieder an derselben Stelle steht (Nachträge 92 bis 95). Er
 * griff bisher auch beim Antippen des Reiters — dann öffnete sich dieser
 * irgendwo in der Mitte, und die manuell erfassten Einträge ganz oben waren
 * nicht zu sehen.
 *
 * Zwei verschiedene Absichten: „ich komme zurück" behält die Stelle, „ich gehe
 * auf diesen Reiter" fängt oben an.
 *
 * Die Routennamen sind zugleich die Schlüssel des Merkers ("gallery", "parts",
 * "minifigs", "finance") — eine zweite Zuordnungstabelle wäre eine zweite
 * Wahrheit, die auseinanderläuft.
 */
fun ScrollMemory.vergissReiter(route: String) {
    vergiss(route)
}
