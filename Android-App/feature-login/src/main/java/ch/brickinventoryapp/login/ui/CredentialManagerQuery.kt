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
 * [PasskeyQuery] via the Android Credential Manager. The system's picker
 * dialog attaches to the Activity behind [context]. Android only hands out
 * a domain's passkeys if its assetlinks.json names this app
 * (PASSKEY_ANDROID_ZERTIFIKATE on the server).
 */
internal class CredentialManagerQuery(context: Context) : PasskeyQuery {

    // The app's language choice puts a ContextWrapper around the Activity.
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
