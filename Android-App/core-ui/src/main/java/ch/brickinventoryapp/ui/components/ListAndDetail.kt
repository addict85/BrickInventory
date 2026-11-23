package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarColors
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.Spacing

/**
 * The key of the entry whose detail currently sits next to it — the list marks
 * its tile. As a Local instead of a parameter, because the list only needs it in the two-pane view.
 */
val LocalOpenDetail = staticCompositionLocalOf<String?> { null }

/**
 * List on the left, detail on the right — on wide windows ([ch.brickinventoryapp.ui.listAndDetail]).
 * The list keeps a good two-fifths, so its grid has two columns; the detail
 * gets the rest and thus stays readable in one column. Whether side by side is decided by
 * the caller based on the window, because the scaffold (side rail) depends on it too.
 */
@Composable
fun ListAndDetail(
    modifier: Modifier = Modifier,
    list: @Composable () -> Unit,
    detail: @Composable () -> Unit,
) {
    Row(modifier.fillMaxSize()) {
        Box(Modifier.weight(0.42f).fillMaxHeight()) { list() }
        VerticalDivider()
        Box(Modifier.weight(0.58f).fillMaxHeight()) {
            CompositionLocalProvider(LocalInDetailArea provides true) { detail() }
        }
    }
}

/**
 * Does the screen sit as the right half next to its list? Then its
 * button at the top only closes the detail, and a back arrow would promise a page that doesn't
 * exist — Material only shows it in list and detail when single-column.
 */
val LocalInDetailArea = staticCompositionLocalOf { false }

/**
 * The key under which a list recognizes its open detail ([LocalOpenDetail]).
 * Parts carry the color along, because the same number in several colors has its own tile.
 */
fun detailKey(kind: String, number: String, color: Int? = null) = "$kind|$number|${color ?: ""}"

/**
 * The button at the top left of a detail page: back on its own page, close next to the
 * list or in the sheet ([close]). Always on the left, so nobody has to hunt for it in any scope.
 */
@Composable
fun BackButton(onClick: () -> Unit, close: Boolean = LocalInDetailArea.current) {
    val text = stringResource(if (close) R.string.detail_close else R.string.common_back)
    WithTooltip(text) {
        IconButton(onClick = onClick) {
            Icon(if (close) Icons.Default.Close else Icons.AutoMirrored.Filled.ArrowBack, contentDescription = text)
        }
    }
}

/**
 * The header of every detail view: back resp. close on the left, the name as the heading,
 * actions on the right. A long name wraps to a second line, and the bar grows with it —
 * with a single line, at 200% only the beginning was there.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DetailTopAppBar(
    title: String,
    onBack: () -> Unit,
    subtitle: String? = null,
    close: Boolean = LocalInDetailArea.current,
    colors: TopAppBarColors = TopAppBarDefaults.topAppBarColors(),
    actions: @Composable RowScope.() -> Unit = {},
) {
    var rows by remember { mutableIntStateOf(1) }
    val density = LocalDensity.current
    val typo = MaterialTheme.typography
    val height = with(density) {
        typo.titleLarge.lineHeight.toDp() * rows + (if (subtitle != null) typo.bodySmall.lineHeight.toDp() else 0.dp)
    } + Spacing.large * 2
    TopAppBar(
        title = {
            Column {
                // With large text, three lines: a part name with 30 characters needed them at 200%.
                Text(title, fontWeight = FontWeight.SemiBold, maxLines = if (largeFont()) 3 else 2, overflow = TextOverflow.Ellipsis,
                    onTextLayout = { rows = it.lineCount }, modifier = Modifier.semantics { heading() })
                if (subtitle != null) Text(subtitle, style = typo.bodySmall, maxLines = 1,
                    overflow = TextOverflow.Ellipsis)
            }
        },
        expandedHeight = maxOf(TopAppBarDefaults.TopAppBarExpandedHeight, height),
        navigationIcon = { BackButton(onBack, close) },
        actions = actions,
        colors = colors,
    )
}
