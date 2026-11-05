package ch.brickinventoryapp.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Ein Weg für flüchtige Meldungen — die Snackbar hat genau einen Platz auf dem
 * Bildschirm, also gibt es genau einen Kanal dorthin. Mit einem Kanal je ViewModel
 * bräuchte jede Stelle, die ein ViewModel benutzt, einen Weiterleitungsblock;
 * fehlt er, verschwinden die Meldungen lautlos.
 * Ausführlich: docs/begruendungen/core-data/data/MeldungsKanal.kt.md#constructor
 */
@Singleton
class MeldungsKanal @Inject constructor() {

    private val _meldung = MutableStateFlow<String?>(null)
    private val warteschlange = ArrayDeque<String>()

    /** Die Meldung, die gerade dran ist; null heisst: nichts anzuzeigen. */
    val meldung: StateFlow<String?> = _meldung.asStateFlow()

    /**
     * Reiht [text] ein; null zeigt nichts. Eine zweite Meldung wartet, bis die
     * erste quittiert ist, statt sie zu ersetzen. Dieselbe Meldung doppelt
     * hintereinander kommt nur einmal, und mehr als [PLAETZE] warten nicht.
     */
    fun zeige(text: String?) {
        if (text == null) return
        synchronized(warteschlange) {
            when {
                _meldung.value == null -> _meldung.value = text
                text == (warteschlange.lastOrNull() ?: _meldung.value) -> Unit
                warteschlange.size < PLAETZE -> warteschlange.addLast(text)
            }
        }
    }

    /** Die angezeigte Meldung ist erledigt (gesehen oder überholt); die nächste rückt nach. */
    fun quittiere() {
        synchronized(warteschlange) { _meldung.value = warteschlange.removeFirstOrNull() }
    }

    private companion object {
        /** Mehr als ein paar Meldungen hintereinander liest niemand; die ältesten zählen. */
        const val PLAETZE = 5
    }
}
