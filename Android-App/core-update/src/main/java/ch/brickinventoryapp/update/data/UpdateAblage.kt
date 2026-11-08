package ch.brickinventoryapp.update.data

import android.content.Context
import androidx.core.content.edit
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import ch.brickinventoryapp.update.util.UpdateStand
import ch.brickinventoryapp.update.util.UpdateStandAblage
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.first
import javax.inject.Inject
import ch.brickinventoryapp.data.GeraeteAblage

/** Die Messlatte der Selbstaktualisierung (util/UpdateFrische.kt), je Gerät im DataStore. */
internal class UpdateAblage @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val dataStore: DataStore<Preferences>,
) : UpdateStandAblage {
    private companion object {
        const val UPDATE_BEIM_START = "update_beim_start"

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

    /** Synchron lesbar wie das Design: im Spiegel der GeraeteAblage. */
    private val spiegel by lazy {
        context.getSharedPreferences(GeraeteAblage.DESIGN_SPIEGEL_DATEI, Context.MODE_PRIVATE)
    }

    override fun startpruefungAn(): Boolean = spiegel.getBoolean(UPDATE_BEIM_START, true)
    override fun setzeStartpruefung(an: Boolean) {
        spiegel.edit { putBoolean(UPDATE_BEIM_START, an) }
    }
}
