package ch.brickinventoryapp.konto.ui.screens

import android.content.Context
import android.content.Intent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import ch.brickinventoryapp.ui.components.zeichenweise
import ch.brickinventoryapp.ui.components.vorgelesenAls
import ch.brickinventoryapp.ui.components.nebenKnopfFarben
import ch.brickinventoryapp.ui.components.nebenKnopfRand
import androidx.core.net.toUri
import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.semantics
import ch.brickinventoryapp.ui.components.FehlerZeile
import ch.brickinventoryapp.ui.components.ansagen
import ch.brickinventoryapp.ui.components.PasswortFeld
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.konto.ui.*
import ch.brickinventoryapp.model.ui.*
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.zustand.ui.*
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.konto.ui.ZweiterFaktorUiState
import ch.brickinventoryapp.ui.components.LocalSchrittschutz
import ch.brickinventoryapp.model.schritt.Schrittaktion
import ch.brickinventoryapp.ui.components.fuer
import ch.brickinventoryapp.ui.components.Sichtschutz
import ch.brickinventoryapp.data.util.GeheimeZwischenablage
import ch.brickinventoryapp.netz.util.otpauthAdresse
import ch.brickinventoryapp.ui.components.SettingsCard

/**
 * Die Notfallcodes an eine App der Wahl (Passwortmanager, Notizen): nur auf Tipp und
 * über die Auswahl des Systems, nicht über die Zwischenablage, deren Verlauf sie behielte.
 */
internal fun teileCodes(ctx: Context, titel: String, codes: List<String>) {
    val senden = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, codes.joinToString("\n"))
        putExtra(Intent.EXTRA_TITLE, titel)
    }
    runCatching { ctx.startActivity(Intent.createChooser(senden, titel)) }
}

/** false, wenn keine App den Link nimmt (Manifest: <queries> für otpauth). */
internal fun oeffneMitAuswahl(ctx: Context, uri: String, titel: String): Boolean {
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
 * sonst unbemerkt. Fehlt eine, bleibt der Schluessel zum Kopieren.
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
    var zfPasswort by remember { mutableStateOf("") }
    var zfCode     by remember { mutableStateOf("") }
    var ohneApp    by rememberSaveable { mutableStateOf(false) }
    var gesichert  by rememberSaveable(zfZustand.codes) { mutableStateOf(false) }
    val auswahlTitel = stringResource(R.string.zf_open_app)
    val kontext = LocalContext.current
    val schluesselEtikett = stringResource(R.string.app_name)
    val teilenTitel = stringResource(R.string.zf_share_title)
    val kopieren: (String) -> Unit = { text ->
        GeheimeZwischenablage.kopiere(kontext, schluesselEtikett, text)
    }
    // Neue Codes und ein neuer Schlüssel erscheinen gleich danach im Klartext: erst
    // nach der Gerätesperre (Schrittschutz), zusätzlich zu Passwort bzw. Code.
    val schutz = LocalSchrittschutz.current.fuer(Schrittaktion.ZWEITER_FAKTOR)
    val codesGrund = stringResource(R.string.schritt_codes)
    // Felder leeren, sobald ein Schritt gelungen ist — sonst stuende das
    // Passwort beim naechsten Schritt noch da.
    LaunchedEffect(zfZustand.aktiv, zfZustand.geheimnis, zfZustand.codes) { zfPasswort = ""; zfCode = "" }

    SettingsCard(title = stringResource(R.string.zf_title), icon = Icons.Default.Security) {
        Text(stringResource(R.string.zf_hint), style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (zfZustand.laedt) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (zfZustand.fehler != null) FehlerZeile(zfZustand.fehler)

        val passwortFeld: @Composable () -> Unit = {
            PasswortFeld(zfPasswort, { zfPasswort = it }, stringResource(R.string.konto_password_current),
                Modifier.fillMaxWidth())
        }
        val codeFeld: @Composable (String) -> Unit = { beschriftung ->
            OutlinedTextField(
                value = zfCode, onValueChange = { zfCode = it.take(24) },
                label = { Text(beschriftung) },
                modifier = Modifier.fillMaxWidth().semantics { contentType = ContentType.SmsOtpCode },
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
                    modifier = Modifier.vorgelesenAls(zfZustand.codes.joinToString(", ") { zeichenweise(it) }))
                OutlinedButton(onClick = { kopieren(zfZustand.codes.joinToString("\n")) }, colors = nebenKnopfFarben(), border = nebenKnopfRand()) { Text(stringResource(R.string.zf_copy)) }
                OutlinedButton(onClick = { teileCodes(kontext, teilenTitel, zfZustand.codes) }, colors = nebenKnopfFarben(), border = nebenKnopfRand()) { Text(stringResource(R.string.zf_share)) }
                CodesGesichert(gesichert) { gesichert = it }
                Button(onClick = onZurueck, enabled = gesichert) { Text(stringResource(R.string.zf_codes_done)) }
            }
            // 2. Einrichtung laeuft: Schluessel in die App, Code bestaetigen.
            zfZustand.geheimnis != null -> {
                Sichtschutz()
                Text(stringResource(R.string.zf_step_app), style = MaterialTheme.typography.bodySmall)
                Button(
                    onClick = {
                        val uri = otpauthAdresse(zfZustand.otpauth)
                        ohneApp = uri == null || !oeffneMitAuswahl(kontext, uri, auswahlTitel)
                    },
                    modifier = Modifier.fillMaxWidth()
                ) { Text(stringResource(R.string.zf_open_app)) }
                if (ohneApp) {
                    Text(stringResource(R.string.zf_no_app), style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error, modifier = Modifier.ansagen())
                }
                Text(zfZustand.geheimnis.chunked(4).joinToString(" "),
                    fontFamily = FontFamily.Monospace)
                OutlinedButton(onClick = { kopieren(zfZustand.geheimnis) }, colors = nebenKnopfFarben(), border = nebenKnopfRand()) {
                    Text(stringResource(R.string.zf_copy_key))
                }
                codeFeld(stringResource(R.string.zf_confirm_code))
                Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                    Button(onClick = { onBestaetigen(zfCode) }, enabled = zfCode.isNotBlank() && !zfZustand.laedt) { Text(stringResource(R.string.zf_confirm)) }
                    OutlinedButton(onClick = onZurueck, colors = nebenKnopfFarben(), border = nebenKnopfRand()) { Text(stringResource(R.string.common_cancel)) }
                }
            }
            // 3. Aktiv: neue Codes oder abschalten.
            zfZustand.aktiv == true -> {
                Text(pluralStringResource(R.plurals.zf_active, zfZustand.codesUebrig, zfZustand.codesUebrig),
                    color = MaterialTheme.colorScheme.primary)
                passwortFeld()
                codeFeld(stringResource(R.string.login_code))
                Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                    OutlinedButton(onClick = { schutz.bestaetige(codesGrund) { onNeueCodes(zfCode) } }, enabled = zfCode.isNotBlank() && !zfZustand.laedt, colors = nebenKnopfFarben(), border = nebenKnopfRand(zfCode.isNotBlank() && !zfZustand.laedt)) { Text(stringResource(R.string.zf_new_codes)) }
                    OutlinedButton(onClick = { onAbschalten(zfPasswort, zfCode) },
                        enabled = zfPasswort.isNotBlank() && zfCode.isNotBlank() && !zfZustand.laedt,
                        colors = nebenKnopfFarben(),
                        border = nebenKnopfRand(zfPasswort.isNotBlank() && zfCode.isNotBlank() && !zfZustand.laedt)) { Text(stringResource(R.string.zf_disable)) }
                }
            }
            // 4. Nicht eingerichtet.
            zfZustand.aktiv == false -> {
                passwortFeld()
                Button(onClick = { schutz.bestaetige(codesGrund) { onEinrichten(zfPasswort) } }, enabled = zfPasswort.isNotBlank() && !zfZustand.laedt,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp)
                ) { Text(stringResource(R.string.zf_setup), fontWeight = FontWeight.SemiBold) }
            }
        }
    }
}
