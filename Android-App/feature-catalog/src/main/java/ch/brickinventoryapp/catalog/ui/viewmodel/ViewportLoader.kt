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
internal class ViewportLoader(area: CoroutineScope, restMs: Long, load: (Int) -> Unit) {
    // replay = 1: a window that arrives before the collector isn't lost.
    private val window = MutableSharedFlow<Pair<Int, Int>>(replay = 1, onBufferOverflow = BufferOverflow.DROP_OLDEST)

    init {
        area.launch {
            window.collectLatest { (of, until) ->
                delay(restMs)
                for (page in (of - 1)..(until + 1)) if (page >= 1) load(page)
            }
        }
    }

    /** First and last visible page; every call restarts the quiet period. */
    fun visible(of: Int, until: Int) {
        window.tryEmit(of to until)
    }
}
