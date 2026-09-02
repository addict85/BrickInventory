package ch.brickinventoryapp.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * EIN Weg für flüchtige Meldungen — die Snackbar hat genau einen Platz auf dem
 * Bildschirm, also gibt es genau einen Kanal dorthin.
 *
 * ── Woher das kommt ─────────────────────────────────────────────────────────
 * Bis hierher gab es DREI Wege, und alle drei endeten an derselben Stelle:
 *
 *   1. `MainViewModel._snackbar` — der eigentliche, von zwölf Feature-Dateien
 *      beschrieben, in AppNavigation.kt eingesammelt und angezeigt.
 *   2. `CatalogViewModel._snackbar` — beim Herauslösen des Katalogs in ein
 *      eigenes ViewModel entstanden, samt `snackbarGelesen()`. Weil das
 *      ViewModel den Weg nach 1. nicht kennt, musste der Navigationsgraph ihn
 *      weiterleiten:
 *          val katMeldung by katalog.snackbar.collectAsStateWithLifecycle()
 *          LaunchedEffect(katMeldung) {
 *              katMeldung?.let { vm.showSnackbar(it); katalog.snackbarGelesen() }
 *          }
 *      Dieser Block stand ZWEIMAL in CatalogGraph.kt — einmal je Ziel, das
 *      das ViewModel benutzt.
 *   3. Eine bildschirmeigene `var snack` in MonitoringScreen.kt, die
 *      dasselbe von Hand tut.
 *
 * Das ist die eigentliche Rechnung des ViewModel-Schnitts: Jedes weitere
 * herausgelöste ViewModel bringt einen weiteren Kanal mit und einen weiteren
 * Weiterleitungsblock an JEDER Stelle, an der es benutzt wird. Vergisst man
 * den Block, verschwinden die Meldungen dieses Bildschirms lautlos — nichts
 * schlägt fehl, es passiert nur nichts.
 *
 * Der Kanal hier dreht das um: Er lebt als @Singleton neben den ViewModels
 * (dasselbe Muster wie [SessionExpiredSignal], das den OkHttp-Interceptor mit
 * dem ViewModel verbindet). Wer melden will, spritzt ihn sich ein; wer anzeigt,
 * sammelt ihn an einer Stelle. Ein neues ViewModel braucht dafür nichts weiter
 * als den Konstruktorparameter.
 *
 * ── Warum der schreibbare Fluss offenliegt ──────────────────────────────────
 * `fluss` ist absichtlich der MutableStateFlow selbst und nicht hinter
 * zeige()/quittiere() versteckt: Die ViewModels halten ihn unter ihrem
 * bisherigen Namen `_snackbar` weiter, damit die rund sechzig Schreibstellen
 * in den Feature-Dateien unverändert bleiben. Ein Umbau, der gleichzeitig den
 * Kanal einführt UND sechzig Aufrufstellen umschreibt, wäre nicht mehr
 * nachvollziehbar — und die Aussage dieser Änderung ist der Kanal.
 */
@Singleton
class MeldungsKanal @Inject constructor() {

    /** Der geteilte Fluss. Null heisst: nichts anzuzeigen. */
    val fluss = MutableStateFlow<String?>(null)

    /** Nur-Lese-Sicht für die Anzeige. */
    val meldung: StateFlow<String?> = fluss.asStateFlow()
}
