package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.R
import ch.brickinventoryapp.ui.*
import coil3.compose.AsyncImage
import coil3.ImageLoader

/**
 * Das Vorschaubild einer Finanzzeile — 52 dp, Rückfall auf das Logo. Eine Funktion
 * für die Set-Zeile (FinanceSections.kt) und die Zeile für manuelle Einträge, weil
 * beide in derselben Tabelle stehen und jede Abweichung sofort auffiele.
 */
@Composable
fun FinanzBild(imageUrl: String?, imageLoader: ImageLoader, beschreibung: String?) {
    Surface(
        shape = Formen.kachel,
        color = MaterialTheme.colorScheme.surfaceVariant,
        modifier = Modifier.size(52.dp)
    ) {
        if (imageUrl != null) {
            AsyncImage(
                model = imageUrl, imageLoader = imageLoader,
                contentDescription = beschreibung,
                modifier = Modifier.fillMaxSize().clip(Formen.kachel),
                contentScale = ContentScale.Fit
            )
        } else {
            Box(Modifier.fillMaxSize(), Alignment.Center) {
                Image(painterResource(R.drawable.ic_logo), null, Modifier.size(36.dp))
            }
        }
    }
}
