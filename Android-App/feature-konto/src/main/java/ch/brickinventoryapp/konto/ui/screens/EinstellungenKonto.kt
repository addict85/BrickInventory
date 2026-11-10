package ch.brickinventoryapp.konto.ui.screens

import ch.brickinventoryapp.ui.components.ZweiterFaktorCodeFeld
import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.ImeAction
import ch.brickinventoryapp.ui.components.FehlerZeile
import ch.brickinventoryapp.ui.components.ansagen
import ch.brickinventoryapp.ui.components.PasswortArt
import ch.brickinventoryapp.ui.components.PasswortFeld
import ch.brickinventoryapp.sicherheit.PASSWORT_MIN_ZEICHEN
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.konto.ui.*
import ch.brickinventoryapp.model.ui.*
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.zustand.ui.*
import ch.brickinventoryapp.sicherheit.passwortZuKurz
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.DESIGN_NAMEN
import ch.brickinventoryapp.ui.DESIGN_TEXTE
import ch.brickinventoryapp.konto.ui.DesignWahl
import ch.brickinventoryapp.konto.ui.KontoUiState
import ch.brickinventoryapp.model.ui.model.ProfilAnsicht
import ch.brickinventoryapp.ui.components.PasswortRueckfrage
import ch.brickinventoryapp.ui.components.SperrGrund
import ch.brickinventoryapp.ui.components.WahlChips
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
            ProfilFelder(profil,
                benutzername = benutzername, onBenutzername = { benutzername = it; tippen(it) },
                email = email, onEmail = { email = it; tippen(it) },
                vorname = vorname, onVorname = { vorname = it; tippen(it) },
                nachname = nachname, onNachname = { nachname = it; tippen(it) })
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
        PasswortKarte(
            pwAktuell = pwAktuell, onPwAktuell = { pwAktuell = it },
            pwNeu = pwNeu, onPwNeu = { pwNeu = it },
            pwWiederholt = pwWiederholt, onPwWiederholt = { pwWiederholt = it },
            speichert = kontoZustand.speichert,
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

/** Benutzername, E-Mail und Name; den Zustand der Felder hält KontoCard. */
@Composable
private fun ProfilFelder(
    profil: ProfilAnsicht,
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
    OutlinedTextField(
        value = benutzername,
        onValueChange = onBenutzername,
        label = { Text(stringResource(R.string.login_username)) },
        modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Formen.feld)
    OutlinedTextField(
        value = email,
        onValueChange = onEmail,
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
            value = vorname, onValueChange = onVorname,
            label = { Text(stringResource(R.string.register_first_name)) },
            modifier = Modifier.weight(1f), singleLine = true, shape = Formen.feld)
        OutlinedTextField(
            value = nachname, onValueChange = onNachname,
            label = { Text(stringResource(R.string.register_last_name)) },
            modifier = Modifier.weight(1f), singleLine = true, shape = Formen.feld)
    }
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
    onAendern: () -> Unit,
) {
    SettingsCard(title = stringResource(R.string.konto_password_title), icon = Icons.Default.Lock) {
        // Steht VOR den Feldern, nicht darunter: Wer erst nach dem Tippen
        // erfaehrt, dass er sich damit abmeldet, hat schon getippt.
        Text(stringResource(R.string.konto_password_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        PasswortFeld(pwAktuell, onPwAktuell, stringResource(R.string.konto_password_current),
            Modifier.fillMaxWidth(), imeAction = ImeAction.Next)
        // Dieselbe Mindestlänge wie im Server (PASSWORT_MIN_ZEICHEN in utils/auth.ts) und
        // in der Webapp, aus util/Passwort.kt — von Anfang an genannt, nicht erst als Fehler.
        // Derselbe Aufbau wie die Startpasswort-Maske: neu und wiederholt.
        val neuZuKurz = pwNeu.isNotEmpty() && passwortZuKurz(pwNeu)
        val verschieden = pwWiederholt.isNotEmpty() && pwWiederholt != pwNeu
        PasswortFeld(pwNeu, onPwNeu, stringResource(R.string.konto_password_new), Modifier.fillMaxWidth(),
            art = PasswortArt.NEU,
            hinweis = if (neuZuKurz) stringResource(R.string.register_password_short)
                      else pluralStringResource(R.plurals.passwort_mindestens, PASSWORT_MIN_ZEICHEN, PASSWORT_MIN_ZEICHEN),
            fehlerhaft = neuZuKurz, imeAction = ImeAction.Next)
        PasswortFeld(pwWiederholt, onPwWiederholt, stringResource(R.string.startpasswort_wiederholen),
            Modifier.fillMaxWidth(), art = PasswortArt.WIEDERHOLUNG,
            hinweis = if (verschieden) stringResource(R.string.startpasswort_verschieden) else null,
            fehlerhaft = verschieden)
        if (pwAktuell.isBlank() || pwNeu.isEmpty() || pwWiederholt.isEmpty())
            SperrGrund(stringResource(R.string.passwort_aendern_fehlt))
        // Tonal statt umrandet: Ein deaktivierter umrandeter Knopf war kaum zu sehen.
        FilledTonalButton(
            onClick = onAendern,
            enabled = !speichert && pwAktuell.isNotBlank() && pwNeu.isNotEmpty() &&
                !passwortZuKurz(pwNeu) && pwWiederholt == pwNeu,
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
