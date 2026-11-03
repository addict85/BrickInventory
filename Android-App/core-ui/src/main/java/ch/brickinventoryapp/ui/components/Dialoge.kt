package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
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
        text = { Text(text) },
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
    inhalt: @Composable ColumnScope.() -> Unit,
) {
    AlertDialog(
        onDismissRequest = onAbbrechen,
        title = { Text(titel) },
        text = { Column(verticalArrangement = Arrangement.spacedBy(Abstaende.mittel), content = inhalt) },
        confirmButton = {
            Button(onClick = onBestaetigen, enabled = bestaetigenAn, shape = Formen.knopf) { Text(bestaetigen) }
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
            if (titel != null) Text(titel, style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.primary,
                modifier = (if (innenAbstand) Modifier else Modifier.padding(start = Abstaende.gross,
                    end = Abstaende.gross, top = Abstaende.gross)).semantics { heading() })
            inhalt()
        }
    }
}
