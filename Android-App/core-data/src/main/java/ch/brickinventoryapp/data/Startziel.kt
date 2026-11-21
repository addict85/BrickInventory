package ch.brickinventoryapp.data

import android.app.Activity

/**
 * The activity a tapped notification opens. The data layer does not know the app;
 * the app passes its class in via Hilt (di/AppModule.kt).
 */
class Startziel(val aktivitaet: Class<out Activity>)
