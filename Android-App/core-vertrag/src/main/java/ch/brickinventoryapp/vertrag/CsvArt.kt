package ch.brickinventoryapp.vertrag

/**
 * Welche Art CSV importiert wird: dieselbe Bedienung für alle, die die Webapp
 * anbietet, deshalb ein Aufzählungstyp statt eines Aufrufwegs je Art.
 */
enum class CsvArt { SETS, TEILE, MINIFIGUREN, MERKLISTE, PREISALARME }
