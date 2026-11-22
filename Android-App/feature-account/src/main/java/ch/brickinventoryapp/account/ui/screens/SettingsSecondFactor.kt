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
    val draft = remember { FactorDraft() }
    // Clear the fields as soon as a step succeeds — otherwise the
    // password would still be there at the next step.
    LaunchedEffect(secondFactorUiState.active, secondFactorUiState.secret, secondFactorUiState.codes) {
        draft.password = ""; draft.code = ""
    }
    // New codes and a new key appear in plain text right after: only
    // behind the device lock (step protection), in addition to password or code.
    val protection = LocalStepGuard.current.forTarget(StepAction.SECOND_FACTOR)
    val codesReason = stringResource(R.string.step_codes)
    val loading = secondFactorUiState.fetch.loading

    SettingsCard(title = stringResource(R.string.zf_title), icon = Icons.Default.Security) {
        Text(stringResource(R.string.zf_hint), style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        secondFactorUiState.fetch.errorMessage?.let { ErrorRow(it) }

        when {
            // 1. Fresh codes: show once, then clear away. No screen capture of them.
            secondFactorUiState.codes.isNotEmpty() -> FreshCodes(secondFactorUiState.codes, onBack)
            // 2. Setup running: key into the app, confirm the code.
            secondFactorUiState.secret != null -> {
                KeyForTheApp(secondFactorUiState.secret, secondFactorUiState.otpauth)
                FactorCodeField(draft, stringResource(R.string.zf_confirm_code))
                ButtonRow(
                    confirm = stringResource(R.string.zf_confirm),
                    onConfirm = {
                        if (draft.code.isBlank()) { draft.codeMissing = true; draft.focus.requestFocus() } else onConfirm(draft.code)
                    },
                    onCancel = onBack,
                    running = loading,
                )
            }
            // 3. Active: new codes or disable.
            secondFactorUiState.active == true -> {
                Text(pluralStringResource(R.plurals.zf_active, secondFactorUiState.codesRemaining, secondFactorUiState.codesRemaining),
                    color = MaterialTheme.colorScheme.primary)
                FactorPasswordField(draft)
                FactorCodeField(draft, stringResource(R.string.login_code))
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.small)) {
                    val renewable = draft.code.isNotBlank() && !loading
                    OutlinedButton(onClick = { protection.confirm(codesReason) { onNewCodes(draft.code) } }, enabled = renewable,
                        colors = secondaryButtonColors(), border = secondaryButtonRand(renewable)) { Text(stringResource(R.string.zf_new_codes)) }
                    val disableable = draft.password.isNotBlank() && draft.code.isNotBlank() && !loading
                    OutlinedButton(onClick = { onTurnOff(draft.password, draft.code) },
                        enabled = disableable,
                        colors = secondaryButtonColors(),
                        border = secondaryButtonRand(disableable)) { Text(stringResource(R.string.zf_disable)) }
                }
            }
            // 4. Not set up.
            secondFactorUiState.active == false -> {
                FactorPasswordField(draft)
                Button(onClick = { protection.confirm(codesReason) { onSetUp(draft.password) } }, enabled = draft.password.isNotBlank() && !loading,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp)
                ) { Text(stringResource(R.string.zf_setup), fontWeight = FontWeight.SemiBold) }
            }
        }
    }
}

/** Password and code of the next step; the code field marks itself when Confirm finds it empty. */
private class FactorDraft {
    var password by mutableStateOf("")
    var code by mutableStateOf("")
    var codeMissing by mutableStateOf(false)
    val focus = FocusRequester()
}

@Composable
private fun FactorPasswordField(draft: FactorDraft) {
    PasswordField(draft.password, { draft.password = it }, stringResource(R.string.account_password_current),
        Modifier.fillMaxWidth())
}

@Composable
private fun FactorCodeField(draft: FactorDraft, label: String) {
    OutlinedTextField(
        value = draft.code, onValueChange = { draft.code = it.take(24); draft.codeMissing = false },
        label = { Text(label) },
        isError = draft.codeMissing,
        supportingText = if (draft.codeMissing) { { Text(stringResource(R.string.login_code_missing), Modifier.announce()) } } else null,
        modifier = Modifier.fillMaxWidth().focusRequester(draft.focus),
        singleLine = true, shape = Shapes.field,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii))
}

/** The fresh recovery codes, shown once: save, share, confirm they are secured, done. */
@Composable
private fun FreshCodes(codes: List<String>, onBack: () -> Unit) {
    val context = LocalContext.current
    val shareTitle = stringResource(R.string.zf_share_title)
    var secured by rememberSaveable(codes) { mutableStateOf(false) }
    PrivacyShield()
    Text(stringResource(R.string.zf_codes_title), fontWeight = FontWeight.SemiBold)
    Text(stringResource(R.string.zf_codes_hint), style = MaterialTheme.typography.bodySmall)
    // Read out character by character: as a word, TalkBack read "i9j0".
    Text(codes.joinToString("\n"),
        fontFamily = FontFamily.Monospace,
        modifier = Modifier.readAloudAs(codes.joinToString(", ") { charByChar(it) }))
    val secure = rememberCodesSecure(codes) { secured = true }
    Button(onClick = secure) { Text(stringResource(R.string.zf_codes_save)) }
    OutlinedButton(onClick = { partsCodes(context, shareTitle, codes) }, colors = secondaryButtonColors(), border = secondaryButtonRand()) { Text(stringResource(R.string.zf_share)) }
    CodesSecured(secured) { secured = it }
    Button(onClick = onBack, enabled = secured) { Text(stringResource(R.string.zf_codes_done)) }
}

/** The key: open the authenticator app with it, or type it in by hand (from API 33 also copy it). */
@Composable
private fun KeyForTheApp(secret: String, otpauth: String?) {
    val context = LocalContext.current
    val selectionTitle = stringResource(R.string.zf_open_app)
    val keyLabel = stringResource(R.string.app_name)
    var withoutApp by rememberSaveable { mutableStateOf(false) }
    PrivacyShield()
    Text(stringResource(R.string.zf_step_app), style = MaterialTheme.typography.bodySmall)
    Button(
        onClick = {
            val uri = otpauthAddress(otpauth)
            withoutApp = uri == null || !openWithSelection(context, uri, selectionTitle)
        },
        modifier = Modifier.fillMaxWidth()
    ) { Text(stringResource(R.string.zf_open_app)) }
    if (withoutApp) {
        Text(stringResource(R.string.zf_no_app), style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.error, modifier = Modifier.announce())
    }
    Text(secret.chunked(4).joinToString(" "),
        fontFamily = FontFamily.Monospace)
    if (secretCopyable(LocalSdkLevel.current)) {
        OutlinedButton(onClick = { SecretClipboard.copy(context, keyLabel, secret) }, colors = secondaryButtonColors(), border = secondaryButtonRand()) {
            Text(stringResource(R.string.zf_copy_key))
        }
    }
}
