package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import kotlinx.coroutines.delay

/**
 * Eine Statusmeldung nur für TalkBack, ohne eigene Fläche: Sie steht neben dem
 * sichtbaren Text, wenn dieser in einem Knopf oder Feld liegt, das sonst als Ganzes
 * zur Live-Region würde und jede Änderung ansagte.
 */
@Composable
fun Ansage(text: String?, modifier: Modifier = Modifier) {
    Box(modifier.ansagen().semantics { if (text != null) contentDescription = text })
}

/**
 * Wie [Ansage], aber höchstens alle [abstandMs] ein neuer Wortlaut: Ein Countdown,
 * der jede Sekunde angesagt würde, übertönte alles andere.
 */
@Composable
fun GedrosselteAnsage(text: String, abstandMs: Long = ANSAGE_ABSTAND_MS) {
    val aktuell by rememberUpdatedState(text)
    var ansageFortschritt by remember { mutableStateOf(text) }
    LaunchedEffect(abstandMs) {
        while (true) {
            delay(abstandMs)
            ansageFortschritt = aktuell
        }
    }
    Ansage(ansageFortschritt)
}

/** Zehn Sekunden zwischen zwei Ansagen eines laufenden Vorgangs. */
const val ANSAGE_ABSTAND_MS = 10_000L
