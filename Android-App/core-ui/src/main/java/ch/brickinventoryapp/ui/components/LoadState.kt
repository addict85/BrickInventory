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
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Lock
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
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.model.ui.Fehlerklasse
import ch.brickinventoryapp.ui.LoadingIndicator
import ch.brickinventoryapp.ui.theme.Abstaende

/**
 * Loading, error, empty, no results and content — the same building block for every
 * screen with loaded content, so no error looks like an empty list
 * anymore. The error names the reason and offers „try again“.
 */
@Composable
fun LoadState(
    anzeige: LoadingIndicator,
    fehler: String?,
    onErneut: () -> Unit,
    leer: @Composable ColumnScope.() -> Unit,
    modifier: Modifier = Modifier,
    noHits: @Composable ColumnScope.() -> Unit = { NoHitsHint() },
    laedt: @Composable () -> Unit = { LoadCircle() },
    errorClass: Fehlerklasse?,
    inhalt: @Composable () -> Unit,
) {
    when (anzeige) {
        LoadingIndicator.LISTE -> inhalt()
        LoadingIndicator.LOADS -> laedt()
        LoadingIndicator.FEHLER -> StateHint(modifier) { ErrorHint(fehler, onErneut, errorClass) }
        LoadingIndicator.NO_HITS -> StateHint(modifier, noHits)
        LoadingIndicator.LEER -> StateHint(modifier, leer)
    }
}

/** The spinner in the middle, for screens without their own skeleton. */
@Composable
fun LoadCircle(modifier: Modifier = Modifier) {
    val text = stringResource(R.string.common_loading)
    Box(modifier.fillMaxSize().semantics { contentDescription = text; liveRegion = LiveRegionMode.Polite }, contentAlignment = Alignment.Center) {
        CircularProgressIndicator()
    }
}

/**
 * Centered and scrollable: on a small phone in landscape, the hint plus
 * buttons otherwise don't fit, and PullToRefresh needs something to pull.
 */
@Composable
fun StateHint(modifier: Modifier = Modifier, inhalt: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Abstaende.huge),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Abstaende.mittel, Alignment.CenterVertically),
        content = inhalt,
    )
}

/** Icon, heading and an explanatory sentence — the shape of every hint. */
@Composable
fun HintText(symbol: ImageVector, titel: String, text: String? = null) {
    EmptySymbol(symbol)
    Text(titel, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center,
        modifier = Modifier.semantics { heading() })
    if (text != null) Text(text, style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
}

/**
 * The error is announced (liveRegion) as soon as it appears. Without a receiver,
 * so any surface can embed it, including a card in settings.
 * With [klasse], icon, heading and advice of that class are shown; the data layer's
 * sentence only where it says more than the heading (code, server text).
 * [klasse] with no default: whoever left it out showed a server error without advice.
 */
@Composable
fun ErrorHint(fehler: String?, onErneut: () -> Unit, klasse: Fehlerklasse?) {
    val (symbol, titel, rat) = when (klasse) {
        Fehlerklasse.OFFLINE -> Triple(Icons.Default.CloudOff, R.string.fehler_offline_titel, R.string.fehler_offline_text)
        Fehlerklasse.SERVER -> Triple(Icons.Default.Dns, R.string.fehler_server_titel, R.string.fehler_server_text)
        Fehlerklasse.LOGIN -> Triple(Icons.Default.Lock, R.string.fehler_anmeldung_titel, R.string.fehler_anmeldung_text)
        Fehlerklasse.UNBEKANNT, null -> Triple(Icons.Default.ErrorOutline, R.string.common_load_failed, null)
    }
    val showSet = klasse == null || klasse == Fehlerklasse.SERVER || klasse == Fehlerklasse.UNBEKANNT
    Column(
        Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Abstaende.mittel),
    ) {
        HintText(symbol, stringResource(titel), rat?.let { stringResource(it) })
        if (showSet && !fehler.isNullOrBlank()) {
            Text(fehler, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        }
        Button(onClick = onErneut) { Text(stringResource(R.string.common_retry)) }
    }
}

@Composable
fun NoHitsHint(text: String = stringResource(R.string.common_no_results)) {
    HintText(Icons.Default.SearchOff, text, stringResource(R.string.common_no_results_hint))
}
