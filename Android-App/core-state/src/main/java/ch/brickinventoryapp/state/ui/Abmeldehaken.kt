package ch.brickinventoryapp.state.ui

/**
 * What must be cleared on sign-out outside the scopes — today the app's
 * widget. As an interface, because the widget lives in the app and this module
 * doesn't know it (di/AppModule.kt binds it).
 */
fun interface Abmeldehaken {
    suspend fun abgemeldet()
}
