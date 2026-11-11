package ch.brickinventoryapp.zustand.ui

import androidx.lifecycle.ViewModel
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.PasswortPflicht
import ch.brickinventoryapp.data.ZweiterFaktorPflicht
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import ch.brickinventoryapp.model.ui.ScrollMemory

/**
 * Was MainActivity zeigt: Sitzung, Snackbar, die Pflichtmasken und das Ziel einer
 * angetippten Meldung. Die Arbeit der Sitzung macht der [SitzungsRepository]; er
 * lebt im Bereich der App und startet mit ihr (BrickInventoryApp), nicht mit diesem ViewModel.
 */
@HiltViewModel
class AppViewModel @Inject constructor(
    private val sitzungsDienst: SitzungsRepository,
    private val meldungen: MeldungsKanal,
    sitzung: Sitzung,
    blickfeldDienst: Blickfeld,
    val scrollMemory: ScrollMemory,
    ausgangsmelder: Ausgangsmelder,
    passwortPflicht: PasswortPflicht,
    zweiterFaktorPflicht: ZweiterFaktorPflicht,
) : ViewModel() {

    val state: StateFlow<AppUiState> = sitzung.state

    val snackbar = meldungen.meldung

    /** Offline gespeicherte Änderungen, die noch zum Server müssen — für die Leiste im Gerüst. */
    val offeneAenderungen: StateFlow<Int> = ausgangsmelder.offene
    fun clearSnackbar() { meldungen.quittiere() }

    /** Mit Startpasswort zeigt MainActivity statt der App die Maske zum Ersetzen. */
    val startpasswortNoetig: StateFlow<Boolean> = passwortPflicht.noetig

    /** Verwalterrechte ohne zweiten Faktor: MainActivity zeigt dessen Einrichtung. */
    val zweiterFaktorNoetig: StateFlow<Boolean> = zweiterFaktorPflicht.noetig

    val blickfeld = blickfeldDienst.konten
    val lagerState = blickfeldDienst.lager

    private val _meldungsZiel = MutableStateFlow(MeldungsZielUiState())
    val meldungsZiel: StateFlow<MeldungsZielUiState> = _meldungsZiel.asStateFlow()

    fun zweiterFaktorEingerichtet() = sitzungsDienst.zweiterFaktorEingerichtet()

    fun logout(): Job = sitzungsDienst.abmelden()

    fun loadHouseholdMembers() = sitzungsDienst.ladeMitglieder()

    fun loadLagerorte() = sitzungsDienst.ladeLagerorte()

    fun loadSettings() = sitzungsDienst.ladeEinstellungen()

    // ── Meldung angetippt ────────────────────────────────────────────────────

    /** Der Intent kommt am Rand der App an, und dieser Rand ist die Activity. */
    fun setAusMeldungAnfordern(setNummer: String?) {
        // Auch hier geprüft: Die Nummer wird Teil einer Navigationsroute.
        val sn = setnummerAusMeldung(setNummer) ?: return
        _meldungsZiel.value = MeldungsZielUiState(sn)
    }

    /** Erledigt — sonst springt die App bei der nächsten Rekomposition erneut. */
    fun setAusMeldungQuittieren() {
        _meldungsZiel.value = MeldungsZielUiState(null)
    }
}
