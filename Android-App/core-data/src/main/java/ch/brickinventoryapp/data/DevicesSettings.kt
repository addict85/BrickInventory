package ch.brickinventoryapp.data

import kotlinx.coroutines.flow.Flow

/** Die Lagen, in denen Bilder vorgewärmt werden dürfen; je eine eigene Erlaubnis. */
enum class VorwaermNetwork { WLAN, MOBILE, ROAMING }

/**
 * Einstellungen, die nur dieses Gerät betreffen, nicht das Konto. Eine schmale
 * Schnittstelle statt der DevicesStore, damit ViewModels sie ohne Android prüfen
 * und Bereiche keine DataStore-Schlüssel kennen.
 */
interface DevicesSettings {
    val alarmMessagesAn: Flow<Boolean>
    suspend fun setAlarmMessages(an: Boolean)
    fun warmUpAllowed(netz: VorwaermNetwork): Flow<Boolean>
    suspend fun warmUpSet(netz: VorwaermNetwork, erlaubt: Boolean)
}

/** Plant den stündlichen Preisalarm ein oder aus; meldet einen Fehlschlag zurück, statt zu werfen. */
interface AlarmPlanner {
    suspend fun einplanen(an: Boolean): Throwable?
}
