package ch.brickinventoryapp.ui

/**
 * A destination of the bottom bar with a remembered scroll position. Destination and list use
 * the same key, so „tab tapped, start at the top“ discards exactly the position
 * the destination remembered. The routes live in the scopes; the app
 * only knows the key via this interface.
 */
interface Reiterziel {
    val rollSchluessel: String
}
