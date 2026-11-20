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
        val DEFAULT = NEUESTE
        fun aus(kennung: String?): Setsortierung = entries.firstOrNull { it.kennung == kennung } ?: DEFAULT
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
        val DEFAULT = NEUESTE
        fun aus(kennung: String?): Merksortierung = entries.firstOrNull { it.kennung == kennung } ?: DEFAULT
    }
}

/** Die Sortierungen des Katalogs; nach Jahr sortiert zeigt er die Jahresleiste. */
enum class Katalogsortierung(val kennung: String, val afterYear: Boolean = false) {
    JAHR_ABSTEIGEND("year_desc", afterYear = true),
    JAHR_AUFSTEIGEND("year_asc", afterYear = true),
    NAME("name_asc"),
    NUMMER("num_asc"),
    TEILE_ABSTEIGEND("parts_desc"),
    TEILE_AUFSTEIGEND("parts_asc");

    companion object {
        val DEFAULT = JAHR_ABSTEIGEND
        fun aus(kennung: String?): Katalogsortierung = entries.firstOrNull { it.kennung == kennung } ?: DEFAULT
    }
}

/**
 * Die Reihenfolgen der Minifiguren. Sortiert wird in der App: Der Server liefert die
 * Figuren ganz und nach Name, eine Wahl kennt er nicht. NAME ist seine Reihenfolge.
 */
enum class Figurenordnung {
    NAME, NUMMER, QUANTITY;

    fun sort(figuren: List<FigurAnsicht>): List<FigurAnsicht> = when (this) {
        NAME -> figuren
        NUMMER -> figuren.sortedBy { it.figNumber.lowercase() }
        QUANTITY -> figuren.sortedByDescending { it.totalQuantity ?: it.quantity }
    }

    companion object {
        val DEFAULT = NAME
    }
}
