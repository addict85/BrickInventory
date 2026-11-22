package ch.brickinventoryapp.account.ui.screens

import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import ch.brickinventoryapp.account.ui.SecondFactorUiState
import ch.brickinventoryapp.model.step.StepAction
import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.model.ui.loading
import ch.brickinventoryapp.model.util.otpauthAddress
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.ButtonRow
import ch.brickinventoryapp.ui.components.ErrorRow
import ch.brickinventoryapp.ui.components.LocalStepGuard
import ch.brickinventoryapp.ui.components.PasswordField
import ch.brickinventoryapp.ui.components.PrivacyShield
import ch.brickinventoryapp.ui.components.SettingsCard
import ch.brickinventoryapp.ui.components.announce
import ch.brickinventoryapp.ui.components.charByChar
import ch.brickinventoryapp.ui.components.forTarget
import ch.brickinventoryapp.ui.components.readAloudAs
import ch.brickinventoryapp.ui.components.secondaryButtonColors
import ch.brickinventoryapp.ui.components.secondaryButtonRand
import ch.brickinventoryapp.ui.theme.Shapes
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.title
import ch.brickinventoryapp.ui.util.LocalSdkLevel
import ch.brickinventoryapp.ui.util.SecretClipboard
import ch.brickinventoryapp.ui.util.secretCopyable

/** The suggested name; the user picks the location in the system's save dialog. */
internal const val CODES_FILE = "brickinventory-wiederherstellungscodes.txt"

/** false if the chosen location wasn't writable; then "Share" remains. */
internal fun writeCodes(resolver: ContentResolver, target: Uri, codes: List<String>): Boolean = runCatching {
    resolver.openOutputStream(target, "wt")?.use { it.write((codes.joinToString("\n") + "\n").toByteArray()) } != null
}.getOrDefault(false)

/**
 * The codes as a file to a chosen location (ACTION_CREATE_DOCUMENT): when sharing, the
 * target app would read along, and some put the text in their history or a cloud. [onSecured]
 * ticks "secured" as soon as the file is written.
 */
@Composable
internal fun rememberCodesSecure(codes: List<String>, onSecured: () -> Unit): () -> Unit {
    val resolver = LocalContext.current.contentResolver
    val current by rememberUpdatedState(codes)
    val choose = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/plain")) { target ->
        if (target != null && writeCodes(resolver, target, current)) onSecured()
    }
    return { runCatching { choose.launch(CODES_FILE) } }
}

/**
 * The emergency codes to an app of choice (password manager, notes): only on tap and
 * via the system's picker, not via the clipboard, which would keep them in its history.
 * Second choice after [rememberCodesSecure], for devices without a document provider.
 */
internal fun partsCodes(ctx: Context, title: String, codes: List<String>) {
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, codes.joinToString("\n"))
        putExtra(Intent.EXTRA_TITLE, title)
    }
    runCatching { ctx.startActivity(Intent.createChooser(send, title)) }
}

/** false if no app takes the link (manifest: <queries> for otpauth). */
internal fun openWithSelection(ctx: Context, uri: String, title: String): Boolean {
    val view = Intent(Intent.ACTION_VIEW, uri.toUri())
    if (view.resolveActivity(ctx.packageManager) == null) return false
    return runCatching { ctx.startActivity(Intent.createChooser(view, title)) }.isSuccess
}

/**
 * Second factor: set up, disable, new recovery codes.
 *
 * On the phone it needs no QR code: the otpauth link opens the
 * authenticator app. Always via the system's picker: the link carries the
 * secret, and an app registered as the default for it would otherwise get it
 * unnoticed. If none is set, the key stays for typing in by hand (from API 33 also for copying).
 */
@Composable
internal fun SecondFactorCard(
    secondFactorUiState: SecondFactorUiState,
    onSetUp: (String) -> Unit,
    onConfirm: (String) -> Unit,
    onNewCodes: (String) -> Unit,
    onTurnOff: (String, String) -> Unit,
    onBack: () -> Unit,
) {
    // Passwords only in remember, see above.
    var zfPassword by remember { mutableStateOf("") }
    var zfCode     by remember { mutableStateOf("") }
    var withoutApp    by rememberSaveable { mutableStateOf(false) }
    var secured  by rememberSaveable(secondFactorUiState.codes) { mutableStateOf(false) }
    // Confirm stays tappable; without a code it marks the field and puts the cursor in it.
    var codeMissing  by rememberSaveable { mutableStateOf(false) }
    val codeFocus = remember { FocusRequester() }
    val selectionTitle = stringResource(R.string.zf_open_app)
    val context = LocalContext.current
    val keyLabel = stringResource(R.string.app_name)
    val shareTitle = stringResource(R.string.zf_share_title)
    val copy: (String) -> Unit = { text ->
        SecretClipboard.copy(context, keyLabel, text)
    }
    // New codes and a new key appear in plain text right after: only
    // behind the device lock (step protection), in addition to password or code.
    val protection = LocalStepGuard.current.forTarget(StepAction.SECOND_FACTOR)
    val codesReason = stringResource(R.string.step_codes)
    // Clear the fields as soon as a step succeeds — otherwise the
    // password would still be there at the next step.
    LaunchedEffect(secondFactorUiState.active, secondFactorUiState.secret, secondFactorUiState.codes) { zfPassword = ""; zfCode = "" }

    SettingsCard(title = stringResource(R.string.zf_title), icon = Icons.Default.Security) {
        Text(stringResource(R.string.zf_hint), style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (secondFactorUiState.fetch.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        secondFactorUiState.fetch.errorMessage?.let { ErrorRow(it) }

        val passwordField: @Composable () -> Unit = {
            PasswordField(zfPassword, { zfPassword = it }, stringResource(R.string.account_password_current),
                Modifier.fillMaxWidth())
        }
        val codeField: @Composable (String) -> Unit = { label ->
            OutlinedTextField(
                value = zfCode, onValueChange = { zfCode = it.take(24); codeMissing = false },
                label = { Text(label) },
                isError = codeMissing,
                supportingText = if (codeMissing) { { Text(stringResource(R.string.login_code_missing), Modifier.announce()) } } else null,
                modifier = Modifier.fillMaxWidth().focusRequester(codeFocus),
                singleLine = true, shape = Shapes.field,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii))
        }

        when {
            // 1. Frische Codes: einmal zeigen, dann wegraeumen. Kein Bildschirmfoto davon.
            secondFactorUiState.codes.isNotEmpty() -> {
                PrivacyShield()
                Text(stringResource(R.string.zf_codes_title), fontWeight = FontWeight.SemiBold)
                Text(stringResource(R.string.zf_codes_hint), style = MaterialTheme.typography.bodySmall)
                // Read out character by character: as a word, TalkBack read "i9j0".
                Text(secondFactorUiState.codes.joinToString("\n"),
                    fontFamily = FontFamily.Monospace,
                    modifier = Modifier.readAloudAs(secondFactorUiState.codes.joinToString(", ") { charByChar(it) }))
                val secure = rememberCodesSecure(secondFactorUiState.codes) { secured = true }
                Button(onClick = secure) { Text(stringResource(R.string.zf_codes_save)) }
                OutlinedButton(onClick = { partsCodes(context, shareTitle, secondFactorUiState.codes) }, colors = secondaryButtonColors(), border = secondaryButtonRand()) { Text(stringResource(R.string.zf_share)) }
                CodesSecured(secured) { secured = it }
                Button(onClick = onBack, enabled = secured) { Text(stringResource(R.string.zf_codes_done)) }
            }
            // 2. Setup running: key into the app, confirm the code.
            secondFactorUiState.secret != null -> {
                PrivacyShield()
                Text(stringResource(R.string.zf_step_app), style = MaterialTheme.typography.bodySmall)
                Button(
                    onClick = {
                        val uri = otpauthAddress(secondFactorUiState.otpauth)
                        withoutApp = uri == null || !openWithSelection(context, uri, selectionTitle)
                    },
                    modifier = Modifier.fillMaxWidth()
                ) { Text(stringResource(R.string.zf_open_app)) }
                if (withoutApp) {
                    Text(stringResource(R.string.zf_no_app), style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error, modifier = Modifier.announce())
                }
                Text(secondFactorUiState.secret.chunked(4).joinToString(" "),
                    fontFamily = FontFamily.Monospace)
                if (secretCopyable(LocalSdkLevel.current)) {
                    OutlinedButton(onClick = { copy(secondFactorUiState.secret) }, colors = secondaryButtonColors(), border = secondaryButtonRand()) {
                        Text(stringResource(R.string.zf_copy_key))
                    }
                }
                codeField(stringResource(R.string.zf_confirm_code))
                ButtonRow(
                    confirm = stringResource(R.string.zf_confirm),
                    onConfirm = {
                        if (zfCode.isBlank()) { codeMissing = true; codeFocus.requestFocus() } else onConfirm(zfCode)
                    },
                    onCancel = onBack,
                    running = secondFactorUiState.fetch.loading,
                )
            }
            // 3. Active: new codes or disable.
            secondFactorUiState.active == true -> {
                Text(pluralStringResource(R.plurals.zf_active, secondFactorUiState.codesRemaining, secondFactorUiState.codesRemaining),
                    color = MaterialTheme.colorScheme.primary)
                passwordField()
                codeField(stringResource(R.string.login_code))
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.small)) {
                    OutlinedButton(onClick = { protection.confirm(codesReason) { onNewCodes(zfCode) } }, enabled = zfCode.isNotBlank() && !secondFactorUiState.fetch.loading, colors = secondaryButtonColors(), border = secondaryButtonRand(zfCode.isNotBlank() && !secondFactorUiState.fetch.loading)) { Text(stringResource(R.string.zf_new_codes)) }
                    OutlinedButton(onClick = { onTurnOff(zfPassword, zfCode) },
                        enabled = zfPassword.isNotBlank() && zfCode.isNotBlank() && !secondFactorUiState.fetch.loading,
                        colors = secondaryButtonColors(),
                        border = secondaryButtonRand(zfPassword.isNotBlank() && zfCode.isNotBlank() && !secondFactorUiState.fetch.loading)) { Text(stringResource(R.string.zf_disable)) }
                }
            }
            // 4. Nicht eingerichtet.
            secondFactorUiState.active == false -> {
                passwordField()
                Button(onClick = { protection.confirm(codesReason) { onSetUp(zfPassword) } }, enabled = zfPassword.isNotBlank() && !secondFactorUiState.fetch.loading,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp)
                ) { Text(stringResource(R.string.zf_setup), fontWeight = FontWeight.SemiBold) }
            }
        }
    }
}
