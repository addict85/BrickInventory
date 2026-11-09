package ch.brickinventoryapp.data.util

import ch.brickinventoryapp.netz.util.Protokoll
import okhttp3.logging.HttpLoggingInterceptor

/**
 * Der Netzmitschnitt des Debug-Builds: nur Anfrage- und Statuszeile, nie Rümpfe
 * (Passwörter, Gutschein-PINs). Die Köpfe mit Token oder Sitzung sind zusätzlich
 * geschwärzt, falls jemand beim Suchen die Stufe hochdreht.
 */
internal fun netzMitschnitt(
    schreiber: HttpLoggingInterceptor.Logger = HttpLoggingInterceptor.Logger { Protokoll.notiz("OkHttp", it) },
): HttpLoggingInterceptor = HttpLoggingInterceptor(schreiber).apply {
    level = HttpLoggingInterceptor.Level.BASIC
    redactHeader("Authorization")
    redactHeader("Cookie")
    redactHeader("Set-Cookie")
}
