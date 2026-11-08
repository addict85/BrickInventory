package ch.brickinventoryapp.data.util

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/** Ob die WebAuthn-Optionen eines Servers zur eingerichteten Adresse gehören. */
enum class RpIdBefund { PASST, FEHLT, FREMD }

/**
 * Der Credential Manager signiert für jede Domain, deren assetlinks.json diese App
 * nennt — nicht nur für den eingerichteten Server. Ein fremder Server könnte die
 * Optionen des echten durchreichen und mit der Antwort dort anmelden. Darum muss
 * die rpId genau der Host der Adresse sein (der Server setzt rpID = Hostname).
 */
fun pruefeRpId(optionen: JsonObject, serverUrl: String): RpIdBefund {
    val feld = optionen["rpId"] ?: (optionen["rp"] as? JsonObject)?.get("id")
    val rpId = (feld as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf { it.isNotBlank() }
        ?: return RpIdBefund.FEHLT
    val host = serverUrl.trim().toHttpUrlOrNull()?.host ?: return RpIdBefund.FREMD
    return if (rpId == host) RpIdBefund.PASST else RpIdBefund.FREMD
}

/** Der Host der Adresse, für die Meldung. */
fun hostVon(serverUrl: String): String = serverUrl.trim().toHttpUrlOrNull()?.host ?: serverUrl
