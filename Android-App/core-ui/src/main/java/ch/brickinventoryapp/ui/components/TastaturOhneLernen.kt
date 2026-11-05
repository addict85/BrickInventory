package ch.brickinventoryapp.ui.components

import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import androidx.compose.runtime.Composable
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.platform.InterceptPlatformTextInput
import androidx.compose.ui.platform.PlatformTextInputMethodRequest

/**
 * Jedes Textfeld in [inhalt] bittet die Tastatur, nichts zu lernen
 * (IME_FLAG_NO_PERSONALIZED_LEARNING): Passwörter, Codes, Gutschein-Nummer und PIN
 * gehören nicht in die Vorschläge oder das Wörterbuch der Tastatur. Compose kennt
 * die Flagge nicht als KeyboardOptions, also beim Start der Eingabe gesetzt.
 */
@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun TastaturOhneLernen(inhalt: @Composable () -> Unit) {
    InterceptPlatformTextInput(
        interceptor = { anfrage, weiter ->
            weiter.startInputMethod(object : PlatformTextInputMethodRequest {
                override fun createInputConnection(outAttributes: EditorInfo): InputConnection =
                    anfrage.createInputConnection(outAttributes).also {
                        outAttributes.imeOptions = outAttributes.imeOptions or EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING
                    }
            })
        },
        content = inhalt,
    )
}
