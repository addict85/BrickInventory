package ch.brickinventoryapp.contract

/**
 * Which kind of CSV is imported: the same operation for all kinds the web app
 * offers, hence an enumeration type instead of one call path per kind.
 */
enum class CsvKind { SETS, TEILE, MINIFIGUREN, MERKLISTE, PREISALARME }
