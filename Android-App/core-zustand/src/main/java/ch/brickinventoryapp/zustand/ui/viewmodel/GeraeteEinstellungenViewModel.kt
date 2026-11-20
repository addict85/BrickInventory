package ch.brickinventoryapp.zustand.ui.viewmodel

import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.MutableStateFlow
import ch.brickinventoryapp.data.cache.Vorschauablage
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.AlarmPlanner
import ch.brickinventoryapp.data.DevicesSettings
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.VorwaermNetwork
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.model.ui.Meldung
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Einstellungen dieses Geräts (Preisalarm-Meldungen, Netze fürs Vorwärmen). Die
 * Bildschirme zeigen nur Zustand und melden Wünsche; Schreiben und Einplanen
 * laufen hier, im viewModelScope, und überleben so das Verlassen der Seite.
 */
@HiltViewModel
class GeraeteEinstellungenViewModel @Inject constructor(
    private val einstellungen: DevicesSettings,
    private val planner: AlarmPlanner,
    private val meldungen: MeldungsKanal,
    private val vorschau: Vorschauablage,
) : ViewModel() {

    val alarmMessagesAn: StateFlow<Boolean> =
        einstellungen.alarmMessagesAn.stateIn(viewModelScope, SharingStarted.WhileSubscribed(ABO_FOLLOW_UP_MS), false)

    /** Vorgabe bis zum ersten Lesen: nur WLAN. */
    val vorwaermen: StateFlow<Map<VorwaermNetwork, Boolean>> = combine(
        VorwaermNetwork.entries.map { netz -> einstellungen.warmUpAllowed(netz) },
    ) { werte -> VorwaermNetwork.entries.zip(werte.toList()).toMap() }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(ABO_FOLLOW_UP_MS), WARM_UP_DEFAULT)

    /**
     * Der Wunsch gilt sofort, auch wenn das Einplanen scheitert; der Fehlschlag
     * kommt mit Klasse und Meldung in die Snackbar, damit „an“ ohne Wirkung auffällt.
     */
    fun alarmMessages(an: Boolean) {
        viewModelScope.launch {
            einstellungen.setAlarmMessages(an)
            val fehler = planner.einplanen(an) ?: return@launch
            meldungen.zeige(Meldung.Resource(R.string.alert_schedule_failed,
                listOf("${fehler::class.java.simpleName}: ${fehler.message ?: "—"}")))
        }
    }

    fun vorwaermen(netz: VorwaermNetwork, erlaubt: Boolean) {
        viewModelScope.launch { einstellungen.warmUpSet(netz, erlaubt) }
    }

    private val _storeBytes = MutableStateFlow(vorschau.belegt())

    /** Belegter Platz der Vorschau-Ablage; sie räumt niemand ausser dem Nutzer. */
    val storeBytes: StateFlow<Long> = _storeBytes.asStateFlow()

    /** Füllt sich beim Blättern wieder; offline ist danach nichts mehr da. */
    fun clearStore() {
        vorschau.leeren()
        _storeBytes.value = vorschau.belegt()
        meldungen.zeige(Meldung.Resource(R.string.monitoring_cache_saved))
    }

    companion object {
        val WARM_UP_DEFAULT: Map<VorwaermNetwork, Boolean> =
            mapOf(VorwaermNetwork.WLAN to true, VorwaermNetwork.MOBILE to false, VorwaermNetwork.ROAMING to false)

        /** Eine Drehung beendet das Abo nicht; erst wer die Seite verlässt, lässt die Ablage ruhen. */
        private const val ABO_FOLLOW_UP_MS = 5_000L
    }
}
