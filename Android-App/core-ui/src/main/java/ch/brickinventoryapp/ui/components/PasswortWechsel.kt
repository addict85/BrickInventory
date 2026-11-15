package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import ch.brickinventoryapp.model.util.PASSWORT_MIN_ZEICHEN
import ch.brickinventoryapp.model.util.passwortZuKurz
import ch.brickinventoryapp.ressourcen.R

/** Ein Feld des Passwortwechsels, das vor dem Absenden nicht stimmt. */
enum class PasswortFeldFehler { AKTUELL, NEU, WIEDERHOLUNG }

/** Was vor dem Absenden nicht stimmt, in der Reihenfolge der Felder. */
fun passwortWechselFehler(aktuell: String, neu: String, wiederholt: String): List<PasswortFeldFehler> = buildList {
    if (aktuell.isBlank()) add(PasswortFeldFehler.AKTUELL)
    if (passwortZuKurz(neu)) add(PasswortFeldFehler.NEU)
    if (wiederholt != neu) add(PasswortFeldFehler.WIEDERHOLUNG)
}

/**
 * Der Zustand des Absendens: Der Knopf bleibt antippbar und markiert dann jedes falsche
 * Feld, der Cursor geht ins erste davon (wie beim Set-Dialog). Ein gesperrter Knopf liess
 * raten, was fehlt.
 */
class PasswortWechselPruefung {
    var geprueft by mutableStateOf(false)
        private set
    internal val fokus = PasswortFeldFehler.entries.associateWith { FocusRequester() }

    fun absenden(aktuell: String, neu: String, wiederholt: String, weiter: () -> Unit) {
        geprueft = true
        val erstes = passwortWechselFehler(aktuell, neu, wiederholt).firstOrNull() ?: return weiter()
        try { fokus.getValue(erstes).requestFocus() } catch (_: IllegalStateException) { /* nicht angeordnet */ }
    }

    fun zuruecksetzen() { geprueft = false }
}

@Composable
fun rememberPasswortWechselPruefung(): PasswortWechselPruefung = remember { PasswortWechselPruefung() }

/** Aktuelles, neues und wiederholtes Passwort, mit den Fehlern aus [pruefung]. */
@Composable
fun PasswortWechselFelder(
    aktuell: String,
    onAktuell: (String) -> Unit,
    neu: String,
    onNeu: (String) -> Unit,
    wiederholt: String,
    onWiederholt: (String) -> Unit,
    pruefung: PasswortWechselPruefung,
    weiter: KeyboardActions = KeyboardActions.Default,
) {
    val fehler = if (pruefung.geprueft) passwortWechselFehler(aktuell, neu, wiederholt) else emptyList()
    val aktuellFehlt = PasswortFeldFehler.AKTUELL in fehler
    // Zu kurz und verschieden zeigen sich schon beim Tippen, leer erst nach dem Absenden.
    val neuFalsch = PasswortFeldFehler.NEU in fehler || (neu.isNotEmpty() && passwortZuKurz(neu))
    val verschieden = PasswortFeldFehler.WIEDERHOLUNG in fehler || (wiederholt.isNotEmpty() && wiederholt != neu)
    PasswortFeld(aktuell, onAktuell, stringResource(R.string.konto_password_current),
        Modifier.fillMaxWidth().focusRequester(pruefung.fokus.getValue(PasswortFeldFehler.AKTUELL)),
        hinweis = if (aktuellFehlt) stringResource(R.string.login_password_fehlt) else null,
        fehlerhaft = aktuellFehlt, imeAction = ImeAction.Next, keyboardActions = weiter)
    PasswortFeld(neu, onNeu, stringResource(R.string.konto_password_new),
        Modifier.fillMaxWidth().focusRequester(pruefung.fokus.getValue(PasswortFeldFehler.NEU)),
        art = PasswortArt.NEU,
        hinweis = if (neuFalsch) stringResource(R.string.register_password_short)
                  else pluralStringResource(R.plurals.passwort_mindestens, PASSWORT_MIN_ZEICHEN, PASSWORT_MIN_ZEICHEN),
        fehlerhaft = neuFalsch, imeAction = ImeAction.Next, keyboardActions = weiter)
    PasswortFeld(wiederholt, onWiederholt, stringResource(R.string.register_password_repeat),
        Modifier.fillMaxWidth().focusRequester(pruefung.fokus.getValue(PasswortFeldFehler.WIEDERHOLUNG)),
        art = PasswortArt.WIEDERHOLUNG,
        hinweis = if (verschieden) stringResource(R.string.startpasswort_verschieden) else null,
        fehlerhaft = verschieden)
}
