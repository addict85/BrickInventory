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
import ch.brickinventoryapp.model.ui.ScrollMemory

/**
 * The order is the whole rule: jump back first, then report.
 */
@Composable
fun ScrollPositionKeeper(
    schluessel: String,
    gridState: LazyGridState,
    bereit: Boolean,
    speicher: ScrollMemory,
    /**
     * How many entries can later arrive at the top of the list? On entering
     * parts, the set parts are usually there before the manual ones; LazyGrid holds the
     * visible entry fixed when inserting, and the manual ones end up above the
     * viewport. Hence an explicit correction as soon as the latecomers
     * are there.
     */
    obenNachziehend: Int = 0,
) {
    var wiederhergestellt by remember { mutableStateOf(false) }
    // Was there a stored position? Only then is a jump to the top
    // wrong — whoever comes back from the detail view wants to return to their spot.
    var hatteGespeicherte by remember { mutableStateOf(false) }
    // Did the list move before the latecomers arrived? `isScrollInProgress`
    // here means only a gesture: the only programmatic scroll is the
    // correction below, and that only runs without a restored position.
    // (`interactionSource` would be cleaner; whether LazyGridState has it in this
    // Compose version is not established.)
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

    // Latecomers at the top: go to the start, but only if nobody wanted
    // anything else — neither a stored position nor their own swipe gesture.
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

/** The same for a LazyColumn. */
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
 * The same for an ordinary Column(verticalScroll(…)). It has no „ready": its
 * height grows while the cards receive data, and ScrollState.value can't
 * be set beyond maxValue — too early a jump would be clamped and the
 * position lost. So it waits until the page is as tall as the
 * position sits deep.
 */
@Composable
fun ScrollPositionKeeper(
    schluessel: String,
    scrollState: ScrollState,
    speicher: ScrollMemory,
) {
    // The holder must NOT survive the outing — `remember` and not
    // `rememberSaveable`, for the same reason as above.
    var wiederhergestellt by remember { mutableStateOf(false) }
    // Read the remembered position ONCE and hold onto it: the reporter below
    // keeps writing continuously, and a second read later would read its
    // own interim state.
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
        // The second slot stays empty: a Column has only ONE number, no
        // entry with an offset in it. Filling it with something would be a value
        // nobody reads, and which a later reader would take as real.
        snapshotFlow { scrollState.value }.collect { speicher.merke(schluessel, it, 0) }
    }
}

/**
 * A tab was tapped at the bottom → discard its remembered scroll position: „I'm
 * coming back“ keeps the position, „I'm going to this tab“ starts at the top, where
 * the manually captured entries sit. The route names double as the
 * holder's keys, so there's no second mapping.
 */
fun ScrollMemory.vergissReiter(route: String) {
    vergiss(route)
}
