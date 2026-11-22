package ch.brickinventoryapp.account.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.account.ui.SecondFactorUiState
import ch.brickinventoryapp.model.step.StepAction
import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.model.ui.loading
import ch.brickinventoryapp.model.util.otpauthAddress
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.BrandsHeader
import ch.brickinventoryapp.ui.components.ErrorRow
import ch.brickinventoryapp.ui.components.ExplainText
import ch.brickinventoryapp.ui.components.LocalStepGuard
import ch.brickinventoryapp.ui.components.LoginCard
import ch.brickinventoryapp.ui.components.LoginTitle
import ch.brickinventoryapp.ui.components.OverlayGuard
import ch.brickinventoryapp.ui.components.PasswordField
import ch.brickinventoryapp.ui.components.PrivacyShield
import ch.brickinventoryapp.ui.components.announce
import ch.brickinventoryapp.ui.components.charByChar
import ch.brickinventoryapp.ui.components.forTarget
import ch.brickinventoryapp.ui.components.readAloudAs
import ch.brickinventoryapp.ui.components.secondaryButtonColors
import ch.brickinventoryapp.ui.components.secondaryButtonRand
import ch.brickinventoryapp.ui.theme.ReadingWidth
import ch.brickinventoryapp.ui.theme.Shapes
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.theme.centeredUntil
import ch.brickinventoryapp.ui.util.LocalSdkLevel
import ch.brickinventoryapp.ui.util.NumericInput
import ch.brickinventoryapp.ui.util.SecretClipboard
import ch.brickinventoryapp.ui.util.secretCopyable

/**
 * Admin rights without a second factor: the server rejects almost every
 * request with 403 `second_factor_required` until it's set up. Instead of an app
 * full of errors, only this mask stands there, needing only what the server
 * still allows. After the emergency codes, it continues with the same token ([onNext]).
 */
@Composable
fun SecondFactorRequiredMask(
    condition: SecondFactorUiState,
    onSetUp: (password: String) -> Unit,
    onConfirm: (code: String) -> Unit,
    onNext: () -> Unit,
    onLogout: () -> Unit,
) {
    // remember, not rememberSaveable: password and code don't belong in the Bundle.
    var pwCurrent by remember { mutableStateOf("") }
    var factorCode by remember { mutableStateOf("") }
    val secret = condition.secret
    // Clear after every successful step, otherwise the password would still be there at the next.
    LaunchedEffect(secret, condition.codes) { pwCurrent = ""; factorCode = "" }
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        // A slipped-in tap would otherwise set up a foreign key here.
        OverlayGuard()
        Column(
            Modifier.verticalScroll(rememberScrollState()).centeredUntil(ReadingWidth.form)
                .padding(horizontal = Spacing.veryLarge, vertical = Spacing.huge),
            verticalArrangement = Arrangement.spacedBy(Spacing.medium),
        ) {
            BrandsHeader(Modifier.fillMaxWidth())
            val step = when {
                condition.codes.isNotEmpty() -> 3
                secret != null -> 2
                condition.active == true -> null
                else -> 1
            }
            if (step != null) StepIndicator(step)
            // In the same card as sign-in and start password; steps and sign-out outside.
            LoginCard {
                when {
                    // The codes show in plain text exactly once: no screenshot of this.
                    condition.codes.isNotEmpty() -> MaskCodes(condition.codes, onNext)
                    // On the phone, the otpauth link opens the authenticator app; the
                    // key stays for typing in by hand, in case none takes the link.
                    secret != null -> MaskKey(condition, secret, factorCode, { factorCode = it }, onConfirm)
                    // Already set up, e.g. after a request that went out just before confirmation.
                    condition.active == true -> {
                        LoginTitle(stringResource(R.string.zf_enabled))
                        Button(onClick = onNext, modifier = Modifier.fillMaxWidth()) {
                            Text(stringResource(R.string.zf_required_next))
                        }
                    }
                    else -> MaskStart(pwCurrent, { pwCurrent = it }, condition.fetch.loading, onSetUp)
                }
            }
            if (condition.fetch.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            condition.fetch.errorMessage?.let { ErrorRow(it) }
            // Centered, full width like "Back to sign-in": indented it stood next to nothing.
            TextButton(onClick = onLogout, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.settings_logout)) }
        }
    }
}

/** Step 3: the recovery codes, saved or shared before "Next". */
@Composable
private fun MaskCodes(codes: List<String>, onNext: () -> Unit) {
    val context = LocalContext.current
    val shareTitle = stringResource(R.string.zf_share_title)
    var secured by rememberSaveable { mutableStateOf(false) }
    PrivacyShield()
    LoginTitle(stringResource(R.string.zf_required_codes_title))
    Text(stringResource(R.string.zf_codes_hint), style = MaterialTheme.typography.bodyMedium)
    Text(codes.joinToString("\n"), fontFamily = FontFamily.Monospace,
        modifier = Modifier.readAloudAs(codes.joinToString(", ") { charByChar(it) }))
    val secure = rememberCodesSecure(codes) { secured = true }
    OutlinedButton(onClick = secure, modifier = Modifier.fillMaxWidth(),
        colors = secondaryButtonColors(), border = secondaryButtonRand()) {
        Text(stringResource(R.string.zf_codes_save))
    }
    OutlinedButton(
        onClick = { partsCodes(context, shareTitle, codes) },
        modifier = Modifier.fillMaxWidth(),
        colors = secondaryButtonColors(),
        border = secondaryButtonRand(),
    ) { Text(stringResource(R.string.zf_share)) }
    CodesSecured(secured) { secured = it }
    Button(onClick = onNext, enabled = secured, modifier = Modifier.fillMaxWidth()) {
        Text(stringResource(R.string.zf_required_next))
    }
}

/** Step 2: the key into the authenticator app, then its first code. */
@Composable
private fun MaskKey(
    condition: SecondFactorUiState,
    secret: String,
    factorCode: String,
    onFactorCode: (String) -> Unit,
    onConfirm: (code: String) -> Unit,
) {
    val context = LocalContext.current
    val selectionTitle = stringResource(R.string.zf_open_app)
    val tag = stringResource(R.string.app_name)
    var withoutApp by rememberSaveable { mutableStateOf(false) }
    PrivacyShield()
    LoginTitle(stringResource(R.string.zf_required_title))
    Text(stringResource(R.string.zf_step_app), style = MaterialTheme.typography.bodyMedium)
    Button(
        onClick = {
            val uri = otpauthAddress(condition.otpauth)
            withoutApp = uri == null || !openWithSelection(context, uri, selectionTitle)
        },
        modifier = Modifier.fillMaxWidth(),
    ) { Text(stringResource(R.string.zf_open_app)) }
    if (withoutApp) {
        Text(stringResource(R.string.zf_no_app), style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.error, modifier = Modifier.announce())
    }
    Text(secret.chunked(4).joinToString(" "), fontFamily = FontFamily.Monospace,
        style = MaterialTheme.typography.bodyLarge)
    if (secretCopyable(LocalSdkLevel.current)) {
        OutlinedButton(
            onClick = { SecretClipboard.copy(context, tag, secret) },
            modifier = Modifier.fillMaxWidth(),
            colors = secondaryButtonColors(),
            border = secondaryButtonRand(),
        ) { Text(stringResource(R.string.zf_copy_key)) }
    }
    OutlinedTextField(
        value = factorCode, onValueChange = { onFactorCode(NumericInput.quantity(it).take(8)) },
        label = { Text(stringResource(R.string.zf_confirm_code)) },
        singleLine = true, shape = Shapes.field,
        keyboardOptions = NumericInput.integerKeyboard(),
        modifier = Modifier.fillMaxWidth())
    Button(
        onClick = { onConfirm(factorCode) },
        enabled = factorCode.isNotEmpty() && !condition.fetch.loading,
        modifier = Modifier.fillMaxWidth(),
    ) { Text(stringResource(R.string.zf_confirm)) }
}

/** Step 1: why it is required, and the password that starts the setup. */
@Composable
private fun MaskStart(pwCurrent: String, onPassword: (String) -> Unit, loading: Boolean, onSetUp: (password: String) -> Unit) {
    val protection = LocalStepGuard.current.forTarget(StepAction.SECOND_FACTOR)
    val codesReason = stringResource(R.string.step_codes)
    LoginTitle(stringResource(R.string.zf_required_title))
    // The reason short, the details on request: at 200% font
    // size three paragraphs filled the screen before the password field.
    ExplainText(stringResource(R.string.zf_required_short),
        stringResource(R.string.zf_required_text), color = MaterialTheme.colorScheme.onSurface,
        theme = stringResource(R.string.zf_title))
    Text(stringResource(R.string.zf_required_password), style = MaterialTheme.typography.bodyMedium)
    PasswordField(pwCurrent, onPassword, stringResource(R.string.account_password_current),
        Modifier.fillMaxWidth())
    // Right after that, the key stands there in plain text: the device lock comes first.
    Button(
        onClick = { protection.confirm(codesReason) { onSetUp(pwCurrent) } },
        enabled = pwCurrent.isNotEmpty() && !loading,
        modifier = Modifier.fillMaxWidth(),
    // "Next" as in step 1 of 3: nothing is set up yet after this.
    ) { Text(stringResource(R.string.setup_continue)) }
}
/**
 * A checkbox before "Next": the codes appear only this one time, and without the
 * checkbox they could be tapped away before they were saved anywhere.
 */
@Composable
internal fun CodesSecured(secured: Boolean, changeOn: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 48.dp)
            .toggleable(value = secured, role = Role.Checkbox, onValueChange = changeOn),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.small),
    ) {
        Checkbox(checked = secured, onCheckedChange = null)
        Text(stringResource(R.string.zf_codes_saved), style = MaterialTheme.typography.bodyMedium)
    }
}

/**
 * Where you stand in the three steps (password, app, codes). The mask is a
 * dead end until the end; without an indicator there was no telling how much was left.
 */
@Composable
private fun StepIndicator(current: Int) {
    val names = listOf(R.string.zf_step_password, R.string.zf_step_app_title, R.string.zf_step_codes)
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.tiny)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.tiny)) {
            names.indices.forEach { i ->
                // Open steps in outline: outlineVariant disappeared on the surface (1.13:1).
                val color = if (i < current) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline
                Box(Modifier.weight(1f).height(Spacing.tiny).background(color, Shapes.stroke))
            }
        }
        Text(pluralStringResource(R.plurals.zf_step, names.size, current, names.size, stringResource(names[current - 1])),
            style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.primary)
    }
}
