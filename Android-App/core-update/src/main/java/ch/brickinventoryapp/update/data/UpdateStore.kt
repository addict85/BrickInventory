package ch.brickinventoryapp.update.data

import android.content.Context
import androidx.core.content.edit
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import ch.brickinventoryapp.update.util.UpdateStatus
import ch.brickinventoryapp.update.util.UpdateStatusStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.first
import javax.inject.Inject
import ch.brickinventoryapp.data.DevicesStore

/** Die Messlatte der Selbstaktualisierung (util/UpdateFresh.kt), je Gerät im DataStore. */
internal class UpdateStore @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val dataStore: DataStore<Preferences>,
) : UpdateStatusStore {
    private companion object {
        const val UPDATE_ON_START = "update_beim_start"

        /**
         * Der höchste gesehene versionCode und der späteste Ausstellungszeitpunkt einer
         * aktuellen Update-Beschreibung (util/UpdateFresh.kt). Je Gerät; das Abmelden
         * lässt sie stehen, sonst setzte es die Messlatte für ein Zurückhalten zurück.
         */
        val UPDATE_HIGHEST_CODE = intPreferencesKey("update_hoechster_code")
        val UPDATE_ISSUED = longPreferencesKey("update_ausgestellt")
    }

    override suspend fun updateStatus(): UpdateStatus? {
        val p = dataStore.data.first()
        val code = p[UPDATE_HIGHEST_CODE] ?: return null
        return UpdateStatus(code, p[UPDATE_ISSUED] ?: 0L)
    }

    override suspend fun rememberUpdateStatus(stand: UpdateStatus) {
        dataStore.edit {
            it[UPDATE_HIGHEST_CODE] = stand.highestCode
            it[UPDATE_ISSUED] = stand.ausgestellt
        }
    }

    /** Synchron lesbar wie das Design: im Spiegel der DevicesStore. */
    private val spiegel by lazy {
        context.getSharedPreferences(DevicesStore.DESIGN_MIRROR_FILE, Context.MODE_PRIVATE)
    }

    override fun startpruefungAn(): Boolean = spiegel.getBoolean(UPDATE_ON_START, true)
    override fun setStartpruefung(an: Boolean) {
        spiegel.edit { putBoolean(UPDATE_ON_START, an) }
    }
}
