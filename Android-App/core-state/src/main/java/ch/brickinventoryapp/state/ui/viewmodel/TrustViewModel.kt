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

    /** Yes to the shown certificate; except for a code deviation only with a matching [input]. */
    fun trustCertificate(input: String? = null): Boolean {
        if (!certificateQuestion.confirm(prefs, input)) return false
        drop.discard()
        return true
    }

    /** Yes by the scanned certificate code; anything but a full match trusts nothing. */
    fun trustByCode(payload: String?): CodeCheck =
        certificateQuestion.confirmByCode(prefs, payload).also { if (it == CodeCheck.MATCHES) drop.discard() }

    fun discardCertificate() = certificateQuestion.discard()
}
