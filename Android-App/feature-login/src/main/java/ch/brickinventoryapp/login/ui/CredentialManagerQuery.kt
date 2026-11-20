package ch.brickinventoryapp.login.ui

import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException

/**
 * [PasskeyQuery] über den Android Credential Manager. Der Auswahldialog des
 * Systems hängt sich an die Activity hinter [context]. Android gibt
 * die Passkeys der Domain nur heraus, wenn ihr assetlinks.json diese App nennt
 * (PASSKEY_ANDROID_ZERTIFIKATE auf dem Server).
 */
internal class CredentialManagerQuery(context: Context) : PasskeyQuery {

    // Die Sprachwahl der App legt einen ContextWrapper um die Activity.
    private val activity: Context = generateSequence(context) { (it as? android.content.ContextWrapper)?.baseContext }
        .firstOrNull { it is android.app.Activity } ?: context

    override suspend fun fetch(optionsJson: String): PasskeyResult = try {
        val antwort = CredentialManager.create(activity).getCredential(
            activity, GetCredentialRequest(listOf(GetPublicKeyCredentialOption(optionsJson))))
        when (val c = antwort.credential) {
            is PublicKeyCredential -> PasskeyResult.Antwort(c.authenticationResponseJson)
            else -> PasskeyResult.Fehler(c.type)
        }
    } catch (_: GetCredentialCancellationException) {
        PasskeyResult.Abgebrochen
    } catch (_: NoCredentialException) {
        PasskeyResult.NoPasskey
    } catch (e: GetCredentialException) {
        PasskeyResult.Fehler(e.type)
    }
}
