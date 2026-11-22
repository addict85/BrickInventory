package ch.brickinventoryapp.data

import kotlinx.coroutines.flow.Flow

/** The situations in which images may be warmed; each with its own permission. */
enum class PrewarmNetwork { WIFI, MOBILE, ROAMING }

/**
 * Settings that concern only this device, not the account. A narrow
 * interface instead of the DevicesStore so that ViewModels can check them without Android
 * and areas know no DataStore keys.
 */
interface DevicesSettings {
    val alarmMessagesEnabled: Flow<Boolean>
    suspend fun setAlarmMessages(an: Boolean)
    fun warmUpAllowed(network: PrewarmNetwork): Flow<Boolean>
    suspend fun warmUpSet(network: PrewarmNetwork, allowed: Boolean)
}

/** Schedules the hourly price alert on or off; reports a failure back instead of throwing. */
interface AlarmPlanner {
    suspend fun schedule(an: Boolean): Throwable?
}
