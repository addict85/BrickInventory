package ch.brickinventoryapp.security

import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import ch.brickinventoryapp.network.util.Protokoll

/**
 * Encryption for the bearer token; the implementation via the Keystore is in
 * TokenTresor.kt. Here, without Android classes, so the rules around it run on the JVM.
 */
interface TokenEncryption {
    /** Plaintext → storable string. Throws if the platform can't do it. */
    fun verschluessle(klartext: String): String

    /** Stored string → plaintext, or null if it isn't readable. */
    fun entschluessle(gespeichert: String): String?

    /** Like [entschluessle], but distinguishes „gone“ from „not right now“. Fakes only know „gone“. */
    fun oeffne(gespeichert: String): Tresorbefund =
        entschluessle(gespeichert)?.let { Tresorbefund.Readable(it) } ?: Tresorbefund.Weg

    /** Delete the key itself: whatever it wrapped is afterwards no longer readable anywhere. */
    fun vergiss() = Unit

    /** Is [gespeichert] under a weaker key or format than [verschluessle] would use now? */
    fun veraltet(gespeichert: String): Boolean = false

    /** After re-encrypting: the legacy key has nothing left to open and is dropped. */
    fun forgetLegacyStock() = Unit
}

/** Is the device currently locked? On the device the KeyguardManager, in the test a value. */
fun interface Geraetesperre {
    fun gesperrt(): Boolean
}

/**
 * The token under a key that only works while the device is unlocked ([onlyUnlocked]):
 * whoever reads out a locked device gets the ciphertext, but no plaintext. If it
 * can't encrypt, it throws; a weaker fallback would be exactly what a locked
 * device would expose. [altbestand] only still reads what earlier versions without a condition
 * stored, until the next unlock re-encrypts it (TokenAblage.levelTokenHigh).
 */
class EntsperrVault(
    private val onlyUnlocked: TokenEncryption,
    private val altbestand: TokenEncryption,
) : TokenEncryption {
    override fun verschluessle(klartext: String): String = UNLOCKED_PREFIX + onlyUnlocked.verschluessle(klartext)

    override fun entschluessle(gespeichert: String): String? = (oeffne(gespeichert) as? Tresorbefund.Readable)?.klartext

    override fun oeffne(gespeichert: String): Tresorbefund =
        if (gespeichert.startsWith(UNLOCKED_PREFIX)) onlyUnlocked.oeffne(gespeichert.removePrefix(UNLOCKED_PREFIX))
        else altbestand.oeffne(gespeichert)

    override fun veraltet(gespeichert: String): Boolean =
        !gespeichert.startsWith(UNLOCKED_PREFIX) || onlyUnlocked.veraltet(gespeichert.removePrefix(UNLOCKED_PREFIX))

    override fun forgetLegacyStock() = altbestand.vergiss()

    override fun vergiss() {
        onlyUnlocked.vergiss()
        altbestand.vergiss()
    }
}

/** Base64 doesn't know a colon: ciphertexts without this prefix come from the key without a condition (legacy data). */
internal const val UNLOCKED_PREFIX = "e1:"

/** What came out of opening the token. */
sealed interface Tresorbefund {
    data class Readable(val klartext: String) : Tresorbefund

    /** Key gone or ciphertext unusable: this token is not coming back. */
    data object Weg : Tresorbefund

    /** The Keystore just isn't answering right now (startup, StrongBox); the token is still there. */
    data object Gesperrt : Tresorbefund
}

/**
 * Only these errors mean „token gone“: wrong key or corrupted
 * ciphertext (AEADBadTag is a BadPadding), a key that became invalid or
 * unreadable, unreadable Base64. Everything else may succeed on the next
 * attempt and must not trigger a sign-out.
 */
internal fun vaultErrorPermanent(e: Throwable): Boolean = when (e) {
    is javax.crypto.BadPaddingException -> true
    is android.security.keystore.KeyPermanentlyInvalidatedException -> true
    is java.security.UnrecoverableKeyException -> true
    is IllegalArgumentException -> true
    else -> false
}

/** One attempt and, on a temporary error, exactly one second one. */
internal fun openWithRetry(attempt: () -> String?): Tresorbefund {
    repeat(2) {
        fangeAusserAbbruch { attempt() }
            .onSuccess { return it?.let { Tresorbefund.Readable(it) } ?: Tresorbefund.Weg }
            .onFailure { if (vaultErrorPermanent(it)) return Tresorbefund.Weg }
    }
    return Tresorbefund.Gesperrt
}

/** Pauses at startup: together under the watchdog's wait time (TokenAblage.waitOnStart). */
internal val VAULT_ATTEMPT_MS = listOf(250L, 750L, 2_000L)

/** After that it keeps going in the background, at most ten minutes; the next start tries again. */
internal const val VAULT_FOLLOW_UP_MS = 30_000L
internal const val VAULT_FOLLOW_UP_ATTEMPTS = 20

/**
 * The token from the store for [melde]. A locked Keystore reports „no token“ once
 * right after startup — the sign-in screen instead of a hanging start —,
 * but deletes nothing, and reports the token afterwards once it can be opened.
 * [alt]: the plaintext from a version before encryption.
 */
suspend fun readToken(
    tresor: TokenEncryption,
    geheim: String?,
    alt: String?,
    melde: suspend (String) -> Unit,
    wait: suspend (Long) -> Unit = { kotlinx.coroutines.delay(it) },
    lock: Geraetesperre = Geraetesperre { false },
) {
    if (geheim == null) return melde(alt ?: "")
    readPatient({ tresor.oeffne(geheim) }, alt, melde, wait, lock)
}

/**
 * Like [readToken] for every value under a key that only works unlocked (also
 * address and name of the TokenAblage): [oeffne] per attempt, [alt] on „gone“.
 */
suspend fun readPatient(
    oeffne: () -> Tresorbefund,
    alt: String?,
    melde: suspend (String) -> Unit,
    wait: suspend (Long) -> Unit = { kotlinx.coroutines.delay(it) },
    lock: Geraetesperre = Geraetesperre { false },
) {
    var attempt = 0
    var emptyReported = false
    while (true) {
        when (val b = oeffne()) {
            is Tresorbefund.Readable -> return melde(b.klartext)
            Tresorbefund.Weg -> return melde(alt ?: "")
            Tresorbefund.Gesperrt -> {
                if (attempt >= VAULT_ATTEMPT_MS.size && !emptyReported) {
                    Protokoll.warnung("Tresor", "Keystore gesperrt; Token bleibt, neuer Versuch im Hintergrund")
                    melde(alt ?: "")
                    emptyReported = true
                }
                if (attempt >= VAULT_ATTEMPT_MS.size + VAULT_FOLLOW_UP_ATTEMPTS) return
                wait(VAULT_ATTEMPT_MS.getOrElse(attempt) { VAULT_FOLLOW_UP_MS })
                // With the device locked, the key only becomes available again after unlocking:
                // that time doesn't count, otherwise the session would be gone after a night.
                if (attempt < VAULT_ATTEMPT_MS.size || !lock.gesperrt()) attempt++
            }
        }
    }
}
