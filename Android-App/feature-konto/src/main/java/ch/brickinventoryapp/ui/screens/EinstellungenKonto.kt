package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.components.zeichenweise
import ch.brickinventoryapp.ui.components.vorgelesenAls
import ch.brickinventoryapp.ui.components.nebenKnopfFarben
import ch.brickinventoryapp.ui.components.nebenKnopfRand
import ch.brickinventoryapp.ui.components.ZweiterFaktorCodeFeld
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
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.semantics
import ch.brickinventoryapp.ui.components.FehlerZeile
import ch.brickinventoryapp.ui.components.ansagen
import ch.brickinventoryapp.ui.components.PasswortArt
import ch.brickinventoryapp.ui.components.PasswortFeld
import ch.brickinventoryapp.util.PASSWORT_MIN_ZEICHEN
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.util.passwortZuKurz
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.DESIGN_NAMEN
import ch.brickinventoryapp.ui.DESIGN_TEXTE
import ch.brickinventoryapp.ui.DesignWahl
import ch.brickinventoryapp.ui.GeraeteUiState
import ch.brickinventoryapp.ui.KontoUiState
import ch.brickinventoryapp.ui.ZweiterFaktorUiState
import ch.brickinventoryapp.ui.components.LocalSchrittschutz
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.ui.components.PasswortRueckfrage
import ch.brickinventoryapp.ui.components.Sichtschutz
import ch.brickinventoryapp.ui.components.SperrGrund
import ch.brickinventoryapp.ui.components.Ueberdeckungsschutz
import ch.brickinventoryapp.ui.components.WahlChips
import ch.brickinventoryapp.util.GeheimeZwischenablage
import ch.brickinventoryapp.util.fmtTag
import ch.brickinventoryapp.util.otpauthAdresse

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
    kontoZustand: KontoUiState,
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
    var pwNeu        by remember { mutableStateOf("") }
    var pwWiederholt by remember { mutableStateOf("") }
    // Das Passwort für eine Profiländerung fragt erst der Dialog beim Speichern ab.
    var fragtPasswort by remember(profil) { mutableStateOf(false) }
    var faktorCode   by remember { mutableStateOf("") }
    val code = faktorCode.takeIf { kontoZustand.codeNoetig && it.isNotBlank() }

    val geaendert = profil != null && (
        benutzername != profil.username.orEmpty() || email != profil.email.orEmpty() ||
        vorname != profil.firstName.orEmpty() || nachname != profil.lastName.orEmpty())

    // „Profil“, nicht „Konto“: Die Leiste der Seite heisst schon so.
    SettingsCard(title = stringResource(R.string.konto_profil_titel), icon = Icons.Default.AccountCircle) {
        if (kontoZustand.laedt && profil == null) {
            LinearProgressIndicator(Modifier.fillMaxWidth())
        }

        if (kontoZustand.meldung != null) {
            Text(kontoZustand.meldung, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.primary, modifier = Modifier.ansagen())
        }
        if (kontoZustand.fehler != null) FehlerZeile(kontoZustand.fehler)
        // Erst nachdem der Server ihn verlangt hat; gilt für E-Mail und Passwort.
        if (kontoZustand.codeNoetig) ZweiterFaktorCodeFeld(faktorCode) { faktorCode = it }

        if (profil != null) {
            val tippen: (String) -> Unit = { onMeldungWeg() }
            val ausstehend = profil.emailNeu
            OutlinedTextField(
                value = benutzername,
                onValueChange = { benutzername = it; tippen(it) },
                label = { Text(stringResource(R.string.login_username)) },
                modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Formen.feld)
            OutlinedTextField(
                value = email,
                onValueChange = { email = it; tippen(it) },
                label = { Text(stringResource(R.string.register_email)) },
                // Eine neue Adresse wartet auf ihren Link, das Feld zeigt bis dahin die
                // geltende. Ohne den Hinweis sähe die Änderung nach dem Speichern verloren aus.
                supportingText = when {
                    ausstehend != null -> { { Text(stringResource(R.string.konto_email_ausstehend, ausstehend)) } }
                    !profil.emailBestaetigt -> { { Text(stringResource(R.string.konto_email_unverified)) } }
                    else -> null
                },
                isError = !profil.emailBestaetigt,
                modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Formen.feld,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
            Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                OutlinedTextField(
                    value = vorname, onValueChange = { vorname = it; tippen(it) },
                    label = { Text(stringResource(R.string.register_first_name)) },
                    modifier = Modifier.weight(1f), singleLine = true, shape = Formen.feld)
                OutlinedTextField(
                    value = nachname, onValueChange = { nachname = it; tippen(it) },
                    label = { Text(stringResource(R.string.register_last_name)) },
                    modifier = Modifier.weight(1f), singleLine = true, shape = Formen.feld)
            }
            // Erst den Fokus abgeben: Sonst bleibt das zuletzt getippte Feld hinter dem
            // Dialog fokussiert und hält Tastatur und Cursor, obwohl nur der Dialog
            // Eingaben annimmt.
            val fokus = LocalFocusManager.current
            Button(
                onClick = { fokus.clearFocus(); fragtPasswort = true },
                enabled = geaendert && !kontoZustand.speichert,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
            ) { Text(stringResource(R.string.konto_save), fontWeight = FontWeight.SemiBold) }
        }
    }

    // Eine eigene Karte unter eigener Überschrift: Unter „Profil“ las sich das Passwort
    // als Teil der Angaben, die „Profil speichern“ sichert.
    if (profil != null) {
        SettingsCard(title = stringResource(R.string.konto_password_title), icon = Icons.Default.Lock) {
            // Steht VOR den Feldern, nicht darunter: Wer erst nach dem Tippen
            // erfaehrt, dass er sich damit abmeldet, hat schon getippt.
            Text(stringResource(R.string.konto_password_hint),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            PasswortFeld(pwAktuell, { pwAktuell = it }, stringResource(R.string.konto_password_current),
                Modifier.fillMaxWidth(), imeAction = ImeAction.Next)
            // Dieselbe Mindestlänge wie im Server (PASSWORT_MIN_ZEICHEN in utils/auth.ts) und
            // in der Webapp, aus util/Passwort.kt — von Anfang an genannt, nicht erst als Fehler.
            // Derselbe Aufbau wie die Startpasswort-Maske: neu und wiederholt.
            val neuZuKurz = pwNeu.isNotEmpty() && passwortZuKurz(pwNeu)
            val verschieden = pwWiederholt.isNotEmpty() && pwWiederholt != pwNeu
            PasswortFeld(pwNeu, { pwNeu = it }, stringResource(R.string.konto_password_new), Modifier.fillMaxWidth(),
                art = PasswortArt.NEU,
                hinweis = if (neuZuKurz) stringResource(R.string.register_password_short)
                          else pluralStringResource(R.plurals.passwort_mindestens, PASSWORT_MIN_ZEICHEN, PASSWORT_MIN_ZEICHEN),
                fehlerhaft = neuZuKurz, imeAction = ImeAction.Next)
            PasswortFeld(pwWiederholt, { pwWiederholt = it }, stringResource(R.string.startpasswort_wiederholen),
                Modifier.fillMaxWidth(), art = PasswortArt.WIEDERHOLUNG,
                hinweis = if (verschieden) stringResource(R.string.startpasswort_verschieden) else null,
                fehlerhaft = verschieden)
            if (pwAktuell.isBlank() || pwNeu.isEmpty() || pwWiederholt.isEmpty())
                SperrGrund(stringResource(R.string.passwort_aendern_fehlt))
            // Tonal statt umrandet: Ein deaktivierter umrandeter Knopf war kaum zu sehen.
            FilledTonalButton(
                onClick = { onPasswort(pwAktuell, pwNeu, code) },
                enabled = !kontoZustand.speichert && pwAktuell.isNotBlank() && pwNeu.isNotEmpty() &&
                    !passwortZuKurz(pwNeu) && pwWiederholt == pwNeu,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
            ) { Text(stringResource(R.string.konto_password_button), fontWeight = FontWeight.SemiBold) }
        }
    }

    // Der Server bestätigt jede Profiländerung mit dem Passwort: Sonst liesse sich über
    // eine neue Adresse das Passwort zurücksetzen. Gefragt wird erst beim Speichern.
    if (fragtPasswort) PasswortRueckfrage(
        titel = stringResource(R.string.konto_save),
        text = stringResource(R.string.konto_profil_password_needed),
        bestaetigen = stringResource(R.string.konto_save),
        codeNoetig = false, fehler = null, laeuft = kontoZustand.speichert,
        onBestaetigen = { pw, _ -> fragtPasswort = false; onSpeichern(benutzername, email, vorname, nachname, pw, code) },
        onAbbrechen = { fragtPasswort = false },
    )
}

/**
 * Die Notfallcodes an eine App der Wahl (Passwortmanager, Notizen): nur auf Tipp und
 * über die Auswahl des Systems, nicht über die Zwischenablage, deren Verlauf sie behielte.
 */
internal fun teileCodes(ctx: android.content.Context, titel: String, codes: List<String>) {
    val senden = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(android.content.Intent.EXTRA_TEXT, codes.joinToString("\n"))
        putExtra(android.content.Intent.EXTRA_TITLE, titel)
    }
    runCatching { ctx.startActivity(android.content.Intent.createChooser(senden, titel)) }
}

/** false, wenn keine App den Link nimmt (Manifest: <queries> für otpauth). */
internal fun oeffneMitAuswahl(ctx: android.content.Context, uri: String, titel: String): Boolean {
    val ansicht = android.content.Intent(android.content.Intent.ACTION_VIEW, uri.toUri())
    if (ansicht.resolveActivity(ctx.packageManager) == null) return false
    return runCatching { ctx.startActivity(android.content.Intent.createChooser(ansicht, titel)) }.isSuccess
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
    val kontext = androidx.compose.ui.platform.LocalContext.current
    val schluesselEtikett = stringResource(R.string.app_name)
    val teilenTitel = stringResource(R.string.zf_share_title)
    val kopieren: (String) -> Unit = { text ->
        GeheimeZwischenablage.kopiere(kontext, schluesselEtikett, text)
    }
    // Neue Codes und ein neuer Schlüssel erscheinen gleich danach im Klartext: erst
    // nach der Gerätesperre (Schrittschutz), zusätzlich zu Passwort bzw. Code.
    val schutz = LocalSchrittschutz.current
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
                    fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
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
                    fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace)
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

/**
 * Angemeldete Geräte: die ausgestellten Zugänge sehen und aussperren.
 * Ausführlich: docs/begruendungen/feature-konto/ui/screens/EinstellungenKonto.kt.md#geraetecard
 */
@Composable
internal fun GeraeteCard(
    zustand: GeraeteUiState,
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
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onPrimaryContainer,
                                        modifier = Modifier.padding(horizontal = 6.dp, vertical = Abstaende.haar))
                                }
                                // Ein Zugang mit Verwalterrechten soll in der Liste auffallen.
                                if (g.vollerZugriff) Surface(
                                    shape = Formen.chip,
                                    color = MaterialTheme.colorScheme.tertiaryContainer,
                                ) {
                                    Text(stringResource(R.string.tokens_full_access),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onTertiaryContainer,
                                        modifier = Modifier.padding(horizontal = 6.dp, vertical = Abstaende.haar))
                                }
                            }
                            Text(
                                stringResource(R.string.tokens_row_hint,
                                    fmtTag(g.angelegt) ?: "—",
                                    fmtTag(g.zuletztBenutzt) ?: stringResource(R.string.tokens_unused),
                                    g.laeuftAb?.let { fmtTag(it) ?: "—" } ?: stringResource(R.string.tokens_never)),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        if (!g.aktuell) MitTooltip(stringResource(R.string.tokens_revoke_title)) {
                            IconButton(onClick = { fragt = g.tokenId }) {
                                Icon(Icons.Default.Delete,
                                    stringResource(R.string.tokens_revoke_title),
                                    tint = MaterialTheme.colorScheme.error)
                            }
                        }
                    }
                }
            }
        }

        Row(Modifier.padding(top = Abstaende.mittel), horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
            OutlinedButton(onClick = onReload, colors = nebenKnopfFarben(), border = nebenKnopfRand()) {
                Text(stringResource(R.string.tokens_reload))
            }
            // Nur anbieten, wenn es wirklich andere gibt — ein Knopf, der
            // immer „es gibt keine anderen" meldet, ist schlimmer als keiner.
            if (zustand.geraete.count { !it.aktuell } > 0) {
                OutlinedButton(
                    onClick = { fragtAlle = true },
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                    border = nebenKnopfRand(),
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
            Ueberdeckungsschutz()
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
            Ueberdeckungsschutz()
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
internal fun DesignCard(design: DesignWahl?, onWahl: (String) -> Unit) {
    if (design == null) return
    val namen = DESIGN_NAMEN.toMap()
    SettingsCard(title = stringResource(R.string.monitoring_theme), icon = Icons.Default.Palette) {
        Text(stringResource(R.string.konto_design_hint), style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        // Eine Wahl aus mehreren — dieselben Radio-Chips wie in den Einstellungen;
        // "" steht für „die Vorgabe des Servers“.
        val vorgabe = namen[design.vorgabe]?.let { stringResource(it) } ?: design.vorgabe
        WahlChips(
            optionen = listOf("" to stringResource(R.string.konto_design_vorgabe, vorgabe)) +
                DESIGN_NAMEN.map { (wert, text) -> wert to stringResource(text) },
            gewaehlt = design.eigenes ?: "",
            onWahl = { wert -> if (wert != (design.eigenes ?: "")) onWahl(wert) },
        )
        // Was das gewählte Design ausmacht — Werkbank allein am Bild vom dunklen Classic zu
        // unterscheiden, gelang kaum.
        DESIGN_TEXTE[design.eigenes ?: design.vorgabe]?.let {
            Text(stringResource(it), style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
