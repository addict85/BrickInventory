package ch.brickinventoryapp.model.ui

import kotlinx.serialization.Serializable

/**
 * From where the scanner was opened; that decides what a hit triggers. It
 * travels along as a field of the route: a text that was set in a ViewModel before
 * also still applied at the next scan from elsewhere.
 */
@Serializable
enum class Scannerherkunft {
    /** Adding from the gallery: hits go into the confirmation dialog. */
    GALERIE,

    /** Search from the gallery: an existing set is opened instead of added. */
    GALERIE_SUCHE,

    /** The parts list takes over only the number, nothing is created. */
    TEILELISTE,

    /** A hit becomes a wishlist item. */
    MERKLISTE,
}
