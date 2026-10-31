package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.model.TokenRotation
import ch.brickinventoryapp.data.repository.Result
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Wie ein Tausch ausging. */
enum class Tauschergebnis { GETAUSCHT, SCHON_GETAUSCHT, SPAETER, NEU_KOPPELN }

/**
 * Tauscht den Token, wenn der Server es verlangt (Kopfzeile `X-Token-Rotation:
 * faellig` oder 401 `token_rotation_noetig`). Der neue Token wird gespeichert,
 * BEVOR ihn jemand benutzt: Ginge die App zwischen Antwort und Speichern zu,
 * stünde sonst nur noch der alte da — und der gilt nach dem Tausch nur 5 min.
 *
 * Nur ein Tausch zugleich (Sperre): Sehen mehrere Anfragen die Kopfzeile, tauscht
 * die erste; die übrigen finden danach einen anderen Token vor und tun nichts.
 * Geht die Antwort verloren, gilt der alte Token serverseitig noch 5 min — so
 * lange wird mit ihm erneut getauscht, danach hilft nur neues Koppeln.
 */
class TokenTausch(
    private val token: suspend () -> String,
    private val speichere: suspend (String) -> Unit,
    private val rotiere: suspend (alterToken: String) -> Result<TokenRotation>,
    private val uhr: () -> Long = System::currentTimeMillis,
    private val pausen: List<Long> = listOf(2_000, 10_000, 30_000),
    private val hintergrund: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
) : ch.brickinventoryapp.di.Rotationsanlass {
    private val sperre = Mutex()

    /** Für die Kopfzeile: nicht warten, die Anfrage selbst ist gelungen. */
    override fun faellig(alterToken: String) {
        if (sperre.isLocked) return
        hintergrund.launch { tausche(alterToken) }
    }

    /**
     * Für 401 `token_rotation_noetig`, auf dem Netz-Thread von OkHttp: Warten ist
     * hier richtig, die Anfrage braucht den neuen Token.
     */
    override fun noetig(alterToken: String): String? = runBlocking {
        when (tausche(alterToken)) {
            Tauschergebnis.GETAUSCHT, Tauschergebnis.SCHON_GETAUSCHT -> token().takeIf { it != alterToken }
            Tauschergebnis.SPAETER, Tauschergebnis.NEU_KOPPELN -> null
        }
    }

    suspend fun tausche(alterToken: String): Tauschergebnis = sperre.withLock { tauscheGesperrt(alterToken) }

    private suspend fun tauscheGesperrt(alterToken: String): Tauschergebnis {
        if (token() != alterToken) return Tauschergebnis.SCHON_GETAUSCHT
        val beginn = uhr()
        for (versuch in 0..pausen.size) {
            when (val r = rotiere(alterToken)) {
                is Result.Success -> {
                    val neu = r.data.token?.takeIf { it.isNotBlank() } ?: return Tauschergebnis.SPAETER
                    speichere(neu)
                    return Tauschergebnis.GETAUSCHT
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
