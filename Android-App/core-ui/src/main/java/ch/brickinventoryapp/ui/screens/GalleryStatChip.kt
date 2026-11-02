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
 * Die Reihe der Kennzahlen über Sets, Teilen und Figuren — eine Fassung, damit alle
 * drei gleich umbrechen. FlowRow statt seitlichem Rollen: Eine angeschnittene Kachel
 * am Rand sagte nicht, dass rechts noch etwas kommt.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun KennzahlenReihe(modifier: Modifier = Modifier, inhalt: @Composable () -> Unit) {
    FlowRow(
        modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(ch.brickinventoryapp.ui.theme.Abstaende.klein),
        verticalArrangement = Arrangement.spacedBy(ch.brickinventoryapp.ui.theme.Abstaende.klein),
    ) { inhalt() }
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
