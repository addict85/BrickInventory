package ch.brickinventoryapp.util

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * Was an eine fremde App (Browser) gehen darf: nur https. Die Adressen kommen
 * aus Serverdaten (Anleitungen, Kauf-Links); ein `intent:`, `file:` oder
 * `content:` darin öffnete sonst beliebige Ziele im Gerät. Den eigenen Server
 * öffnet die App selbst, dafür braucht es hier kein http.
 */
fun externeAdresse(url: String?): HttpUrl? =
    url?.trim()?.toHttpUrlOrNull()?.takeIf { it.isHttps }

/**
 * Ein Pfad des eigenen Servers als volle Adresse — aufgelöst statt verkettet, und
 * nur, wenn er auf demselben Server bleibt: `//fremd.example/x` oder eine volle
 * Adresse in `local_path` führten sonst den Token-Client zu einem fremden Host.
 * Relativ zur Serveradresse samt Unterpfad, wie es die Verkettung vorher war.
 */
fun eigeneAdresse(serverUrl: String, pfad: String): String? {
    val basis = (serverUrl.trim().trimEnd('/') + "/").toHttpUrlOrNull() ?: return null
    val ziel = basis.resolve(pfad.trim().removePrefix("/")) ?: return null
    return ziel.takeIf { it.scheme == basis.scheme && it.host == basis.host && it.port == basis.port }?.toString()
}
