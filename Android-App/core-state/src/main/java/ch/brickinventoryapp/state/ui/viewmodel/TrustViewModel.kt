package ch.brickinventoryapp.state.ui.viewmodel

import androidx.lifecycle.ViewModel
import ch.brickinventoryapp.data.ConnectionDrop
import ch.brickinventoryapp.data.TrustStore
import ch.brickinventoryapp.security.CertificateQuestion
import ch.brickinventoryapp.security.CertificateQuestion.CodeCheck
import ch.brickinventoryapp.state.ui.UserCaToggle
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

/**
 * Whom the app trusts for its own server: a shown certificate and the
 * user CAs. If trust changes, it discards the API client's open
 * connections; they carried the old one.
 */
@HiltViewModel
class TrustViewModel @Inject constructor(
    private val prefs: TrustStore,
    private val drop: ConnectionDrop,
    private val certificateQuestion: CertificateQuestion,
) : ViewModel() {

    /** The certificate that is waiting for yes or no (CertificateDialog). */
    val certificate = certificateQuestion.open

    /** Also user-installed CAs; on only after confirmation. */
    val userCa = UserCaToggle(
        read = prefs::userCaAllowed,
        write = prefs::setUserCa,
        afterChange = drop::discard,
    )

    /**
     * Yes to the shown certificate. Without a known CA or when changed, only with [input];
     * a new key from Android 16 only with [deviceConfirmed] (screen lock just passed).
     */
    fun trustCertificate(input: String? = null, deviceConfirmed: Boolean = false): Boolean {
        if (!certificateQuestion.confirm(prefs, input, deviceConfirmed)) return false
        drop.discard()
        return true
    }

    /** Yes by the scanned certificate code; anything but a full match trusts nothing. */
    fun trustByCode(payload: String?): CodeCheck =
        certificateQuestion.confirmByCode(prefs, payload).also { if (it == CodeCheck.MATCHES) drop.discard() }

    fun discardCertificate() = certificateQuestion.discard()
}
