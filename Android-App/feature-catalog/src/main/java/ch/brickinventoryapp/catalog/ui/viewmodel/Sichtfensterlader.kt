package ch.brickinventoryapp.catalog.ui.viewmodel

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

/**
 * Loads a viewport's pages only once the list has been still for [restMs]. The bar
 * scrolls through every intermediate position while dragging; without stillness the
 * target page would sit behind hundreds of requested pages. `collectLatest` discards the
 * waiting window instead of merely postponing it. One page of lead in each direction.
 */
internal class Sichtfensterlader(bereich: CoroutineScope, restMs: Long, lade: (Int) -> Unit) {
    // replay = 1: a window that arrives before the collector isn't lost.
    private val fenster = MutableSharedFlow<Pair<Int, Int>>(replay = 1, onBufferOverflow = BufferOverflow.DROP_OLDEST)

    init {
        bereich.launch {
            fenster.collectLatest { (von, bis) ->
                delay(restMs)
                for (seite in (von - 1)..(bis + 1)) if (seite >= 1) lade(seite)
            }
        }
    }

    /** First and last visible page; every call restarts the quiet period. */
    fun sichtbar(von: Int, bis: Int) {
        fenster.tryEmit(von to bis)
    }
}
