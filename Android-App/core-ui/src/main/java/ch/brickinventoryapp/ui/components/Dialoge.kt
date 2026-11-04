package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import ch.brickinventoryapp.ui.MITTLERE_BREITE_DP
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.text.input.KeyboardType
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.AppKarte
import ch.brickinventoryapp.ui.theme.Formen

/**
 * Die Rückfrage vor einer Aktion ohne Weg zurück: Symbol, Titel, ein Satz, die
 * Aktion in Fehlerfarbe rechts. Eine Bauform für Set löschen, Lagerort löschen,
 * Konto trennen und Abmelden — vorher fragte nur das Set nach.
 * Schliessen muss der Aufrufer in [onBestaetigen] selbst.
 */
@Composable
fun Rueckfrage(
    titel: String,
    text: String,
    bestaetigen: String,
    onBestaetigen: () -> Unit,
    onAbbrechen: () -> Unit,
    symbol: ImageVector? = null,
) {
    AlertDialog(
        onDismissRequest = onAbbrechen,
        icon = symbol?.let { s -> { Icon(s, null, tint = MaterialTheme.colorScheme.error) } },
        title = { Text(titel) },
        // Rollbar: Bei 200 % Schrift reicht ein langer Satz sonst unter die Knöpfe.
        text = { Text(text, Modifier.verticalScroll(rememberScrollState())) },
        confirmButton = {
            TextButton(onClick = onBestaetigen) { Text(bestaetigen, color = MaterialTheme.colorScheme.error) }
        },
        dismissButton = { TextButton(onClick = onAbbrechen) { Text(stringResource(R.string.common_cancel)) } },
    )
}

/**
 * Der Rahmen jedes Erfassen-Dialogs: Titel links ohne Symbol, die Felder mit
 * gleichem Abstand untereinander, rechts der volle Knopf. Set, Merkposten,
 * Übernahme und Lagerort sahen vorher je anders aus (Symbol, Mitte, Rundung).
 * Auf dem Telefon mit grosser Schrift als Vollbild ([vollbildErfassen]).
 */
@Composable
fun ErfassenDialog(
    titel: String,
    bestaetigen: String,
    onBestaetigen: () -> Unit,
    onAbbrechen: () -> Unit,
    bestaetigenAn: Boolean = true,
    inhalt: @Composable ColumnScope.() -> Unit,
) {
    if (vollbildErfassen()) {
        VollbildErfassen(titel, bestaetigen, onBestaetigen, onAbbrechen, bestaetigenAn, inhalt)
        return
    }
    AlertDialog(
        onDismissRequest = onAbbrechen,
        title = { Text(titel) },
        // Rollbar: Ist die Schrift gross, sind die Felder höher als das Fenster; die
        // Knöpfe bleiben dabei stehen, nur die Felder rollen.
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(Abstaende.mittel)) { inhalt() }
        },
        confirmButton = {
            Button(onClick = onBestaetigen, enabled = bestaetigenAn) { Text(bestaetigen) }
        },
        dismissButton = { TextButton(onClick = onAbbrechen) { Text(stringResource(R.string.common_cancel)) } },
    )
}

/**
 * Vollbild statt schwebendem Dialog: auf schmalem Fenster ab grosser Schrift. Dort
 * füllte der AlertDialog den Schirm ohnehin, und seine Rollkante schnitt Zeilen mitten
 * durch (Material: „full-screen dialog“ für Eingaben auf dem Telefon).
 */
@Composable
fun vollbildErfassen(): Boolean {
    val breiteDp = LocalWindowInfo.current.containerSize.width / LocalDensity.current.density
    return grosseSchrift() && breiteDp < MITTLERE_BREITE_DP
}

/**
 * Kopf mit Schliessen und Titel, die Felder rollen, der Bestätigen-Knopf steht fest
 * am Fuss in voller Breite: Neben einem Titel in 200 % Schrift hätte er oben keinen Platz.
 */
@Composable
private fun VollbildErfassen(
    titel: String,
    bestaetigen: String,
    onBestaetigen: () -> Unit,
    onAbbrechen: () -> Unit,
    bestaetigenAn: Boolean,
    inhalt: @Composable ColumnScope.() -> Unit,
) {
    Dialog(onDismissRequest = onAbbrechen, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
            Column(Modifier.fillMaxSize().imePadding()) {
                Row(Modifier.fillMaxWidth().padding(horizontal = Abstaende.winzig, vertical = Abstaende.klein),
                    verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = onAbbrechen) {
                        Icon(Icons.Default.Close, contentDescription = stringResource(R.string.common_cancel))
                    }
                    Text(titel, style = MaterialTheme.typography.titleLarge,
                        modifier = Modifier.weight(1f).semantics { heading() })
                }
                Column(
                    Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())
                        .padding(horizontal = Abstaende.gross, vertical = Abstaende.klein),
                    verticalArrangement = Arrangement.spacedBy(Abstaende.mittel),
                ) { inhalt() }
                HorizontalDivider()
                Button(onClick = onBestaetigen, enabled = bestaetigenAn,
                    modifier = Modifier.fillMaxWidth().padding(Abstaende.gross)) { Text(bestaetigen) }
            }
        }
    }
}

/**
 * Ein Abschnitt einer Unterseite: Karte mit Überschrift. Anders als SettingsCard
 * ohne Symbol und ohne Grossbuchstaben — auf einer Unterseite nennt die App-Leiste
 * die Rubrik schon, der Abschnitt nur seinen Teil davon. Ohne [titel] eine
 * Karte ohne Kopf.
 */
@Composable
fun Abschnitt(
    titel: String?,
    modifier: Modifier = Modifier,
    innenAbstand: Boolean = true,
    inhalt: @Composable ColumnScope.() -> Unit,
) {
    AppKarte(modifier) {
        Column(
            if (innenAbstand) Modifier.fillMaxWidth().padding(Abstaende.gross) else Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Abstaende.klein),
        ) {
            // Dieselbe Überschrift wie jede Karte (Abschnittstitel).
            if (titel != null) Abschnittstitel(titel,
                if (innenAbstand) Modifier else Modifier.padding(start = Abstaende.gross,
                    end = Abstaende.gross, top = Abstaende.gross))
            inhalt()
        }
    }
}

/**
 * Die Rückfrage nach dem Passwort vor einem Schritt, den der Server bestätigt haben
 * will. Das Codefeld erst, wenn er den zweiten Faktor verlangt hat ([codeNoetig]);
 * das Passwort bleibt dabei stehen. Beides nur in remember: Gesicherter Zustand
 * landet im Bundle und bei Prozesstod auf der Platte.
 */
@Composable
fun PasswortRueckfrage(
    titel: String,
    text: String,
    bestaetigen: String,
    codeNoetig: Boolean,
    fehler: String?,
    laeuft: Boolean,
    onBestaetigen: (passwort: String, code: String?) -> Unit,
    onAbbrechen: () -> Unit,
) {
    var passwort by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    ErfassenDialog(
        titel = titel,
        bestaetigen = bestaetigen,
        onBestaetigen = { onBestaetigen(passwort, code.takeIf { codeNoetig && it.isNotBlank() }) },
        onAbbrechen = onAbbrechen,
        bestaetigenAn = !laeuft && passwort.isNotEmpty() && (!codeNoetig || code.isNotBlank()),
    ) {
        // Ein Dialog hat sein eigenes Fenster; der Schutz der Seite reicht nicht hinein.
        Ueberdeckungsschutz()
        Text(text, style = MaterialTheme.typography.bodyMedium)
        PasswortFeld(passwort, { passwort = it }, stringResource(R.string.konto_password_current),
            Modifier.fillMaxWidth())
        if (codeNoetig) ZweiterFaktorCodeFeld(code) { code = it }
        if (fehler != null) FehlerZeile(fehler)
    }
}

/** Der Code des zweiten Faktors, den der Server für Passwort, E-Mail und Gutscheine verlangt. */
@Composable
fun ZweiterFaktorCodeFeld(code: String, onCode: (String) -> Unit) {
    OutlinedTextField(
        value = code, onValueChange = { onCode(it.take(24)) },
        label = { Text(stringResource(R.string.login_code)) },
        supportingText = { Text(stringResource(R.string.login_code_hint)) },
        // Das System bietet einen eben empfangenen Code zum Einsetzen an.
        modifier = Modifier.fillMaxWidth().semantics { contentType = ContentType.SmsOtpCode },
        singleLine = true, shape = Formen.feld,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii))
}
