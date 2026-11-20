package ch.brickinventoryapp.konto.ui.screens

import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.model.ui.errorMessage
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import ch.brickinventoryapp.ui.components.charByChar
import ch.brickinventoryapp.ui.components.readAloudAs
import ch.brickinventoryapp.ui.components.nebenKnopfFarben
import ch.brickinventoryapp.ui.components.nebenKnopfRand
import androidx.core.net.toUri
import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import ch.brickinventoryapp.ui.components.Knopfzeile
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType
import ch.brickinventoryapp.ui.components.ErrorRow
import ch.brickinventoryapp.ui.components.announce
import ch.brickinventoryapp.ui.components.PasswordField
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.titel
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.konto.ui.ZweiterFaktorUiState
import ch.brickinventoryapp.ui.components.LocalSchrittschutz
import ch.brickinventoryapp.model.schritt.Schrittaktion
import ch.brickinventoryapp.ui.components.fuer
import ch.brickinventoryapp.ui.components.Sichtschutz
import ch.brickinventoryapp.ui.util.SecretClipboard
import ch.brickinventoryapp.ui.util.LocalSdkLevel
import ch.brickinventoryapp.ui.util.secretCopyable
import ch.brickinventoryapp.model.util.otpauthAddress
import ch.brickinventoryapp.ui.components.SettingsCard

/** Der vorgeschlagene Name; den Ort wählt der Nutzer im Speicherdialog des Systems. */
internal const val CODES_FILE = "brickinventory-wiederherstellungscodes.txt"

/** false, wenn der gewählte Ort nicht beschreibbar war; dann bleibt „Teilen“. */
internal fun writeCodes(resolver: ContentResolver, ziel: Uri, codes: List<String>): Boolean = runCatching {
    resolver.openOutputStream(ziel, "wt")?.use { it.write((codes.joinToString("\n") + "\n").toByteArray()) } != null
}.getOrDefault(false)

/**
 * Die Codes als Datei an einen Ort der Wahl (ACTION_CREATE_DOCUMENT): Beim Teilen läse die
 * Ziel-App mit, und manche legen den Text in ihren Verlauf oder in eine Cloud. [onSecured]
 * hakt „gesichert“ an, sobald die Datei geschrieben ist.
 */
@Composable
internal fun rememberCodesSecure(codes: List<String>, onSecured: () -> Unit): () -> Unit {
    val resolver = LocalContext.current.contentResolver
    val aktuell by rememberUpdatedState(codes)
    val waehlen = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/plain")) { ziel ->
        if (ziel != null && writeCodes(resolver, ziel, aktuell)) onSecured()
    }
    return { runCatching { waehlen.launch(CODES_FILE) } }
}

/**
 * Die Notfallcodes an eine App der Wahl (Passwortmanager, Notizen): nur auf Tipp und
 * über die Auswahl des Systems, nicht über die Zwischenablage, deren Verlauf sie behielte.
 * Zweite Wahl nach [rememberCodesSecure], für Geräte ohne Dokumentanbieter.
 */
internal fun partsCodes(ctx: Context, titel: String, codes: List<String>) {
    val senden = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, codes.joinToString("\n"))
        putExtra(Intent.EXTRA_TITLE, titel)
    }
    runCatching { ctx.startActivity(Intent.createChooser(senden, titel)) }
}

/** false, wenn keine App den Link nimmt (Manifest: <queries> für otpauth). */
internal fun openWithSelection(ctx: Context, uri: String, titel: String): Boolean {
    val ansicht = Intent(Intent.ACTION_VIEW, uri.toUri())
    if (ansicht.resolveActivity(ctx.packageManager) == null) return false
    return runCatching { ctx.startActivity(Intent.createChooser(ansicht, titel)) }.isSuccess
}

/**
 * Zweiter Faktor: einrichten, abschalten, neue Wiederherstellungscodes.
 *
 * Auf dem Telefon braucht es keinen QR-Code: Der otpauth-Link oeffnet die
 * Authenticator-App. Immer über die Auswahl des Systems: Der Link trägt das
 * Geheimnis, und eine App, die sich als Standard dafür eingetragen hat, bekäme es
 * sonst unbemerkt. Fehlt eine, bleibt der Schluessel zum Abtippen (ab API 33 auch zum Kopieren).
 */
@Composable
internal fun ZweiterFaktorCard(
    zfZustand: ZweiterFaktorUiState,
    onEinrichten: (String) -> Unit,
    onBestaetigen: (String) -> Unit,
    onNeueCodes: (String) -> Unit,
    onAbschalten: (String, String) -> Unit,
    onZurueck: () -> Unit,
) {
    // Passwörter nur in remember, siehe oben.
    var zfPassword by remember { mutableStateOf("") }
    var zfCode     by remember { mutableStateOf("") }
    var withoutApp    by rememberSaveable { mutableStateOf(false) }
    var secured  by rememberSaveable(zfZustand.codes) { mutableStateOf(false) }
    // Bestätigen bleibt antippbar; ohne Code markiert es das Feld und setzt den Cursor hinein.
    var codeMissing  by rememberSaveable { mutableStateOf(false) }
    val codeFocus = remember { FocusRequester() }
    val selectionTitle = stringResource(R.string.zf_open_app)
    val context = LocalContext.current
    val keyLabel = stringResource(R.string.app_name)
    val shareTitle = stringResource(R.string.zf_share_title)
    val kopieren: (String) -> Unit = { text ->
        SecretClipboard.copy(context, keyLabel, text)
    }
    // Neue Codes und ein neuer Schlüssel erscheinen gleich danach im Klartext: erst
    // nach der Gerätesperre (Schrittschutz), zusätzlich zu Passwort bzw. Code.
    val protection = LocalSchrittschutz.current.fuer(Schrittaktion.ZWEITER_FAKTOR)
    val codesReason = stringResource(R.string.schritt_codes)
    // Felder leeren, sobald ein Schritt gelungen ist — sonst stuende das
    // Passwort beim naechsten Schritt noch da.
    LaunchedEffect(zfZustand.aktiv, zfZustand.geheimnis, zfZustand.codes) { zfPassword = ""; zfCode = "" }

    SettingsCard(title = stringResource(R.string.zf_title), icon = Icons.Default.Security) {
        Text(stringResource(R.string.zf_hint), style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (zfZustand.abruf.laedt) LinearProgressIndicator(Modifier.fillMaxWidth())
        zfZustand.abruf.errorMessage?.let { ErrorRow(it) }

        val passwordField: @Composable () -> Unit = {
            PasswordField(zfPassword, { zfPassword = it }, stringResource(R.string.konto_password_current),
                Modifier.fillMaxWidth())
        }
        val codeField: @Composable (String) -> Unit = { beschriftung ->
            OutlinedTextField(
                value = zfCode, onValueChange = { zfCode = it.take(24); codeMissing = false },
                label = { Text(beschriftung) },
                isError = codeMissing,
                supportingText = if (codeMissing) { { Text(stringResource(R.string.login_code_fehlt), Modifier.announce()) } } else null,
                modifier = Modifier.fillMaxWidth().focusRequester(codeFocus),
                singleLine = true, shape = Formen.feld,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii))
        }

        when {
            // 1. Frische Codes: einmal zeigen, dann wegraeumen. Kein Bildschirmfoto davon.
            zfZustand.codes.isNotEmpty() -> {
                Sichtschutz()
                Text(stringResource(R.string.zf_codes_title), fontWeight = FontWeight.SemiBold)
                Text(stringResource(R.string.zf_codes_hint), style = MaterialTheme.typography.bodySmall)
                // Zeichen für Zeichen vorgelesen: Als Wort las TalkBack „i9j0“.
                Text(zfZustand.codes.joinToString("\n"),
                    fontFamily = FontFamily.Monospace,
                    modifier = Modifier.readAloudAs(zfZustand.codes.joinToString(", ") { charByChar(it) }))
                val secure = rememberCodesSecure(zfZustand.codes) { secured = true }
                Button(onClick = secure) { Text(stringResource(R.string.zf_codes_speichern)) }
                OutlinedButton(onClick = { partsCodes(context, shareTitle, zfZustand.codes) }, colors = nebenKnopfFarben(), border = nebenKnopfRand()) { Text(stringResource(R.string.zf_share)) }
                CodesSecured(secured) { secured = it }
                Button(onClick = onZurueck, enabled = secured) { Text(stringResource(R.string.zf_codes_done)) }
            }
            // 2. Einrichtung laeuft: Schluessel in die App, Code bestaetigen.
            zfZustand.geheimnis != null -> {
                Sichtschutz()
                Text(stringResource(R.string.zf_step_app), style = MaterialTheme.typography.bodySmall)
                Button(
                    onClick = {
                        val uri = otpauthAddress(zfZustand.otpauth)
                        withoutApp = uri == null || !openWithSelection(context, uri, selectionTitle)
                    },
                    modifier = Modifier.fillMaxWidth()
                ) { Text(stringResource(R.string.zf_open_app)) }
                if (withoutApp) {
                    Text(stringResource(R.string.zf_no_app), style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error, modifier = Modifier.announce())
                }
                Text(zfZustand.geheimnis.chunked(4).joinToString(" "),
                    fontFamily = FontFamily.Monospace)
                if (secretCopyable(LocalSdkLevel.current)) {
                    OutlinedButton(onClick = { kopieren(zfZustand.geheimnis) }, colors = nebenKnopfFarben(), border = nebenKnopfRand()) {
                        Text(stringResource(R.string.zf_copy_key))
                    }
                }
                codeField(stringResource(R.string.zf_confirm_code))
                Knopfzeile(
                    bestaetigen = stringResource(R.string.zf_confirm),
                    onBestaetigen = {
                        if (zfCode.isBlank()) { codeMissing = true; codeFocus.requestFocus() } else onBestaetigen(zfCode)
                    },
                    onAbbrechen = onZurueck,
                    laeuft = zfZustand.abruf.laedt,
                )
            }
            // 3. Aktiv: neue Codes oder abschalten.
            zfZustand.aktiv == true -> {
                Text(pluralStringResource(R.plurals.zf_active, zfZustand.codesUebrig, zfZustand.codesUebrig),
                    color = MaterialTheme.colorScheme.primary)
                passwordField()
                codeField(stringResource(R.string.login_code))
                Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                    OutlinedButton(onClick = { protection.confirm(codesReason) { onNeueCodes(zfCode) } }, enabled = zfCode.isNotBlank() && !zfZustand.abruf.laedt, colors = nebenKnopfFarben(), border = nebenKnopfRand(zfCode.isNotBlank() && !zfZustand.abruf.laedt)) { Text(stringResource(R.string.zf_new_codes)) }
                    OutlinedButton(onClick = { onAbschalten(zfPassword, zfCode) },
                        enabled = zfPassword.isNotBlank() && zfCode.isNotBlank() && !zfZustand.abruf.laedt,
                        colors = nebenKnopfFarben(),
                        border = nebenKnopfRand(zfPassword.isNotBlank() && zfCode.isNotBlank() && !zfZustand.abruf.laedt)) { Text(stringResource(R.string.zf_disable)) }
                }
            }
            // 4. Nicht eingerichtet.
            zfZustand.aktiv == false -> {
                passwordField()
                Button(onClick = { protection.confirm(codesReason) { onEinrichten(zfPassword) } }, enabled = zfPassword.isNotBlank() && !zfZustand.abruf.laedt,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp)
                ) { Text(stringResource(R.string.zf_setup), fontWeight = FontWeight.SemiBold) }
            }
        }
    }
}
