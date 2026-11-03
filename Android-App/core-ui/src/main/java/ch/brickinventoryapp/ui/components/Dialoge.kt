package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
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
 */
@Composable
fun ErfassenDialog(
    titel: String,
    bestaetigen: String,
    onBestaetigen: () -> Unit,
    onAbbrechen: () -> Unit,
    bestaetigenAn: Boolean = true,
    /** Was fehlt, solange [bestaetigenAn] aus ist — ein blasser Knopf allein liess raten, warum. */
    fehlt: String? = null,
    inhalt: @Composable ColumnScope.() -> Unit,
) {
    AlertDialog(
        onDismissRequest = onAbbrechen,
        title = { Text(titel) },
        // Rollbar: Bei 200 % Schrift sind die Felder höher als das Fenster; die Knöpfe
        // bleiben dabei stehen, nur die Felder rollen.
        text = {
            // Höchstens gut die halbe Bildschirmhöhe: Sonst wächst der Dialog über den
            // Bildschirm, das Fenster kürzt ihn, und Compose misst ohne Ende neu.
            val metrik = LocalContext.current.resources.displayMetrics
            val hoechstens = (metrik.heightPixels / metrik.density * 0.55f).dp
            Column(Modifier.heightIn(max = hoechstens).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(Abstaende.mittel)) {
                inhalt()
                if (!bestaetigenAn && fehlt != null) Text(fehlt, style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        },
        confirmButton = {
            Button(onClick = onBestaetigen, enabled = bestaetigenAn) { Text(bestaetigen) }
        },
        dismissButton = { TextButton(onClick = onAbbrechen) { Text(stringResource(R.string.common_cancel)) } },
    )
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
        OutlinedTextField(
            value = passwort, onValueChange = { passwort = it },
            label = { Text(stringResource(R.string.konto_password_current)) },
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Formen.feld,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
        if (codeNoetig) ZweiterFaktorCodeFeld(code) { code = it }
        if (fehler != null) {
            Text(fehler, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
        }
    }
}

/** Der Code des zweiten Faktors, den der Server für Passwort, E-Mail und Gutscheine verlangt. */
@Composable
fun ZweiterFaktorCodeFeld(code: String, onCode: (String) -> Unit) {
    OutlinedTextField(
        value = code, onValueChange = { onCode(it.take(24)) },
        label = { Text(stringResource(R.string.login_code)) },
        supportingText = { Text(stringResource(R.string.login_code_hint)) },
        modifier = Modifier.fillMaxWidth(), singleLine = true, shape = Formen.feld,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii))
}
