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
val LocalAppSperre = staticCompositionLocalOf<AppSperre?> { null }

/**
 * Fingerabdruck oder Gerätesperre, ohne Schlüssel: Die Sperre schützt vor dem, der das
 * Telefon in der Hand hat. Was der Server prüft, bindet der Schrittschutz eigens.
 * Ohne Displaysperre gibt es nichts zu fragen; dann geht es weiter.
 */
fun entsperreMitGeraetesperre(activity: FragmentActivity, titel: String, untertitel: String, weiter: () -> Unit) {
    if (activity.getSystemService<KeyguardManager>()?.isDeviceSecure != true) return weiter()
    val rueckruf = object : BiometricPrompt.AuthenticationCallback() {
        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) = weiter()
    }
    val info = BiometricPrompt.PromptInfo.Builder().setTitle(titel).setSubtitle(untertitel)
        .setAllowedAuthenticators(BIOMETRIC_STRONG or DEVICE_CREDENTIAL).build()
    BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), rueckruf).authenticate(info)
}

/** Deckt die App ab, bis entsperrt ist; fragt beim Erscheinen von selbst. */
@Composable
fun AppSperreSchirm(onEntsperren: () -> Unit) {
    Ueberdeckungsschutz()
    LaunchedEffect(Unit) { onEntsperren() }
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Box(Modifier.fillMaxSize(), Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Abstaende.mittel)) {
                Text(stringResource(R.string.app_sperre_gesperrt), style = MaterialTheme.typography.titleMedium)
                Button(onClick = onEntsperren) { Text(stringResource(R.string.app_sperre_entsperren)) }
            }
        }
    }
}

/** Die Wahl in den Einstellungen; ohne Displaysperre nur das Ausschalten. */
@Composable
fun AppSperreWahl(sperre: AppSperre) {
    val minuten by sperre.minuten.collectAsState()
    val kontext = LocalContext.current
    val moeglich = remember(kontext) { kontext.getSystemService<KeyguardManager>()?.isDeviceSecure == true }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
        Text(stringResource(R.string.app_sperre_titel), style = MaterialTheme.typography.bodyMedium)
        Text(stringResource(if (moeglich) R.string.app_sperre_hint else R.string.app_sperre_ohne_displaysperre),
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        val aus = stringResource(R.string.app_sperre_aus)
        val mitZahl = AppSperre.WAHL.associateWith { stringResource(R.string.app_sperre_minuten, it) }
        WahlChips(
            optionen = AppSperre.WAHL.map { it to if (it == 0) aus else mitZahl.getValue(it) },
            gewaehlt = minuten,
            onWahl = sperre::setzeMinuten,
            enabled = moeglich,
        )
    }
}
