package ch.brickinventoryapp.ui

import ch.brickinventoryapp.data.model.SetAggregate
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import java.util.concurrent.CopyOnWriteArrayList
import javax.inject.Inject
import javax.inject.Singleton

/** Was sich am Bestand geändert hat — siehe [Bestandssignal]. */
sealed interface Aenderung {
    data object Sets : Aenderung
    data object Teile : Aenderung
    data object Figuren : Aenderung
    data object Merkliste : Aenderung
    data object Alarme : Aenderung
    /** Ein Kauf eines Sets hat sich geändert; die Galerie passt die Kachel an, statt neu zu laden. */
    data class SetZusammenfassung(val agg: SetAggregate) : Aenderung
}

/**
 * Ein Bereich meldet, was er am Bestand geändert hat; die anderen laden nach.
 * Wessen Ziel nicht offen ist, sammelt nicht und lädt beim nächsten Öffnen.
 *
 * Je Sammler und Art liegt höchstens eine offene Meldung (je Set die neueste
 * Zusammenfassung): Ein beschäftigter Sammler verliert so nichts, und die
 * Ablage wächst nicht. Ein Puffer mit tryEmit verwarf bei Überlauf still.
 */
@Singleton
class Bestandssignal @Inject constructor() {

    private class Sammler {
        val offen = LinkedHashMap<Any, Aenderung>()
        val wecker = Channel<Unit>(Channel.CONFLATED)
    }

    private val sammler = CopyOnWriteArrayList<Sammler>()

    val aenderungen: Flow<Aenderung> = flow {
        val s = Sammler()
        sammler += s
        try {
            while (true) {
                s.wecker.receive()
                val stapel = synchronized(s) { s.offen.values.toList().also { s.offen.clear() } }
                for (a in stapel) emit(a)
            }
        } finally {
            sammler -= s
        }
    }

    fun melde(vararg was: Aenderung) {
        for (s in sammler) {
            synchronized(s) {
                for (a in was) {
                    val art: Any = if (a is Aenderung.SetZusammenfassung) "set:${a.agg.setNumber}" else a
                    s.offen.remove(art)
                    s.offen[art] = a
                }
            }
            s.wecker.trySend(Unit)
        }
    }
}
