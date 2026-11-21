package ch.brickinventoryapp.ui.components

import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import androidx.compose.runtime.Composable
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.platform.InterceptPlatformTextInput
import androidx.compose.ui.platform.PlatformTextInputMethodRequest

/**
 * Every text field in [inhalt] asks the keyboard to learn nothing
 * (IME_FLAG_NO_PERSONALIZED_LEARNING): passwords, codes, voucher numbers and PINs
 * don't belong in the keyboard's suggestions or dictionary. Compose doesn't know
 * the flag as a KeyboardOptions, so it's set when input starts.
 */
@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun KeyboardWithoutLearn(inhalt: @Composable () -> Unit) {
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
