package ch.brickinventoryapp.state.ui.viewmodel

import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.MutableStateFlow
import ch.brickinventoryapp.data.cache.Vorschauablage
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.AlarmPlanner
import ch.brickinventoryapp.data.DevicesSettings
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.VorwaermNetwork
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.model.ui.Meldung
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * This device's settings (price-alert notifications, networks for warming up). The
 * screens only show state and report wishes; writing and scheduling
 * run here, in the viewModelScope, and so survive leaving the page.
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

    /** Default until the first read: Wi-Fi only. */
    val vorwaermen: StateFlow<Map<VorwaermNetwork, Boolean>> = combine(
        VorwaermNetwork.entries.map { netz -> einstellungen.warmUpAllowed(netz) },
    ) { werte -> VorwaermNetwork.entries.zip(werte.toList()).toMap() }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(ABO_FOLLOW_UP_MS), WARM_UP_DEFAULT)

    /**
     * The wish applies immediately, even if scheduling fails; the failure
     * comes with class and message into the snackbar, so „on“ without effect stands out.
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

    /** Occupied space of the preview cache; nobody but the user clears it. */
    val storeBytes: StateFlow<Long> = _storeBytes.asStateFlow()

    /** Fills up again while scrolling; nothing is left offline afterwards. */
    fun clearStore() {
        vorschau.leeren()
        _storeBytes.value = vorschau.belegt()
        meldungen.zeige(Meldung.Resource(R.string.monitoring_cache_saved))
    }

    companion object {
        val WARM_UP_DEFAULT: Map<VorwaermNetwork, Boolean> =
            mapOf(VorwaermNetwork.WLAN to true, VorwaermNetwork.MOBILE to false, VorwaermNetwork.ROAMING to false)

        /** A rotation doesn't end the subscription; only leaving the page lets the store rest. */
        private const val ABO_FOLLOW_UP_MS = 5_000L
    }
}
