package ch.brickinventoryapp.app.ui.components

import androidx.compose.foundation.layout.Arrangement
import ch.brickinventoryapp.ui.theme.windowSurface
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.security.CertificateUnresolved
import ch.brickinventoryapp.security.fingerprintStart
import ch.brickinventoryapp.security.fingerprintReadable
import ch.brickinventoryapp.ui.components.OverlayGuard
import ch.brickinventoryapp.ui.components.FingerprintField
import ch.brickinventoryapp.security.Transcript
import androidx.compose.ui.window.DialogProperties

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
    /** With a screen lock a new key from Android 16 is confirmed with it; without one, typed off. */
    deviceSecure: Boolean = true,
) {
    if (question.kind == CertificateUnresolved.Kind.CODE_MISMATCH) CodeDeviationDialog(question, onCancel)
    else CertificateQuestionDialog(question, userCaEnabled, trustOn, onUserCa, onCancel, deviceSecure)
}

/** Everything except CODE_MISMATCH: trust after comparing or typing. */
@Composable
private fun CertificateQuestionDialog(
    question: CertificateUnresolved,
    userCaEnabled: Boolean,
    trustOn: (input: String?) -> Boolean,
    onUserCa: () -> Unit,
    onCancel: () -> Unit,
    deviceSecure: Boolean,
) {
    var input by rememberSaveable(question.fingerprint) { mutableStateOf("") }
    var finding by remember(question.fingerprint) { mutableStateOf<Transcript?>(null) }
    // Voluntary on first contact with CT requirement: whoever types sees only the beginning as usual.
    var typeInSelected by rememberSaveable(question.fingerprint) { mutableStateOf(false) }
    val host = question.key.substringBeforeLast(':')
    val (title, text) = titleAndText(question)
    val changed = question.kind == CertificateUnresolved.Kind.CHANGED || question.kind == CertificateUnresolved.Kind.KEY_NEW
    val firstContact = question.kind == CertificateUnresolved.Kind.FIRST_CONTACT
    val public = firstContact || question.kind == CertificateUnresolved.Kind.KEY_NEW
    val byDevice = question.deviceConfirmationNeeded && deviceSecure
    val writeOff = mustTranscribe(question, typeInSelected, deviceSecure)
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
                if (byDevice) Text(stringResource(R.string.cert_device_confirm), style = MaterialTheme.typography.bodySmall)
                if (firstContact && !writeOff) {
                    TextButton(onClick = { typeInSelected = true }) { Text(stringResource(R.string.cert_first_contact_type)) }
                }
                if (writeOff) {
                    FingerprintField(
                        input = input,
                        onInput = { input = it; finding = null },
                        needed = Transcript.NEEDED,
                        help = stringResource(inputHelp(question.kind)),
                        error = { counted -> transcriptError(finding, counted) },
                    )
                    // Under a public CA the code carries no fingerprint; there it does not help.
                    if (!public) Text(stringResource(R.string.cert_changed_qr), style = MaterialTheme.typography.bodySmall)
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

/** Without CT, when chosen on first contact, or a new key from Android 16 without a screen lock. */
private fun mustTranscribe(question: CertificateUnresolved, typeInSelected: Boolean, deviceSecure: Boolean): Boolean =
    question.transcriptNeeded || question.kind == CertificateUnresolved.Kind.FIRST_CONTACT && typeInSelected ||
        question.deviceConfirmationNeeded && !deviceSecure

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

/** Heading and explanation per kind of question; without CT requirement the first contact explains typing. */
private fun titleAndText(question: CertificateUnresolved): Pair<Int, Int> = when (question.kind) {
    CertificateUnresolved.Kind.FIRST_CONTACT -> R.string.cert_title_first_contact to
        if (question.transcriptNeeded) R.string.cert_text_first_contact_type else R.string.cert_text_first_contact
    CertificateUnresolved.Kind.UNKNOWN_CA -> R.string.cert_title_unknown to R.string.cert_text_unknown
    CertificateUnresolved.Kind.USER_CA -> R.string.cert_title_user_ca to R.string.cert_text_user_ca
    CertificateUnresolved.Kind.CHANGED -> R.string.cert_title_changed to R.string.cert_text_changed
    CertificateUnresolved.Kind.CODE_MISMATCH -> R.string.cert_title_code_mismatch to R.string.cert_text_code_mismatch
    CertificateUnresolved.Kind.KEY_NEW -> R.string.cert_title_key_new to R.string.cert_text_key_new
}
