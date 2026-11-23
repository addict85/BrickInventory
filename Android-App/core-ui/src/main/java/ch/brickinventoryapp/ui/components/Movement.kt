package ch.brickinventoryapp.ui.components

import android.database.ContentObserver
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext

/**
 * Has the person chosen „remove animations“ (animator duration 0)? Then no
 * image flies, no tile glides and no skeleton shimmers: motion can trigger
 * dizziness, and whoever turns it off means all of it. The setting is observed,
 * because it's changed in system settings while the app is open.
 */
@Composable
fun movementReduced(): Boolean {
    val context = LocalContext.current
    val resolution = context.contentResolver
    fun read() = Settings.Global.getFloat(resolution, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    var reduced by remember(context) { mutableStateOf(read()) }
    DisposableEffect(context) {
        val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean) { reduced = read() }
        }
        resolution.registerContentObserver(Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE), false, observer)
        onDispose { resolution.unregisterContentObserver(observer) }
    }
    return reduced
}
