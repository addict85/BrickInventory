package ch.brickinventoryapp.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.util.fmtInt

/** „12 Stück“ for a quantity badge „×12“: TalkBack read the symbol as „times“. */
@Composable
fun stueckzahl(menge: Int): String = pluralStringResource(R.plurals.cd_stueck, menge, fmtInt(menge))

/**
 * Replaces what TalkBack reads for this text: abbreviations like „×12“, „✓“ or a
 * bare year number mean nothing when read out loud.
 */
fun Modifier.readAloudAs(text: String): Modifier = clearAndSetSemantics { contentDescription = text }

/** „a 1 b 2 - c 3 d 4“: read out codes character by character, not as a word („i9j0“). */
fun charByChar(code: String): String = code.toList().joinToString(" ")
