package ch.brickinventoryapp.data

import android.app.Activity

/**
 * Die Activity, die eine angetippte Meldung öffnet. Die Datenschicht kennt die App
 * nicht; die App reicht ihre Klasse über Hilt herein (di/AppModule.kt).
 */
class Startziel(val aktivitaet: Class<out Activity>)
