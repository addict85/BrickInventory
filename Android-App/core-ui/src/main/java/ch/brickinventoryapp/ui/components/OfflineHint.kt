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
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.model.util.fmtStatus
import ch.brickinventoryapp.ui.util.appNumberLocale
import ch.brickinventoryapp.ui.util.twentyFourHours

/** How many changes are waiting in the outbox — the scaffold sets it, the offline hint names it along. */
val LocalOpenChanges = compositionLocalOf { 0 }

/**
 * Counts the offline hints currently shown. If one is shown, it names the waiting
 * changes itself, and the scaffold's outbox bar steps back: two loose
 * rows stacked contradicted each other („sending" over „offline“).
 */
val LocalOfflineHints = staticCompositionLocalOf<MutableIntState?> { null }

/**
 * A banner over a list that doesn't come from the server but from
 * disk storage, together with the changes waiting for the next connection.
 * Without a surface it got lost between the switcher and the search field; with `null`, nothing.
 * [onErneut] fetches the list again: without a button, only pulling was left, and that can't be seen.
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
 * The banner above the content as long as changes are waiting in the outbox — on every
 * tab, because you can change something offline anywhere. Announced, so TalkBack names
 * the number when it changes.
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
 * A neutral surface with a border: offline is not an error, the changes are safely stored.
 * tertiaryContainer was red in Classic and Noppe and reported an error where there is
 * none; red stays reserved for a discarded sync (snackbar from the outbox reporter).
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
