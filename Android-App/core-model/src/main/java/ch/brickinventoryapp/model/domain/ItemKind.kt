package ch.brickinventoryapp.model.domain

import kotlinx.serialization.Serializable

/**
 * Which kind of item is meant: a set, a part or a figure. As a type from the
 * route into the ViewModel, so that no screen misspells „fig“; [identifier] is
 * the server's text and goes over the wire only in the api layer.
 */
@Serializable
enum class ItemKind(val identifier: String) {
    SET("set"), PART("part"), FIG("fig");

    companion object {
        /** Throws on an unknown text: the identifiers come from the own code. */
        fun from(identifier: String): ItemKind = entries.first { it.identifier == identifier }
    }
}
