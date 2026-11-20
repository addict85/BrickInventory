package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.BorderStroke
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
import androidx.compose.material3.TextButton
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
import ch.brickinventoryapp.model.util.fmtStatus
import ch.brickinventoryapp.ui.util.appNumberLocale
import ch.brickinventoryapp.ui.util.twentyFourHours

/** Wie viele Änderungen im Ausgang warten — das Gerüst setzt es, der Offline-Hinweis nennt es mit. */
val LocalOpenChanges = compositionLocalOf { 0 }

/**
 * Zählt die Offline-Hinweise, die gerade stehen. Steht einer, nennt er die wartenden
 * Änderungen selbst, und die Ausgangsleiste des Gerüsts tritt zurück: Zwei lose
 * Zeilen übereinander widersprachen sich („wird gesendet“ über „offline“).
 */
val LocalOfflineHints = staticCompositionLocalOf<MutableIntState?> { null }

/**
 * Ein Banner über einer Liste, die nicht vom Server kommt, sondern aus dem
 * Plattenspeicher, samt der Änderungen, die auf die nächste Verbindung warten.
 * Ohne Fläche ging es zwischen Umschalter und Suche unter; bei `null` nichts.
 * [onErneut] holt die Liste neu: Ohne Knopf blieb nur das Ziehen, und das sieht man nicht.
 */
@Composable
fun OfflineHint(stand: Long?, modifier: Modifier = Modifier, onErneut: (() -> Unit)? = null) {
    if (stand == null) return
    val counter = LocalOfflineHints.current
    if (counter != null) DisposableEffect(counter) {
        counter.intValue += 1
        onDispose { counter.intValue -= 1 }
    }
    val offen = LocalOpenChanges.current
    NoticeBanner(
        symbol = Icons.Default.CloudOff,
        titel = stringResource(R.string.offline_stand,
            fmtStatus(stand, appNumberLocale(), twentyFour = twentyFourHours())),
        text = if (offen > 0) pluralStringResource(R.plurals.offline_warten, offen, offen) else null,
        modifier = modifier,
        aktion = onErneut?.let { stringResource(R.string.common_retry) to it },
    )
}

/**
 * Das Banner über dem Inhalt, solange Änderungen im Ausgang warten — auf jedem
 * Reiter, weil man offline überall etwas ändern kann. Angesagt, damit TalkBack die
 * Zahl nennt, wenn sie sich ändert.
 */
@Composable
fun ExitBar(anzahl: Int, modifier: Modifier = Modifier) {
    if (anzahl <= 0) return
    NoticeBanner(
        symbol = Icons.Default.CloudUpload,
        titel = pluralStringResource(R.plurals.offline_warten, anzahl, anzahl),
        text = null,
        modifier = modifier,
    )
}

/**
 * Neutrale Fläche mit Rahmen: Offline ist kein Fehler, die Änderungen sind gesichert.
 * tertiaryContainer war in Classic und Noppe rot und meldete einen Fehler, wo keiner
 * ist; Rot bleibt dem verworfenen Abgleich (Snackbar aus dem Ausgangsmelder).
 */
@Composable
private fun NoticeBanner(
    symbol: ImageVector,
    titel: String,
    text: String?,
    modifier: Modifier = Modifier,
    aktion: Pair<String, () -> Unit>? = null,
) {
    Surface(
        modifier.fillMaxWidth().padding(horizontal = Abstaende.mittel, vertical = Abstaende.tiny).announce(),
        shape = Formen.leiste,
        color = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Row(
            Modifier.padding(horizontal = Abstaende.mittel, vertical = Abstaende.klein),
            horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(symbol, contentDescription = null, modifier = Modifier.size(withFont(18.dp)),
                tint = MaterialTheme.colorScheme.primary)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Abstaende.hairline)) {
                Text(titel, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
                if (text != null) Text(text, style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (aktion != null) TextButton(onClick = aktion.second) { Text(aktion.first) }
        }
    }
}
