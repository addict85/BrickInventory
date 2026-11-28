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
import ch.brickinventoryapp.ui.LoadingIndicator
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.uistate.ErrorClass

/**
 * Loading, error, empty, no results and content — the same building block for every
 * screen with loaded content, so no error looks like an empty list
 * anymore. The error names the reason and offers „try again“.
 */
@Composable
fun LoadState(
    display: LoadingIndicator,
    error: String?,
    onAgain: () -> Unit,
    empty: @Composable ColumnScope.() -> Unit,
    modifier: Modifier = Modifier,
    noHits: @Composable ColumnScope.() -> Unit = { NoHitsHint() },
    loading: @Composable () -> Unit = { LoadCircle() },
    errorClass: ErrorClass?,
    content: @Composable () -> Unit,
) {
    when (display) {
        LoadingIndicator.LIST -> content()
        LoadingIndicator.LOADS -> loading()
        LoadingIndicator.ERROR -> StateHint(modifier) { ErrorHint(error, onAgain, errorClass) }
        LoadingIndicator.NO_HITS -> StateHint(modifier, noHits)
        LoadingIndicator.EMPTY -> StateHint(modifier, empty)
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
fun StateHint(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Spacing.huge),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.medium, Alignment.CenterVertically),
        content = content,
    )
}

/** Icon, heading and an explanatory sentence — the shape of every hint. */
@Composable
fun HintText(symbol: ImageVector, title: String, text: String? = null) {
    EmptySymbol(symbol)
    Text(title, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center,
        modifier = Modifier.semantics { heading() })
    if (text != null) Text(text, style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
}

/**
 * The error is announced (liveRegion) as soon as it appears. Without a receiver,
 * so any surface can embed it, including a card in settings.
 * With [kind], icon, heading and advice of that class are shown; the data layer's
 * sentence only where it says more than the heading (code, server text).
 * [kind] with no default: whoever left it out showed a server error without advice.
 */
@Composable
fun ErrorHint(error: String?, onAgain: () -> Unit, kind: ErrorClass?) {
    val (symbol, title, advice) = when (kind) {
        ErrorClass.OFFLINE -> Triple(Icons.Default.CloudOff, R.string.error_offline_title, R.string.error_offline_text)
        ErrorClass.SERVER -> Triple(Icons.Default.Dns, R.string.error_server_title, R.string.error_server_text)
        ErrorClass.LOGIN -> Triple(Icons.Default.Lock, R.string.error_login_title, R.string.error_login_text)
        ErrorClass.UNKNOWN, null -> Triple(Icons.Default.ErrorOutline, R.string.common_load_failed, null)
    }
    val showSet = kind == null || kind == ErrorClass.SERVER || kind == ErrorClass.UNKNOWN
    Column(
        Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.medium),
    ) {
        HintText(symbol, stringResource(title), advice?.let { stringResource(it) })
        if (showSet && !error.isNullOrBlank()) {
            Text(error, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        }
        Button(onClick = onAgain) { Text(stringResource(R.string.common_retry)) }
    }
}

@Composable
fun NoHitsHint(text: String = stringResource(R.string.common_no_results)) {
    HintText(Icons.Default.SearchOff, text, stringResource(R.string.common_no_results_hint))
}
