package ch.brickinventoryapp.model.fach

/**
 * Die Sortierungen der Listen, je Liste ein Typ: Der Server führt je eine Tabelle
 * (SET_SORTS, MERK_SORTS, Katalog), und ein Wert der einen gilt in der anderen nicht.
 * Auf der Leitung und in der Ablage steht die [Setsortierung.kennung]; Unbekanntes
 * liest sich als Vorgabe, wie der Server einen unbekannten Wert behandelt.
 */
enum class Setsortierung(val kennung: String) {
    NEUESTE("added_desc"),
    AELTESTE("added_asc"),
    NAME("name_asc"),
    NUMMER("num_asc"),
    JAHR("year_desc"),
    PREIS_ABSTEIGEND("price_desc"),
    PREIS_AUFSTEIGEND("price_asc"),
    MENGE_ABSTEIGEND("qty_desc"),
    MENGE_AUFSTEIGEND("qty_asc");

    companion object {
        val VORGABE = NEUESTE
        fun aus(kennung: String?): Setsortierung = entries.firstOrNull { it.kennung == kennung } ?: VORGABE
    }
}

/** Die Sortierungen der Merkliste (MERK_SORTS): ohne Menge, der Preis ist der Marktpreis. */
enum class Merksortierung(val kennung: String) {
    NEUESTE("added_desc"),
    AELTESTE("added_asc"),
    NAME("name_asc"),
    NUMMER("num_asc"),
    JAHR("year_desc"),
    PREIS_ABSTEIGEND("price_desc"),
    PREIS_AUFSTEIGEND("price_asc");

    companion object {
        val VORGABE = NEUESTE
        fun aus(kennung: String?): Merksortierung = entries.firstOrNull { it.kennung == kennung } ?: VORGABE
    }
}

/** Die Sortierungen des Katalogs; nach Jahr sortiert zeigt er die Jahresleiste. */
enum class Katalogsortierung(val kennung: String, val nachJahr: Boolean = false) {
    JAHR_ABSTEIGEND("year_desc", nachJahr = true),
    JAHR_AUFSTEIGEND("year_asc", nachJahr = true),
    NAME("name_asc"),
    NUMMER("num_asc"),
    TEILE_ABSTEIGEND("parts_desc"),
    TEILE_AUFSTEIGEND("parts_asc");

    companion object {
        val VORGABE = JAHR_ABSTEIGEND
        fun aus(kennung: String?): Katalogsortierung = entries.firstOrNull { it.kennung == kennung } ?: VORGABE
    }
}
