package ch.brickinventoryapp.konto.ui.screens

import ch.brickinventoryapp.ui.satz
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.model.ui.fehlerMeldung
import ch.brickinventoryapp.ui.titel
import ch.brickinventoryapp.ui.beschreibung
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.ui.components.ZweiterFaktorCodeFeld
import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.foundation.text.KeyboardActions
import ch.brickinventoryapp.ui.components.PasswortWechselFelder
import ch.brickinventoryapp.ui.components.PasswortWechselPruefung
import ch.brickinventoryapp.ui.components.rememberPasswortWechselPruefung
import ch.brickinventoryapp.ui.theme.hauptKnopfFarben
import ch.brickinventoryapp.ui.theme.tonKnopfFarben
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType
import ch.brickinventoryapp.ui.components.FehlerZeile
import ch.brickinventoryapp.ui.components.ansagen
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.konto.ui.DesignWahl
import ch.brickinventoryapp.konto.ui.KontoUiState
import ch.brickinventoryapp.model.fach.ProfilAnsicht
import ch.brickinventoryapp.ui.components.PasswortRueckfrage
import ch.brickinventoryapp.ui.components.AuswahlFeld
import ch.brickinventoryapp.ui.components.SettingsCard

/**
 * Das eigene Konto: Profil und Passwort. Über /auth/profile und
 * /auth/change-password, die auch das Bearer-Token der App annehmen.
 */
@Composable
internal fun KontoCard(
    // `kontoZustand`, nicht `zustand`: Die Kontoseiten nehmen `zustand` schon für andere
    // Zustände, und derselbe Name für zwei Typen verwechselt sich beim Lesen.
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

    val geaendert = profilGeaendert(profil, benutzername, email, vorname, nachname)
    // Speichern bleibt antippbar und markiert dann, was fehlt (wie beim Set-Dialog).
    var profilGeprueft by rememberSaveable(profil) { mutableStateOf(false) }
    val profilFokus = remember { ProfilFeld.entries.associateWith { FocusRequester() } }
    val passwortPruefung = rememberPasswortWechselPruefung()

    // „Profil“, nicht „Konto“: Die Leiste der Seite heisst schon so.
    SettingsCard(title = stringResource(R.string.konto_profil_titel), icon = Icons.Default.AccountCircle) {
        if (kontoZustand.abruf.laedt && profil == null) {
            LinearProgressIndicator(Modifier.fillMaxWidth())
        }

        KontoMeldungen(kontoZustand)
        // Erst nachdem der Server ihn verlangt hat; gilt für E-Mail und Passwort.
        if (kontoZustand.codeNoetig) ZweiterFaktorCodeFeld(faktorCode) { faktorCode = it }

        if (profil != null) {
            val tippen: (String) -> Unit = { onMeldungWeg() }
            ProfilFelder(profil,
                fehler = if (profilGeprueft) profilFehler(benutzername, email) else emptyList(),
                fokus = profilFokus,
                benutzername = benutzername, onBenutzername = { benutzername = it; tippen(it) },
                email = email, onEmail = { email = it; tippen(it) },
                vorname = vorname, onVorname = { vorname = it; tippen(it) },
                nachname = nachname, onNachname = { nachname = it; tippen(it) })
            // Erst den Fokus abgeben: Sonst bleibt das zuletzt getippte Feld hinter dem
            // Dialog fokussiert und hält Tastatur und Cursor, obwohl nur der Dialog
            // Eingaben annimmt.
            val fokus = LocalFocusManager.current
            ProfilSpeichernKnopf(nichtsGeaendert = profilGeprueft && !geaendert, speichert = kontoZustand.speichert) {
                profilGeprueft = true
                val erstes = profilFehler(benutzername, email).firstOrNull()
                if (erstes != null) profilFokus.getValue(erstes).requestFocus()
                else if (geaendert) { fokus.clearFocus(); fragtPasswort = true }
            }
        }
    }

    // Eine eigene Karte unter eigener Überschrift: Unter „Profil“ las sich das Passwort
    // als Teil der Angaben, die „Profil speichern“ sichert.
    if (profil != null) {
        PasswortKarte(
            pwAktuell = pwAktuell, onPwAktuell = { pwAktuell = it },
            pwNeu = pwNeu, onPwNeu = { pwNeu = it },
            pwWiederholt = pwWiederholt, onPwWiederholt = { pwWiederholt = it },
            speichert = kontoZustand.speichert,
            pruefung = passwortPruefung,
            onAendern = { onPasswort(pwAktuell, pwNeu, code) },
        )
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

/** Weicht eine Eingabe vom Stand des Servers ab? Nur dann lässt sich speichern. */
private fun profilGeaendert(profil: ProfilAnsicht?, benutzername: String, email: String, vorname: String, nachname: String) =
    profil != null && (
        benutzername != profil.username.orEmpty() || email != profil.email.orEmpty() ||
        vorname != profil.firstName.orEmpty() || nachname != profil.lastName.orEmpty())

/** Meldung und Fehler über den Profilfeldern, beide angesagt. */
@Composable
private fun KontoMeldungen(kontoZustand: KontoUiState) {
    kontoZustand.meldung?.let { meldung ->
        Text(meldung.satz(), style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.primary, modifier = Modifier.ansagen())
    }
    (kontoZustand.fehler ?: kontoZustand.abruf.fehlerMeldung)?.let { FehlerZeile(it) }
}

/** „Profil speichern“, antippbar auch ohne Änderung; dann sagt die Zeile darüber, warum nichts geschieht. */
@Composable
private fun ProfilSpeichernKnopf(nichtsGeaendert: Boolean, speichert: Boolean, onClick: () -> Unit) {
    if (nichtsGeaendert) Text(stringResource(R.string.konto_nichts_geaendert),
        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.ansagen())
    Button(
        onClick = onClick,
        enabled = !speichert,
        colors = hauptKnopfFarben(),
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
    ) { Text(stringResource(R.string.konto_save), fontWeight = FontWeight.SemiBold) }
}

/** Ein Profilfeld, das vor dem Speichern nicht leer sein darf. */
internal enum class ProfilFeld { BENUTZERNAME, EMAIL }

/** Was vor dem Speichern fehlt, in der Reihenfolge der Felder. */
internal fun profilFehler(benutzername: String, email: String): List<ProfilFeld> = buildList {
    if (benutzername.isBlank()) add(ProfilFeld.BENUTZERNAME)
    if (email.isBlank()) add(ProfilFeld.EMAIL)
}

/**
 * Benutzername, E-Mail und Name; den Zustand der Felder hält KontoCard. Mit Symbol wie
 * beim Registrieren und wie die Passwortfelder darunter: Ohne sahen die beiden Karten
 * aus zwei Formularen aus.
 */
@Composable
private fun ProfilFelder(
    profil: ProfilAnsicht,
    fehler: List<ProfilFeld>,
    fokus: Map<ProfilFeld, FocusRequester>,
    benutzername: String,
    onBenutzername: (String) -> Unit,
    email: String,
    onEmail: (String) -> Unit,
    vorname: String,
    onVorname: (String) -> Unit,
    nachname: String,
    onNachname: (String) -> Unit,
) {
    val ausstehend = profil.emailNeu
    val nameFehlt = ProfilFeld.BENUTZERNAME in fehler
    OutlinedTextField(
        value = benutzername,
        onValueChange = onBenutzername,
        label = { Text(stringResource(R.string.login_username)) },
        leadingIcon = { Icon(Icons.Default.Person, null) },
        isError = nameFehlt,
        supportingText = if (nameFehlt) { { Text(stringResource(R.string.login_username_fehlt), Modifier.ansagen()) } } else null,
        modifier = Modifier.fillMaxWidth().focusRequester(fokus.getValue(ProfilFeld.BENUTZERNAME)),
        singleLine = true, shape = Formen.feld)
    val emailFehlt = ProfilFeld.EMAIL in fehler
    OutlinedTextField(
        value = email,
        onValueChange = onEmail,
        label = { Text(stringResource(R.string.register_email)) },
        leadingIcon = { Icon(Icons.Default.Email, null) },
        // Eine neue Adresse wartet auf ihren Link, das Feld zeigt bis dahin die
        // geltende. Ohne den Hinweis sähe die Änderung nach dem Speichern verloren aus.
        supportingText = when {
            emailFehlt -> { { Text(stringResource(R.string.konto_email_fehlt), Modifier.ansagen()) } }
            ausstehend != null -> { { Text(stringResource(R.string.konto_email_ausstehend, ausstehend)) } }
            !profil.emailBestaetigt -> { { Text(stringResource(R.string.konto_email_unverified)) } }
            else -> null
        },
        isError = emailFehlt || !profil.emailBestaetigt,
        modifier = Modifier.fillMaxWidth().focusRequester(fokus.getValue(ProfilFeld.EMAIL)),
        singleLine = true, shape = Formen.feld,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
    OutlinedTextField(
        value = vorname, onValueChange = onVorname,
        label = { Text(stringResource(R.string.register_first_name)) },
        leadingIcon = { Icon(Icons.Default.Badge, null) },
        modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Formen.feld)
    OutlinedTextField(
        value = nachname, onValueChange = onNachname,
        label = { Text(stringResource(R.string.register_last_name)) },
        leadingIcon = { Icon(Icons.Default.Badge, null) },
        modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Formen.feld)
}

/** Passwort ändern. Die Eingaben hält KontoCard; die Karte zeigt sie nur und meldet Änderungen. */
@Composable
private fun PasswortKarte(
    pwAktuell: String,
    onPwAktuell: (String) -> Unit,
    pwNeu: String,
    onPwNeu: (String) -> Unit,
    pwWiederholt: String,
    onPwWiederholt: (String) -> Unit,
    speichert: Boolean,
    pruefung: PasswortWechselPruefung,
    onAendern: () -> Unit,
) {
    SettingsCard(title = stringResource(R.string.konto_password_title), icon = Icons.Default.Lock) {
        // Steht VOR den Feldern, nicht darunter: Wer erst nach dem Tippen
        // erfaehrt, dass er sich damit abmeldet, hat schon getippt.
        Text(stringResource(R.string.konto_password_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        val fokus = LocalFocusManager.current
        PasswortWechselFelder(pwAktuell, onPwAktuell, pwNeu, onPwNeu, pwWiederholt, onPwWiederholt, pruefung,
            KeyboardActions(onNext = { fokus.moveFocus(FocusDirection.Down) }))
        // Tonal statt umrandet: Ein deaktivierter umrandeter Knopf war kaum zu sehen.
        FilledTonalButton(
            onClick = { pruefung.absenden(pwAktuell, pwNeu, pwWiederholt, onAendern) },
            enabled = !speichert,
            colors = tonKnopfFarben(),
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
        ) { Text(stringResource(R.string.konto_password_button), fontWeight = FontWeight.SemiBold) }
    }
}

/**
 * Das Design dieses Kontos: die Vorgabe des Verwalters oder ein eigenes. Es gilt
 * auf allen Geräten des Kontos, weil der Server es speichert; ohne [design]
 * (älterer Server) bleibt die Karte weg.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun DesignCard(design: DesignWahl?, onWahl: (Design?) -> Unit) {
    if (design == null) return
    SettingsCard(title = stringResource(R.string.monitoring_theme), icon = Icons.Default.Palette) {
        Text(stringResource(R.string.konto_design_hint), style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        // Eine Wahl aus sieben: ein Feld mit Menü wie Sprache und Währung; null steht für
        // „die Vorgabe des Servers“.
        val vorgabe = stringResource(design.vorgabe.titel())
        AuswahlFeld(
            beschriftung = stringResource(R.string.monitoring_theme),
            modifier = Modifier.fillMaxWidth(),
            optionen = listOf<Pair<Design?, String>>(null to stringResource(R.string.konto_design_vorgabe, vorgabe)) +
                Design.entries.map { it to stringResource(it.titel()) },
            gewaehlt = design.eigenes,
            onWahl = { wert -> if (wert != design.eigenes) onWahl(wert) },
        )
        // Was das gewählte Design ausmacht — Werkbank allein am Bild vom dunklen Classic zu
        // unterscheiden, gelang kaum.
        (design.eigenes ?: design.vorgabe).beschreibung().let {
            Text(stringResource(it), style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
