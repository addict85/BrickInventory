package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.model.TokenRotation
import ch.brickinventoryapp.data.repository.Result
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Wie ein Tausch ausging. VERWORFEN: Während des Tauschs wurde abgemeldet, neu
 * angemeldet oder der Server gewechselt; der neue Token gehört nicht mehr hierher.
 */
enum class Tauschergebnis { GETAUSCHT, SCHON_GETAUSCHT, SPAETER, NEU_KOPPELN, VERWORFEN }

/** Was der Tausch vom Speicher sieht; [generation] zählt Anmelden, Abmelden und Serverwechsel. */
data class TokenStand(val token: String, val herkunft: String?, val generation: Long)

/** Der neue Token und die Herkunft der Anfrage, die ihn brachte (nach Umschreiben und Umleitung). */
data class GetauschterToken(val rotation: TokenRotation, val herkunft: String?)

/**
 * Sperre und Generation für jede Schreibung des Tokens. Ein Tausch kann bis zu
 * einer halben Minute wiederholen; speichert er danach blind, landet der Token
 * des alten Kontos oder Servers in der neuen Sitzung. Darum speichert er nur,
 * wenn Token, Herkunft und Generation noch dieselben sind — unter derselben
 * Sperre, unter der Anmelden, Abmelden und Serverwechsel schreiben.
 */
class TokenSchranke {
    private val sperre = Mutex()
    @Volatile var generation: Long = 0
        private set

    /** Für Anmelden, Abmelden, Serverwechsel: [neueSitzung] beendet laufende Tausche. */
    suspend fun <T> schreibe(neueSitzung: suspend () -> Boolean = { true }, block: suspend () -> T): T =
        sperre.withLock {
            if (neueSitzung()) generation++
            block()
        }

    /** Schreibt nur, wenn [jetzt] noch [vorher] ist und der Token von dessen Herkunft kam. */
    suspend fun ersetzeFalls(vorher: TokenStand, anfrageHerkunft: String?, jetzt: suspend () -> TokenStand,
                             speichere: suspend () -> Unit): Boolean = sperre.withLock {
        if (anfrageHerkunft == null || anfrageHerkunft != vorher.herkunft || jetzt() != vorher) return@withLock false
        speichere()
        true
    }
}

/**
 * Höchstdauer einer Anmeldung, dieselbe wie die harte Frist des Servers
 * (APP_HOECHSTDAUER_TAGE in Web-App/routes/auth.ts; der Tausch erbt sie). Die
 * Prüfung hier ist die zweite Linie: Die App meldet sich selbst ab und entwertet den
 * Token, statt erst am 401 zu merken, dass die Kette zu Ende ist.
 */
const val TOKEN_HOECHSTDAUER_TAGE = 180L

fun anmeldungUeberfaellig(angemeldetAm: Long, jetzt: Long): Boolean =
    jetzt - angemeldetAm > TOKEN_HOECHSTDAUER_TAGE * 24 * 60 * 60 * 1000

/**
 * Tauscht den Token, wenn der Server es verlangt (Kopfzeile `X-Token-Rotation:
 * faellig` oder 401 `token_rotation_noetig`). Der neue Token wird gespeichert,
 * BEVOR ihn jemand benutzt: Ginge die App zwischen Antwort und Speichern zu,
 * stünde sonst nur noch der alte da — und der gilt nach dem Tausch nur 5 min.
 * Ausführlich: docs/begruendungen/core-data/data/TokenTausch.kt.md#tokentausch
 */
class TokenTausch(
    private val stand: suspend () -> TokenStand,
    private val ersetze: suspend (vorher: TokenStand, neu: String, anfrageHerkunft: String?) -> Boolean,
    private val rotiere: suspend (alterToken: String) -> Result<GetauschterToken>,
    private val uhr: () -> Long = System::currentTimeMillis,
    private val pausen: List<Long> = listOf(2_000, 10_000, 30_000),
    /** Für [faellig]: der Anwendungsbereich, damit der Tausch das Verlassen eines Bildschirms überlebt. */
    private val hintergrund: CoroutineScope,
) : ch.brickinventoryapp.di.Rotationsanlass {
    private val sperre = Mutex()

    /** Für die Kopfzeile: nicht warten, die Anfrage selbst ist gelungen. */
    override fun faellig(alterToken: String) {
        if (sperre.isLocked) return
        hintergrund.launch { tausche(alterToken) }
    }

    /**
     * Für 401 `token_rotation_noetig`, auf dem Netz-Thread von OkHttp: Warten ist
     * hier richtig, die Anfrage braucht den neuen Token. „Schon getauscht“ heisst
     * auch „inzwischen woanders angemeldet“ — darum nur ein Token derselben
     * Herkunft und Generation wie die abgewiesene Anfrage.
     */
    override fun noetig(alterToken: String, herkunft: String?, generation: Long): String? = runBlocking {
        when (tausche(alterToken)) {
            Tauschergebnis.GETAUSCHT, Tauschergebnis.SCHON_GETAUSCHT -> stand()
                .takeIf { herkunft != null && it.herkunft == herkunft && it.generation == generation }
                ?.token?.takeIf { it != alterToken && it.isNotBlank() }
            Tauschergebnis.SPAETER, Tauschergebnis.NEU_KOPPELN, Tauschergebnis.VERWORFEN -> null
        }
    }

    suspend fun tausche(alterToken: String): Tauschergebnis = sperre.withLock { tauscheGesperrt(alterToken) }

    private suspend fun tauscheGesperrt(alterToken: String): Tauschergebnis {
        val vorher = stand()
        if (vorher.token != alterToken) return Tauschergebnis.SCHON_GETAUSCHT
        val beginn = uhr()
        for (versuch in 0..pausen.size) {
            // Abgemeldet oder anderer Server: Der alte Token geht nicht noch einmal hinaus.
            if (versuch > 0 && stand() != vorher) return Tauschergebnis.VERWORFEN
            when (val r = rotiere(alterToken)) {
                is Result.Success -> {
                    val neu = r.data.rotation.token?.takeIf { it.isNotBlank() } ?: return Tauschergebnis.SPAETER
                    return if (ersetze(vorher, neu, r.data.herkunft)) Tauschergebnis.GETAUSCHT else Tauschergebnis.VERWORFEN
                }
                is Result.Error -> {
                    // 401: Der alte Token gilt nicht mehr (Überlappung vorbei, widerrufen).
                    if (r.httpCode == 401) return Tauschergebnis.NEU_KOPPELN
                    if (!r.transient) return Tauschergebnis.SPAETER
                    val pause = pausen.getOrNull(versuch) ?: break
                    if (uhr() - beginn + pause > UEBERLAPPUNG_MS) break
                    delay(pause)
                }
            }
        }
        return Tauschergebnis.SPAETER
    }

    companion object {
        /** So lange gilt der alte Token nach einem Tausch weiter (ueberlappung_sek: 300). */
        const val UEBERLAPPUNG_MS = 300_000L
    }
}
