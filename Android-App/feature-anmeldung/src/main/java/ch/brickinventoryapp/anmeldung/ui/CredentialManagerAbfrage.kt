package ch.brickinventoryapp.anmeldung.ui

import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException

/**
 * [PasskeyAbfrage] über den Android Credential Manager. Der Auswahldialog des
 * Systems hängt sich an die Activity hinter [context]. Android gibt
 * die Passkeys der Domain nur heraus, wenn ihr assetlinks.json diese App nennt
 * (PASSKEY_ANDROID_ZERTIFIKATE auf dem Server).
 */
class CredentialManagerAbfrage(context: Context) : PasskeyAbfrage {

    // Die Sprachwahl der App legt einen ContextWrapper um die Activity.
    private val activity: Context = generateSequence(context) { (it as? android.content.ContextWrapper)?.baseContext }
        .firstOrNull { it is android.app.Activity } ?: context

    override suspend fun hole(optionenJson: String): PasskeyErgebnis = try {
        val antwort = CredentialManager.create(activity).getCredential(
            activity, GetCredentialRequest(listOf(GetPublicKeyCredentialOption(optionenJson))))
        when (val c = antwort.credential) {
            is PublicKeyCredential -> PasskeyErgebnis.Antwort(c.authenticationResponseJson)
            else -> PasskeyErgebnis.Fehler(c.type)
        }
    } catch (_: GetCredentialCancellationException) {
        PasskeyErgebnis.Abgebrochen
    } catch (_: NoCredentialException) {
        PasskeyErgebnis.KeinPasskey
    } catch (e: GetCredentialException) {
        PasskeyErgebnis.Fehler(e.type)
    }
}
