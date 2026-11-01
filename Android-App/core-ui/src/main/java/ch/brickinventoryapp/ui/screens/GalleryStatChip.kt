package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.util.fmtInt
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/**
 * Eine Kennzahl mit Bezeichnung. Volle Rollenfarben ohne Alpha: Die kleine
 * Bezeichnung erreichte abgeschwächt nur 3,4:1. Zusammengefasst vorgelesen,
 * damit „12 Sets“ eine Fundstelle ist und nicht zwei.
 */
@Composable
fun GalleryStatChip(value: String, label: String, detail: String? = null) {
    Surface(
        shape = Formen.chip,
        color = MaterialTheme.colorScheme.primaryContainer,
        contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
        modifier = Modifier.semantics(mergeDescendants = true) {},
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp)
        ) {
            Text(value, fontWeight = FontWeight.ExtraBold, style = MaterialTheme.typography.titleMedium)
            Text(label, style = MaterialTheme.typography.labelSmall)
            if (detail != null) Text(detail, style = MaterialTheme.typography.labelSmall)
        }
    }
}

/**
 * „144 aus Sets · 250 einzeln“ unter der Teilezahl, wie in der Webapp — nur wenn
 * es einzeln erfasste Teile gibt; sonst wäre die Zeile die Zahl darüber noch einmal.
 */
@Composable
fun teileAufschluesselung(ausSets: Int?, einzeln: Int?): String? =
    if (ausSets != null && einzeln != null && einzeln > 0)
        stringResource(R.string.parts_breakdown, fmtInt(ausSets), fmtInt(einzeln))
    else null
