package ch.brickinventoryapp.ui.components

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.os.Build
import android.view.Window
import android.view.WindowManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.window.DialogWindowProvider
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.util.LocalSdkLevel

/**
 * No screenshot, no recording and no preview thumbnail in the app overview, as long as
 * this screen is up — for voucher number and PIN.
 */
@Composable
fun PrivacyShield(coverage: Boolean = true) {
    if (coverage) OverlayGuard()
    val view = LocalView.current
    val activity = LocalContext.current.findActivity()
    DisposableEffect(view, activity) {
        // A dialog has its own window and only takes over FLAG_SECURE from the window below it
        // on its next rebuild. So both apply immediately, and both are counted.
        val window = listOfNotNull(activity?.window, (view.parent as? DialogWindowProvider)?.window).distinct()
        window.forEach(::secure)
        onDispose { window.forEach(::giveFree) }
    }
}

/**
 * With the app lock turned on, the app overview shows no preview thumbnail: it otherwise
 * showed exactly what the lock is meant to hide, even with „hide preview“ off.
 * From Android 13 onward only the thumbnail, screenshots stay allowed; below that it
 * only works with FLAG_SECURE via the counter of [PrivacyShield].
 */
@Composable
fun AppOverviewProtection(lock: AppLock) {
    val minutes by lock.minutes.collectAsState()
    if (minutes <= 0) return
    if (LocalSdkLevel.current < Build.VERSION_CODES.TIRAMISU) {
        PrivacyShield(coverage = false)
        return
    }
    val activity = LocalContext.current.findActivity() ?: return
    DisposableEffect(activity) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) activity.setRecentsScreenshotEnabled(false)
        onDispose { if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) activity.setRecentsScreenshotEnabled(true) }
    }
}

private fun protectedCount(f: Window) = f.decorView.getTag(R.id.privacy_shield_count) as? Int ?: 0

private fun secure(f: Window) {
    if (protectedCount(f) == 0) f.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    f.decorView.setTag(R.id.privacy_shield_count, protectedCount(f) + 1)
}

private fun giveFree(f: Window) {
    val rest = protectedCount(f) - 1
    f.decorView.setTag(R.id.privacy_shield_count, rest)
    if (rest <= 0) f.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
}

private fun Context.findActivity(): Activity? {
    var c: Context = this
    while (c is ContextWrapper) {
        if (c is Activity) return c
        c = c.baseContext
    }
    return null
}
