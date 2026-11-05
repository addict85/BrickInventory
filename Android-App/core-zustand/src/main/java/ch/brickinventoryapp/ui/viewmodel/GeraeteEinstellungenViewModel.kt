package ch.brickinventoryapp.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.AlarmPlaner
import ch.brickinventoryapp.data.GeraeteEinstellungen
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.VorwaermNetz
import ch.brickinventoryapp.ressourcen.R
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
    private val einstellungen: GeraeteEinstellungen,
    private val planer: AlarmPlaner,
    private val texte: Texte,
    meldungen: MeldungsKanal,
) : ViewModel() {

    private val _snackbar = meldungen.fluss

    val alarmMeldungenAn: StateFlow<Boolean> =
        einstellungen.alarmMeldungenAn.stateIn(viewModelScope, SharingStarted.Eagerly, false)

    /** Vorgabe bis zum ersten Lesen: nur WLAN. */
    val vorwaermen: StateFlow<Map<VorwaermNetz, Boolean>> = combine(
        VorwaermNetz.entries.map { netz -> einstellungen.vorwaermenErlaubt(netz) },
    ) { werte -> VorwaermNetz.entries.zip(werte.toList()).toMap() }
        .stateIn(viewModelScope, SharingStarted.Eagerly, VORWAERMEN_VORGABE)

    /**
     * Der Wunsch gilt sofort, auch wenn das Einplanen scheitert; der Fehlschlag
     * kommt mit Klasse und Meldung in die Snackbar, damit „an“ ohne Wirkung auffällt.
     */
    fun alarmMeldungen(an: Boolean) {
        viewModelScope.launch {
            einstellungen.setzeAlarmMeldungen(an)
            val fehler = planer.einplanen(an) ?: return@launch
            _snackbar.value = texte.text(R.string.alert_schedule_failed,
                "${fehler::class.java.simpleName}: ${fehler.message ?: "—"}")
        }
    }

    fun vorwaermen(netz: VorwaermNetz, erlaubt: Boolean) {
        viewModelScope.launch { einstellungen.setzeVorwaermen(netz, erlaubt) }
    }

    companion object {
        val VORWAERMEN_VORGABE: Map<VorwaermNetz, Boolean> =
            mapOf(VorwaermNetz.WLAN to true, VorwaermNetz.MOBIL to false, VorwaermNetz.ROAMING to false)
    }
}
