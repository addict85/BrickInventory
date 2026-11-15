package ch.brickinventoryapp.model.fach

// Was eine Bearbeitung des Bestands trägt, wenn sie im Ausgang wartet oder die Ablage nachzieht.

/** Ein Merkposten, der angelegt werden soll; [besitzer] null heisst das eigene Konto. */
data class Merkwunsch(val setNumber: String, val zustand: Zustand = Zustand.NEU, val besitzer: Int? = null)

/**
 * Was an einem manuellen Teil oder einer Figur geändert wird. Mit [schritt] zählen zwei Geräte
 * zusammen (quantity_delta); ein Server ohne nimmt [menge], dann gewinnt der Letzte.
 */
data class Stueckaenderung(
    val menge: Int,
    val schritt: Int? = null,
    val stueckpreis: Geld? = null,
    val zustand: Zustand? = null,
    val blNummer: String? = null,
)

/**
 * Die Kaufsumme eines Sets nach einer Kaufänderung, vollständig: Ein Preis null heisst
 * „keiner erfasst“, nicht „unbekannt“.
 */
data class Setzusammenfassung(
    val setNumber: String,
    val zustand: Zustand,
    val zustaende: List<Zustand>,
    val gebraucht: Int,
    val hoechsterKaufpreis: Geld?,
    val kaufpreisSchnitt: Geld?,
)
