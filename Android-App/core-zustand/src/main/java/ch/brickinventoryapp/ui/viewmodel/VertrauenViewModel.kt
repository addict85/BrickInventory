package ch.brickinventoryapp.ui.viewmodel

import androidx.lifecycle.ViewModel
import ch.brickinventoryapp.data.PreferencesManager
import ch.brickinventoryapp.ui.NutzerCaSchalter
import ch.brickinventoryapp.util.ZertifikatsFrage
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import javax.inject.Named
import okhttp3.OkHttpClient

/**
 * Wem die App beim eigenen Server vertraut: ein gezeigtes Zertifikat und die
 * Nutzer-CAs. Den API-Client kennt nur dieses ViewModel; es verwirft seine offenen
 * Verbindungen, sobald sich das Vertrauen ändert.
 */
@HiltViewModel
class VertrauenViewModel @Inject constructor(
    private val prefs: PreferencesManager,
    @param:Named("api") private val apiHttpClient: OkHttpClient,
    private val zertifikatsFrage: ZertifikatsFrage,
) : ViewModel() {

    /** Das Zertifikat, das auf Ja oder Nein wartet (ZertifikatDialog). */
    val zertifikat = zertifikatsFrage.offen

    /** Auch nutzerinstallierte CAs; an nur nach Bestätigung. */
    val nutzerCa = NutzerCaSchalter(
        lies = prefs::nutzerCaErlaubt,
        schreibe = prefs::setzeNutzerCa,
        nachAenderung = { apiHttpClient.connectionPool.evictAll() },
    )

    /** Ja zum gezeigten Zertifikat. Ohne bekannte CA oder geändert nur mit [eingabe]. */
    fun zertifikatVertrauen(eingabe: String? = null): Boolean {
        if (!zertifikatsFrage.bestaetige(prefs, eingabe)) return false
        apiHttpClient.connectionPool.evictAll()
        return true
    }

    fun zertifikatVerwerfen() = zertifikatsFrage.verwerfen()
}
