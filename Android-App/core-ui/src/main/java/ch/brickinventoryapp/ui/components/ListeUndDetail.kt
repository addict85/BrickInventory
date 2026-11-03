package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier

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
        Box(Modifier.weight(0.58f).fillMaxHeight()) { detail() }
    }
}
