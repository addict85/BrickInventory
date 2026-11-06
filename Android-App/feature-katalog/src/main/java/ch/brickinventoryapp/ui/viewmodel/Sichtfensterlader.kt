package ch.brickinventoryapp.ui.viewmodel

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

/**
 * Lädt die Seiten eines Sichtfensters erst, wenn die Liste [ruheMs] ruht. Die Leiste
 * rollt beim Ziehen durch jede Zwischenposition; ohne Ruhe stünde die Zielseite hinter
 * Hunderten angeforderter Seiten. `collectLatest` verwirft das wartende Fenster, statt es
 * nur aufzuschieben. Eine Seite Vorlauf in beide Richtungen.
 */
internal class Sichtfensterlader(bereich: CoroutineScope, ruheMs: Long, lade: (Int) -> Unit) {
    // replay = 1: Ein Fenster, das vor dem Sammler kommt, geht nicht verloren.
    private val fenster = MutableSharedFlow<Pair<Int, Int>>(replay = 1, onBufferOverflow = BufferOverflow.DROP_OLDEST)

    init {
        bereich.launch {
            fenster.collectLatest { (von, bis) ->
                delay(ruheMs)
                for (seite in (von - 1)..(bis + 1)) if (seite >= 1) lade(seite)
            }
        }
    }

    /** Erste und letzte sichtbare Seite; jeder Aufruf startet die Ruhezeit neu. */
    fun sichtbar(von: Int, bis: Int) {
        fenster.tryEmit(von to bis)
    }
}
