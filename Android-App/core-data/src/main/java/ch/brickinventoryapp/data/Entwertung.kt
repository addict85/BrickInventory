package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.repository.KontoRepository
import ch.brickinventoryapp.di.ServerWaechter
import ch.brickinventoryapp.di.Zugangslage
import ch.brickinventoryapp.util.KlartextAbgelehnt
import ch.brickinventoryapp.util.NetworkPolicy
import ch.brickinventoryapp.util.Tresorbefund
import ch.brickinventoryapp.util.eigeneAdresse
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import javax.inject.Inject

/**
 * Was eine spätere Entwertung braucht: der Server, dem das Token gehört, und das
 * Token selbst — nur verschlüsselt (Keystore), denn der Auftrag liegt bis dahin
 * in der Datenbank von WorkManager.
 */
data class Entwertungsauftrag(val serverUrl: String, val tokenGeheim: String)

/** Legt einen Auftrag in die dauerhafte Warteschlange (data/lokal/EntwertungsWorker). */
fun interface EntwertungsPlaner {
    fun plane(auftrag: Entwertungsauftrag)
}

/** Der Auftrag für das jetzige Token, oder null ohne Token (PreferencesManager). */
fun interface Entwertungsquelle {
    suspend fun entwertungsauftrag(): Entwertungsauftrag?
}

enum class Abmeldeweg { SOFORT, NACHGEHOLT, OHNE_AUFTRAG }

/**
 * Abmelden am Server: erst der kurze Versuch, und scheitert er, eine Warteschlange,
 * die wiederholt, bis der Server bestätigt. Sonst bliebe ein Token ohne Ablauf
 * gültig, sobald jemand ohne Netz abmeldet.
 */
class Abmeldung @Inject constructor(
    private val konto: KontoRepository,
    private val quelle: Entwertungsquelle,
    private val planer: EntwertungsPlaner,
) {
    suspend fun amServer(): Abmeldeweg {
        // Vor dem Versuch: Danach räumt das Abmelden das Token weg.
        val auftrag = quelle.entwertungsauftrag()
        return when (konto.entwertenAmServer()) {
            Entwertungsergebnis.ENTWERTET -> Abmeldeweg.SOFORT
            Entwertungsergebnis.AUFGEBEN -> Abmeldeweg.OHNE_AUFTRAG
            Entwertungsergebnis.SPAETER -> if (auftrag == null) Abmeldeweg.OHNE_AUFTRAG
                else Abmeldeweg.NACHGEHOLT.also { planer.plane(auftrag) }
        }
    }
}

enum class Entwertungsergebnis { ENTWERTET, SPAETER, AUFGEBEN }

/**
 * 401 heisst: Das Token gilt schon nicht mehr, das Ziel ist erreicht. Eine
 * Umleitung (nur innerhalb des Servers verfolgt) oder ein anderer 4xx-Satz wird
 * auch beim zehnten Mal nicht anders; Zeitüberschreitung, 429 und 5xx schon.
 */
fun einordnenEntwertung(code: Int): Entwertungsergebnis = when {
    code in 200..299 || code == 401 -> Entwertungsergebnis.ENTWERTET
    code == 408 || code == 429 || code >= 500 -> Entwertungsergebnis.SPAETER
    else -> Entwertungsergebnis.AUFGEBEN
}

/**
 * POST /auth/logout mit genau diesem Token an genau diesen Server. Über einen
 * eigenen Wächter: Der der App kennt nach dem Abmelden kein Token mehr und strich
 * den Kopf; dieser hält dieselben Regeln (https, Pfad, Umleitungen) für den Auftrag.
 */
class Entwerter(private val basis: OkHttpClient, private val entwicklung: Boolean) {

    fun entwerte(serverUrl: String, token: String): Entwertungsergebnis {
        val ziel = eigeneAdresse(serverUrl, "api/v1/auth/logout")
        if (token.isBlank() || ziel == null) return Entwertungsergebnis.AUFGEBEN
        val lage = object : Zugangslage {
            override fun serverUrl() = serverUrl
            override fun token() = token
            override fun tokenHerkunft() = NetworkPolicy.herkunft(serverUrl)
            override fun generation() = 0L
        }
        val client = basis.newBuilder()
            .followRedirects(false).followSslRedirects(false)
            .addInterceptor(ServerWaechter(lage, istApiClient = false, entwicklung = entwicklung, sitzungAbgelaufen = {}))
            .build()
        val anfrage = Request.Builder().url(ziel).post("{}".toRequestBody("application/json".toMediaType())).build()
        return try {
            client.newCall(anfrage).execute().use { einordnenEntwertung(it.code) }
        } catch (_: KlartextAbgelehnt) {
            Entwertungsergebnis.AUFGEBEN
        } catch (_: java.io.IOException) {
            Entwertungsergebnis.SPAETER
        }
    }
}

enum class Entwertungsschritt { FERTIG, NOCHMAL, AUFGEGEBEN }

/** Etwa eine Woche bei WorkManagers Rückzug (30 s, verdoppelt, höchstens 5 h). */
const val ENTWERTUNG_HOECHSTVERSUCHE = 40

/**
 * Ein Lauf des Arbeiters. Ein gesperrter Keystore ist wie ein fehlendes Netz ein
 * Grund zu warten (util/Tresorbefund); ein verlorener Schlüssel macht das Token
 * auch für einen Dieb unbrauchbar, also gibt es nichts mehr zu tun.
 */
fun entwertungsSchritt(befund: Tresorbefund, versuch: Int, entwerte: (String) -> Entwertungsergebnis): Entwertungsschritt =
    when (befund) {
        Tresorbefund.Weg -> Entwertungsschritt.AUFGEGEBEN
        Tresorbefund.Gesperrt -> if (versuch + 1 >= ENTWERTUNG_HOECHSTVERSUCHE) Entwertungsschritt.AUFGEGEBEN else Entwertungsschritt.NOCHMAL
        is Tresorbefund.Lesbar -> when (entwerte(befund.klartext)) {
            Entwertungsergebnis.ENTWERTET -> Entwertungsschritt.FERTIG
            Entwertungsergebnis.AUFGEBEN -> Entwertungsschritt.AUFGEGEBEN
            Entwertungsergebnis.SPAETER ->
                if (versuch + 1 >= ENTWERTUNG_HOECHSTVERSUCHE) Entwertungsschritt.AUFGEGEBEN else Entwertungsschritt.NOCHMAL
        }
    }
