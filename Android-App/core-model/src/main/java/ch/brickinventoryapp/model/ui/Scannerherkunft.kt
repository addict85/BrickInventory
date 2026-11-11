package ch.brickinventoryapp.model.ui

import kotlinx.serialization.Serializable

/**
 * Von wo der Scanner geöffnet wurde; das entscheidet, was ein Treffer auslöst. Sie
 * reist als Feld der Route mit: Ein Text, der vorher in einem ViewModel gesetzt
 * wurde, galt auch noch beim nächsten Scan von anderswo.
 */
@Serializable
enum class Scannerherkunft {
    /** Erfassen aus der Galerie: Treffer gehen in den Bestätigungsdialog. */
    GALERIE,

    /** Suche aus der Galerie: Ein vorhandenes Set wird geöffnet statt erfasst. */
    GALERIE_SUCHE,

    /** Die Teileliste übernimmt nur die Nummer, angelegt wird nichts. */
    TEILELISTE,

    /** Ein Treffer wird zum Merkposten. */
    MERKLISTE,
}
