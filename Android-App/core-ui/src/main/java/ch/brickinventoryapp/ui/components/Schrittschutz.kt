package ch.brickinventoryapp.ui.components

import android.app.KeyguardManager
import android.os.Build
import android.os.SystemClock
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.core.content.ContextCompat
import androidx.core.content.getSystemService
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import ch.brickinventoryapp.ressourcen.R

/**
 * Vor einem heiklen Schritt (Gutschein-PIN, Wiederherstellungscodes, Verwaltung)
 * die Gerätesperre fragen: Wer das entsperrte Telefon kurz in der Hand hat, soll
 * dort nicht weiterkommen. [weiter] läuft nur nach Bestätigung.
 */
fun interface Schrittschutz {
    fun bestaetige(grund: String, weiter: () -> Unit)
}

/**
 * Ohne Anbieter geschieht nichts: Vergässe eine Activity ihn, wäre der Schutz
 * sonst still aus. MainActivity setzt [GeraeteSchrittschutz], Tests ihren eigenen.
 */
val LocalSchrittschutz = staticCompositionLocalOf { Schrittschutz { _, _ -> } }

/**
 * Fingerabdruck oder Gesicht, sonst PIN, Muster oder Passwort des Geräts
 * (androidx.biometric). Ein Gerät ohne Sperre hat nichts zu fragen und lässt
 * durch — der Schritt wäre dort ohnehin jedem offen.
 */
class GeraeteSchrittschutz(private val activity: FragmentActivity) : Schrittschutz {
    private val frist = Bestaetigungsfrist(uhr = SystemClock::elapsedRealtime)

    /** Beim Verlassen der App (MainActivity.onStop): Danach wird wieder gefragt. */
    fun vergiss() = frist.vergiss()

    override fun bestaetige(grund: String, weiter: () -> Unit) {
        if (frist.gilt() || activity.getSystemService<KeyguardManager>()?.isDeviceSecure != true) {
            weiter()
            return
        }
        val rueckruf = object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                frist.bestaetigt()
                weiter()
            }
        }
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(grund)
            .setSubtitle(activity.getString(R.string.schritt_untertitel))
            .setAllowedAuthenticators(erlaubteVerfahren())
            .build()
        BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), rueckruf).authenticate(info)
    }

    // STRONG zusammen mit der Gerätesperre kennt androidx.biometric erst ab Android 11.
    private fun erlaubteVerfahren(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) BIOMETRIC_STRONG or DEVICE_CREDENTIAL
        else BIOMETRIC_WEAK or DEVICE_CREDENTIAL
}

/**
 * Zeigt [inhalt] erst nach der Bestätigung und fragt beim Öffnen von selbst.
 * Verlässt die App den Vordergrund, ist der Bereich wieder gesperrt.
 */
@Composable
fun Schrittsperre(grund: String, inhalt: @Composable () -> Unit) {
    val schutz = LocalSchrittschutz.current
    var frei by remember { mutableStateOf(false) }
    val frage = { schutz.bestaetige(grund) { frei = true } }
    LaunchedEffect(schutz) { if (!frei) frage() }
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) { frei = false }
    if (frei) {
        inhalt()
    } else {
        Box(Modifier.fillMaxSize(), Alignment.Center) {
            Button(onClick = frage) { Text(stringResource(R.string.schritt_entsperren)) }
        }
    }
}
