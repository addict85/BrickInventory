package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import ch.brickinventoryapp.model.ui.Message
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.sentence
import ch.brickinventoryapp.ui.theme.Shapes

/**
 * A text that appears after an action is announced: without a live region, a
 * blind person hears nothing after „Sign in“ and doesn't know it failed.
 */
fun Modifier.announce(): Modifier = semantics { liveRegion = LiveRegionMode.Polite }

/**
 * Sits above a locked main button and says what's missing: pale alone left you
 * guessing why it wouldn't go (as during sign-in).
 */
@Composable
fun LockReason(text: String) {
    Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

/** An error line below a form, in error color and announced. */
@Composable
fun ErrorRow(text: String, modifier: Modifier = Modifier) {
    Text(text, modifier.announce(), color = MaterialTheme.colorScheme.error,
        style = MaterialTheme.typography.bodyMedium)
}

@Composable
fun ErrorRow(message: Message, modifier: Modifier = Modifier) = ErrorRow(message.sentence(), modifier)

/** What the field is for — this decides what the password manager offers. */
enum class PasswordKind {
    /** The existing password: the manager fills it in. */
    CURRENT,
    /** A new password: the manager suggests a strong one and remembers it. */
    NEW,
    /** The repeat of the new one. */
    RETRY,
}

/**
 * Every password field of the app: with an autofill type, a password keyboard and the eye to
 * reveal it. As long as the password is visible, the privacy screen applies — a
 * revealed password belongs in no screenshot, whichever page it's on.
 */
@Composable
fun PasswordField(
    value: String,
    onValue: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    kind: PasswordKind = PasswordKind.CURRENT,
    /** Help or error text below the field; in error color with [faulty]. */
    hint: String? = null,
    faulty: Boolean = false,
    imeAction: ImeAction = ImeAction.Done,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
) {
    var visible by rememberSaveable { mutableStateOf(false) }
    if (visible) PrivacyShield()
    val autofill = if (kind == PasswordKind.CURRENT) ContentType.Password else ContentType.NewPassword
    OutlinedTextField(
        value = value,
        onValueChange = onValue,
        label = { Text(label) },
        // The lock icon everywhere, not only at sign-in: this way a password field is recognized
        // the same way on every page.
        leadingIcon = { Icon(Icons.Default.Lock, null) },
        trailingIcon = {
            val toggle = stringResource(if (visible) R.string.cd_password_hide else R.string.cd_password_show)
            WithTooltip(toggle) {
                IconButton(onClick = { visible = !visible }) {
                    Icon(if (visible) Icons.Default.VisibilityOff else Icons.Default.Visibility, contentDescription = toggle)
                }
            }
        },
        visualTransformation = if (visible) VisualTransformation.None else PasswordVisualTransformation(),
        isError = faulty,
        supportingText = hint?.let { { Text(it) } },
        singleLine = true,
        shape = Shapes.field,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = imeAction),
        keyboardActions = keyboardActions,
        modifier = modifier.semantics { contentType = autofill },
    )
}
