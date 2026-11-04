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
fun bewegungReduziert(): Boolean {
    val kontext = LocalContext.current
    val aufloesung = kontext.contentResolver
    fun lies() = Settings.Global.getFloat(aufloesung, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    var reduziert by remember(kontext) { mutableStateOf(lies()) }
    DisposableEffect(kontext) {
        val beobachter = object : ContentObserver(Handler(Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean) { reduziert = lies() }
        }
        aufloesung.registerContentObserver(Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE), false, beobachter)
        onDispose { aufloesung.unregisterContentObserver(beobachter) }
    }
    return reduziert
}
