package ch.brickinventoryapp.account.ui.screens

import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.ui.components.charByChar
import ch.brickinventoryapp.ui.components.readAloudAs
import ch.brickinventoryapp.ui.components.nebenKnopfFarben
import ch.brickinventoryapp.ui.components.nebenKnopfRand
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
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.rememberScrollState
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
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.account.ui.ZweiterFaktorUiState
import ch.brickinventoryapp.ui.components.LoginCard
import ch.brickinventoryapp.ui.components.LoginTitle
import ch.brickinventoryapp.ui.components.ErrorRow
import ch.brickinventoryapp.ui.components.LocalSchrittschutz
import ch.brickinventoryapp.model.step.Schrittaktion
import ch.brickinventoryapp.ui.components.fuer
import ch.brickinventoryapp.ui.components.PasswordField
import ch.brickinventoryapp.ui.components.BrandsHeader
import ch.brickinventoryapp.ui.components.Sichtschutz
import ch.brickinventoryapp.ui.components.Ueberdeckungsschutz
import ch.brickinventoryapp.ui.components.announce
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.theme.Lesebreite
import ch.brickinventoryapp.ui.theme.centeredUntil
import ch.brickinventoryapp.ui.util.SecretClipboard
import ch.brickinventoryapp.ui.util.LocalSdkLevel
import ch.brickinventoryapp.ui.util.secretCopyable
import ch.brickinventoryapp.ui.util.NumericInput
import ch.brickinventoryapp.model.util.otpauthAddress
import ch.brickinventoryapp.ui.components.ErklaerText

/**
 * Admin rights without a second factor: the server rejects almost every
 * request with 403 `zweiter_faktor_pflicht` until it's set up. Instead of an app
 * full of errors, only this mask stands there, needing only what the server
 * still allows. After the emergency codes, it continues with the same token ([onWeiter]).
 */
@Composable
fun ZweiterFaktorPflichtMaske(
    zustand: ZweiterFaktorUiState,
    onEinrichten: (passwort: String) -> Unit,
    onBestaetigen: (code: String) -> Unit,
    onWeiter: () -> Unit,
    onAbmelden: () -> Unit,
) {
    // remember, not rememberSaveable: password and code don't belong in the Bundle.
    var pwCurrent by remember { mutableStateOf("") }
    var faktorCode by remember { mutableStateOf("") }
    var withoutApp by rememberSaveable { mutableStateOf(false) }
    var secured by rememberSaveable { mutableStateOf(false) }
    val context = LocalContext.current
    val selectionTitle = stringResource(R.string.zf_open_app)
    val etikett = stringResource(R.string.app_name)
    val shareTitle = stringResource(R.string.zf_share_title)
    val protection = LocalSchrittschutz.current.fuer(Schrittaktion.ZWEITER_FAKTOR)
    val codesReason = stringResource(R.string.schritt_codes)
    val geheimnis = zustand.geheimnis
    // Clear after every successful step, otherwise the password would still be there at the next.
    LaunchedEffect(geheimnis, zustand.codes) { pwCurrent = ""; faktorCode = "" }
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        // A slipped-in tap would otherwise set up a foreign key here.
        Ueberdeckungsschutz()
        Column(
            Modifier.verticalScroll(rememberScrollState()).centeredUntil(Lesebreite.formular)
                .padding(horizontal = Abstaende.veryLarge, vertical = Abstaende.huge),
            verticalArrangement = Arrangement.spacedBy(Abstaende.mittel),
        ) {
            BrandsHeader(Modifier.fillMaxWidth())
            val schritt = when {
                zustand.codes.isNotEmpty() -> 3
                geheimnis != null -> 2
                zustand.aktiv == true -> null
                else -> 1
            }
            if (schritt != null) StepIndicator(schritt)
            // In the same card as sign-in and start password; steps and sign-out outside.
            LoginCard {
                when {
                    // The codes show in plain text exactly once: no screenshot of this.
                    zustand.codes.isNotEmpty() -> {
                        Sichtschutz()
                        LoginTitle(stringResource(R.string.zf_pflicht_codes_titel))
                        Text(stringResource(R.string.zf_codes_hint), style = MaterialTheme.typography.bodyMedium)
                        Text(zustand.codes.joinToString("\n"), fontFamily = FontFamily.Monospace,
                            modifier = Modifier.readAloudAs(zustand.codes.joinToString(", ") { charByChar(it) }))
                        val secure = rememberCodesSecure(zustand.codes) { secured = true }
                        OutlinedButton(onClick = secure, modifier = Modifier.fillMaxWidth(),
                            colors = nebenKnopfFarben(), border = nebenKnopfRand()) {
                            Text(stringResource(R.string.zf_codes_speichern))
                        }
                        OutlinedButton(
                            onClick = { partsCodes(context, shareTitle, zustand.codes) },
                            modifier = Modifier.fillMaxWidth(),
                            colors = nebenKnopfFarben(),
                            border = nebenKnopfRand(),
                        ) { Text(stringResource(R.string.zf_share)) }
                        CodesSecured(secured) { secured = it }
                        Button(onClick = onWeiter, enabled = secured, modifier = Modifier.fillMaxWidth()) {
                            Text(stringResource(R.string.zf_pflicht_weiter))
                        }
                    }
                    // On the phone, the otpauth link opens the authenticator app; the
                    // key stays for typing in by hand, in case none takes the link.
                    geheimnis != null -> {
                        Sichtschutz()
                        LoginTitle(stringResource(R.string.zf_pflicht_titel))
                        Text(stringResource(R.string.zf_step_app), style = MaterialTheme.typography.bodyMedium)
                        Button(
                            onClick = {
                                val uri = otpauthAddress(zustand.otpauth)
                                withoutApp = uri == null || !openWithSelection(context, uri, selectionTitle)
                            },
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text(stringResource(R.string.zf_open_app)) }
                        if (withoutApp) {
                            Text(stringResource(R.string.zf_no_app), style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.error, modifier = Modifier.announce())
                        }
                        Text(geheimnis.chunked(4).joinToString(" "), fontFamily = FontFamily.Monospace,
                            style = MaterialTheme.typography.bodyLarge)
                        if (secretCopyable(LocalSdkLevel.current)) {
                            OutlinedButton(
                                onClick = { SecretClipboard.copy(context, etikett, geheimnis) },
                                modifier = Modifier.fillMaxWidth(),
                                colors = nebenKnopfFarben(),
                                border = nebenKnopfRand(),
                            ) { Text(stringResource(R.string.zf_copy_key)) }
                        }
                        OutlinedTextField(
                            value = faktorCode, onValueChange = { faktorCode = NumericInput.quantity(it).take(8) },
                            label = { Text(stringResource(R.string.zf_confirm_code)) },
                            singleLine = true, shape = Formen.feld,
                            keyboardOptions = NumericInput.ganzzahlTastatur(),
                            modifier = Modifier.fillMaxWidth())
                        Button(
                            onClick = { onBestaetigen(faktorCode) },
                            enabled = faktorCode.isNotEmpty() && !zustand.abruf.laedt,
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text(stringResource(R.string.zf_confirm)) }
                    }
                    // Already set up, e.g. after a request that went out just before confirmation.
                    zustand.aktiv == true -> {
                        LoginTitle(stringResource(R.string.zf_enabled))
                        Button(onClick = onWeiter, modifier = Modifier.fillMaxWidth()) {
                            Text(stringResource(R.string.zf_pflicht_weiter))
                        }
                    }
                    else -> {
                        LoginTitle(stringResource(R.string.zf_pflicht_titel))
                        // The reason short, the details on request: at 200% font
                        // size three paragraphs filled the screen before the password field.
                        ErklaerText(stringResource(R.string.zf_pflicht_kurz),
                            stringResource(R.string.zf_pflicht_text), farbe = MaterialTheme.colorScheme.onSurface,
                            thema = stringResource(R.string.zf_title))
                        Text(stringResource(R.string.zf_pflicht_passwort), style = MaterialTheme.typography.bodyMedium)
                        PasswordField(pwCurrent, { pwCurrent = it }, stringResource(R.string.konto_password_current),
                            Modifier.fillMaxWidth())
                        // Right after that, the key stands there in plain text: the device lock comes first.
                        Button(
                            onClick = { protection.confirm(codesReason) { onEinrichten(pwCurrent) } },
                            enabled = pwCurrent.isNotEmpty() && !zustand.abruf.laedt,
                            modifier = Modifier.fillMaxWidth(),
                        // "Next" as in step 1 of 3: nothing is set up yet after this.
                        ) { Text(stringResource(R.string.setup_continue)) }
                    }
                }
            }
            if (zustand.abruf.laedt) LinearProgressIndicator(Modifier.fillMaxWidth())
            zustand.abruf.errorMessage?.let { ErrorRow(it) }
            // Centered, full width like "Back to sign-in": indented it stood next to nothing.
            TextButton(onClick = onAbmelden, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.settings_logout)) }
        }
    }
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
        horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
    ) {
        Checkbox(checked = secured, onCheckedChange = null)
        Text(stringResource(R.string.zf_codes_gesichert), style = MaterialTheme.typography.bodyMedium)
    }
}

/**
 * Where you stand in the three steps (password, app, codes). The mask is a
 * dead end until the end; without an indicator there was no telling how much was left.
 */
@Composable
private fun StepIndicator(aktuell: Int) {
    val namen = listOf(R.string.zf_schritt_passwort, R.string.zf_schritt_app, R.string.zf_schritt_codes)
    Column(verticalArrangement = Arrangement.spacedBy(Abstaende.tiny)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Abstaende.tiny)) {
            namen.indices.forEach { i ->
                // Open steps in outline: outlineVariant disappeared on the surface (1.13:1).
                val farbe = if (i < aktuell) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline
                Box(Modifier.weight(1f).height(Abstaende.tiny).background(farbe, Formen.strich))
            }
        }
        Text(pluralStringResource(R.plurals.zf_schritt, namen.size, aktuell, namen.size, stringResource(namen[aktuell - 1])),
            style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.primary)
    }
}
