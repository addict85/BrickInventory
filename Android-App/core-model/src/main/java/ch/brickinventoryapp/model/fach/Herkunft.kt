package ch.brickinventoryapp.model.fach

/** Woher eine Figur im Bestand kommt; der Server schreibt „set“ oder „manual“. */
enum class Herkunft(val kennung: String) {
    SET("set"),
    MANUELL("manual"),
    ;

    companion object {
        /** Ein unbekanntes Wort zählt als Set: So zeigt die Karte keine Käufe, die es nicht gibt. */
        fun aus(kennung: String?): Herkunft = entries.firstOrNull { it.kennung == kennung } ?: SET
    }
}
