package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.MutableIntState
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.util.fmtStand

/** Wie viele Änderungen im Ausgang warten — das Gerüst setzt es, der Offline-Hinweis nennt es mit. */
val LocalOffeneAenderungen = compositionLocalOf { 0 }

/**
 * Zählt die Offline-Hinweise, die gerade stehen. Steht einer, nennt er die wartenden
 * Änderungen selbst, und die Ausgangsleiste des Gerüsts tritt zurück: Zwei lose
 * Zeilen übereinander widersprachen sich („wird gesendet“ über „offline“).
 */
val LocalOfflineHinweise = staticCompositionLocalOf<MutableIntState?> { null }

/**
 * Ein Banner über einer Liste, die nicht vom Server kommt, sondern aus dem
 * Plattenspeicher, samt der Änderungen, die auf die nächste Verbindung warten.
 * Ohne Fläche ging es zwischen Umschalter und Suche unter; bei `null` nichts.
 */
@Composable
fun OfflineHinweis(stand: Long?, modifier: Modifier = Modifier) {
    if (stand == null) return
    val zaehler = LocalOfflineHinweise.current
    if (zaehler != null) DisposableEffect(zaehler) {
        zaehler.intValue += 1
        onDispose { zaehler.intValue -= 1 }
    }
    val offen = LocalOffeneAenderungen.current
    Hinweisbanner(
        symbol = Icons.Default.CloudOff,
        titel = stringResource(R.string.offline_stand, fmtStand(stand, ch.brickinventoryapp.util.appNumberLocale())),
        text = if (offen > 0) pluralStringResource(R.plurals.offline_warten, offen, offen) else null,
        modifier = modifier,
    )
}

/**
 * Das Banner über dem Inhalt, solange Änderungen im Ausgang warten — auf jedem
 * Reiter, weil man offline überall etwas ändern kann. Angesagt, damit TalkBack die
 * Zahl nennt, wenn sie sich ändert.
 */
@Composable
fun AusgangLeiste(anzahl: Int, modifier: Modifier = Modifier) {
    if (anzahl <= 0) return
    Hinweisbanner(
        symbol = Icons.Default.CloudUpload,
        titel = pluralStringResource(R.plurals.offline_warten, anzahl, anzahl),
        text = null,
        modifier = modifier,
    )
}

/** Fläche in tertiaryContainer: hebt sich in jedem Design ab, ohne nach Fehler auszusehen. */
@Composable
private fun Hinweisbanner(symbol: ImageVector, titel: String, text: String?, modifier: Modifier = Modifier) {
    Surface(
        modifier.fillMaxWidth().padding(horizontal = Abstaende.mittel, vertical = Abstaende.winzig).ansagen(),
        shape = Formen.leiste,
        color = MaterialTheme.colorScheme.tertiaryContainer,
        contentColor = MaterialTheme.colorScheme.onTertiaryContainer,
    ) {
        Row(
            Modifier.padding(horizontal = Abstaende.mittel, vertical = Abstaende.klein),
            horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(symbol, contentDescription = null, modifier = Modifier.size(mitSchrift(18.dp)))
            Column(verticalArrangement = Arrangement.spacedBy(Abstaende.haar)) {
                Text(titel, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
                if (text != null) Text(text, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}
