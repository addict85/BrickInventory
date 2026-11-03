package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.components.AuswahlChip
import androidx.core.net.toUri
import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.util.passwortZuKurz
import ch.brickinventoryapp.ui.theme.Abstaende

/**
 * Das eigene Konto: Profil und Passwort. Über /auth/profile und
 * /auth/change-password, die auch das Bearer-Token der App annehmen.
 */
@Composable
internal fun KontoCard(
    // `kontoZustand`, nicht `zustand`: In dieser Datei nimmt GeraeteCard einen
    // Parameter `zustand` vom Typ GeraeteUiState. Der Compiler trennt die
    // Gültigkeitsbereiche, UiStateFieldsTest bestimmt den Typ aber je Name und Datei
    // und hielte die Felder für fehlend.
    kontoZustand: ch.brickinventoryapp.ui.KontoUiState,
    onSpeichern: (String, String, String, String, String?, String?) -> Unit,
    onPasswort: (String, String, String?) -> Unit,
    onMeldungWeg: () -> Unit,
) {
    val profil = kontoZustand.profil
    // Die Felder werden aus dem Serverstand vorbelegt und danach vom Nutzer
    // gefuehrt. `remember(profil)` und nicht `remember`: Nach dem Speichern
    // holt das ViewModel das Profil neu, und die Felder sollen den
    // NORMALISIERTEN Stand des Servers zeigen, nicht das Getippte.
    var benutzername by remember(profil) { mutableStateOf(profil?.username.orEmpty()) }
    var email        by remember(profil) { mutableStateOf(profil?.email.orEmpty()) }
    var vorname      by remember(profil) { mutableStateOf(profil?.firstName.orEmpty()) }
    var nachname     by remember(profil) { mutableStateOf(profil?.lastName.orEmpty()) }
    // remember, nicht rememberSaveable: Gesicherter Zustand landet im Bundle und bei
    // Prozesstod auf der Platte (ActivityManager) — kein Ort für Passwörter und Codes.
    var pwAktuell    by remember { mutableStateOf("") }
    var pwFuerEmail  by remember(profil) { mutableStateOf("") }
    var pwNeu        by remember { mutableStateOf("") }
    var faktorCode   by remember { mutableStateOf("") }
    val code = faktorCode.takeIf { kontoZustand.codeNoetig && it.isNotBlank() }

    val emailNeu = profil != null && !email.trim().equals(profil.email.orEmpty(), ignoreCase = true)
    val geaendert = profil != null && (
        benutzername != profil.username.orEmpty() || email != profil.email.orEmpty() ||
        vorname != profil.firstName.orEmpty() || nachname != profil.lastName.orEmpty())

    SettingsCard(title = stringResource(R.string.konto_title), icon = Icons.Default.AccountCircle) {
        if (kontoZustand.laedt && profil == null) {
            LinearProgressIndicator(Modifier.fillMaxWidth())
        }

        if (kontoZustand.meldung != null) {
            Text(kontoZustand.meldung, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.primary)
        }
        if (kontoZustand.fehler != null) {
            Text(kontoZustand.fehler, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error)
        }
        // Erst nachdem der Server ihn verlangt hat; gilt für E-Mail und Passwort.
        if (kontoZustand.codeNoetig) ZweiterFaktorCodeFeld(faktorCode) { faktorCode = it }

        if (profil != null) {
            val tippen: (String) -> Unit = { onMeldungWeg() }
            OutlinedTextField(
                value = benutzername,
                onValueChange = { benutzername = it; tippen(it) },
                label = { Text(stringResource(R.string.login_username)) },
                modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Formen.knopf)
            OutlinedTextField(
                value = email,
                onValueChange = { email = it; tippen(it) },
                label = { Text(stringResource(R.string.register_email)) },
                // Der Server setzt die Bestaetigung zurueck, wenn die Adresse
                // wechselt. Der Hinweis sagt, WARUM hier plotzlich „nicht
                // bestaetigt" steht, statt es unkommentiert anzuzeigen.
                supportingText = if (!profil.emailBestaetigt) {
                    { Text(stringResource(R.string.konto_email_unverified)) }
                } else null,
                isError = !profil.emailBestaetigt,
                modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Formen.knopf,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
            Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                OutlinedTextField(
                    value = vorname, onValueChange = { vorname = it; tippen(it) },
                    label = { Text(stringResource(R.string.register_first_name)) },
                    modifier = Modifier.weight(1f), singleLine = true, shape = Formen.knopf)
                OutlinedTextField(
                    value = nachname, onValueChange = { nachname = it; tippen(it) },
                    label = { Text(stringResource(R.string.register_last_name)) },
                    modifier = Modifier.weight(1f), singleLine = true, shape = Formen.knopf)
            }
            // Über eine neue Adresse liesse sich das Passwort zurücksetzen —
            // darum fragt der Server dann nach dem aktuellen.
            if (emailNeu) {
                OutlinedTextField(
                    value = pwFuerEmail, onValueChange = { pwFuerEmail = it; tippen(it) },
                    label = { Text(stringResource(R.string.konto_email_password)) },
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Formen.knopf)
            }
            Button(
                onClick = { onSpeichern(benutzername, email, vorname, nachname, pwFuerEmail.takeIf { emailNeu }, code) },
                enabled = geaendert && !kontoZustand.speichert && (!emailNeu || pwFuerEmail.isNotEmpty()),
                modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp), shape = Formen.knopf
            ) { Text(stringResource(R.string.konto_save), fontWeight = FontWeight.SemiBold) }

            HorizontalDivider(Modifier.padding(vertical = Abstaende.mittel),
                color = MaterialTheme.colorScheme.outlineVariant)

            Text(stringResource(R.string.konto_password_title),
                style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
            // Steht VOR den Feldern, nicht darunter: Wer erst nach dem Tippen
            // erfaehrt, dass er sich damit abmeldet, hat schon getippt.
            Text(stringResource(R.string.konto_password_hint),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedTextField(
                value = pwAktuell, onValueChange = { pwAktuell = it },
                label = { Text(stringResource(R.string.konto_password_current)) },
                visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Formen.knopf,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
            OutlinedTextField(
                value = pwNeu, onValueChange = { pwNeu = it },
                label = { Text(stringResource(R.string.konto_password_new)) },
                visualTransformation = PasswordVisualTransformation(),
                // Dieselbe Mindestlänge wie im Server (PASSWORT_MIN_ZEICHEN in utils/auth.ts) und
                // in der Webapp, aus util/Passwort.kt. Hier vorweggenommen, damit man dafür keine
                // Runde über das Netz braucht.
                supportingText = if (pwNeu.isNotEmpty() && passwortZuKurz(pwNeu)) {
                    { Text(stringResource(R.string.register_password_short)) }
                } else null,
                isError = pwNeu.isNotEmpty() && passwortZuKurz(pwNeu),
                modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Formen.knopf,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
            OutlinedButton(
                onClick = { onPasswort(pwAktuell, pwNeu, code) },
                enabled = !kontoZustand.speichert && pwAktuell.isNotBlank() && !passwortZuKurz(pwNeu),
                modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp), shape = Formen.knopf
            ) { Text(stringResource(R.string.konto_password_button), fontWeight = FontWeight.SemiBold) }
        }
    }
}

/** Der Code des zweiten Faktors, den der Server für Passwort und E-Mail verlangt. */
@Composable
internal fun ZweiterFaktorCodeFeld(code: String, onCode: (String) -> Unit) {
    OutlinedTextField(
        value = code, onValueChange = { onCode(it.take(24)) },
        label = { Text(stringResource(R.string.login_code)) },
        supportingText = { Text(stringResource(R.string.login_code_hint)) },
        modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Formen.knopf,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii))
}

/**
 * Zweiter Faktor: einrichten, abschalten, neue Wiederherstellungscodes.
 *
 * Auf dem Telefon braucht es keinen QR-Code: Der otpauth-Link oeffnet die
 * Authenticator-App. Immer über die Auswahl des Systems: Der Link trägt das
 * Geheimnis, und eine App, die sich als Standard dafür eingetragen hat, bekäme es
 * sonst unbemerkt. Fehlt eine, bleibt der Schluessel zum Kopieren.
 */
/** false, wenn keine App den Link nimmt (Manifest: <queries> für otpauth). */
private fun oeffneMitAuswahl(ctx: android.content.Context, uri: String, titel: String): Boolean {
    val ansicht = android.content.Intent(android.content.Intent.ACTION_VIEW, uri.toUri())
    if (ansicht.resolveActivity(ctx.packageManager) == null) return false
    return runCatching { ctx.startActivity(android.content.Intent.createChooser(ansicht, titel)) }.isSuccess
}

@Composable
internal fun ZweiterFaktorCard(
    zfZustand: ch.brickinventoryapp.ui.ZweiterFaktorUiState,
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
    val auswahlTitel = stringResource(R.string.zf_open_app)
    val kontext = androidx.compose.ui.platform.LocalContext.current
    val schluesselEtikett = stringResource(R.string.app_name)
    val kopieren: (String) -> Unit = { text ->
        ch.brickinventoryapp.util.GeheimeZwischenablage.kopiere(kontext, schluesselEtikett, text)
    }
    // Neue Codes und ein neuer Schlüssel erscheinen gleich danach im Klartext: erst
    // nach der Gerätesperre (Schrittschutz), zusätzlich zu Passwort bzw. Code.
    val schutz = ch.brickinventoryapp.ui.components.LocalSchrittschutz.current
    val codesGrund = stringResource(R.string.schritt_codes)
    // Felder leeren, sobald ein Schritt gelungen ist — sonst stuende das
    // Passwort beim naechsten Schritt noch da.
    LaunchedEffect(zfZustand.aktiv, zfZustand.geheimnis, zfZustand.codes) { zfPasswort = ""; zfCode = "" }

    SettingsCard(title = stringResource(R.string.zf_title), icon = Icons.Default.Security) {
        Text(stringResource(R.string.zf_hint), style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (zfZustand.laedt) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (zfZustand.fehler != null) {
            Text(zfZustand.fehler, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error)
        }

        val passwortFeld: @Composable () -> Unit = {
            OutlinedTextField(
                value = zfPasswort, onValueChange = { zfPasswort = it },
                label = { Text(stringResource(R.string.konto_password_current)) },
                visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Formen.knopf,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
        }
        val codeFeld: @Composable (String) -> Unit = { beschriftung ->
            OutlinedTextField(
                value = zfCode, onValueChange = { zfCode = it.take(24) },
                label = { Text(beschriftung) },
                modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Formen.knopf,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii))
        }

        when {
            // 1. Frische Codes: einmal zeigen, dann wegraeumen. Kein Bildschirmfoto davon.
            zfZustand.codes.isNotEmpty() -> {
                ch.brickinventoryapp.ui.components.Sichtschutz()
                Text(stringResource(R.string.zf_codes_title), fontWeight = FontWeight.SemiBold)
                Text(stringResource(R.string.zf_codes_hint), style = MaterialTheme.typography.bodySmall)
                Text(zfZustand.codes.joinToString("\n"),
                    fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace)
                Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                    OutlinedButton(onClick = { kopieren(zfZustand.codes.joinToString("\n")) },
                        shape = Formen.knopf) { Text(stringResource(R.string.zf_copy)) }
                    Button(onClick = onZurueck, shape = Formen.knopf) { Text(stringResource(R.string.zf_codes_done)) }
                }
            }
            // 2. Einrichtung laeuft: Schluessel in die App, Code bestaetigen.
            zfZustand.geheimnis != null -> {
                ch.brickinventoryapp.ui.components.Sichtschutz()
                Text(stringResource(R.string.zf_step_app), style = MaterialTheme.typography.bodySmall)
                Button(
                    onClick = {
                        val uri = ch.brickinventoryapp.util.otpauthAdresse(zfZustand.otpauth)
                        ohneApp = uri == null || !oeffneMitAuswahl(kontext, uri, auswahlTitel)
                    },
                    modifier = Modifier.fillMaxWidth(), shape = Formen.knopf
                ) { Text(stringResource(R.string.zf_open_app)) }
                if (ohneApp) {
                    Text(stringResource(R.string.zf_no_app), style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error)
                }
                Text(zfZustand.geheimnis.chunked(4).joinToString(" "),
                    fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace)
                OutlinedButton(onClick = { kopieren(zfZustand.geheimnis) }, shape = Formen.knopf) {
                    Text(stringResource(R.string.zf_copy_key))
                }
                codeFeld(stringResource(R.string.zf_confirm_code))
                Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                    Button(onClick = { onBestaetigen(zfCode) }, enabled = zfCode.isNotBlank() && !zfZustand.laedt,
                        shape = Formen.knopf) { Text(stringResource(R.string.zf_confirm)) }
                    OutlinedButton(onClick = onZurueck, shape = Formen.knopf) { Text(stringResource(R.string.common_cancel)) }
                }
            }
            // 3. Aktiv: neue Codes oder abschalten.
            zfZustand.aktiv == true -> {
                Text(pluralStringResource(R.plurals.zf_active, zfZustand.codesUebrig, zfZustand.codesUebrig),
                    color = MaterialTheme.colorScheme.primary)
                passwortFeld()
                codeFeld(stringResource(R.string.login_code))
                Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                    OutlinedButton(onClick = { schutz.bestaetige(codesGrund) { onNeueCodes(zfCode) } }, enabled = zfCode.isNotBlank() && !zfZustand.laedt,
                        shape = Formen.knopf) { Text(stringResource(R.string.zf_new_codes)) }
                    OutlinedButton(onClick = { onAbschalten(zfPasswort, zfCode) },
                        enabled = zfPasswort.isNotBlank() && zfCode.isNotBlank() && !zfZustand.laedt,
                        shape = Formen.knopf) { Text(stringResource(R.string.zf_disable)) }
                }
            }
            // 4. Nicht eingerichtet.
            zfZustand.aktiv == false -> {
                passwortFeld()
                Button(onClick = { schutz.bestaetige(codesGrund) { onEinrichten(zfPasswort) } }, enabled = zfPasswort.isNotBlank() && !zfZustand.laedt,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp), shape = Formen.knopf
                ) { Text(stringResource(R.string.zf_setup), fontWeight = FontWeight.SemiBold) }
            }
        }
    }
}

/**
 * Angemeldete Geräte: die ausgestellten Zugänge sehen und aussperren.
 *
 * Der eigene Zugang hat keinen Knopf: Der Server markiert die Zeile, mit der
 * gerade gefragt wird, und wer sie entwertet, meldet sich selbst ab. Dafür gibt es
 * den Abmelden-Knopf am Ende der Seite, der benennt, was er tut.
 *
 * Datumsangaben über fmtDatum(), weil api_tokens Zeitstempel ohne Millisekunden
 * liefert und die gemeinsame Fassung damit umgeht (DatumFormatTest). „Nie benutzt“
 * bekommt einen eigenen Text — ein leeres Feld sähe aus wie ein Fehler.
 */
@Composable
internal fun GeraeteCard(
    zustand: ch.brickinventoryapp.ui.GeraeteUiState,
    onReload: () -> Unit,
    onRevoke: (String) -> Unit,
    onRevokeOthers: () -> Unit,
) {
    var fragt by rememberSaveable { mutableStateOf<String?>(null) }
    var fragtAlle by rememberSaveable { mutableStateOf(false) }

    SettingsCard(title = stringResource(R.string.tokens_title), icon = Icons.Default.Devices) {
        Text(stringResource(R.string.tokens_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(bottom = Abstaende.mittel))

        when {
            zustand.laedt && zustand.geraete.isEmpty() ->
                CircularProgressIndicator(Modifier.size(22.dp))
            zustand.fehler != null ->
                Text(zustand.fehler, color = MaterialTheme.colorScheme.error,
                     style = MaterialTheme.typography.bodySmall)
            zustand.geraete.isEmpty() ->
                Text(stringResource(R.string.tokens_none),
                     style = MaterialTheme.typography.bodySmall,
                     color = MaterialTheme.colorScheme.onSurfaceVariant)
            else -> Column(verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                for (g in zustand.geraete) {
                    Row(verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.weight(1f)) {
                            Row(verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text(g.bezeichnung, fontWeight = FontWeight.SemiBold)
                                if (g.aktuell) Surface(
                                    shape = Formen.chip,
                                    color = MaterialTheme.colorScheme.primaryContainer,
                                ) {
                                    Text(stringResource(R.string.tokens_current),
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onPrimaryContainer,
                                        modifier = Modifier.padding(horizontal = 6.dp, vertical = Abstaende.haar))
                                }
                                // Ein Zugang mit Verwalterrechten soll in der Liste auffallen.
                                if (g.vollerZugriff) Surface(
                                    shape = Formen.chip,
                                    color = MaterialTheme.colorScheme.tertiaryContainer,
                                ) {
                                    Text(stringResource(R.string.tokens_full_access),
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onTertiaryContainer,
                                        modifier = Modifier.padding(horizontal = 6.dp, vertical = Abstaende.haar))
                                }
                            }
                            Text(
                                stringResource(R.string.tokens_row_hint,
                                    ch.brickinventoryapp.util.fmtTag(g.angelegt) ?: "—",
                                    ch.brickinventoryapp.util.fmtTag(g.zuletztBenutzt) ?: stringResource(R.string.tokens_unused),
                                    g.laeuftAb?.let { ch.brickinventoryapp.util.fmtTag(it) ?: "—" } ?: stringResource(R.string.tokens_never)),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        if (!g.aktuell) IconButton(onClick = { fragt = g.tokenId }) {
                            Icon(Icons.Default.Delete,
                                stringResource(R.string.tokens_revoke_title),
                                tint = MaterialTheme.colorScheme.error)
                        }
                    }
                }
            }
        }

        Row(Modifier.padding(top = Abstaende.mittel), horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
            OutlinedButton(onClick = onReload, shape = Formen.knopf) {
                Text(stringResource(R.string.tokens_reload))
            }
            // Nur anbieten, wenn es wirklich andere gibt — ein Knopf, der
            // immer „es gibt keine anderen" meldet, ist schlimmer als keiner.
            if (zustand.geraete.count { !it.aktuell } > 0) {
                OutlinedButton(
                    onClick = { fragtAlle = true },
                    shape = Formen.knopf,
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                ) { Text(stringResource(R.string.tokens_revoke_others)) }
            }
        }
    }

    // Rückfrage: Ein Zugang, der weg ist, kommt nicht wieder — das Gerät
    // dahinter muss sich neu anmelden.
    val zuEntwerten = fragt
    if (zuEntwerten != null) AlertDialog(
        onDismissRequest = { fragt = null },
        title = { Text(stringResource(R.string.tokens_revoke_title)) },
        text = {
            ch.brickinventoryapp.ui.components.Ueberdeckungsschutz()
            Text(stringResource(R.string.tokens_revoke_text,
                zustand.geraete.firstOrNull { it.tokenId == zuEntwerten }?.bezeichnung ?: "—"))
        },
        confirmButton = {
            TextButton(onClick = { fragt = null; onRevoke(zuEntwerten) }) {
                Text(stringResource(R.string.tokens_revoke_confirm),
                     color = MaterialTheme.colorScheme.error)
            }
        },
        dismissButton = {
            TextButton(onClick = { fragt = null }) { Text(stringResource(R.string.common_cancel)) }
        },
    )

    if (fragtAlle) AlertDialog(
        onDismissRequest = { fragtAlle = false },
        title = { Text(stringResource(R.string.tokens_revoke_others_title)) },
        text = {
            ch.brickinventoryapp.ui.components.Ueberdeckungsschutz()
            val betroffen = zustand.geraete.count { !it.aktuell }
            Text(pluralStringResource(
                R.plurals.tokens_revoke_others_text, betroffen, betroffen))
        },
        confirmButton = {
            TextButton(onClick = { fragtAlle = false; onRevokeOthers() }) {
                Text(stringResource(R.string.tokens_revoke_confirm),
                     color = MaterialTheme.colorScheme.error)
            }
        },
        dismissButton = {
            TextButton(onClick = { fragtAlle = false }) { Text(stringResource(R.string.common_cancel)) }
        },
    )
}

/**
 * Das Design dieses Kontos: die Vorgabe des Verwalters oder ein eigenes. Es gilt
 * auf allen Geräten des Kontos, weil der Server es speichert; ohne [design]
 * (älterer Server) bleibt die Karte weg.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun DesignCard(design: ch.brickinventoryapp.ui.DesignWahl?, onWahl: (String) -> Unit) {
    if (design == null) return
    val namen = ch.brickinventoryapp.ui.DESIGN_NAMEN.toMap()
    SettingsCard(title = stringResource(R.string.monitoring_theme), icon = Icons.Default.Palette) {
        Text(stringResource(R.string.konto_design_hint), style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        // Eine Wahl aus mehreren — dieselben Radio-Chips wie in den Einstellungen;
        // "" steht für „die Vorgabe des Servers“.
        val vorgabe = namen[design.vorgabe]?.let { stringResource(it) } ?: design.vorgabe
        ch.brickinventoryapp.ui.components.WahlChips(
            optionen = listOf("" to stringResource(R.string.konto_design_vorgabe, vorgabe)) +
                ch.brickinventoryapp.ui.DESIGN_NAMEN.map { (wert, text) -> wert to stringResource(text) },
            gewaehlt = design.eigenes ?: "",
            onWahl = { wert -> if (wert != (design.eigenes ?: "")) onWahl(wert) },
        )
    }
}
