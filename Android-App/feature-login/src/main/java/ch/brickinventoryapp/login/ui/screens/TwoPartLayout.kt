package ch.brickinventoryapp.login.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.ui.components.outsideTheSystemBars
import ch.brickinventoryapp.ui.theme.ReadingWidth
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.theme.centeredUntil

/**
 * Brand and form of sign-in and setup: scrollable and centered as long as it fits (with a
 * keyboard or large font the main button would otherwise sit below the fold), side by side
 * in landscape from [ACROSS_TWO_COLUMN]. [body] learns whether it stands in the wide half.
 */
@Composable
internal fun TwoPartLayout(
    partPadding: Dp,
    singlePadding: PaddingValues,
    header: @Composable ColumnScope.() -> Unit,
    body: @Composable ColumnScope.(wide: Boolean) -> Unit,
) {
    BoxWithConstraints(Modifier.fillMaxSize().outsideTheSystemBars()) {
        // In Row and Column lambdas, BoxWithConstraints's receiver is locked (DslMarker).
        val height = maxHeight
        if (maxWidth > height && maxWidth >= ACROSS_TWO_COLUMN) {
            Row(
                Modifier.fillMaxSize().centeredUntil(ReadingWidth.form * 2)
                    .padding(horizontal = Spacing.huge),
                horizontalArrangement = Arrangement.spacedBy(Spacing.huge),
            ) {
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).heightIn(min = height)
                    .padding(vertical = partPadding),
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
                    content = header)
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).heightIn(min = height)
                    .padding(vertical = partPadding),
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                    body(true)
                }
            }
        } else Column(
            modifier = Modifier.verticalScroll(rememberScrollState()).heightIn(min = height)
                .centeredUntil(ReadingWidth.form)
                .padding(singlePadding),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            header()
            body(false)
        }
    }
}

/** From this width on, in landscape, brand and form sit side by side. */
private val ACROSS_TWO_COLUMN = 840.dp
