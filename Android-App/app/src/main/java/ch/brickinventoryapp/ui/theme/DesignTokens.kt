package ch.brickinventoryapp.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * ERZEUGT aus shared/design-tokens.json — NICHT von Hand aendern.
 *
 * Welche Konstante der App welchen Token spiegelt. Die Werte stehen NICHT hier — sie kommen aus 'designs' oben. Diese Zuordnung erzeugt DesignTokens.kt.
 *
 * Erzeugt von Web-App/scripts/generate-design-tokens.js. Wer hier einen Wert
 * aendert, aendert ihn nur in der App — und genau das soll diese Datei
 * verhindern. Der Wert gehoert nach shared/design-tokens.json.
 */

/** --b600 im Design "classic". */
val BrandBlue = Color(0xFF2563EB)

/** --b700 im Design "classic". */
val BrandBlueDark = Color(0xFF1D4ED8)

/** --b50 im Design "classic". */
val BrandBlueLight = Color(0xFFEFF6FF)

/** --b100 im Design "classic". */
val BrandBlue50 = Color(0xFFDBEAFE)

/**
 * --chart-new im Design "classic".
 *
 * Diagrammfarben — je Design ueberschreibbar. Vorher standen sie fest
 * im JavaScript; damit konnte kein Design sie anpassen, und im
 * Stein-Look stach das Bernstein der Gebraucht-Linie aus der ansonsten
 * blauen Palette heraus.
 */
val ChartNewClassic = Color(0xFF2563EB)

/**
 * --chart-used im Design "classic".
 *
 * Im Stein-Design Salbeigruen und Sand — dieselben Werte wie die
 * Zustands-Plaketten .cond-new und .cond-used. Der Grund ist nicht
 * Geschmack: Diese Farben stehen ueberall in der Oberflaeche fuer
 * genau diese Unterscheidung; wer sie im Diagramm wiedererkennt, muss
 * die Legende nicht lesen. Vorher stand dort --chart-used:#3d5a80 (die
 * Primaerfarbe des Designs) — zusammen mit dem hellen Blau der
 * Neu-Linie ergab das ZWEI Blautoene, die sich nur in der Helligkeit
 * unterschieden, und verkleinert oder gedruckt verschwindet so ein
 * Unterschied als Erstes.
 */
val ChartUsedClassic = Color(0xFFD97706)

/** --b600 im Design "brick". */
val SlateBlue = Color(0xFF3D5A80)

/** --b700 im Design "brick". */
val SlateBlueDark = Color(0xFF2F4763)

/** --b100 im Design "brick". */
val SlateBlueLight = Color(0xFFD9E4F0)

/**
 * --brick-petrol im Design "brick".
 *
 * Aktions- und Wertfarbe des Stein-Designs. Gibt es nur dort — im
 * Grunddesign existiert kein Gegenstueck.
 */
val Petrol = Color(0xFF3D7A8C)

/**
 * --chart-new im Design "brick".
 *
 * Diagrammfarben — je Design ueberschreibbar. Vorher standen sie fest
 * im JavaScript; damit konnte kein Design sie anpassen, und im
 * Stein-Look stach das Bernstein der Gebraucht-Linie aus der ansonsten
 * blauen Palette heraus.
 */
val ChartNewBrick = Color(0xFF5F8468)

/**
 * --chart-used im Design "brick".
 *
 * Im Stein-Design Salbeigruen und Sand — dieselben Werte wie die
 * Zustands-Plaketten .cond-new und .cond-used. Der Grund ist nicht
 * Geschmack: Diese Farben stehen ueberall in der Oberflaeche fuer
 * genau diese Unterscheidung; wer sie im Diagramm wiedererkennt, muss
 * die Legende nicht lesen. Vorher stand dort --chart-used:#3d5a80 (die
 * Primaerfarbe des Designs) — zusammen mit dem hellen Blau der
 * Neu-Linie ergab das ZWEI Blautoene, die sich nur in der Helligkeit
 * unterschieden, und verkleinert oder gedruckt verschwindet so ein
 * Unterschied als Erstes.
 */
val ChartUsedBrick = Color(0xFF9A7A45)
