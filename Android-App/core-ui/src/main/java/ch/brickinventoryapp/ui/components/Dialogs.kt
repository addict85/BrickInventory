package ch.brickinventoryapp.ui.components

import androidx.compose.ui.semantics.paneTitle
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import ch.brickinventoryapp.ui.MIDDLE_WIDTH_DP
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.withFrameNanos
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.theme.AppCard
import ch.brickinventoryapp.ui.theme.Shapes
import ch.brickinventoryapp.ui.theme.windowSurface
import ch.brickinventoryapp.ui.theme.mainButtonColors
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator

/**
 * The follow-up question before an action with no way back: icon, title, a sentence, the
 * action in error color on the right. One shape for deleting a set, deleting a storage location,
 * unlinking an account and signing out. [title] is a question („Set löschen?“): „löschen“
 * for what is gone for good, „entfernen“ for what only leaves a list. The caller closes it in [onConfirm].
 */
@Composable
fun Prompt(
    title: String,
    text: String,
    confirm: String,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
    symbol: ImageVector? = null,
) {
    // Title as heading and name of the window: TalkBack names what it's about on opening.
    AlertDialog(
        onDismissRequest = onCancel,
        properties = DialogProperties(usePlatformDefaultWidth = false),
        modifier = Modifier.windowEdge().semantics { paneTitle = title },
        containerColor = windowSurface(),
        icon = symbol?.let { s -> { Icon(s, null, tint = MaterialTheme.colorScheme.error) } },
        title = { Text(title, Modifier.semantics { heading() }) },
        // Scrollable: at 200% text size a long sentence would otherwise reach under the buttons.
        text = { Text(text, Modifier.verticalScroll(rememberScrollState())) },
        confirmButton = {
            TextButton(onClick = onConfirm) { Text(confirm, color = MaterialTheme.colorScheme.error) }
        },
        dismissButton = { TextButton(onClick = onCancel) { Text(stringResource(R.string.common_cancel)) } },
    )
}

/**
 * The frame of every capture dialog: title on the left without an icon, the fields with
 * equal spacing stacked, the full-width button on the right. Set, wishlist,
 * takeover and storage location used to each look different (icon, center, rounding).
 * On the phone with large text as full screen ([addFullscreen]).
 */
@Composable
fun AddDialog(
    title: String,
    confirm: String,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
    confirmEnabled: Boolean = true,
    /** Whether something has already been entered; if so, a misstep doesn't close the dialog (see [addClosable]). */
    changed: Boolean = false,
    content: @Composable ColumnScope.() -> Unit,
) {
    var discardAsk by rememberSaveable { mutableStateOf(false) }
    // Back and tapping outside end up here; Cancel and the X keep closing without asking.
    val close: () -> Unit = { if (changed) { discardAsk = true } else { onCancel() } }
    if (discardAsk) {
        Prompt(
            title = stringResource(R.string.record_discard_title),
            text = stringResource(R.string.record_discard_text),
            confirm = stringResource(R.string.record_discard),
            onConfirm = { discardAsk = false; onCancel() },
            onCancel = { discardAsk = false },
        )
    }
    if (addFullscreen()) {
        FullscreenAdd(title, confirm, onConfirm, onCancel, close, confirmEnabled, changed, content)
        return
    }
    AlertDialog(
        onDismissRequest = close,
        properties = addClosable(changed),
        modifier = Modifier.windowEdge().semantics { paneTitle = title },
        containerColor = windowSurface(),
        title = { Text(title, Modifier.semantics { heading() }) },
        // Scrollable: with large text, the fields are taller than the window; the
        // buttons stay put, only the fields scroll.
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(Spacing.medium)) { content() }
        },
        confirmButton = {
            Button(onClick = onConfirm, enabled = confirmEnabled, colors = mainButtonColors()) { Text(confirm) }
        },
        dismissButton = { TextButton(onClick = onCancel) { Text(stringResource(R.string.common_cancel)) } },
    )
}

/**
 * The buttons at the foot of a form outside an AlertDialog (sheet, card):
 * Cancel on the left, the main action on the right, as AlertDialog orders them. With large
 * text, the main button moves to the right on the next line instead of off-screen.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ButtonRow(
    confirm: String,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
    /** While saving: a spinner before it, the main button accepts no second tap. */
    running: Boolean = false,
) {
    FlowRow(
        modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.small, Alignment.End),
        verticalArrangement = Arrangement.spacedBy(Spacing.small),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        if (running) CircularProgressIndicator(Modifier.size(withFont(18.dp)), strokeWidth = 2.dp)
        TextButton(onClick = onCancel) { Text(stringResource(R.string.common_cancel)) }
        Button(onClick = onConfirm, enabled = !running, colors = mainButtonColors()) { Text(confirm) }
    }
}

/**
 * Tapping outside doesn't close a filled-in form: a tap next to the window used to
 * discard a set, wishlist entry or storage location along with everything typed. Back stays as it is,
 * but asks first (AddDialog).
 */
fun addClosable(changed: Boolean) =
    DialogProperties(dismissOnClickOutside = !changed, usePlatformDefaultWidth = false)

/**
 * The margin of a floating dialog to the window, set explicitly instead of the platform's
 * window width: that depended on the device, and without it the dialog stood edge-to-edge over the
 * full width. It centers itself; it never gets wider than 560 dp.
 */
fun Modifier.windowEdge(): Modifier = padding(horizontal = WINDOW_EDGE)

private val WINDOW_EDGE = 24.dp

/**
 * Full screen instead of a floating dialog: on a narrow window from large text size onward. There,
 * the AlertDialog filled the screen anyway, and its scroll edge cut lines right in
 * the middle (Material: „full-screen dialog“ for input on the phone).
 */
@Composable
fun addFullscreen(): Boolean {
    val widthDp = LocalWindowInfo.current.containerSize.width / LocalDensity.current.density
    return largeFont() && widthDp < MIDDLE_WIDTH_DP
}

/**
 * Header with close and title, the fields scroll, the confirm button sits fixed
 * at the foot full width: next to a title at 200% text size it would have no room at the top.
 */
@Composable
private fun FullscreenAdd(
    title: String,
    confirm: String,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
    onClose: () -> Unit,
    confirmEnabled: Boolean,
    changed: Boolean,
    content: @Composable ColumnScope.() -> Unit,
) {
    Dialog(onDismissRequest = onClose, properties = addClosable(changed)) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
            Column(Modifier.fillMaxSize().imePadding()) {
                Row(Modifier.fillMaxWidth().padding(horizontal = Spacing.tiny, vertical = Spacing.small),
                    verticalAlignment = Alignment.CenterVertically) {
                    WithTooltip(stringResource(R.string.common_cancel)) {
                        IconButton(onClick = onCancel) {
                            Icon(Icons.Default.Close, contentDescription = stringResource(R.string.common_cancel))
                        }
                    }
                    Text(title, style = MaterialTheme.typography.titleLarge,
                        modifier = Modifier.weight(1f).semantics { heading() })
                }
                Column(
                    Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())
                        .padding(horizontal = Spacing.large, vertical = Spacing.small),
                    verticalArrangement = Arrangement.spacedBy(Spacing.medium),
                ) { content() }
                HorizontalDivider()
                Button(onClick = onConfirm, enabled = confirmEnabled, colors = mainButtonColors(),
                    modifier = Modifier.fillMaxWidth().padding(Spacing.large)) { Text(confirm) }
            }
        }
    }
}

/**
 * A section of a sub-page: card with a heading. Unlike SettingsCard,
 * without an icon and without capital letters — on a sub-page the app bar already
 * names the category, the section only its part of it. Without [title], a
 * card without a header.
 */
@Composable
fun Section(
    title: String?,
    modifier: Modifier = Modifier,
    innerGap: Boolean = true,
    content: @Composable ColumnScope.() -> Unit,
) {
    AppCard(modifier) {
        Column(
            if (innerGap) Modifier.fillMaxWidth().padding(Spacing.large) else Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.small),
        ) {
            // The same heading as every card (section title).
            if (title != null) SectionTitle(title,
                if (innerGap) Modifier else Modifier.padding(start = Spacing.large,
                    end = Spacing.large, top = Spacing.large))
            content()
        }
    }
}

/**
 * The follow-up question for the password before a step the server wants confirmed.
 * The code field only once it has requested the second factor ([codeNeeded]);
 * the password stays put. Both only in remember: saved state ends up
 * in the bundle and, on process death, on disk.
 */
@Composable
fun PasswordPrompt(
    title: String,
    text: String,
    confirm: String,
    codeNeeded: Boolean,
    error: String?,
    running: Boolean,
    onConfirm: (password: String, code: String?) -> Unit,
    onCancel: () -> Unit,
) {
    var password by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    // The rejection scrolls into view: with the code field above it, it used to sit on small screens below
    // the edge of the follow-up question, and you'd only see a new field without the reason for it.
    val messageVisible = remember { BringIntoViewRequester() }
    LaunchedEffect(error) {
        if (error == null) return@LaunchedEffect
        withFrameNanos { }  // only once the row is set
        messageVisible.bringIntoView()
    }
    AddDialog(
        title = title,
        confirm = confirm,
        onConfirm = { onConfirm(password, code.takeIf { codeNeeded && it.isNotBlank() }) },
        onCancel = onCancel,
        confirmEnabled = !running && password.isNotEmpty() && (!codeNeeded || code.isNotBlank()),
    ) {
        // A dialog has its own window; the page's protection doesn't reach into it.
        OverlayGuard()
        Text(text, style = MaterialTheme.typography.bodyMedium)
        PasswordField(password, { password = it }, stringResource(R.string.account_password_current),
            Modifier.fillMaxWidth())
        if (codeNeeded) SecondFactorCodeField(code) { code = it }
        if (error != null) ErrorRow(error, Modifier.bringIntoViewRequester(messageVisible))
    }
}

/** The second-factor code the server requires for password, email and vouchers. */
@Composable
fun SecondFactorCodeField(code: String, onCode: (String) -> Unit) {
    OutlinedTextField(
        value = code, onValueChange = { onCode(it.take(24)) },
        label = { Text(stringResource(R.string.login_code)) },
        supportingText = { Text(stringResource(R.string.login_code_hint)) },
        // No SmsOtpCode: the code comes from an authenticator app, not by SMS, and
        // Compose has no autofill type for TOTP. Otherwise the system offered SMS codes.
        modifier = Modifier.fillMaxWidth(),
        singleLine = true, shape = Shapes.field,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii))
}
