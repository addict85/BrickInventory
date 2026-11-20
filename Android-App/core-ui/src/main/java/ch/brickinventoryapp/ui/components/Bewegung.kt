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
 * Hat die Person „Animationen entfernen“ gewählt (Animator-Dauer 0)? Dann fliegt kein
 * Bild, gleitet keine Kachel und schimmert kein Skelett: Bewegung kann Schwindel
 * auslösen, und wer sie abschaltet, meint alle. Die Einstellung wird beobachtet,
 * weil man sie bei offener App in den Systemeinstellungen umstellt.
 */
@Composable
fun movementReduced(): Boolean {
    val context = LocalContext.current
    val resolution = context.contentResolver
    fun lies() = Settings.Global.getFloat(resolution, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    var reduced by remember(context) { mutableStateOf(lies()) }
    DisposableEffect(context) {
        val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean) { reduced = lies() }
        }
        resolution.registerContentObserver(Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE), false, observer)
        onDispose { resolution.unregisterContentObserver(observer) }
    }
    return reduced
}
