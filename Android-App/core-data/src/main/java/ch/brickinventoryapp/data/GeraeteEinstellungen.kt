package ch.brickinventoryapp.data

import kotlinx.coroutines.flow.Flow

/** Die Lagen, in denen Bilder vorgewärmt werden dürfen; je eine eigene Erlaubnis. */
enum class VorwaermNetz { WLAN, MOBIL, ROAMING }

/**
 * Einstellungen, die nur dieses Gerät betreffen, nicht das Konto. Eine schmale
 * Schnittstelle statt der GeraeteAblage, damit ViewModels sie ohne Android prüfen
 * und Bereiche keine DataStore-Schlüssel kennen.
 */
interface GeraeteEinstellungen {
    val alarmMeldungenAn: Flow<Boolean>
    suspend fun setzeAlarmMeldungen(an: Boolean)
    fun vorwaermenErlaubt(netz: VorwaermNetz): Flow<Boolean>
    suspend fun setzeVorwaermen(netz: VorwaermNetz, erlaubt: Boolean)
}

/** Plant den stündlichen Preisalarm ein oder aus; meldet einen Fehlschlag zurück, statt zu werfen. */
interface AlarmPlaner {
    suspend fun einplanen(an: Boolean): Throwable?
}
