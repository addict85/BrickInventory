package ch.brickinventoryapp.ui.viewmodel

import androidx.lifecycle.ViewModel
import ch.brickinventoryapp.data.Verbindungsabwurf
import ch.brickinventoryapp.data.Vertrauensablage
import ch.brickinventoryapp.ui.NutzerCaSchalter
import ch.brickinventoryapp.util.ZertifikatsFrage
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

/**
 * Wem die App beim eigenen Server vertraut: ein gezeigtes Zertifikat und die
 * Nutzer-CAs. Ändert sich das Vertrauen, verwirft es die offenen Verbindungen des
 * API-Clients; sie trugen das alte.
 */
@HiltViewModel
class VertrauenViewModel @Inject constructor(
    private val prefs: Vertrauensablage,
    private val abwurf: Verbindungsabwurf,
    private val zertifikatsFrage: ZertifikatsFrage,
) : ViewModel() {

    /** Das Zertifikat, das auf Ja oder Nein wartet (ZertifikatDialog). */
    val zertifikat = zertifikatsFrage.offen

    /** Auch nutzerinstallierte CAs; an nur nach Bestätigung. */
    val nutzerCa = NutzerCaSchalter(
        lies = prefs::nutzerCaErlaubt,
        schreibe = prefs::setzeNutzerCa,
        nachAenderung = abwurf::verwirf,
    )

    /** Ja zum gezeigten Zertifikat. Ohne bekannte CA oder geändert nur mit [eingabe]. */
    fun zertifikatVertrauen(eingabe: String? = null): Boolean {
        if (!zertifikatsFrage.bestaetige(prefs, eingabe)) return false
        abwurf.verwirf()
        return true
    }

    fun zertifikatVerwerfen() = zertifikatsFrage.verwerfen()
}
