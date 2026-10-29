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
 *
 * Er lebt als @Singleton neben den ViewModels (wie [SessionExpiredSignal]): Wer
 * melden will, lässt ihn sich einspritzen; angezeigt wird an einer Stelle
 * (AppNavigation.kt). Ein neues ViewModel braucht nur den Konstruktorparameter.
 *
 * `fluss` ist absichtlich der MutableStateFlow selbst und nicht hinter
 * zeige()/quittiere() versteckt: Die ViewModels halten ihn unter dem Namen
 * `_snackbar`, damit die vielen Schreibstellen in den Feature-Dateien gleich
 * bleiben.
 */
@Singleton
class MeldungsKanal @Inject constructor() {

    /** Der geteilte Fluss. Null heisst: nichts anzuzeigen. */
    val fluss = MutableStateFlow<String?>(null)

    /** Nur-Lese-Sicht für die Anzeige. */
    val meldung: StateFlow<String?> = fluss.asStateFlow()
}
