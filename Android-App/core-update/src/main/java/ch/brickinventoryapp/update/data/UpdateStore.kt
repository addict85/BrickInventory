package ch.brickinventoryapp.update.data

import android.content.Context
import androidx.core.content.edit
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import ch.brickinventoryapp.data.DevicesStore
import ch.brickinventoryapp.update.util.UpdateStatus
import ch.brickinventoryapp.update.util.UpdateStatusStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.first
import javax.inject.Inject

/** The self-update's benchmark (util/UpdateFresh.kt), per device in the DataStore. */
internal class UpdateStore @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val dataStore: DataStore<Preferences>,
) : UpdateStatusStore {
    private companion object {
        const val UPDATE_ON_START = "update_beim_start"

        /**
         * The highest versionCode seen and the latest issue time of a
         * current update description (util/UpdateFresh.kt). Per device; signing out
         * leaves it as is, otherwise it would reset the benchmark for a withholding.
         */
        val UPDATE_HIGHEST_CODE = intPreferencesKey("update_hoechster_code")
        val UPDATE_ISSUED = longPreferencesKey("update_ausgestellt")
    }

    override suspend fun updateStatus(): UpdateStatus? {
        val p = dataStore.data.first()
        val code = p[UPDATE_HIGHEST_CODE] ?: return null
        return UpdateStatus(code, p[UPDATE_ISSUED] ?: 0L)
    }

    override suspend fun rememberUpdateStatus(state: UpdateStatus) {
        dataStore.edit {
            it[UPDATE_HIGHEST_CODE] = state.highestCode
            it[UPDATE_ISSUED] = state.issued
        }
    }

    /** Synchronously readable like the design: mirroring DevicesStore. */
    private val mirror by lazy {
        context.getSharedPreferences(DevicesStore.DESIGN_MIRROR_FILE, Context.MODE_PRIVATE)
    }

    override fun startCheckEnabled(): Boolean = mirror.getBoolean(UPDATE_ON_START, true)
    override fun setStartCheck(an: Boolean) {
        mirror.edit { putBoolean(UPDATE_ON_START, an) }
    }
}
