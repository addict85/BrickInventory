package ch.brickinventoryapp.zustand.ui

/**
 * Was beim Abmelden ausserhalb der Bereiche geleert werden muss — heute das Widget
 * der App. Als Schnittstelle, weil das Widget in der App liegt und dieses Modul
 * sie nicht kennt (di/AppModule.kt bindet es).
 */
fun interface Abmeldehaken {
    suspend fun abgemeldet()
}
