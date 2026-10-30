package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.SearchOff
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import ch.brickinventoryapp.R
import ch.brickinventoryapp.ui.Ladeanzeige
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Formen

/**
 * Laden, Fehler, Leer, Kein Treffer und Inhalt — derselbe Baustein für jeden
 * Bildschirm mit geladenem Inhalt, damit kein Fehler mehr wie eine leere Liste
 * aussieht. Der Fehler nennt den Grund und bietet „Erneut versuchen“ an.
 */
@Composable
fun Ladezustand(
    anzeige: Ladeanzeige,
    fehler: String?,
    onErneut: () -> Unit,
    leer: @Composable ColumnScope.() -> Unit,
    modifier: Modifier = Modifier,
    keineTreffer: @Composable ColumnScope.() -> Unit = { KeinTrefferHinweis() },
    laedt: @Composable () -> Unit = { LadeKreis() },
    inhalt: @Composable () -> Unit,
) {
    when (anzeige) {
        Ladeanzeige.LISTE -> inhalt()
        Ladeanzeige.LAEDT -> laedt()
        Ladeanzeige.FEHLER -> ZustandsHinweis(modifier) { FehlerHinweis(fehler, onErneut) }
        Ladeanzeige.KEINE_TREFFER -> ZustandsHinweis(modifier, keineTreffer)
        Ladeanzeige.LEER -> ZustandsHinweis(modifier, leer)
    }
}

/** Der Kringel in der Mitte, für Bildschirme ohne eigenes Skelett. */
@Composable
fun LadeKreis(modifier: Modifier = Modifier) {
    val text = stringResource(R.string.common_loading)
    Box(modifier.fillMaxSize().semantics { contentDescription = text }, contentAlignment = Alignment.Center) {
        CircularProgressIndicator()
    }
}

/**
 * Mittig und rollbar: Auf einem kleinen Telefon im Querformat passt der Hinweis
 * samt Knöpfen sonst nicht hin, und PullToRefresh braucht etwas zum Ziehen.
 */
@Composable
fun ZustandsHinweis(modifier: Modifier = Modifier, inhalt: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Abstaende.riesig),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Abstaende.mittel, Alignment.CenterVertically),
        content = inhalt,
    )
}

/** Symbol, Überschrift und ein erklärender Satz — die Form aller Hinweise. */
@Composable
fun HinweisText(symbol: ImageVector, titel: String, text: String? = null) {
    LeerSymbol(symbol)
    Text(titel, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center,
        modifier = Modifier.semantics { heading() })
    if (text != null) Text(text, style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
}

/**
 * Der Fehler wird angesagt (liveRegion), sobald er erscheint. Ohne Empfänger,
 * damit ihn jede Fläche einbetten kann, auch eine Karte in den Einstellungen.
 */
@Composable
fun FehlerHinweis(fehler: String?, onErneut: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Abstaende.mittel),
    ) {
        HinweisText(Icons.Default.CloudOff, stringResource(R.string.common_load_failed), fehler)
        Button(onClick = onErneut, shape = Formen.knopf) { Text(stringResource(R.string.common_retry)) }
    }
}

@Composable
fun KeinTrefferHinweis(text: String = stringResource(R.string.common_no_results)) {
    HinweisText(Icons.Default.SearchOff, text, stringResource(R.string.common_no_results_hint))
}
