package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.model.ui.Listenansicht

/**
 * Umschalter Karten/Tabelle als zwei Chips: Bei zwei Möglichkeiten wäre ein
 * Aufklappmenü ein Klick zu viel, und die Wahl ist ohne Öffnen sichtbar.
 */
@Composable
fun AnsichtUmschalter(
    aktuell: Listenansicht,
    onWechsel: (Listenansicht) -> Unit,
    modifier: Modifier = Modifier,
) {
    SegmentWahl(
        optionen = listOf(
            Listenansicht.KARTEN to stringResource(R.string.view_cards),
            Listenansicht.TABELLE to stringResource(R.string.view_table),
        ),
        gewaehlt = aktuell,
        onWahl = onWechsel,
        modifier = modifier,
    )
}

/**
 * Das Suchfeld für Galerie, Teile, Minifiguren und Katalog. Eine Fassung, damit
 * auch der Leeren-Knopf überall gleich heisst: `cd_search_clear` beschreibt die
 * Wirkung — „Löschen“ hätte TalkBack-Nutzern das Wort für „Bestand vernichten“
 * vorgelesen.
 */
@Composable
fun Suchfeld(
    wert: String,
    onWert: (String) -> Unit,
    platzhalter: String,
    modifier: Modifier = Modifier,
) {
    // Bei normaler Schrift eine Zeile: Ein umbrechender Platzhalter machte das Feld doppelt
    // so hoch wie den Filterknopf daneben. Bei grosser Schrift bricht er um, statt bei
    // „Nummer oder…“ abzureissen.
    val zeilen = if (grosseSchrift()) PLATZHALTER_ZEILEN_GROSS else 1
    OutlinedTextField(
        value = wert,
        onValueChange = onWert,
        placeholder = { Text(platzhalter, maxLines = zeilen, overflow = TextOverflow.Ellipsis) },
        leadingIcon = { Icon(Icons.Default.Search, null, Modifier.size(mitSchrift(20.dp))) },
        trailingIcon = {
            if (wert.isNotEmpty()) {
                MitTooltip(stringResource(R.string.cd_search_clear)) {
                    IconButton(onClick = { onWert("") }) {
                        Icon(Icons.Default.Clear, stringResource(R.string.cd_search_clear))
                    }
                }
            }
        },
        // Der Platzhalter verschwindet mit der ersten Eingabe; der Name des Felds bleibt.
        modifier = modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = Abstaende.klein)
            .semantics { contentDescription = platzhalter },
        singleLine = true,
        shape = Formen.karte,
    )
}

private const val PLATZHALTER_ZEILEN_GROSS = 3
