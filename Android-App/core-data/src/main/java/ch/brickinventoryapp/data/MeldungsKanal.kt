package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.ui.Meldung
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
 */
interface MeldungsKanal {
    val meldung: StateFlow<Meldung?>
    fun zeige(meldung: Meldung?)

    /** Ein fertiger Satz; null zeigt nichts. */
    fun zeige(text: String?) = zeige(text?.let(Meldung::Text))
    fun acknowledge()

    /** Für Tests ohne Hilt. */
    companion object {
        operator fun invoke(): MeldungsKanal = MessageQueue()
    }
}

@Singleton
internal class MessageQueue @Inject constructor() : MeldungsKanal {

    private val _message = MutableStateFlow<Meldung?>(null)
    private val queue = ArrayDeque<Meldung>()

    /** Die Meldung, die gerade dran ist; null heisst: nichts anzuzeigen. */
    override val meldung: StateFlow<Meldung?> = _message.asStateFlow()

    /**
     * Reiht [meldung] ein; null zeigt nichts. Eine zweite Meldung wartet, bis die
     * erste quittiert ist, statt sie zu ersetzen. Dieselbe Meldung doppelt
     * hintereinander kommt nur einmal, und mehr als [PLACES] warten nicht.
     */
    override fun zeige(meldung: Meldung?) {
        if (meldung == null) return
        synchronized(queue) {
            when {
                _message.value == null -> _message.value = meldung
                meldung == (queue.lastOrNull() ?: _message.value) -> Unit
                queue.size < PLACES -> queue.addLast(meldung)
            }
        }
    }

    /** Die angezeigte Meldung ist erledigt (gesehen oder überholt); die nächste rückt nach. */
    override fun acknowledge() {
        synchronized(queue) { _message.value = queue.removeFirstOrNull() }
    }

    private companion object {
        /** Mehr als ein paar Meldungen hintereinander liest niemand; die ältesten zählen. */
        const val PLACES = 5
    }
}
