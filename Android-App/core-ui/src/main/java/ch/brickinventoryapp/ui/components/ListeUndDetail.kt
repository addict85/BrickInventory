package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.ressourcen.R

/**
 * Der Schlüssel des Eintrags, dessen Detail gerade daneben steht — die Liste markiert
 * seine Kachel. Als Local statt Parameter, weil die Liste ihn nur im Zweierbild braucht.
 */
val LocalOffenesDetail = staticCompositionLocalOf<String?> { null }

/**
 * Liste links, Detail rechts — auf breiten Fenstern ([ch.brickinventoryapp.ui.listeUndDetail]).
 * Die Liste behält gut zwei Fünftel, damit ihr Raster zwei Spalten hat; das Detail
 * bekommt den Rest und bleibt damit einspaltig lesbar. Ob nebeneinander, entscheidet
 * der Aufrufer am Fenster, weil auch das Gerüst (Seitenleiste) davon abhängt.
 */
@Composable
fun ListeUndDetail(
    modifier: Modifier = Modifier,
    liste: @Composable () -> Unit,
    detail: @Composable () -> Unit,
) {
    Row(modifier.fillMaxSize()) {
        Box(Modifier.weight(0.42f).fillMaxHeight()) { liste() }
        VerticalDivider()
        Box(Modifier.weight(0.58f).fillMaxHeight()) {
            CompositionLocalProvider(LocalImDetailBereich provides true) { detail() }
        }
    }
}

/**
 * Steht der Bildschirm als rechte Hälfte neben seiner Liste? Dann schliesst sein
 * Knopf oben nur das Detail, und ein Zurück-Pfeil versprach eine Seite, die es nicht
 * gibt — Material zeigt ihn in Liste und Detail nur einspaltig.
 */
val LocalImDetailBereich = staticCompositionLocalOf { false }

/** Der Knopf oben links einer Detailseite: Zurück auf eigener Seite, Schliessen neben der Liste. */
@Composable
fun ZurueckKnopf(onClick: () -> Unit) {
    IconButton(onClick = onClick) {
        if (LocalImDetailBereich.current) Icon(Icons.Default.Close, stringResource(R.string.detail_close))
        else Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.common_back))
    }
}
