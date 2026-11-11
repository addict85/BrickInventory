package ch.brickinventoryapp.ui

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import ch.brickinventoryapp.model.ui.Meldung

/**
 * Hier, und nur hier, wird aus einer [Meldung] ein Satz: Die Oberfläche kennt die
 * Sprache, die sie gerade zeigt. Ein Wert, der selbst eine Meldung ist, wird zuerst
 * gebildet, damit ein Satz einen anderen einbetten kann.
 */
fun Meldung.alsSatz(ctx: Context): String = when (this) {
    is Meldung.Text -> text
    is Meldung.Ressource -> if (werte.isEmpty()) ctx.getString(id) else ctx.getString(id, *werte.gebildet(ctx))
    is Meldung.Menge -> ctx.resources.getQuantityString(id, anzahl, *werte.gebildet(ctx))
}

private fun List<Any>.gebildet(ctx: Context): Array<Any> =
    map { if (it is Meldung) it.alsSatz(ctx) else it }.toTypedArray()

/** Für Bildschirme: der Satz im Context der Komposition, der die Sprache der App trägt. */
@Composable
fun Meldung.satz(): String = alsSatz(LocalContext.current)
