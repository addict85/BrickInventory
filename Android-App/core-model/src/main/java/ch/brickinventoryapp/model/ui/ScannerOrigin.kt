package ch.brickinventoryapp.model.ui

import kotlinx.serialization.Serializable

/**
 * From where the scanner was opened; that decides what a hit triggers. It
 * travels along as a field of the route: a text that was set in a ViewModel before
 * also still applied at the next scan from elsewhere.
 */
@Serializable
enum class ScannerOrigin {
    /** Adding from the gallery: hits go into the confirmation dialog. */
    GALLERY,

    /** Search from the gallery: the set number goes into the search field, nothing is added. */
    GALLERY_SEARCH,

    /** The parts list takes over only the number, nothing is created. */
    PART_LIST,

    /** A hit becomes a wishlist item. */
    WANTED_LIST,
}
