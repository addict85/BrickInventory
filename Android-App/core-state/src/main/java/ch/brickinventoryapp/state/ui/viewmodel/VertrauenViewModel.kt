package ch.brickinventoryapp.state.ui.viewmodel

import androidx.lifecycle.ViewModel
import ch.brickinventoryapp.data.Verbindungsabwurf
import ch.brickinventoryapp.data.Vertrauensablage
import ch.brickinventoryapp.state.ui.UserCaToggle
import ch.brickinventoryapp.security.CertificateQuestion
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

/**
 * Whom the app trusts for its own server: a shown certificate and the
 * user CAs. If trust changes, it discards the API client's open
 * connections; they carried the old one.
 */
@HiltViewModel
class VertrauenViewModel @Inject constructor(
    private val prefs: Vertrauensablage,
    private val drop: Verbindungsabwurf,
    private val certificateQuestion: CertificateQuestion,
) : ViewModel() {

    /** The certificate that is waiting for yes or no (CertificateDialog). */
    val zertifikat = certificateQuestion.offen

    /** Also user-installed CAs; on only after confirmation. */
    val userCa = UserCaToggle(
        lies = prefs::userCaAllowed,
        schreibe = prefs::setUserCa,
        afterChange = drop::discard,
    )

    /**
     * Yes to the shown certificate. Without a known CA or when changed, only with [eingabe];
     * a new key from Android 16 only with [deviceConfirmed] (screen lock just passed).
     */
    fun trustCertificate(eingabe: String? = null, deviceConfirmed: Boolean = false): Boolean {
        if (!certificateQuestion.confirm(prefs, eingabe, deviceConfirmed)) return false
        drop.discard()
        return true
    }

    fun discardCertificate() = certificateQuestion.verwerfen()
}
