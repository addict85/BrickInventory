package ch.brickinventoryapp.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.KontoUiState
import ch.brickinventoryapp.ui.components.FehlerZeile
import ch.brickinventoryapp.ui.components.MarkenKopf
import ch.brickinventoryapp.ui.components.PasswortArt
import ch.brickinventoryapp.ui.components.PasswortFeld
import ch.brickinventoryapp.ui.components.ZweiterFaktorCodeFeld
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Lesebreite
import ch.brickinventoryapp.ui.theme.mittigBis
import ch.brickinventoryapp.util.PASSWORT_MIN_ZEICHEN
import ch.brickinventoryapp.util.passwortZuKurz

/**
 * Das Konto hat noch sein Startpasswort: Der Server weist bis zum Wechsel jeden
 * Abruf ab (403 `passwort_wechsel_noetig`). Statt einer App voller Fehlermeldungen
 * steht nur diese Maske da, gebaut wie die Maske für den zweiten Faktor (Markenkopf,
 * Lesebreite). Der Wechsel beendet alle Zugänge, danach meldet man sich mit dem neuen
 * Passwort an ([onErsetzen] meldet bei Erfolg ab).
 */
@Composable
fun StartpasswortMaske(
    kontoZustand: KontoUiState,
    onErsetzen: (aktuell: String, neu: String, code: String?) -> Unit,
    onAbmelden: () -> Unit,
) {
    // remember, nicht rememberSaveable: Gesicherter Zustand landet im Bundle und bei
    // Prozesstod auf der Platte (ActivityManager) — kein Ort für Passwörter und Codes.
    var pwAktuell by remember { mutableStateOf("") }
    var pwNeu by remember { mutableStateOf("") }
    var pwWiederholt by remember { mutableStateOf("") }
    var faktorCode by remember { mutableStateOf("") }
    val zuKurz = pwNeu.isNotEmpty() && passwortZuKurz(pwNeu)
    val verschieden = pwWiederholt.isNotEmpty() && pwWiederholt != pwNeu
    val fokus = LocalFocusManager.current
    val weiter = KeyboardActions(onNext = { fokus.moveFocus(FocusDirection.Down) })
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        // Ein untergeschobener Tipp setzte hier das Passwort des Kontos.
        ch.brickinventoryapp.ui.components.Ueberdeckungsschutz()
        Column(
            Modifier.verticalScroll(rememberScrollState()).mittigBis(Lesebreite.formular)
                .padding(horizontal = Abstaende.sehrGross, vertical = Abstaende.riesig),
            verticalArrangement = Arrangement.spacedBy(Abstaende.mittel),
        ) {
            MarkenKopf(Modifier.fillMaxWidth())
            Text(stringResource(R.string.startpasswort_titel), style = MaterialTheme.typography.headlineSmall,
                modifier = Modifier.semantics { heading() })
            Text(stringResource(R.string.startpasswort_text), style = MaterialTheme.typography.bodyMedium)
            PasswortFeld(pwAktuell, { pwAktuell = it }, stringResource(R.string.konto_password_current),
                Modifier.fillMaxWidth(), imeAction = ImeAction.Next, keyboardActions = weiter)
            // Die Mindestlänge steht von Anfang an da, nicht erst als Fehler.
            PasswortFeld(pwNeu, { pwNeu = it }, stringResource(R.string.konto_password_new), Modifier.fillMaxWidth(),
                art = PasswortArt.NEU,
                hinweis = if (zuKurz) stringResource(R.string.register_password_short)
                          else pluralStringResource(R.plurals.passwort_mindestens, PASSWORT_MIN_ZEICHEN, PASSWORT_MIN_ZEICHEN),
                fehlerhaft = zuKurz, imeAction = ImeAction.Next, keyboardActions = weiter)
            PasswortFeld(pwWiederholt, { pwWiederholt = it }, stringResource(R.string.startpasswort_wiederholen),
                Modifier.fillMaxWidth(), art = PasswortArt.WIEDERHOLUNG,
                hinweis = if (verschieden) stringResource(R.string.startpasswort_verschieden) else null,
                fehlerhaft = verschieden)
            kontoZustand.fehler?.let { FehlerZeile(it) }
            if (kontoZustand.codeNoetig) ZweiterFaktorCodeFeld(faktorCode) { faktorCode = it }
            Button(
                onClick = { onErsetzen(pwAktuell, pwNeu, faktorCode.takeIf { kontoZustand.codeNoetig && it.isNotBlank() }) },
                enabled = !kontoZustand.speichert && pwAktuell.isNotEmpty() && pwNeu.isNotEmpty() && !zuKurz && pwWiederholt == pwNeu,
                modifier = Modifier.fillMaxWidth(),
            ) { Text(stringResource(R.string.konto_password_button)) }
            TextButton(onClick = onAbmelden) { Text(stringResource(R.string.settings_logout)) }
        }
    }
}
