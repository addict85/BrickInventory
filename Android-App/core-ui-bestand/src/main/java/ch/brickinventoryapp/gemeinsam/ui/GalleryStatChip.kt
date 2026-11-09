package ch.brickinventoryapp.gemeinsam.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.util.fmtInt

/**
 * Eine Kennzahl als Text: Zahl fett, Bezeichnung daneben. Keine eigene Fläche — die
 * kräftigen Pillen sahen aus wie Knöpfe, taten aber nichts. Zahl und Wort aus einem
 * Plural, sonst stand „1 Exemplare“; zusammengefasst vorgelesen als eine Fundstelle.
 */
@Composable
fun GalleryStatChip(anzahl: Int, plural: Int, detail: String? = null) {
    val zahl = fmtInt(anzahl)
    val text = pluralStringResource(plural, anzahl, zahl)
    // Die Aufschlüsselung klein in derselben Zeile: Als zweite Zeile darunter war die
    // Kennzahl breiter als ihr Wert und liess eine Lücke vor der nächsten.
    val klein = MaterialTheme.typography.labelSmall.fontSize
    val stelle = text.indexOf(zahl)
    Text(
        buildAnnotatedString {
            if (stelle < 0) append(text) else {
                append(text, 0, stelle)
                withStyle(SpanStyle(fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)) { append(zahl) }
                append(text, stelle + zahl.length, text.length)
            }
            if (detail != null) withStyle(SpanStyle(fontSize = klein)) { append("\u2002("); append(detail); append(')') }
        },
        Modifier.semantics(mergeDescendants = true) {},
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

/**
 * Die Kennzahlen über Sets, Teilen, Figuren und im Detail — eine ruhige Fläche
 * (surfaceContainerLow, ohne Rand und Schatten), damit keine nach Bedienelement aussieht.
 * Sie brechen um, auch bei 200 %: Wischbar war bei grosser Schrift nur ein Teil zu
 * sehen, und den Pfeil am Rand konnte man nicht antippen.
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
