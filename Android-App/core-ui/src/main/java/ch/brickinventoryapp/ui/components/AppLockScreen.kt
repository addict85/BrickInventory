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
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.Spacing

/** The activity's app lock; without a provider, settings shows no choice. */
val LocalAppLock = staticCompositionLocalOf<AppLock?> { null }

/**
 * Fingerprint or screen lock, bound to a dedicated Keystore key: only
 * its signature lifts the lock (AppUnlocking), not the callback alone.
 * Without a screen lock there is no such key and nothing to ask; then it just continues.
 */
fun unlockWithDevicesLock(activity: FragmentActivity, title: String, subtitle: String, next: () -> Unit) {
    if (activity.getSystemService<KeyguardManager>()?.isDeviceSecure != true) return next()
    // Since minSdk 30 the key can authorize both (KeystoreKey).
    val info = BiometricPrompt.PromptInfo.Builder().setTitle(title).setSubtitle(subtitle)
        .setAllowedAuthenticators(BIOMETRIC_STRONG or DEVICE_CREDENTIAL).build()
    AppUnlocking(AppLockKey) { signature, response ->
        val callback = object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) =
                response(result.cryptoObject?.signature)
        }
        BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), callback)
            .authenticate(info, BiometricPrompt.CryptoObject(signature))
    }.unlock(next)
}

/** Covers the app until unlocked; asks on its own when it appears. */
@Composable
fun AppLockScreen(unlockOn: () -> Unit) {
    OverlayGuard()
    LaunchedEffect(Unit) { unlockOn() }
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Box(Modifier.fillMaxSize(), Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Spacing.medium)) {
                Text(stringResource(R.string.app_lock_locked), style = MaterialTheme.typography.titleMedium)
                Button(onClick = unlockOn) { Text(stringResource(R.string.app_lock_unlock)) }
            }
        }
    }
}

/** The choice in settings; without a screen lock only turning it off. */
@Composable
fun AppLockChoice(lock: AppLock) {
    val minutes by lock.minutes.collectAsState()
    val context = LocalContext.current
    val possible = remember(context) { context.getSystemService<KeyguardManager>()?.isDeviceSecure == true }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.small)) {
        Text(stringResource(if (possible) R.string.app_lock_hint else R.string.app_lock_without_screen_lock),
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        val from = stringResource(R.string.app_lock_from)
        val withNumber = AppLock.CHOICE.associateWith { stringResource(R.string.app_lock_minutes, it) }
        SelectionField(
            label = stringResource(R.string.app_lock_title),
            modifier = Modifier.fillMaxWidth(),
            options = AppLock.CHOICE.map { it to if (it == 0) from else withNumber.getValue(it) },
            chosen = minutes,
            onChoice = lock::setMinutes,
            enabled = possible,
        )
    }
}
