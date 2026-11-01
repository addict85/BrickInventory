package ch.brickinventoryapp.util

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * Liegt [url] als APK unter [basis]? Geparst und Segment für Segment verglichen:
 * Ein Textvergleich liesse `…/apk-neuste.angreifer.tld/x.apk`, `…/../x.apk` oder
 * Varianten mit Benutzerangabe, Port oder Fragment durch.
 */
fun liegtUnter(url: String, basis: String): Boolean {
    val ziel = url.toHttpUrlOrNull() ?: return false
    val b = basis.toHttpUrlOrNull() ?: return false
    val ordner = b.pathSegments.filter { it.isNotEmpty() }
    return ziel.isHttps && ziel.host == b.host && ziel.port == b.port &&
        ziel.username.isEmpty() && ziel.password.isEmpty() && ziel.query == null && ziel.fragment == null &&
        ziel.pathSegments.size == ordner.size + 1 && ziel.pathSegments.take(ordner.size) == ordner &&
        ziel.pathSegments.last().let { it.endsWith(".apk") && it.length > 4 }
}

/** Die Signatur eines Pakets: die aktuellen Schlüssel und die Ahnenreihe (APK-Signatur v3). */
data class Signatur(val aktuell: Set<String>, val ahnen: List<String>)

/**
 * Darf ein APK mit [neu] die App mit [alt] ersetzen? Wie Android: mit mehreren
 * Signierern genau dieselben; mit einem darf der neue Schlüssel ein Nachfolger
 * sein (Schlüsselrotation) — dann steht der laufende in der Ahnenreihe des neuen.
 * Mengengleichheit lehnte jede Rotation ab. Leer heisst unbekannt, also nein.
 */
fun signaturFolgt(alt: Signatur, neu: Signatur): Boolean = when {
    alt.aktuell.isEmpty() || neu.aktuell.isEmpty() -> false
    alt.aktuell.size > 1 || neu.aktuell.size > 1 -> alt.aktuell == neu.aktuell
    else -> alt.aktuell == neu.aktuell || alt.aktuell.single() in neu.ahnen
}
