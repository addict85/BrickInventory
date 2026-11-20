package ch.brickinventoryapp.state.ui.viewmodel

import androidx.lifecycle.ViewModel
import ch.brickinventoryapp.data.Verbindungsabwurf
import ch.brickinventoryapp.data.Vertrauensablage
import ch.brickinventoryapp.state.ui.UserCaToggle
import ch.brickinventoryapp.security.CertificateQuestion
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
    private val drop: Verbindungsabwurf,
    private val certificateQuestion: CertificateQuestion,
) : ViewModel() {

    /** Das Zertifikat, das auf Ja oder Nein wartet (CertificateDialog). */
    val zertifikat = certificateQuestion.offen

    /** Auch nutzerinstallierte CAs; an nur nach Bestätigung. */
    val userCa = UserCaToggle(
        lies = prefs::userCaAllowed,
        schreibe = prefs::setUserCa,
        afterChange = drop::discard,
    )

    /** Ja zum gezeigten Zertifikat. Ohne bekannte CA oder geändert nur mit [eingabe]. */
    fun trustCertificate(eingabe: String? = null): Boolean {
        if (!certificateQuestion.confirm(prefs, eingabe)) return false
        drop.discard()
        return true
    }

    fun discardCertificate() = certificateQuestion.verwerfen()
}
