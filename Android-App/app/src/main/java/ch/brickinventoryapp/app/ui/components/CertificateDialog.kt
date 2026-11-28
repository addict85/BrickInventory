package ch.brickinventoryapp.app.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.security.CertificateQuestion.CodeCheck
import ch.brickinventoryapp.security.CertificateUnresolved
import ch.brickinventoryapp.security.Transcript
import ch.brickinventoryapp.security.fingerprintReadable
import ch.brickinventoryapp.security.fingerprintStart
import ch.brickinventoryapp.ui.components.FingerprintField
import ch.brickinventoryapp.ui.components.OverlayGuard
import ch.brickinventoryapp.ui.components.announce
import ch.brickinventoryapp.ui.components.secondaryButtonColors
import ch.brickinventoryapp.ui.components.secondaryButtonRand
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.theme.windowSurface

/**
 * The question about a certificate that the app does not accept by itself. The fingerprint
 * is shown in the same notation as in the web app so that it can be compared.
 */
@Composable
fun CertificateDialog(
    question: CertificateUnresolved,
    userCaEnabled: Boolean,
    trustOn: (input: String?) -> Boolean,
    onUserCa: () -> Unit,
    onCancel: () -> Unit,
    /** Scanning the web app's certificate code; null where there is no camera (previews). */
    codeScan: CodeScan? = null,
) {
    if (question.kind == CertificateUnresolved.Kind.CODE_MISMATCH) CodeDeviationDialog(question, onCancel)
    else CertificateQuestionDialog(question, userCaEnabled, trustOn, onUserCa, onCancel, codeScan)
}

/**
 * The scanner and what a scanned code decides (CertificateCode in core-security).
 * A slot, so that the dialog stays testable without a camera.
 */
class CodeScan(
    val trust: (payload: String) -> CodeCheck,
    val scanner: @Composable (onResult: (String) -> Unit, onDismiss: () -> Unit) -> Unit,
)

/** Everything except CODE_MISMATCH: trust after scanning the web app's code, comparing or typing. */
@Composable
private fun CertificateQuestionDialog(
    question: CertificateUnresolved,
    userCaEnabled: Boolean,
    trustOn: (input: String?) -> Boolean,
    onUserCa: () -> Unit,
    onCancel: () -> Unit,
    codeScan: CodeScan?,
) {
    var scanning by rememberSaveable(question.fingerprint) { mutableStateOf(false) }
    var codeFinding by rememberSaveable(question.fingerprint) { mutableStateOf<CodeCheck?>(null) }
    val public = question.kind == CertificateUnresolved.Kind.FIRST_CONTACT || question.kind == CertificateUnresolved.Kind.KEY_NEW
    // Only where the web app knows the fingerprint: under a public CA it shows none.
    val scan = codeScan.takeIf { !public }
    if (scanning && scan != null) {
        ScannerDialog(scan, onDone = { scanning = false }) { codeFinding = it }
        return
    }
    val scanChoice: (@Composable () -> Unit)? =
        scan?.let { { ScanChoice(codeFinding) { codeFinding = null; scanning = true } } }
    QuestionDialog(question, userCaEnabled, trustOn, onUserCa, onCancel, scanChoice)
}

/** [scanChoice] replaces the old hint to scan a new sign-in code. */
@Composable
private fun QuestionDialog(
    question: CertificateUnresolved,
    userCaEnabled: Boolean,
    trustOn: (input: String?) -> Boolean,
    onUserCa: () -> Unit,
    onCancel: () -> Unit,
    scanChoice: (@Composable () -> Unit)?,
) {
    var input by rememberSaveable(question.fingerprint) { mutableStateOf("") }
    var finding by remember(question.fingerprint) { mutableStateOf<Transcript?>(null) }
    val host = question.key.substringBeforeLast(':')
    val (title, text) = titleAndText(question)
    val changed = question.kind == CertificateUnresolved.Kind.CHANGED || question.kind == CertificateUnresolved.Kind.KEY_NEW
    val public = question.kind == CertificateUnresolved.Kind.FIRST_CONTACT || question.kind == CertificateUnresolved.Kind.KEY_NEW
    val writeOff = question.transcriptNeeded
    val window = stringResource(title)
    AlertDialog(
        containerColor = windowSurface(),
        onDismissRequest = onCancel,
        properties = closable(input),
        modifier = Modifier.semantics { paneTitle = window },
        title = { Text(window, modifier = Modifier.semantics { heading() }) },
        text = {
            OverlayGuard()
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(Spacing.small)) {
                Text(stringResource(text, host))
                FingerprintDisplay(question, writeOff, changed)
                scanChoice?.invoke()
                if (writeOff) {
                    FingerprintField(
                        input = input,
                        onInput = { input = it; finding = null },
                        needed = Transcript.NEEDED,
                        help = stringResource(inputHelp(question.kind)),
                        error = { counted -> transcriptError(finding, counted) },
                    )
                    // Under a public CA the code carries no fingerprint; there it does not help.
                    if (!public && scanChoice == null) Text(stringResource(R.string.cert_changed_qr), style = MaterialTheme.typography.bodySmall)
                }
                // The only place where user CAs are asked about: on the error,
                // with an explanation. Afterwards the dialog asks again (USER_CA), again for typing.
                if (question.kind == CertificateUnresolved.Kind.UNKNOWN_CA && !userCaEnabled) {
                    TextButton(onClick = onUserCa) { Text(stringResource(R.string.cert_user_ca)) }
                }
            }
        },
        confirmButton = {
            TrustButton(changed, active = !writeOff || input.isNotBlank()) {
                finding = findingAfter(trustOn(input.takeIf { writeOff }), input, question.fingerprint)
            }
        },
        dismissButton = { TextButton(onClick = onCancel) { Text(stringResource(R.string.common_cancel)) } },
    )
}

/** The scanner over everything; a full match closes the question, anything else comes back as [onFinding]. */
@Composable
private fun ScannerDialog(scan: CodeScan, onDone: () -> Unit, onFinding: (CodeCheck) -> Unit) {
    Dialog(onDismissRequest = onDone, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        scan.scanner({ payload -> onDone(); onFinding(scan.trust(payload)) }, onDone)
    }
}

/** The comfortable way first; the result of the last scan below it, the manual comparison stays. */
@Composable
private fun ScanChoice(finding: CodeCheck?, onScan: () -> Unit) {
    OutlinedButton(onClick = onScan, colors = secondaryButtonColors(), border = secondaryButtonRand()) {
        Icon(Icons.Default.QrCodeScanner, null)
        Spacer(Modifier.width(Spacing.small))
        Text(stringResource(R.string.cert_scan_qr))
    }
    Text(stringResource(R.string.cert_scan_explain), style = MaterialTheme.typography.bodySmall)
    scanError(finding)?.let {
        Text(stringResource(it), Modifier.announce(), color = MaterialTheme.colorScheme.error,
            style = MaterialTheme.typography.bodySmall)
    }
}

/** A match closes the dialog and needs no text; every other result trusts nothing and says why. */
internal fun scanError(finding: CodeCheck?): Int? = when (finding) {
    null, CodeCheck.MATCHES -> null
    CodeCheck.FITS_NOT -> R.string.cert_scan_mismatch
    CodeCheck.UNKNOWN_VERSION -> R.string.cert_scan_unknown_version
    CodeCheck.NOT_A_CODE -> R.string.cert_scan_not_code
}

/** A changed key colors the button as a warning; otherwise the usual button. */
@Composable
private fun TrustButton(changed: Boolean, active: Boolean, onClick: () -> Unit) {
    TextButton(
        onClick = onClick,
        enabled = active,
        colors = if (changed) ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)
                 else ButtonDefaults.textButtonColors(),
    ) { Text(stringResource(if (changed) R.string.cert_trust_new else R.string.cert_trust)) }
}

/** If the app rejects although the transcript matches, “does not match” is still shown — otherwise the dialog would stay mute. */
private fun findingAfter(accepted: Boolean, input: String, fingerprint: String): Transcript? =
    if (accepted) null
    else Transcript.of(input, fingerprint).takeIf { it != Transcript.MATCHES } ?: Transcript.FITS_NOT

/** Previous and new fingerprint; when typing only the beginning. */
@Composable
private fun FingerprintDisplay(question: CertificateUnresolved, writeOff: Boolean, changed: Boolean) {
    question.expected?.let {
        Text(stringResource(R.string.cert_previous), style = MaterialTheme.typography.labelMedium)
        Text(fingerprintReadable(it), fontFamily = FontFamily.Monospace,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    // What is to be typed is not shown: otherwise one would copy it from an attacker's
    // screen instead of from the web app. The beginning only shows which line.
    Text(stringResource(if (writeOff) R.string.cert_starts_with else R.string.cert_fingerprint),
        style = MaterialTheme.typography.labelMedium)
    Text(if (writeOff) fingerprintStart(question.fingerprint) else fingerprintReadable(question.fingerprint),
        fontFamily = FontFamily.Monospace,
        // Without typing the comparison is the whole check: large enough to read.
        style = if (writeOff) MaterialTheme.typography.bodySmall else MaterialTheme.typography.titleMedium,
        color = if (changed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface)
}

/**
 * Server and scanned code name different keys: nothing to confirm, only
 * to explain. Both values are shown in full, nothing is typed here.
 */
@Composable
private fun CodeDeviationDialog(question: CertificateUnresolved, onClose: () -> Unit) {
    val title = stringResource(R.string.cert_title_code_mismatch)
    AlertDialog(
        containerColor = windowSurface(),
        onDismissRequest = onClose,
        modifier = Modifier.semantics { paneTitle = title },
        title = { Text(title, modifier = Modifier.semantics { heading() }) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(Spacing.small)) {
                Text(stringResource(R.string.cert_text_code_mismatch, question.key.substringBeforeLast(':')))
                question.expected?.let {
                    Text(stringResource(R.string.cert_aloud_code), style = MaterialTheme.typography.labelMedium)
                    Text(fingerprintReadable(it), fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
                }
                Text(stringResource(R.string.cert_from_server), style = MaterialTheme.typography.labelMedium)
                Text(fingerprintReadable(question.fingerprint), fontFamily = FontFamily.Monospace,
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
            }
        },
        confirmButton = { TextButton(onClick = onClose) { Text(stringResource(R.string.common_ok)) } },
    )
}

/**
 * A tap next to the dialog discarded the half-typed input. Back closes only as long as
 * nothing is typed; tapping outside never — Cancel stays the explicit way.
 */
internal fun closable(input: String) =
    DialogProperties(dismissOnBackPress = input.isEmpty(), dismissOnClickOutside = false)

/** “Too short” says how much is missing; “does not match” means the characters are wrong. */
@Composable
private fun transcriptError(finding: Transcript?, counted: Int): String? = when (finding) {
    null, Transcript.MATCHES -> null
    Transcript.EMPTY, Transcript.TO_SHORT -> stringResource(R.string.cert_input_too_short, counted, Transcript.NEEDED)
    Transcript.FITS_NOT -> stringResource(R.string.cert_input_wrong)
}

/** Where the transcript comes from: the web app does not know keys of a public CA, only the browser does. */
private fun inputHelp(kind: CertificateUnresolved.Kind): Int = when (kind) {
    CertificateUnresolved.Kind.KEY_NEW -> R.string.cert_key_new_input
    CertificateUnresolved.Kind.FIRST_CONTACT -> R.string.cert_first_contact_input
    CertificateUnresolved.Kind.CHANGED -> R.string.cert_changed_input
    else -> R.string.cert_unknown_input
}

/** Heading and explanation per kind of question. */
private fun titleAndText(question: CertificateUnresolved): Pair<Int, Int> = when (question.kind) {
    CertificateUnresolved.Kind.FIRST_CONTACT -> R.string.cert_title_first_contact to R.string.cert_text_first_contact_type
    CertificateUnresolved.Kind.UNKNOWN_CA -> R.string.cert_title_unknown to R.string.cert_text_unknown
    CertificateUnresolved.Kind.USER_CA -> R.string.cert_title_user_ca to R.string.cert_text_user_ca
    CertificateUnresolved.Kind.CHANGED -> R.string.cert_title_changed to R.string.cert_text_changed
    CertificateUnresolved.Kind.CODE_MISMATCH -> R.string.cert_title_code_mismatch to R.string.cert_text_code_mismatch
    CertificateUnresolved.Kind.KEY_NEW -> R.string.cert_title_key_new to R.string.cert_text_key_new
}
