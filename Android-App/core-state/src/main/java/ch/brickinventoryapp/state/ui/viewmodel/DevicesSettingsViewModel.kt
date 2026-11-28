package ch.brickinventoryapp.state.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.cache.PreviewStore
import ch.brickinventoryapp.dataapi.device.AlarmPlanner
import ch.brickinventoryapp.dataapi.device.DevicesSettings
import ch.brickinventoryapp.dataapi.device.PrewarmNetwork
import ch.brickinventoryapp.dataapi.message.MessageChannel
import ch.brickinventoryapp.model.text.Message
import ch.brickinventoryapp.resources.R
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
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
class DevicesSettingsViewModel @Inject constructor(
    private val settings: DevicesSettings,
    private val planner: AlarmPlanner,
    private val messages: MessageChannel,
    private val preview: PreviewStore,
) : ViewModel() {

    val alarmMessagesEnabled: StateFlow<Boolean> =
        settings.alarmMessagesEnabled.stateIn(viewModelScope, SharingStarted.WhileSubscribed(ABO_FOLLOW_UP_MS), false)

    /** Default until the first read: Wi-Fi only. */
    val prewarm: StateFlow<Map<PrewarmNetwork, Boolean>> = combine(
        PrewarmNetwork.entries.map { network -> settings.warmUpAllowed(network) },
    ) { values -> PrewarmNetwork.entries.zip(values.toList()).toMap() }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(ABO_FOLLOW_UP_MS), WARM_UP_DEFAULT)

    /**
     * The wish applies immediately, even if scheduling fails; the failure
     * comes with class and message into the snackbar, so „on“ without effect stands out.
     */
    fun alarmMessages(an: Boolean) {
        viewModelScope.launch {
            settings.setAlarmMessages(an)
            val error = planner.schedule(an) ?: return@launch
            messages.show(Message.Resource(R.string.alert_schedule_failed,
                listOf("${error::class.java.simpleName}: ${error.message ?: "—"}")))
        }
    }

    fun prewarm(network: PrewarmNetwork, allowed: Boolean) {
        viewModelScope.launch { settings.warmUpSet(network, allowed) }
    }

    private val _storeBytes = MutableStateFlow(preview.occupied())

    /** Occupied space of the preview cache; nobody but the user clears it. */
    val storeBytes: StateFlow<Long> = _storeBytes.asStateFlow()

    /** Fills up again while scrolling; nothing is left offline afterwards. */
    fun clearStore() {
        preview.clearAll()
        _storeBytes.value = preview.occupied()
        messages.show(Message.Resource(R.string.monitoring_cache_saved))
    }

    companion object {
        val WARM_UP_DEFAULT: Map<PrewarmNetwork, Boolean> =
            mapOf(PrewarmNetwork.WIFI to true, PrewarmNetwork.MOBILE to false, PrewarmNetwork.ROAMING to false)

        /** A rotation doesn't end the subscription; only leaving the page lets the store rest. */
        private const val ABO_FOLLOW_UP_MS = 5_000L
    }
}
