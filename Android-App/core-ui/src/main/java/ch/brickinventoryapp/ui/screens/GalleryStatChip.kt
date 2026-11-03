package ch.brickinventoryapp.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.util.fmtInt

/**
 * Eine Kennzahl als Text: Zahl fett, Bezeichnung daneben. Keine eigene Fläche — die
 * kräftigen Pillen sahen aus wie Knöpfe, taten aber nichts. Zusammengefasst
 * vorgelesen, damit „12 Sets“ eine Fundstelle ist und nicht zwei.
 */
@Composable
fun GalleryStatChip(value: String, label: String, detail: String? = null) {
    Column(Modifier.semantics(mergeDescendants = true) {}) {
        Text(
            buildAnnotatedString {
                withStyle(SpanStyle(fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)) { append(value) }
                append(' ')
                append(label)
            },
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (detail != null) Text(detail, style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/**
 * Die Kennzahlen über Sets, Teilen, Figuren und im Detail — eine ruhige Fläche
 * (surfaceContainerLow, ohne Rand und Schatten) mit umbrechendem Text. Eine Fassung,
 * damit alle gleich umbrechen und keine nach Bedienelement aussieht.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun KennzahlenReihe(modifier: Modifier = Modifier, inhalt: @Composable () -> Unit) {
    Surface(modifier.fillMaxWidth(), shape = Formen.leiste, color = MaterialTheme.colorScheme.surfaceContainerLow) {
        FlowRow(
            Modifier.padding(horizontal = Abstaende.rand, vertical = Abstaende.klein),
            horizontalArrangement = Arrangement.spacedBy(Abstaende.gross),
            verticalArrangement = Arrangement.spacedBy(Abstaende.winzig),
        ) { inhalt() }
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
