package ch.brickinventoryapp.ui.components

import android.app.KeyguardManager
import ch.brickinventoryapp.ui.theme.windowSurface
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
import ch.brickinventoryapp.model.step.StepAction
import ch.brickinventoryapp.model.step.StepBinding
import ch.brickinventoryapp.resources.R
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import java.security.Signature
import kotlin.coroutines.resume

/**
 * Asks for the screen lock before a sensitive step (voucher PIN, recovery codes, management):
 * whoever briefly holds the unlocked phone shouldn't get
 * further there. [next] only runs after confirmation.
 */
fun interface StepGuard {
    fun confirm(reason: String, next: () -> Unit)

    /** For a step the server checks: the confirmation only applies there to [action]. */
    fun confirm(reason: String, action: StepAction, next: () -> Unit) = confirm(reason, next)
}

/** The same protection, always for [action]: this keeps calls with two arguments bound to the server. */
fun StepGuard.forTarget(action: StepAction): StepGuard {
    val basis = this
    return StepGuard { reason, next -> basis.confirm(reason, action, next) }
}

/**
 * Without a provider, nothing happens: if an activity forgot it, the protection
 * would otherwise be silently off. MainActivity sets [DevicesStepProtection], tests their own.
 */
val LocalStepGuard = staticCompositionLocalOf { StepGuard { _, _ -> } }

/**
 * Fingerprint (strong biometrics), otherwise the device's PIN, pattern or password. Without
 * a lock, there's nothing to check; then [withoutLock] warns, instead of silently letting it through.
 * Confirmed is only what the Keystore releases and, for a [StepAction] with
 * an identifier, what the server accepts with the signature over its challenge ([StepFlow]).
 */
// [subtitle] and [noKey] come from outside: below Android 13 the
// activity carries the system language instead of the app's, core-ui doesn't know the localized context.
class DevicesStepProtection(
    private val activity: FragmentActivity,
    private val noKey: () -> Unit = {},
    private val binding: StepBinding = StepBinding.WITHOUT,
    /** The server rejected it; null: no response. */
    private val declined: (message: String?) -> Unit = {},
    /** The device cannot generate a key with attestation; sensitive steps then only work in the web app. */
    private val withoutAttestation: () -> Unit = {},
    private val subtitle: () -> String,
) : StepGuard {
    // Per action: the release on the server also applies only to one.
    private val deadlines = mutableMapOf<StepAction, ConfirmationDeadline>()
    private val flow = StepFlow(binding, StepApproval(DevicesKey::public))

    /** The follow-up question without a screen lock; MainActivity shows it with [WithoutLockWarning]. */
    val withoutLock = WithoutLock()

    /** On leaving the app (MainActivity.onStop): asked again afterwards. */
    fun forgetNow() = deadlines.values.forEach(ConfirmationDeadline::forgetNow)

    /** After signing in: only then does the server accept the key ([KeyBinding]). */
    fun bindAnServer() {
        if (activity.getSystemService<KeyguardManager>()?.isDeviceSecure != true) return
        activity.lifecycleScope.launch {
            when (val a = KeyBinding(binding, DevicesKey).bind()) {
                KeyBinding.Outbox.Bound -> Unit
                KeyBinding.Outbox.WithoutAttestation -> withoutAttestation()
                is KeyBinding.Outbox.Rejected -> a.message?.let(declined)
            }
        }
    }

    override fun confirm(reason: String, next: () -> Unit) = confirm(reason, StepAction.LOCAL, next)

    override fun confirm(reason: String, action: StepAction, next: () -> Unit) {
        val deadline = deadlines.getOrPut(action) { ConfirmationDeadline(clock = SystemClock::elapsedRealtime) }
        if (deadline.applies()) {
            next()
            return
        }
        if (activity.getSystemService<KeyguardManager>()?.isDeviceSecure != true) {
            withoutLock.question(reason) { deadline.confirmed(); next() }
            return
        }
        // Without a bound key, no proceeding: a fallback to the bare follow-up question
        // would be exactly the path a hooked-up callback opens.
        val signature = runCatching { DevicesKey.signature() }.getOrNull() ?: return noKey()
        activity.lifecycleScope.launch {
            when (val a = flow.confirm(action) { unlock(reason, signature) }) {
                StepFlow.Outbox.Next -> { deadline.confirmed(); next() }
                StepFlow.Outbox.Cancelled -> Unit
                is StepFlow.Outbox.Rejected -> declined(a.message)
            }
        }
    }

    /** The signature released by the Keystore; null on cancellation or a lock error. */
    private suspend fun unlock(reason: String, signature: Signature): Signature? = suspendCancellableCoroutine { next ->
        val callback = object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                if (next.isActive) next.resume(result.cryptoObject?.signature)
            }
            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                if (next.isActive) next.resume(null)
            }
        }
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(reason)
            .setSubtitle(subtitle())
            // Since minSdk 30 always strong biometrics or the screen lock, never class-2 face;
            // the Keystore key can release for both (DevicesKey).
            .setAllowedAuthenticators(BIOMETRIC_STRONG or DEVICE_CREDENTIAL)
            .build()
        BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), callback)
            .authenticate(info, BiometricPrompt.CryptoObject(signature))
    }
}

/**
 * A step that waits without a screen lock: whoever uses a device without a
 * lock should know that PIN, codes and management are there open to anyone who
 * briefly has the phone. A yes counts as a confirmation until the deadline.
 */
class WithoutLock {
    class Waiting(val reason: String, val next: () -> Unit)

    var waiting by mutableStateOf<Waiting?>(null)
        private set

    fun question(reason: String, next: () -> Unit) {
        waiting = Waiting(reason, next)
    }

    fun proceed() {
        val w = waiting ?: return
        waiting = null
        w.next()
    }

    fun cancel() {
        waiting = null
    }
}

/** The follow-up question for [WithoutLock]; tapping away cancels it, an overlapping tap doesn't count. */
@Composable
fun WithoutLockWarning(withoutLock: WithoutLock) {
    val w = withoutLock.waiting ?: return
    val title = stringResource(R.string.step_without_lock_title)
    AlertDialog(
        containerColor = windowSurface(),
        onDismissRequest = withoutLock::cancel,
        modifier = Modifier.semantics { paneTitle = title },
        title = { Text(title, Modifier.semantics { heading() }) },
        text = {
            OverlayGuard()
            Text(stringResource(R.string.step_without_lock_text, w.reason))
        },
        confirmButton = {
            TextButton(onClick = withoutLock::proceed) { Text(stringResource(R.string.step_without_lock_next)) }
        },
        dismissButton = {
            TextButton(onClick = withoutLock::cancel) { Text(stringResource(R.string.common_cancel)) }
        },
    )
}

/**
 * Shows [content] only after confirmation and asks on its own when it opens.
 * If the app leaves the foreground, the area is locked again.
 */
@Composable
fun StepLock(reason: String, action: StepAction = StepAction.LOCAL, content: @Composable () -> Unit) {
    // A page behind the screen lock is sensitive: no tap slipped in underneath.
    OverlayGuard()
    val basis = LocalStepGuard.current
    val protection = remember(basis, action) { basis.forTarget(action) }
    var unlocked by remember { mutableStateOf(false) }
    val question = { protection.confirm(reason) { unlocked = true } }
    LaunchedEffect(protection) { if (!unlocked) question() }
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) { unlocked = false }
    if (unlocked) {
        content()
    } else {
        Box(Modifier.fillMaxSize(), Alignment.Center) {
            Button(onClick = question) { Text(stringResource(R.string.step_unlock)) }
        }
    }
}
