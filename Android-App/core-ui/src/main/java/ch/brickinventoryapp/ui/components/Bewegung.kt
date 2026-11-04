package ch.brickinventoryapp.ui.components

import android.provider.Settings
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext

/**
 * Hat die Person „Animationen entfernen“ gewählt (Animator-Dauer 0)? Dann fliegt kein
 * Bild, gleitet keine Kachel und schimmert kein Skelett: Bewegung kann Schwindel
 * auslösen, und wer sie abschaltet, meint alle.
 */
@Composable
fun bewegungReduziert(): Boolean {
    val kontext = LocalContext.current
    return remember(kontext) {
        Settings.Global.getFloat(kontext.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    }
}
