package ch.brickinventoryapp.collection.ui

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.OpenInBrowser
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import ch.brickinventoryapp.network.util.externalAddress
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.secondaryButtonColors
import ch.brickinventoryapp.ui.components.secondaryButtonRand
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.util.openExtern

/** The search at toppreise.ch; the query is encoded, a `#` or `&` would change the address. */
internal fun comparisonUrl(query: String): String =
    "https://www.toppreise.ch/produktsuche".toUri().buildUpon().appendQueryParameter("q", query).build().toString()

/**
 * The same query the server builds (`catalog/priceComparison.ts`): "LEGO", the number without
 * its variant and the name. Used where the server sent no address, e.g. right after a scan.
 */
internal fun setComparisonUrl(setNumber: String, name: String?): String? {
    val number = setNumber.replace(Regex("-\\d+$"), "").trim()
    if (number.isEmpty()) return null
    return comparisonUrl(listOf("LEGO", number, name?.trim().orEmpty()).filter { it.isNotEmpty() }.joinToString(" "))
}

/**
 * "Preisvergleich" where the set already is: the comparison only opens the browser, a
 * tab of its own in the bar cost a slot for one button. [onNoApp] tells the page to say
 * that no browser opened it.
 */
@Composable
internal fun PriceComparisonButton(url: String, onNoApp: () -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    OutlinedButton(
        onClick = { if (!openExtern(context, externalAddress(url))) onNoApp() },
        modifier = modifier,
        colors = secondaryButtonColors(),
        border = secondaryButtonRand(),
    ) {
        Icon(Icons.Default.OpenInBrowser, null, Modifier.size(withFont(18.dp)))
        Spacer(Modifier.width(Spacing.tiny))
        Text(stringResource(R.string.detail_compare))
    }
}
