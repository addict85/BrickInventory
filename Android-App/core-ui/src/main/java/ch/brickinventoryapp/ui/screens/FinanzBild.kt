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
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.*
import coil3.ImageLoader

/**
 * Das Vorschaubild einer Finanzzeile — 52 dp, Rückfall auf das gemeinsame Ersatzbild. Eine Funktion
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
        ch.brickinventoryapp.ui.components.ProduktBild(
            model = imageUrl, imageLoader = imageLoader,
            contentDescription = beschreibung,
            modifier = Modifier.fillMaxSize().clip(Formen.kachel),
            contentScale = ContentScale.Fit,
            ersatzGroesse = 28.dp,
            bildgrund = true,
            innenAbstand = 2.dp,
        )
    }
}
