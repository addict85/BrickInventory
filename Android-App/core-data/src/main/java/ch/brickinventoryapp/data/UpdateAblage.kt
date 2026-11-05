package ch.brickinventoryapp.data

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import ch.brickinventoryapp.util.UpdateStand
import ch.brickinventoryapp.util.UpdateStandAblage
import kotlinx.coroutines.flow.first
import javax.inject.Inject

/** Die Messlatte der Selbstaktualisierung (util/UpdateFrische.kt), je Gerät im DataStore. */
internal class UpdateAblage @Inject constructor(private val dataStore: DataStore<Preferences>) : UpdateStandAblage {
    private companion object {
        /**
         * Der höchste gesehene versionCode und der späteste Ausstellungszeitpunkt einer
         * aktuellen Update-Beschreibung (util/UpdateFrische.kt). Je Gerät; das Abmelden
         * lässt sie stehen, sonst setzte es die Messlatte für ein Zurückhalten zurück.
         */
        val UPDATE_HOECHSTER_CODE = intPreferencesKey("update_hoechster_code")
        val UPDATE_AUSGESTELLT = longPreferencesKey("update_ausgestellt")
    }

    override suspend fun updateStand(): UpdateStand? {
        val p = dataStore.data.first()
        val code = p[UPDATE_HOECHSTER_CODE] ?: return null
        return UpdateStand(code, p[UPDATE_AUSGESTELLT] ?: 0L)
    }

    override suspend fun merkeUpdateStand(stand: UpdateStand) {
        dataStore.edit {
            it[UPDATE_HOECHSTER_CODE] = stand.hoechsterCode
            it[UPDATE_AUSGESTELLT] = stand.ausgestellt
        }
    }
}
