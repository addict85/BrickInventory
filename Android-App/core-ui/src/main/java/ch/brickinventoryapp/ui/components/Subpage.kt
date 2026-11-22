package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.ui.theme.ReadingWidth
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.theme.centeredUntil
import ch.brickinventoryapp.ui.title

/**
 * The frame of every sub-page: title, back arrow, the content below it with
 * spacing between the cards.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Subpage(
    title: String,
    snackbarHostState: SnackbarHostState,
    onBack: () -> Unit,
    /** Forms narrower than lists: an input field beyond 800 dp no longer reads as one. */
    width: androidx.compose.ui.unit.Dp = ReadingWidth.list,
    /** Actions for the whole page at the top right, e.g. an overflow menu. */
    actions: @Composable RowScope.() -> Unit = {},
    /** The main action as a floating button; the content keeps room free for it at the bottom. */
    primaryAction: (@Composable () -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Scaffold(
        // ── Its own snackbar host ──
        //
        // The messages run through a flow (vm.snackbar), and AppNavigation shows them
        // on `snackbarHostState`; the host for that lives in the tab scaffold, which isn't
        // in this composition here. Without this line, „Gutschein gespeichert“, „250
        // CHF“ and every rejection of the balance query would silently get lost.
        snackbarHost = { SnackbarHost(snackbarHostState) },
        // The header of the detail pages: heading, on two lines instead of truncated with large text.
        topBar = { DetailTopAppBar(title, onBack, close = false, actions = actions) },
        floatingActionButton = { primaryAction?.invoke() },
    ) { inner ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(inner)
                .verticalScroll(rememberScrollState())
                // Centered at reading width on the tablet: a row past 1200 dp no longer
                // reads in one sweep.
                .centeredUntil(width)
                .padding(horizontal = Spacing.large, vertical = Spacing.large),
            verticalArrangement = Arrangement.spacedBy(Spacing.large),
        ) {
            content()
            // The floating button would otherwise cover the last row.
            if (primaryAction != null) Spacer(Modifier.height(PRIMARY_ACTION_SPACE))
        }
    }
}

/** Height of a floating button including its margin to the edge. */
private val PRIMARY_ACTION_SPACE = 72.dp
