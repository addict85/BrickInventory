package ch.brickinventoryapp.zustand.ui.viewmodel

import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.MutableStateFlow
import ch.brickinventoryapp.data.cache.Vorschauablage
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
    private val meldungen: MeldungsKanal,
    private val vorschau: Vorschauablage,
) : ViewModel() {

    val alarmMeldungenAn: StateFlow<Boolean> =
        einstellungen.alarmMeldungenAn.stateIn(viewModelScope, SharingStarted.WhileSubscribed(ABO_NACHLAUF_MS), false)

    /** Vorgabe bis zum ersten Lesen: nur WLAN. */
    val vorwaermen: StateFlow<Map<VorwaermNetz, Boolean>> = combine(
        VorwaermNetz.entries.map { netz -> einstellungen.vorwaermenErlaubt(netz) },
    ) { werte -> VorwaermNetz.entries.zip(werte.toList()).toMap() }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(ABO_NACHLAUF_MS), VORWAERMEN_VORGABE)

    /**
     * Der Wunsch gilt sofort, auch wenn das Einplanen scheitert; der Fehlschlag
     * kommt mit Klasse und Meldung in die Snackbar, damit „an“ ohne Wirkung auffällt.
     */
    fun alarmMeldungen(an: Boolean) {
        viewModelScope.launch {
            einstellungen.setzeAlarmMeldungen(an)
            val fehler = planer.einplanen(an) ?: return@launch
            meldungen.zeige(texte.text(R.string.alert_schedule_failed,
                "${fehler::class.java.simpleName}: ${fehler.message ?: "—"}"))
        }
    }

    fun vorwaermen(netz: VorwaermNetz, erlaubt: Boolean) {
        viewModelScope.launch { einstellungen.setzeVorwaermen(netz, erlaubt) }
    }

    private val _ablageBytes = MutableStateFlow(vorschau.belegt())

    /** Belegter Platz der Vorschau-Ablage; sie räumt niemand ausser dem Nutzer. */
    val ablageBytes: StateFlow<Long> = _ablageBytes.asStateFlow()

    /** Füllt sich beim Blättern wieder; offline ist danach nichts mehr da. */
    fun ablageLeeren() {
        vorschau.leeren()
        _ablageBytes.value = vorschau.belegt()
        meldungen.zeige(texte.text(R.string.monitoring_cache_saved))
    }

    companion object {
        val VORWAERMEN_VORGABE: Map<VorwaermNetz, Boolean> =
            mapOf(VorwaermNetz.WLAN to true, VorwaermNetz.MOBIL to false, VorwaermNetz.ROAMING to false)

        /** Eine Drehung beendet das Abo nicht; erst wer die Seite verlässt, lässt die Ablage ruhen. */
        private const val ABO_NACHLAUF_MS = 5_000L
    }
}
