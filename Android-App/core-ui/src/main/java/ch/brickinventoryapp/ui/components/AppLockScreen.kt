package ch.brickinventoryapp.ui.components

import android.app.KeyguardManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.core.content.ContextCompat
import androidx.core.content.getSystemService
import androidx.fragment.app.FragmentActivity
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.theme.Abstaende

/** Die App-Sperre der Activity; ohne Anbieter zeigen die Einstellungen keine Wahl. */
val LocalAppLock = staticCompositionLocalOf<AppLock?> { null }

/**
 * Fingerabdruck oder Gerätesperre, gebunden an einen eigenen Keystore-Schlüssel: Erst
 * dessen Signatur hebt die Sperre auf (AppUnlocking), nicht der Rückruf allein.
 * Ohne Displaysperre gibt es keinen solchen Schlüssel und nichts zu fragen; dann geht es weiter.
 */
fun unlockWithDevicesLock(activity: FragmentActivity, titel: String, subtitle: String, weiter: () -> Unit) {
    if (activity.getSystemService<KeyguardManager>()?.isDeviceSecure != true) return weiter()
    // Seit minSdk 30 kann der Schlüssel beides freigeben (KeystoreKey).
    val info = BiometricPrompt.PromptInfo.Builder().setTitle(titel).setSubtitle(subtitle)
        .setAllowedAuthenticators(BIOMETRIC_STRONG or DEVICE_CREDENTIAL).build()
    AppUnlocking(AppLockKey) { signatur, antwort ->
        val callback = object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) =
                antwort(result.cryptoObject?.signature)
        }
        BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), callback)
            .authenticate(info, BiometricPrompt.CryptoObject(signatur))
    }.unlock(weiter)
}

/** Deckt die App ab, bis entsperrt ist; fragt beim Erscheinen von selbst. */
@Composable
fun AppLockScreen(unlockOn: () -> Unit) {
    Ueberdeckungsschutz()
    LaunchedEffect(Unit) { unlockOn() }
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Box(Modifier.fillMaxSize(), Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Abstaende.mittel)) {
                Text(stringResource(R.string.app_sperre_gesperrt), style = MaterialTheme.typography.titleMedium)
                Button(onClick = unlockOn) { Text(stringResource(R.string.app_sperre_entsperren)) }
            }
        }
    }
}

/** Die Wahl in den Einstellungen; ohne Displaysperre nur das Ausschalten. */
@Composable
fun AppLockChoice(lock: AppLock) {
    val minuten by lock.minuten.collectAsState()
    val context = LocalContext.current
    val possible = remember(context) { context.getSystemService<KeyguardManager>()?.isDeviceSecure == true }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
        Text(stringResource(if (possible) R.string.app_sperre_hint else R.string.app_sperre_ohne_displaysperre),
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        val aus = stringResource(R.string.app_sperre_aus)
        val withNumber = AppLock.CHOICE.associateWith { stringResource(R.string.app_sperre_minuten, it) }
        SelectionField(
            beschriftung = stringResource(R.string.app_sperre_titel),
            modifier = Modifier.fillMaxWidth(),
            optionen = AppLock.CHOICE.map { it to if (it == 0) aus else withNumber.getValue(it) },
            gewaehlt = minuten,
            onWahl = lock::setMinutes,
            enabled = possible,
        )
    }
}
