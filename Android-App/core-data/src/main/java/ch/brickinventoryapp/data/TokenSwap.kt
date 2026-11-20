package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.repository.Ergebnis
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.transformLatest
import kotlinx.coroutines.launch
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import ch.brickinventoryapp.network.di.Rotationsanlass

/**
 * Wie ein Tausch ausging. DISCARDED: Während des Tauschs wurde abgemeldet, neu
 * angemeldet oder der Server gewechselt; der neue Token gehört nicht mehr hierher.
 */
internal enum class Tauschergebnis { GETAUSCHT, ALREADY_SWAPPED, LATER, NEW_PAIR, DISCARDED }

/** Was der Tausch vom Speicher sieht; [generation] zählt Anmelden, Abmelden und Serverwechsel. */
data class TokenStatus(val token: String, val herkunft: String?, val generation: Long)

/**
 * Der neue Token und die Herkunft der Anfrage, die ihn brachte (nach Umschreiben und Umleitung).
 * Nur diese zwei Werte: Der Tausch braucht nicht mehr, und das Wire-Format bleibt in core-data.
 */
data class SwappedToken(val token: String?, val herkunft: String?)

/**
 * Sperre und Generation für jede Schreibung des Tokens. Ein Tausch kann bis zu
 * einer halben Minute wiederholen; speichert er danach blind, landet der Token
 * des alten Kontos oder Servers in der neuen Sitzung. Darum speichert er nur,
 * wenn Token, Herkunft und Generation noch dieselben sind — unter derselben
 * Sperre, unter der Anmelden, Abmelden und Serverwechsel schreiben.
 */
internal class TokenLimit {
    private val lock = Mutex()
    @Volatile var generation: Long = 0
        private set

    /** Für Anmelden, Abmelden, Serverwechsel: [newSession] beendet laufende Tausche. */
    suspend fun <T> schreibe(newSession: suspend () -> Boolean = { true }, block: suspend () -> T): T =
        lock.withLock {
            if (newSession()) generation++
            block()
        }

    /** Schreibt nur, wenn [jetzt] noch [vorher] ist und der Token von dessen Herkunft kam. */
    suspend fun replaceIf(vorher: TokenStatus, requestOrigin: String?, jetzt: suspend () -> TokenStatus,
                             speichere: suspend () -> Unit): Boolean = lock.withLock {
        if (requestOrigin == null || requestOrigin != vorher.herkunft || jetzt() != vorher) return@withLock false
        speichere()
        true
    }

    /**
     * Spiegelt einen Wert der Platte in den Speicher. Die Schreibungen setzen den
     * Speicher vor der Platte; ein Wert, der unterwegs schon überholt wurde, darf ihn
     * nicht zurückdrehen. Darum gilt er nur, wenn die Platte ihn unter der Sperre noch hat.
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    suspend fun <P, R, T> mirror(
        strom: Flow<P>,
        jetzt: suspend () -> P,
        roh: (P) -> R,
        lies: suspend (R, suspend (T) -> Unit) -> Unit,
        setze: (T) -> Unit,
        gelesen: () -> Unit,
    ) {
        var erster = true
        strom.map(roh).distinctUntilChanged()
            .transformLatest { r -> lies(r) { emit(r to it) } }
            .collect { (r, wert) ->
                lock.withLock { if (roh(jetzt()) == r) setze(wert) }
                if (erster) { erster = false; gelesen() }
            }
    }
}

/**
 * Höchstdauer einer Anmeldung, dieselbe wie die harte Frist des Servers
 * (APP_HOECHSTDAUER_TAGE in Web-App/routes/auth.ts; der Tausch erbt sie). Die
 * Prüfung hier ist die zweite Linie: Die App meldet sich selbst ab und entwertet den
 * Token, statt erst am 401 zu merken, dass die Kette zu Ende ist.
 */
internal const val TOKEN_MAX_DURATION_DAYS = 180L

internal fun loginOverdue(signedInAt: Long, jetzt: Long): Boolean =
    jetzt - signedInAt > TOKEN_MAX_DURATION_DAYS * 24 * 60 * 60 * 1000

/**
 * Tauscht den Token, wenn der Server es verlangt (Kopfzeile `X-Token-Rotation:
 * faellig` oder 401 `token_rotation_noetig`). Der neue Token wird gespeichert,
 * BEVOR ihn jemand benutzt: Ginge die App zwischen Antwort und Speichern zu,
 * stünde sonst nur noch der alte da — und der gilt nach dem Tausch nur 5 min.
 */
internal class TokenSwap(
    private val stand: suspend () -> TokenStatus,
    private val ersetze: suspend (vorher: TokenStatus, neu: String, requestOrigin: String?) -> Boolean,
    private val rotiere: suspend (alterToken: String) -> Ergebnis<SwappedToken>,
    private val clock: () -> Long = System::currentTimeMillis,
    private val pausen: List<Long> = listOf(2_000, 10_000, 30_000),
    /** Für [faellig]: der Anwendungsbereich, damit der Tausch das Verlassen eines Bildschirms überlebt. */
    private val hintergrund: CoroutineScope,
    /** So lange hält noetig() einen Thread des OkHttp-Dispatchers fest. */
    private val warten: Long = NEEDED_WAIT_MS,
    /**
     * Darf jetzt getauscht werden? Bei gesperrtem Gerät nicht: Den neuen Token nähme nur ein
     * Schlüssel ohne Entsperr-Bedingung auf, und den gibt es nicht mehr (EntsperrVault).
     */
    private val bereit: () -> Boolean = { true },
) : Rotationsanlass {
    private val lock = Mutex()

    /** Für die Kopfzeile: nicht warten, die Anfrage selbst ist gelungen. */
    override fun faellig(alterToken: String) {
        if (lock.isLocked) return
        hintergrund.launch { tausche(alterToken) }
    }

    /**
     * Für 401 `token_rotation_noetig`, auf dem Netz-Thread von OkHttp: Warten ist
     * hier richtig, die Anfrage braucht den neuen Token. „Schon getauscht“ heisst
     * auch „inzwischen woanders angemeldet“ — darum nur ein Token derselben
     * Herkunft und Generation wie die abgewiesene Anfrage.
     */
    override fun noetig(alterToken: String, herkunft: String?, generation: Long): String? = runBlocking {
        neededWaiting(alterToken, herkunft, generation)
    }

    /**
     * Der Netz-Thread wartet höchstens [warten]; der Tausch selbst läuft im
     * Anwendungsbereich weiter, damit ein schon erhaltener Token noch gespeichert wird.
     */
    suspend fun neededWaiting(alterToken: String, herkunft: String?, generation: Long): String? {
        val tausch = hintergrund.async { tausche(alterToken) }
        return when (withTimeoutOrNull(warten) { tausch.await() }) {
            null -> null
            Tauschergebnis.GETAUSCHT, Tauschergebnis.ALREADY_SWAPPED -> stand()
                .takeIf { herkunft != null && it.herkunft == herkunft && it.generation == generation }
                ?.token?.takeIf { it != alterToken && it.isNotBlank() }
            Tauschergebnis.LATER, Tauschergebnis.NEW_PAIR, Tauschergebnis.DISCARDED -> null
        }
    }

    suspend fun tausche(alterToken: String): Tauschergebnis = lock.withLock { swapLocked(alterToken) }

    private suspend fun swapLocked(alterToken: String): Tauschergebnis {
        val vorher = stand()
        if (vorher.token != alterToken) return Tauschergebnis.ALREADY_SWAPPED
        if (!bereit()) return Tauschergebnis.LATER
        val beginn = clock()
        for (attempt in 0..pausen.size) {
            // Abgemeldet oder anderer Server: Der alte Token geht nicht noch einmal hinaus.
            if (attempt > 0 && stand() != vorher) return Tauschergebnis.DISCARDED
            when (val r = rotiere(alterToken)) {
                is Ergebnis.Erfolg -> return succeeded(vorher, r.data)
                is Ergebnis.Fehler -> {
                    // 401: Der alte Token gilt nicht mehr (Überlappung vorbei, widerrufen).
                    if (r is Ergebnis.Fehler.Abgewiesen) return Tauschergebnis.NEW_PAIR
                    if (!r.transient) return Tauschergebnis.LATER
                    val pause = pausen.getOrNull(attempt) ?: break
                    if (clock() - beginn + pause > OVERLAP_MS) break
                    delay(pause)
                }
            }
        }
        return Tauschergebnis.LATER
    }

    /** Eine Antwort ohne neuen Token ist kein Tausch; passt der Stand nicht mehr, wird verworfen. */
    private suspend fun succeeded(vorher: TokenStatus, antwort: SwappedToken): Tauschergebnis {
        val neu = antwort.token?.takeIf { it.isNotBlank() } ?: return Tauschergebnis.LATER
        return if (ersetze(vorher, neu, antwort.herkunft)) Tauschergebnis.GETAUSCHT else Tauschergebnis.DISCARDED
    }

    companion object {
        /** So lange gilt der alte Token nach einem Tausch weiter (ueberlappung_sek: 300). */
        const val OVERLAP_MS = 300_000L

        /** Kürzer als das Lesezeitlimit des api-Clients (60 s), länger als ein gelungener Tausch. */
        const val NEEDED_WAIT_MS = 20_000L
    }
}
