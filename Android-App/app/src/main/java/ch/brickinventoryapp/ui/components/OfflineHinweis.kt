package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.R
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.util.fmtStand

/**
 * Eine Zeile über einer Liste, die nicht vom Server kommt, sondern aus dem
 * Plattenspeicher. Ohne sie sähe ein Stand von gestern aus wie ein frischer.
 * Dezent, weil die Daten trotzdem brauchbar sind; bei `null` nichts.
 */
@Composable
fun OfflineHinweis(stand: Long?, modifier: Modifier = Modifier) {
    if (stand == null) return
    Row(
        modifier.fillMaxWidth().padding(horizontal = Abstaende.mittel, vertical = Abstaende.winzig),
        horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Default.CloudOff, contentDescription = null, modifier = Modifier.size(16.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(stringResource(R.string.offline_stand, fmtStand(stand)),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/**
 * Die Leiste über dem Inhalt, solange Änderungen im Ausgang warten — auf jedem
 * Reiter, weil man offline überall etwas ändern kann. Eine Live-Region, damit
 * TalkBack die Zahl ansagt, wenn sie sich ändert.
 */
@Composable
fun AusgangLeiste(anzahl: Int, modifier: Modifier = Modifier) {
    if (anzahl <= 0) return
    Row(
        modifier.fillMaxWidth().padding(horizontal = Abstaende.mittel, vertical = Abstaende.winzig)
            .semantics { liveRegion = LiveRegionMode.Polite },
        horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Default.CloudUpload, contentDescription = null, modifier = Modifier.size(16.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(pluralStringResource(R.plurals.offline_ausgang, anzahl, anzahl),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
