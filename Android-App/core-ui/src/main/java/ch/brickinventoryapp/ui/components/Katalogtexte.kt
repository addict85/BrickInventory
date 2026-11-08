package ch.brickinventoryapp.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.intl.LocaleList
import ch.brickinventoryapp.model.ui.FarbeDeutsch
import ch.brickinventoryapp.model.ui.KategorieDeutsch

/** Ist die Oberfläche deutsch? Die Katalogdaten von Rebrickable sind es nie. */
@Composable
private fun deutsch(): Boolean = LocalConfiguration.current.locales[0].language == "de"

/**
 * Farbnamen in der Sprache der App, wie in der Webapp (colorName): „Trans-Klar“
 * statt „Trans-Clear“. Als Funktion, damit auch Listen ausserhalb der Komposition
 * (Filtereinträge in remember) übersetzt werden.
 */
@Composable
fun farbUebersetzer(): (String) -> String =
    if (deutsch()) FarbeDeutsch::uebersetze else { name -> name }

/** Teilekategorien in der Sprache der App, wie die Farben daneben („Steine“ statt „Bricks“). */
@Composable
fun kategorieUebersetzer(): (String) -> String =
    if (deutsch()) KategorieDeutsch::uebersetze else { name -> name }

/**
 * Teile- und Figurennamen bleiben englisch: Der Server liefert keine deutschen,
 * und eine Wort-für-Wort-Übersetzung („Fliese 1 x 2 mit Nut“) träfe die Namen,
 * unter denen man ein Teil bei BrickLink sucht, nicht. Ausgezeichnet sind sie als
 * Englisch, damit TalkBack sie englisch ausspricht statt deutsch zu buchstabieren.
 */
@Composable
fun katalogName(name: String): AnnotatedString =
    if (deutsch()) AnnotatedString(name, SpanStyle(localeList = LocaleList("en"))) else AnnotatedString(name)
