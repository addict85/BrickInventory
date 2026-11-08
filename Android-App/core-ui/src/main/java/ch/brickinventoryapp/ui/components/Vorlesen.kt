package ch.brickinventoryapp.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.util.fmtInt

/** „12 Stück“ für eine Mengenplakette „×12“: TalkBack las das Zeichen als „mal“. */
@Composable
fun stueckzahl(menge: Int): String = pluralStringResource(R.plurals.cd_stueck, menge, fmtInt(menge))

/**
 * Ersetzt, was TalkBack an diesem Text liest: Kurzformen wie „×12“, „✓“ oder eine
 * nackte Jahreszahl haben vorgelesen keine Bedeutung.
 */
fun Modifier.vorgelesenAls(text: String): Modifier = clearAndSetSemantics { contentDescription = text }

/** „a 1 b 2 - c 3 d 4“: Codes Zeichen für Zeichen vorlesen, nicht als Wort („i9j0“). */
fun zeichenweise(code: String): String = code.toList().joinToString(" ")
