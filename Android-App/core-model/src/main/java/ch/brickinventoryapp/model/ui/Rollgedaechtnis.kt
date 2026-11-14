package ch.brickinventoryapp.model.ui

/**
 * Gemerkte Rollpositionen je Reiter. Liegt unter der Oberfläche, weil der Zustand
 * (AppViewModel) den Merker hält und die Bildschirme ihn nur lesen: So kennt die
 * Zustandsschicht kein Compose-Modul.
 */

interface ScrollMemory {
    fun lies(schluessel: String): Pair<Int, Int>
    fun merke(schluessel: String, index: Int, offset: Int)

    /** Nach einem Filterwechsel: Die alte Stelle zeigt auf Einträge, die es nicht mehr gibt. */
    fun vergiss(schluessel: String)
}

/** Für Tests ohne Hilt. */
fun ScrollMemory(): ScrollMemory = ScrollSpeicher()

/** Eine Instanz für die ganze App; Hilt bindet sie im Zustandsmodul als Singleton. */
class ScrollSpeicher : ScrollMemory {
    private val positionen = mutableMapOf<String, Pair<Int, Int>>()

    override fun lies(schluessel: String): Pair<Int, Int> = positionen[schluessel] ?: (0 to 0)

    override fun merke(schluessel: String, index: Int, offset: Int) {
        positionen[schluessel] = index to offset
    }

    override fun vergiss(schluessel: String) {
        positionen.remove(schluessel)
    }
}
