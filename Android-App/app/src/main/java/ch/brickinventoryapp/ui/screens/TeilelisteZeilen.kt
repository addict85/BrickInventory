package ch.brickinventoryapp.ui.screens

// Die Zeilen der temporären Teileliste. Eigene Datei ohne Compose, damit die
// Auflösung eines Sets (ui/Teileliste.kt) ohne Oberfläche prüfbar ist.

data class PlSet(val setNumber: String, var name: String = "")

data class PlPart(
    val partNumber: String,
    val blPartNumber: String? = null,
    val partName: String,
    val colorName: String,
    val colorHex: String?,
    val colorId: Int = 0,
    val blColorId: Int? = null,
    var quantity: Int,
    val imageUrl: String?,
    val imageLocal: String? = null,
    val isFig: Boolean = false,
    /**
     * Wie viele davon im eigenen Bestand liegen — `null`, solange nicht
     * gefragt wurde.
     *
     * `null` und `0` sind ausdruecklich verschieden: `null` heisst „nicht
     * gefragt" (die Zeile zeigt gar nichts), `0` heisst „gefragt, nichts
     * vorhanden" (die Zeile zeigt eine rote Null). Ein Int mit Vorgabe 0
     * haette beides zu „habe ich nicht" verschmolzen.
     */
    val vorhanden: Int? = null,
)
