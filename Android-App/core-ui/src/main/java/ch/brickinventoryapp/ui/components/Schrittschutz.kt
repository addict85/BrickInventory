package ch.brickinventoryapp.ui.components

import android.app.KeyguardManager
import ch.brickinventoryapp.ui.theme.fensterFlaeche
import android.os.SystemClock
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.res.stringResource
import androidx.core.content.ContextCompat
import androidx.core.content.getSystemService
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.lifecycleScope
import ch.brickinventoryapp.model.step.Schrittaktion
import ch.brickinventoryapp.model.step.Schrittbindung
import ch.brickinventoryapp.resources.R
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import java.security.Signature
import kotlin.coroutines.resume

/**
 * Asks for the screen lock before a sensitive step (voucher PIN, recovery codes, management):
 * whoever briefly holds the unlocked phone shouldn't get
 * further there. [weiter] only runs after confirmation.
 */
fun interface Schrittschutz {
    fun confirm(grund: String, weiter: () -> Unit)

    /** For a step the server checks: the confirmation only applies there to [aktion]. */
    fun confirm(grund: String, aktion: Schrittaktion, weiter: () -> Unit) = confirm(grund, weiter)
}

/** The same protection, always for [aktion]: this keeps calls with two arguments bound to the server. */
fun Schrittschutz.fuer(aktion: Schrittaktion): Schrittschutz {
    val basis = this
    return Schrittschutz { grund, weiter -> basis.confirm(grund, aktion, weiter) }
}

/**
 * Without a provider, nothing happens: if an activity forgot it, the protection
 * would otherwise be silently off. MainActivity sets [DevicesStepProtection], tests their own.
 */
val LocalSchrittschutz = staticCompositionLocalOf { Schrittschutz { _, _ -> } }

/**
 * Fingerprint (strong biometrics), otherwise the device's PIN, pattern or password. Without
 * a lock, there's nothing to check; then [withoutLock] warns, instead of silently letting it through.
 * Confirmed is only what the Keystore releases and, for a [Schrittaktion] with
 * an identifier, what the server accepts with the signature over its challenge ([Schrittablauf]).
 */
// [subtitle] and [noKey] come from outside: below Android 13 the
// activity carries the system language instead of the app's, core-ui doesn't know the localized context.
class DevicesStepProtection(
    private val activity: FragmentActivity,
    private val noKey: () -> Unit = {},
    private val bindung: Schrittbindung = Schrittbindung.OHNE,
    /** The server rejected it; null: no response. */
    private val abgelehnt: (meldung: String?) -> Unit = {},
    /** The device cannot generate a key with attestation; sensitive steps then only work in the web app. */
    private val withoutAttestation: () -> Unit = {},
    private val subtitle: () -> String,
) : Schrittschutz {
    // Per action: the release on the server also applies only to one.
    private val deadlines = mutableMapOf<Schrittaktion, Bestaetigungsfrist>()
    private val flow = Schrittablauf(bindung, Schrittfreigabe(DevicesKey::oeffentlich))

    /** The follow-up question without a screen lock; MainActivity shows it with [WithoutLockWarning]. */
    val withoutLock = WithoutLock()

    /** On leaving the app (MainActivity.onStop): asked again afterwards. */
    fun vergiss() = deadlines.values.forEach(Bestaetigungsfrist::vergiss)

    /** After signing in: only then does the server accept the key ([Schluesselbindung]). */
    fun bindAnServer() {
        if (activity.getSystemService<KeyguardManager>()?.isDeviceSecure != true) return
        activity.lifecycleScope.launch {
            when (val a = Schluesselbindung(bindung, DevicesKey).bind()) {
                Schluesselbindung.Ausgang.Gebunden -> Unit
                Schluesselbindung.Ausgang.WithoutAttestation -> withoutAttestation()
                is Schluesselbindung.Ausgang.Rejected -> a.meldung?.let(abgelehnt)
            }
        }
    }

    override fun confirm(grund: String, weiter: () -> Unit) = confirm(grund, Schrittaktion.LOKAL, weiter)

    override fun confirm(grund: String, aktion: Schrittaktion, weiter: () -> Unit) {
        val deadline = deadlines.getOrPut(aktion) { Bestaetigungsfrist(clock = SystemClock::elapsedRealtime) }
        if (deadline.gilt()) {
            weiter()
            return
        }
        if (activity.getSystemService<KeyguardManager>()?.isDeviceSecure != true) {
            withoutLock.frage(grund) { deadline.confirmed(); weiter() }
            return
        }
        // Without a bound key, no proceeding: a fallback to the bare follow-up question
        // would be exactly the path a hooked-up callback opens.
        val signatur = runCatching { DevicesKey.signatur() }.getOrNull() ?: return noKey()
        activity.lifecycleScope.launch {
            when (val a = flow.confirm(aktion) { unlock(grund, signatur) }) {
                Schrittablauf.Ausgang.Weiter -> { deadline.confirmed(); weiter() }
                Schrittablauf.Ausgang.Abgebrochen -> Unit
                is Schrittablauf.Ausgang.Rejected -> abgelehnt(a.meldung)
            }
        }
    }

    /** The signature released by the Keystore; null on cancellation or a lock error. */
    private suspend fun unlock(grund: String, signatur: Signature): Signature? = suspendCancellableCoroutine { weiter ->
        val callback = object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                if (weiter.isActive) weiter.resume(result.cryptoObject?.signature)
            }
            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                if (weiter.isActive) weiter.resume(null)
            }
        }
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(grund)
            .setSubtitle(subtitle())
            // Since minSdk 30 always strong biometrics or the screen lock, never class-2 face;
            // the Keystore key can release for both (DevicesKey).
            .setAllowedAuthenticators(BIOMETRIC_STRONG or DEVICE_CREDENTIAL)
            .build()
        BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), callback)
            .authenticate(info, BiometricPrompt.CryptoObject(signatur))
    }
}

/**
 * A step that waits without a screen lock: whoever uses a device without a
 * lock should know that PIN, codes and management are there open to anyone who
 * briefly has the phone. A yes counts as a confirmation until the deadline.
 */
class WithoutLock {
    class Waiting(val grund: String, val weiter: () -> Unit)

    var wartet by mutableStateOf<Waiting?>(null)
        private set

    fun frage(grund: String, weiter: () -> Unit) {
        wartet = Waiting(grund, weiter)
    }

    fun fortfahren() {
        val w = wartet ?: return
        wartet = null
        w.weiter()
    }

    fun abbrechen() {
        wartet = null
    }
}

/** The follow-up question for [WithoutLock]; tapping away cancels it, an overlapping tap doesn't count. */
@Composable
fun WithoutLockWarning(withoutLock: WithoutLock) {
    val w = withoutLock.wartet ?: return
    val titel = stringResource(R.string.schritt_ohne_sperre_titel)
    AlertDialog(
        containerColor = fensterFlaeche(),
        onDismissRequest = withoutLock::abbrechen,
        modifier = Modifier.semantics { paneTitle = titel },
        title = { Text(titel, Modifier.semantics { heading() }) },
        text = {
            Ueberdeckungsschutz()
            Text(stringResource(R.string.schritt_ohne_sperre_text, w.grund))
        },
        confirmButton = {
            TextButton(onClick = withoutLock::fortfahren) { Text(stringResource(R.string.schritt_ohne_sperre_weiter)) }
        },
        dismissButton = {
            TextButton(onClick = withoutLock::abbrechen) { Text(stringResource(R.string.common_cancel)) }
        },
    )
}

/**
 * Shows [inhalt] only after confirmation and asks on its own when it opens.
 * If the app leaves the foreground, the area is locked again.
 */
@Composable
fun Schrittsperre(grund: String, aktion: Schrittaktion = Schrittaktion.LOKAL, inhalt: @Composable () -> Unit) {
    // A page behind the screen lock is sensitive: no tap slipped in underneath.
    Ueberdeckungsschutz()
    val basis = LocalSchrittschutz.current
    val protection = remember(basis, aktion) { basis.fuer(aktion) }
    var entsperrt by remember { mutableStateOf(false) }
    val frage = { protection.confirm(grund) { entsperrt = true } }
    LaunchedEffect(protection) { if (!entsperrt) frage() }
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) { entsperrt = false }
    if (entsperrt) {
        inhalt()
    } else {
        Box(Modifier.fillMaxSize(), Alignment.Center) {
            Button(onClick = frage) { Text(stringResource(R.string.schritt_entsperren)) }
        }
    }
}
