package ch.brickinventoryapp.ui

import ch.brickinventoryapp.data.model.SetAggregate
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
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
 *
 * Vorher rief eine Funktion des MainViewModel die Ladefunktionen der anderen
 * direkt auf (ein gelöschtes Set lud Galerie, Teile, Figuren und Finanzen).
 * Getrennte ViewModels kennen einander nicht — und ein ViewModel, dessen Ziel
 * nicht offen ist, muss auch nichts nachladen: Es lädt beim nächsten Öffnen.
 */
@Singleton
class Bestandssignal @Inject constructor() {
    private val _aenderungen = MutableSharedFlow<Aenderung>(extraBufferCapacity = 32)
    val aenderungen: SharedFlow<Aenderung> = _aenderungen.asSharedFlow()

    fun melde(vararg was: Aenderung) {
        for (a in was) _aenderungen.tryEmit(a)
    }
}
